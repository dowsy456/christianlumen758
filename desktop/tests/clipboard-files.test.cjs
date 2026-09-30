'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { readClipboardFiles } = require('../clipboard-files.cjs');
const options = (files, size = 3) => ({ platform:'win32', executeImpl: async (program, args, opts) => {
  assert.equal(program, 'powershell.exe'); assert.equal(opts.windowsHide, true); assert.ok(args.includes('-STA'));
  return { stdout:JSON.stringify(files) };
}, fsImpl:{ stat:async () => ({ isFile:() => true, size }), readFile:async () => Buffer.from('abc') } });
test('Explorer file clipboard supports up to twelve files with names, MIME and bytes', async () => {
  const files = await readClipboardFiles(12, options(Array.from({length:12}, (_, i) => `C:\\files\\${i}.png`)));
  assert.equal(files.length, 12); assert.equal(files[0].name, '0.png'); assert.equal(files[0].type, 'image/png');
  assert.equal(Buffer.from(files[0].data).toString(), 'abc');
});
test('clipboard rejects oversize and excess files instead of silently truncating', async () => {
  await assert.rejects(readClipboardFiles(1, options(['a.txt','b.txt'])), /1 more file/);
  await assert.rejects(readClipboardFiles(12, options(['a.txt'], 126*1024*1024)), /125 MB/);
  assert.deepEqual(await readClipboardFiles(0, options(['a.txt'])), []);
});
