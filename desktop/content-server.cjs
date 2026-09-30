'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

function resolveContentPath(root, url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'chatapp:' || parsed.hostname !== 'app' || parsed.port || parsed.username || parsed.password) return null;
  let pathname;
  try { pathname = decodeURIComponent(parsed.pathname); } catch { return null; }
  if (pathname.includes('\\') || pathname.includes('\0') || pathname.includes(':')) return null;
  const relative = pathname.replace(/^\/+/, '') || 'index.html';
  const result = path.resolve(root, relative);
  const base = path.resolve(root) + path.sep;
  return result.startsWith(base) ? result : null;
}

function createContentHandler(getRoot, net) {
  return async request => {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const root = getRoot();
    if (!root) return new Response('App is starting', { status: 503 });
    const file = resolveContentPath(root, request.url);
    if (!file) return new Response('Not found', { status: 404 });
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(file).href, { method: request.method, headers: request.headers });
      // The same chatapp URL can point to a new GitHub release after restart.
      // Never let a prior release's CSS/JS shadow the selected shared web files.
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-store');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch { return new Response('Not found', { status: 404 }); }
  };
}
module.exports = { resolveContentPath, createContentHandler };
