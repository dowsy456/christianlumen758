const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { createContentHandler } = require('../content-server.cjs');

test('native host serves the selected web release without caching or injecting UI', async t => {
  const fixtureRoot = path.resolve(__dirname, '../../../../updater-test-fixtures');
  await fs.mkdir(fixtureRoot, { recursive: true });
  const dir = await fs.mkdtemp(path.join(fixtureRoot, 'content-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const first = path.join(dir, 'first'), next = path.join(dir, 'next');
  await fs.mkdir(first); await fs.mkdir(next);
  const oldUI = '<html><body>Previous shared UI</body></html>';
  const newUI = '<html><body><span id="call-in-call">Shared roster</span></body></html>';
  await fs.writeFile(path.join(first, 'index.html'), oldUI);
  await fs.writeFile(path.join(next, 'index.html'), newUI);
  let selected = first;
  const handler = createContentHandler(() => selected, { fetch: async url => new Response(await fs.readFile(fileURLToPath(url))) });
  const request = { url: 'chatapp://app/index.html', method: 'GET', headers: {} };
  assert.equal(await (await handler(request)).text(), oldUI);
  selected = next;
  const response = await handler(request);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(await response.text(), newUI, 'shared file bytes are served unchanged');
});
