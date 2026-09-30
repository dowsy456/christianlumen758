'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
const applySource = source.slice(source.indexOf('async function applyPendingUpdate()'), source.indexOf('async function boot()'));
function fixture(state = {}, draft = '') {
  const loaded = [], notices = [];
  const renderer = vm.createContext({ ChatApp:state, document:{querySelector:() => ({value:draft})} }); renderer.window = renderer;
  const context = vm.createContext({ pendingCandidate:{dir:'new'}, currentCandidate:{dir:'old'}, booting:false, mainWindow:{},
    appView:{webContents:{isDestroyed:() => false, executeJavaScript: async text => vm.runInContext(text,renderer)}},
    loadCandidate:async candidate => loaded.push(candidate.dir), dialog:{showMessageBox:async (_win, value) => notices.push(value)}, writeLog:() => {} });
  vm.runInContext(applySource,context);
  return {context,loaded,notices};
}
test('update protects active and paused recordings, unsent preview audio, calls, drafts and queued sends', async () => {
  for (const state of [{voiceRecorder:{state:'recording'}},{voiceRecorder:{state:'paused'}},{voicePreviewBlob:{}},{voiceRecorderStream:{}},{currentCallRoomId:'room'},{pendingSendCount:1},{pendingPoll:{question:'Unsent poll'}},{activeFirebaseUploads:new Map([['one',{}]])},{pendingFiles:[{}]}]) {
    const h = fixture(state); await h.context.applyPendingUpdate(); assert.equal(h.loaded.length,0); assert.equal(h.notices.length,1); assert.equal(h.context.booting,false);
  }
  const draft = fixture({},'unsent text'); await draft.context.applyPendingUpdate(); assert.equal(draft.loaded.length,0);
  const ready = fixture(); await ready.context.applyPendingUpdate(); assert.deepEqual(ready.loaded,['new']);
});
test('rapid update clicks perform only one renderer replacement while its busy check is pending', async () => {
  const h = fixture(); let release;
  h.context.appView.webContents.executeJavaScript = () => new Promise(resolve => {release=resolve;});
  const first = h.context.applyPendingUpdate(), second = h.context.applyPendingUpdate();
  assert.equal(h.context.booting,true); release(false); await Promise.all([first,second]);
  assert.deepEqual(h.loaded,['new']); assert.equal(h.context.booting,false);
});
