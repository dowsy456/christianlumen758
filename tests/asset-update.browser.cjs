// Reuse one browser HTTP cache across a deployment: edited UI assets must refresh.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const mock = require('./firebase-mock.js');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const currentVersion = /loader\.js\?v=([^"']+)/.exec(html)[1];
const legacyVersion = '20260919-overlay-audio-2';
let deployed = false;
const requests = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  requests.push(url.pathname + url.search);
  const extension = path.extname(file);
  let data = fs.readFileSync(file);
  if (url.pathname === '/index.html') data = Buffer.from(deployed ? html : html.replaceAll(currentVersion, legacyVersion));
  const revision = url.searchParams.get('v') === currentVersion ? 'new' : 'old';
  if (url.pathname === '/js/calling/panel.js') data = Buffer.concat([Buffer.from(`window.__loadedCallUIRevision=${JSON.stringify(revision)};\n`), data]);
  if (url.pathname === '/css/call-panel-resize.css') data = Buffer.concat([data, Buffer.from(`\n:root { --loaded-call-css-revision: ${revision}; }\n`)]);
  res.writeHead(200, {
    'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[extension] || 'application/octet-stream',
    'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=31536000, immutable'
  });
  res.end(data);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  try {
    const context = await browser.newContext();
    await context.addInitScript(mock);
    // Do not use Playwright routing: it disables HTTP caching, masking this bug.
    await context.addInitScript(() => {
      const originalFetch = window.fetch;
      window.fetch = (url, options) => new URL(typeof url === 'string' ? url : url.url, location.href).origin === location.origin
        ? originalFetch(url, options) : Promise.resolve(new Response('null', { headers: { 'Content-Type': 'application/json' } }));
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const entry = `http://127.0.0.1:${server.address().port}/index.html`;
    await page.goto(entry);
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    assert.equal(await page.evaluate(() => window.__loadedCallUIRevision), 'old');
    await page.goto('about:blank');
    const requestCount = requests.length;
    await page.goto(entry);
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    assert.equal(requests.slice(requestCount).some(url => url.startsWith('/js/calling/panel.js?')), false, 'old JavaScript really was retained in HTTP cache');
    deployed = true;
    await page.goto('about:blank');
    await page.goto(entry);
    await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    assert.equal(await page.evaluate(() => window.__loadedCallUIRevision), 'new', 'shared call UI refreshes on deployment');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--loaded-call-css-revision').trim()), 'new', 'shared call styles refresh with the UI');
    assert.equal(await page.evaluate(() => ChatRuntime.version), currentVersion);
    const revisions = await page.locator('script[src],link[rel="stylesheet"]').evaluateAll(nodes => nodes.map(node => new URL(node.src || node.href).searchParams.get('v')));
    assert.ok(revisions.every(version => version === currentVersion), 'entry scripts, CSS, and dynamic feature scripts use one revision');
    assert.deepEqual(errors, []);
    console.log('Shared web UI upgrades through a retained browser cache without an EXE change: PASS');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
