/* Deterministic refresh-rate pacing, independent of a physical display. */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../activities/bopl-royale/game.js'), 'utf8');
function scheduler(frameRate = '30') {
  const state = { settings: { frameRate }, canvasSizeDirty: false };
  const start = source.indexOf('    let scheduledFrameRate=');
  const end = source.indexOf('    function gameLoop(ts)', start);
  assert(start >= 0 && end > start);
  const sandbox = { state };
  vm.runInNewContext(source.slice(start, end) + '\nthis.tick=shouldRenderFrame;', sandbox);
  return { state, tick: sandbox.tick };
}
for (const refresh of [60, 90, 120, 144, 165, 240]) {
  test(`30 FPS remains 30 on a ${refresh} Hz display without accumulating refresh rounding`, () => {
    const { tick } = scheduler();
    const frames = [];
    for (let i = 0; i < refresh * 10; i++) {
      const ts = i * 1000 / refresh;
      if (tick(ts)) frames.push(ts);
    }
    assert.equal(frames.length, 300);
    for (let i = 1; i < frames.length; i++) assert(frames[i] - frames[i - 1] <= 1000 / 30 + 1000 / refresh + .01);
  });
}
test('display-sync renders each refresh and changing caps does not cause a catch-up burst', () => {
  const { state, tick } = scheduler('unlimited');
  for (let i = 0; i < 144; i++) assert.equal(tick(i * 1000 / 144), true);
  state.settings.frameRate = '30';
  assert.equal(tick(1000), true);
  assert.equal(tick(1007), false);
  assert.equal(tick(15000), true);
  assert.equal(tick(15007), false);
});
test('a resize repaints on the next refresh without resetting the normal frame cadence', () => {
  const { state, tick } = scheduler();
  assert.equal(tick(0), true);
  state.canvasSizeDirty = true;
  assert.equal(tick(7), true);
  state.canvasSizeDirty = false;
  assert.equal(tick(14), false);
  assert.equal(tick(34), true);
});
