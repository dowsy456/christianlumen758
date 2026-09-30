const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
test('each source folder fits one GitHub browser upload', () => {
 const generated = new Set(['node_modules', '.git', 'dist', 'test-results']);
 function files(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).reduce((count, entry) =>
   count + (entry.isDirectory() ? (generated.has(entry.name) ? 0 : files(path.join(dir,entry.name))) : 1), 0);
 }
 for (const entry of fs.readdirSync(root, {withFileTypes:true})) {
  if (entry.isDirectory() && !generated.has(entry.name)) {
   assert.ok(files(path.join(root,entry.name)) <= 100, `${entry.name} exceeds GitHub's 100-file upload limit`);
  }
 }
});
function context(){
 const events=[];
 const ctx=vm.createContext({document:{documentElement:{dataset:{}}},window:{dispatchEvent:e=>events.push(e.type)},Event:class{constructor(type){this.type=type;}}});
 vm.runInContext(read('js/runtime/application.js'),ctx);
 return {ctx,events};
}
test('all editable scripts parse and every declared module exists',()=>{
 let count=0;
 function walk(dir){for(const file of fs.readdirSync(dir,{withFileTypes:true})){
  const full=path.join(dir,file.name);
  if(file.isDirectory()){if(!['node_modules','.git'].includes(file.name))walk(full);}
  else if(file.name.endsWith('.js')){new vm.Script(fs.readFileSync(full,'utf8'),{filename:full});count++;}
 }}walk(root);
 assert.ok(count>80);
 const {ctx}=context();vm.runInContext(read('js/module-manifest.js'),ctx);
 assert.equal(new Set(ctx.ChatAppModules.map(e=>e.id)).size,ctx.ChatAppModules.length);
 for(const item of ctx.ChatAppModules)assert.ok(fs.existsSync(path.join(root,item.src)),item.src);
 assert.ok(read('app.js').split('\n').length<100,'entry script must remain a small bootstrap');
});
test('runtime defers side effects, initializes in manifest order, and starts once',()=>{
 const {ctx,events}=context();ctx.order=[];
 vm.runInContext(`ChatApp.register('second',()=>order.push(2));ChatApp.register('first',()=>order.push(1));`,ctx);
 assert.equal(ctx.order.length,0);
 ctx.ChatApp.initialize([{id:'first'},{id:'second'}]);ctx.ChatApp.initialize([{id:'first'},{id:'second'}]);
 assert.equal(JSON.stringify(ctx.order),'[1,2]');assert.deepEqual(events,['chatapp:ready']);
});
test('missing or duplicate modules fail before startup side effects',()=>{
 const {ctx}=context();ctx.touched=false;
 vm.runInContext(`ChatApp.register('first',()=>touched=true)`,ctx);
 assert.throws(()=>ctx.ChatApp.initialize([{id:'first'},{id:'missing'}]),/did not register/);
 assert.equal(ctx.touched,false);
 assert.throws(()=>ctx.ChatApp.register('first',()=>{}),/Duplicate/);
});
test('formatter reuse preserves timezone and DST output with a bounded cache',()=>{
 const {ctx}=context();vm.runInContext(read('js/core/formatters.js'),ctx);
 ctx.ChatApp.initialize([{id:'core/formatters'}]);
 const app=ctx.ChatApp;
 const opts={timeZone:'America/New_York',hour:'numeric',minute:'2-digit',hour12:true};
 const first=app.getDateTimeFormatter('en-US',opts);
 assert.equal(first,app.getDateTimeFormatter('en-US',{...opts}));
 for(const ts of ['2026-03-08T06:59:00Z','2026-03-08T07:01:00Z','2026-11-01T05:59:00Z','2026-11-01T06:01:00Z']){
  assert.equal(first.format(new Date(ts)),new Intl.DateTimeFormat('en-US',opts).format(new Date(ts)));
 }
 const zones=Intl.supportedValuesOf('timeZone').slice(0,80);
 for(const timeZone of zones)app.getDateTimeFormatter('en-US',{timeZone});
 assert.equal(app.dateTimeFormatterCache.size,64);
});
test('stable message timestamps avoid repeated DOM work and update at midnight',()=>{
 const {ctx}=context();
 vm.runInContext(read('js/core/formatters.js'),ctx);ctx.ChatApp.initialize([{id:'core/formatters'}]);
 vm.runInContext(read('js/rooms/home.js'),ctx);
 let refreshes=0;let date={year:2026,month:9,day:7};
 ctx.document.visibilityState='visible';ctx.document.querySelectorAll=()=>[{_refreshTimestamp:()=>refreshes++}];
 ctx.ChatApp.getAccurateNow=()=>new Date();ctx.ChatApp.getESTParts=()=>date;
 ctx.ChatApp.updateLiveMessageTimestamps();
 for(let i=0;i<1800;i++)ctx.ChatApp.updateLiveMessageTimestamps();
 assert.equal(refreshes,1);
 date={year:2026,month:9,day:8};ctx.ChatApp.updateLiveMessageTimestamps();assert.equal(refreshes,2);
 ctx.document.visibilityState='hidden';date.day=9;ctx.ChatApp.updateLiveMessageTimestamps();assert.equal(refreshes,2);
 ctx.document.visibilityState='visible';ctx.ChatApp.updateLiveMessageTimestamps();assert.equal(refreshes,3);
});
