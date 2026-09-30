const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
 const timers=[];
 const a={register(){},currentUser:{code:'ME'},currentRoomId:'one',restoreDone:true,
  sanitizeRoomCode:String,getStoredPlace:()=>`room:${a.currentRoomId}`,views:{chat:{dataset:{active:'true'}}},
  notificationRoomHeads:new Map([['one','m'],['two','m']]),canSeeMessage:()=>true,
  roomsMetaCache:new Map([['one',{messageCount:10}],['two',{messageCount:3}]]),
  membershipMap:new Map([['one',{joinedAt:1,lastSeenCount:0}],['two',{joinedAt:2,lastSeenCount:0}]]),
  msgDataByKey:new Map(),updateRoomListItem(){},syncUnreadTaskbarBadge(){}};
 const context=vm.createContext({ChatApp:a,document:{hidden:false},window:{},console,Date,
  setTimeout:callback=>{const timer={callback};timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.cancelled=true;}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/rooms/collections.js'),'utf8'),context);
 return {a,timers};
}
test('visible reads clear synchronously, save immediately, coalesce in-flight writes and keep rooms independent',async()=>{
 const {a}=setup(),writes=[];
 a._writeLastSeen=(id,count)=>new Promise(resolve=>writes.push({id,count,resolve}));
 a.scheduleLastSeenBump('one');
 assert.equal(a.getRoomMissedCount('one'),0);assert.equal(writes.length,1,'No debounce before saving');
 a.membershipMap.set('one',a.mergePendingRoomRead('one',{joinedAt:1,lastSeenCount:0}));
 assert.equal(a.getRoomMissedCount('one'),0,'Stale membership cannot restore unread');
 a.roomsMetaCache.get('one').messageCount=11;a.scheduleLastSeenBump('one');
 a.currentRoomId='two';a.scheduleLastSeenBump('two');
 assert.deepEqual(writes.map(w=>[w.id,w.count]),[['one',10],['two',3]]);
 writes[0].resolve({committed:true,snapshot:{val:()=>({lastSeenCount:10})}});await settle();
 assert.equal(writes[2].count,11,'New reads are flushed immediately after the prior write');
 writes[1].resolve({committed:true,snapshot:{val:()=>({lastSeenCount:3})}});
 writes[2].resolve({committed:true,snapshot:{val:()=>({lastSeenCount:11})}});await settle();
 assert.equal(a.pendingRoomReads.size,0);
});
test('cold Firebase membership retries null, preserves other fields and never recreates deleted membership',async()=>{
 const {a}=setup();a.firebase={database:{ServerValue:{TIMESTAMP:123}}};
 let member={joinedAt:1,lastSeenCount:0,ownReadMessages:{mine:5}};
 a.db={ref(){return {async transaction(update){assert.equal(update(null),null);const next=update(member);member=next;return {committed:true,snapshot:{val:()=>member}};}};}};
 a.scheduleLastSeenBump('one');await settle();assert.equal(member.lastSeenCount,10);assert.equal(member.ownReadMessages.mine,5);
 a.membershipMap.get('one').lastSeenCount=0;member=null;
 a.scheduleLastSeenBump('one');await settle();assert.equal(member,null);assert.equal(a.pendingRoomReads.size,0);
});
test('failed saves retain local read and retry without waiting for another message or scroll',async()=>{
 const {a,timers}=setup();let attempts=0;
 a._writeLastSeen=async(id,count)=>{if(++attempts===1)throw Error('set');return {committed:true,snapshot:{val:()=>({lastSeenCount:count})}};};
 a.scheduleLastSeenBump('one');await settle();assert.equal(a.getRoomMissedCount('one'),0);
 assert.equal(timers.length,1);timers[0].callback();await settle();assert.equal(attempts,2);assert.equal(a.pendingRoomReads.size,0);
});
test('room clears, leaving and account changes invalidate pending writes',async()=>{
 for(const invalidate of [a=>{a.roomsMetaCache.get('one').messagesClearedAt=99;},a=>a.membershipMap.delete('one'),a=>{a.currentUser={code:'OTHER'};},a=>a.clearPendingRoomReads()]){
  const {a}=setup();a.firebase={database:{ServerValue:{TIMESTAMP:123}}};let update,finish;
  a.db={ref(){return {transaction(fn){update=fn;return new Promise(resolve=>finish=resolve);}};}};
  a.scheduleLastSeenBump('one');invalidate(a);
  assert.equal(update({joinedAt:1,lastSeenCount:0}),undefined,'Invalid read cannot write into a different room/account lifetime');
  finish({committed:false,snapshot:{val:()=>null}});await settle();a.clearPendingRoomReads();
 }
});
test('hidden content never clears unread, and optimistic outgoing stubs are not counted as read messages',()=>{
 const {a}=setup();a.canSeeMessage=()=>false;a._writeLastSeen=()=>{throw Error('Must not write');};
 a.scheduleLastSeenBump('one');assert.equal(a.getRoomMissedCount('one'),10);
 a.canSeeMessage=()=>true;a.roomsMetaCache.get('one').messageCount=0;
 a.msgDataByKey.set('draft',{__stub:true});a.scheduleLastSeenBump('one');assert.equal(a.pendingRoomReads.size,0);
});
test('clear epochs reset all readers without a global membership rewrite or losing the first new unread',async()=>{
 const {a}=setup();a.roomsMetaCache.set('one',{messageCount:0,messagesClearedAt:1000});
 a.membershipMap.set('one',{joinedAt:1,lastSeenCount:8000,lastSeenAt:500});
 assert.equal(a.getRoomMissedCount('one'),0);
 a.roomsMetaCache.get('one').messageCount=1;
 assert.equal(a.getRoomMissedCount('one'),1,'old history read count cannot swallow new messages');
 let saved;a.firebase={database:{ServerValue:{TIMESTAMP:1100}}};
 a.db={ref(){return {async transaction(update){saved=update({joinedAt:1,lastSeenCount:8000,lastSeenAt:500});return {committed:true,snapshot:{val:()=>saved}};}};}};
 a.scheduleLastSeenBump('one');await settle();
 assert.equal(saved.lastSeenCount,1);assert.equal(saved.lastSeenEpoch,1000);
 a.membershipMap.set('one',saved);a.roomsMetaCache.get('one').messageCount=2;
 assert.equal(a.getRoomMissedCount('one'),1);
});
test('clear is one atomic message/receipt write and does not await auxiliary cleanup or reopen the room',async()=>{
 const paths=[],writes=[];let invalidated='';
 const a={register(){},sanitizeRoomCode:String,isVinny:()=>true,pollNow:()=>123,
  invalidateRecentRoomMessages:id=>{invalidated=id;},
  db:{ref(p=''){paths.push(p);return {update:async patch=>{writes.push(patch);},once:()=>new Promise(()=>{})};}},
  openRoom(){throw Error('Must not reopen');}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/rooms/actions.js'),'utf8'),{ChatApp:a,console});
 assert.equal(await a.clearRoomMessages('one'),true);assert.equal(invalidated,'one');
 assert.equal(writes.length,1);assert.equal(writes[0]['messages/one'],null);assert.equal(writes[0]['readReceipts/one']._clearedAt,123);
 assert.equal(writes[0]['rooms/one/messagesClearedAt'],123);assert.deepEqual(paths,['','roomMembers/one']);
});
test('room cache retains complete tails only and never shows one latest row from an oversized attachment tail',()=>{
 const a={register(){},currentUser:{code:'ME'},MSG_LIVE_TAIL:60,compareMessageKeys:(a,b)=>a.localeCompare(b)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/rooms/cache.js'),'utf8'),{ChatApp:a});
 a.cacheRecentRoomMessages('one',new Map([['a',{text:'earlier'}],['b',{text:'latest'}]]));
 assert.equal(a.getRecentRoomMessages('one').length,2);
 a.cacheRecentRoomMessages('one',new Map([['a',{text:'x'.repeat(1100000)}],['b',{text:'latest'}]]));
 assert.equal(a.getRecentRoomMessages('one').length,0,'cache cannot expose an incomplete tail');
});
test('delayed send metadata cannot restore a cleared room count or preview',async()=>{
 let commit,finish;let room={messageCount:12,lastMessagePreview:'old'};
 const a={register(){},sanitizeRoomCode:String,currentUser:{code:'ME'},roomsMetaCache:new Map(),formatRoomLastMessagePreview:()=> 'sent',
  db:{ref(p){return {
   once:async()=>({exists:()=>true,val:()=>p.startsWith('messages/')?{createdAt:500,text:'old send'}:{...room}}),
   transaction:fn=>{commit=fn;return new Promise(resolve=>finish=resolve);},
   update(){throw Error('Must use guarded transaction');}
  };}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/chat/send.js'),'utf8'),{ChatApp:a,console,Date});
 const pending=a.updateRoomLastMessage('one','old send','m');await settle();
 room={messageCount:0,messagesClearedAt:1000};
 assert.equal(commit(room),undefined,'clear epoch invalidates the delayed metadata transaction');
 finish({committed:false,snapshot:{val:()=>room}});await pending;
 assert.equal(room.messageCount,0);assert.equal(room.lastMessagePreview,undefined);
});
