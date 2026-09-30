const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'), fs=require('node:fs'), path=require('node:path');
function app(globals={}){const ChatApp={register(){}}; const ctx=vm.createContext({ChatApp,setTimeout,clearTimeout,...globals}); for(const file of ['core/validation','accounts/codes','accounts/password','rooms/names'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file+'.js'),'utf8'),ctx);return ChatApp;}
test('room labels preserve metadata capitalization when menus only have normalized IDs',()=>{
 const a=app();a.roomsMetaCache=new Map([['night room',{name:'Night Room'}]]);
 assert.equal(a.roomDisplayName('night room'),'Night Room');
 assert.equal(a.roomDisplayName('NIGHT ROOM',{}),'Night Room');
 assert.equal(a.roomDisplayName('night room',{name:'Updated CASE'}),'Updated CASE');
 assert.equal(a.roomDisplayName('Unknown Room'),'Unknown Room');
});
test('password migration preserves personal data and all identity references without editing content',()=>{
 const a=app(), old='OLD-PASS', next='NEW-PASS';
 const root={users:{[old]:{username:'Alice',settings:{customSoundEffects:{message:{dataURL:'data:audio/mp3;base64,AAAA'}}},prefs:{pinnedRooms:{room:true}},htmlLibrary:{file:{ownerCode:old}}}},
 usernames:{alice:{code:old}},displayNames:{alice:{code:old}},rooms:{room:{name:old,createdBy:old,password:old,online:{[old]:{state:'online'}}}},memberships:{[old]:{room:true}},
 messages:{room:{m:{text:old,userCode:old,replyTo:{userCode:old},sticker:{creatorCode:old}}}},
 pings:{[old]:{room:{ping:{from:old}}}},readReceipts:{room:{_latest:{key:'m',createdAt:1},m:{[old]:1}}},
 calendarReminders:{[old]:{date:{note:true}}},stickerCollections:{[old]:{sticker:true}},stickerSavers:{sticker:{[old]:true}},stickers:{byOwner:{[old]:{sticker:true}},meta:{sticker:{creatorCode:old}}},
 htmlHub:{byOwner:{[old]:{file:true}},files:{file:{ownerCode:old}},meta:{file:{ownerCode:old}}},
 calls:{room:{startedBy:old,members:{[old]:{code:old}},rings:{[old]:{fromCode:old,toCode:old}},screenViewers:{[old]:{[old]:{session:true}}},webrtc:{[old]:{session:{[old]:{session:{offer:true}}}}}}},appPresence:{[old]:{session:{status:'online'}}}};
 const out=a.migratePasswordData(root,old,next);
 assert.ok(out.users[next].settings.customSoundEffects.message);
 assert.equal(out.users[old],undefined);assert.equal(root.users[old].username,'Alice');
 for(const node of ['memberships','calendarReminders','stickerCollections','pings']){assert.ok(out[node][next]);assert.equal(out[node][old],undefined);}
 assert.equal(out.messages.room.m.userCode,next);assert.equal(out.messages.room.m.text,old);assert.equal(out.rooms.room.name,old);assert.equal(out.rooms.room.password,old);
 assert.equal(out.displayNames.alice.code,next);assert.equal(out.htmlHub.files.file.ownerCode,next);assert.equal(out.readReceipts.room.m[next],1);
 assert.ok(out.calls.room.screenViewers[next][next]);assert.ok(out.calls.room.webrtc[next].session[next]);
 assert.equal(out.appPresence[next],undefined);assert.equal(out.rooms.room.online[next],undefined);
});
test('password collision and stale source abort without changing either account',()=>{const a=app(),root={users:{OLD:{username:'a'},NEW:{username:'b'}}};assert.throws(()=>a.migratePasswordData(root,'OLD','NEW'),/An error occurred. Try a different password./);assert.equal(root.users.OLD.username,'a');assert.throws(()=>a.migratePasswordData(root,'MISSING','OTHER'));});
test('room rename preserves stable message/call IDs, updates labels, checks owner and case-insensitive duplicates',()=>{
 const a=app(),root={rooms:{old:{name:'Old',createdBy:'OWNER'},other:{name:'Taken',createdBy:'B'}},messages:{old:{m:{text:'Old'}}},memberships:{OWNER:{old:true}},calls:{old:{rings:{B:{roomName:'Old'}}}},pings:{B:{old:{p:{roomName:'Old'}}}}};
 const out=a.renameRoomData(root,'old','New Name','OWNER');assert.equal(out.rooms.old.name,'New Name');assert.equal(out.calls.old.rings.B.roomName,'New Name');assert.equal(out.pings.B.old.p.roomName,'New Name');assert.equal(out.messages.old.m.text,'Old');assert.ok(out.memberships.OWNER.old);
 assert.throws(()=>a.renameRoomData(root,'old','taken','OWNER'),/already exists/);assert.throws(()=>a.renameRoomData(root,'old','New','B'),/creator/);assert.throws(()=>a.renameRoomData(root,'old','Bad/Name','OWNER'));
});
test('live room rename uses only room metadata and survives a concurrent local presence update',async()=>{
 const a=app(),rooms={room:{name:'Before',createdBy:'OWNER',online:{OWNER:{state:'online'}},messageCount:3},other:{name:'Other',createdBy:'B'}},access=[];
 a.currentUser={code:'OWNER'};a.roomsMetaCache=new Map([['room',rooms.room]]);
 let attempts=0;
 a.db={ref(p){access.push(p);assert.equal(p,'rooms','Never access root, private messages, files, or call signaling');return {
  async once(){return {val:()=>structuredClone(rooms)};},
  async transaction(update,callback,applyLocally){assert.equal(applyLocally,false);if(++attempts===1){rooms.room.messageCount=4;rooms.room.online.OWNER.state='away';throw new Error('set');}const result=update(structuredClone(rooms));if(result)Object.assign(rooms,result);return {committed:!!result,snapshot:{val:()=>structuredClone(rooms)}};}
 };}};
 assert.equal(await a.renameRoom('room','After'),'After');assert.equal(rooms.room.nameLower,'after');assert.equal(rooms.room.messageCount,4);assert.equal(rooms.room.online.OWNER.state,'away');assert.equal(a.roomsMetaCache.get('room').name,'After');assert.deepEqual(access,['rooms']);
 await assert.rejects(a.renameRoom('room','OTHER'),/already exists/);
 a.currentUser.code='B';await assert.rejects(a.renameRoom('room','New'),/creator/);
 assert.equal(rooms.room.name,'After');await assert.rejects(a.renameRoom('room','Bad/Name'),/1–20/);
});
test('concurrent duplicate names, ownership changes, and deletion abort the metadata transaction',async()=>{
 for(const change of [rooms=>{rooms.other={name:'After'};},rooms=>{rooms.room.createdBy='OTHER';},rooms=>{delete rooms.room;}]){
  const a=app(),rooms={room:{name:'Before',createdBy:'OWNER'}};a.currentUser={code:'OWNER'};a.roomsMetaCache=new Map();
  a.db={ref(p){assert.equal(p,'rooms');return {async once(){return {val:()=>structuredClone(rooms)};},async transaction(update){const tentative=update(structuredClone(rooms));assert.equal(tentative.room.name,'After');change(rooms);const next=update(structuredClone(rooms));assert.equal(next,undefined);return {committed:false,snapshot:{val:()=>structuredClone(rooms)}};}};}};
  await assert.rejects(a.renameRoom('room','After'),/already exists|creator|no longer exists/);assert.notEqual(rooms.room?.name,'After');
 }
});

test('numeric room rename retries the Firebase cold null snapshot and preserves every room reference',async()=>{
 const a=app();
 const root={rooms:[null,{name:'1',createdBy:'OWNER',online:{OWNER:{state:'online'}},messageCount:2}],messages:{1:{message:{text:'Keep me'}}},memberships:{OWNER:{1:true}},calls:{1:{instanceId:'live-call'}},activePolls:{1:{poll:{endsAt:123456}}},readReceipts:{1:{message:{OWNER:123}}},typing:{1:{OWNER:true}},roomSystemEvents:{1:{event:{done:true}}}};
 const before=structuredClone(root);let attached=0,attempts=0;
 a.currentUser={code:'OWNER'};a.roomsMetaCache=new Map([['1',root.rooms[1]]]);
 a.db={ref(p){assert.equal(p,'rooms');return {
  on(){attached++;},off(){attached--;},async once(){return {val:()=>structuredClone(root.rooms)};},
  async transaction(update,callback,applyLocally){
   assert.equal(attached,1);assert.equal(applyLocally,false);
   assert.equal(update(null),null,'Cold cache must request a server retry, not abort');attempts++;
   const next=update(structuredClone(root.rooms));attempts++;
   root.rooms=next;return {committed:true,snapshot:{val:()=>structuredClone(next)}};
  }
 };}};
 const save=a.renameRoom('1','1f');
 assert.equal(a.roomDisplayName('1'),'1f','Local label changes before the async save');
 assert.equal(await save,'1f');assert.equal(attempts,2);assert.equal(attached,0);
 assert.equal(root.rooms[1].name,'1f');assert.equal(root.rooms[1].createdBy,'OWNER');assert.equal(root.rooms[1].messageCount,2);
 for(const key of Object.keys(before).filter(key=>key!=='rooms'))assert.deepEqual(root[key],before[key],`${key} remains linked to the same room`);
 assert.equal(a.pendingRoomNames.size,0);
});

test('rejected rename restores the latest server label and releases the metadata listener',async()=>{
 const a=app();a.currentUser={code:'OWNER'};a.roomsMetaCache=new Map([['room',{name:'Before',createdBy:'OWNER'}]]);
 let release,attached=0;
 a.db={ref(){return {on(){attached++;},off(){attached--;},async once(){return {val:()=>({})};},transaction(){return new Promise((resolve,reject)=>{release=reject;});}};}};
 const save=a.renameRoom('room','After');assert.equal(a.roomDisplayName('room'),'After');
 await new Promise(resolve=>setTimeout(resolve,0));
 a.roomsMetaCache.set('room',{name:'Server name',createdBy:'OWNER'});
 release(Object.assign(new Error('permission_denied'),{code:'PERMISSION_DENIED'}));
 await assert.rejects(save,/permissions/);assert.equal(a.roomDisplayName('room'),'Server name');assert.equal(attached,0);assert.equal(a.pendingRoomNames.size,0);
});
test('a stalled rename releases its UI wait without queuing a late write after the read expires',async()=>{
 const a=app({setTimeout:fn=>setTimeout(fn,5)});let writes=0,finish;
 a.currentUser={code:'OWNER'};a.roomsMetaCache=new Map();
 a.db={ref(){return {once:()=>new Promise(resolve=>{finish=resolve;}),update:async()=>{writes++;}};}};
 await assert.rejects(a.renameRoom('room','After'),/not confirmed/);
 finish({val:()=>({room:{name:'Before',createdBy:'OWNER'}})});
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(writes,0);
});
test('admin-panel joining writes one join log, preserves existing membership, and stops on failure',async()=>{
 const a=app(),logs=[],opened=[],toasts=[];let membership=null,fail=false;
 for(const file of ['rooms/management','rooms/actions'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js',file+'.js'),'utf8'),{ChatApp:a,console});
 a.currentUser={code:'ADMIN',username:'Admin',displayName:'Admin'};a.isVinny=()=>true;
 a.firebase={database:{ServerValue:{TIMESTAMP:1234}}};a.membershipMap=new Map();a.roomsMetaCache=new Map();
 a.renderRoomsList=a.closeModal=()=>{};a.showToast=toast=>toasts.push(toast);a.openRoom=id=>opened.push(id);
 a.writeRoomSystemMessage=async(...args)=>logs.push(args);
 a.db={ref(p){if(p==='rooms/private')return {once:async()=>({exists:()=>true,val:()=>({name:'Private',private:true,messageCount:12})})};assert.equal(p,'memberships/ADMIN/private');return {async transaction(update){if(fail)throw Error('permission_denied');const next=update(membership);if(next!==undefined)membership=next;return {committed:next!==undefined,snapshot:{val:()=>membership}};}};}};
 await a.joinRoomFromPanel('private');await a.joinRoomFromPanel('private');
 assert.equal(logs.length,1);assert.equal(logs[0][1].type,'member_joined');assert.equal(logs[0][2],'member-joined:ADMIN:1234');
 assert.equal(membership.joinedAt,1234);assert.equal(a.membershipMap.get('private').lastSeenCount,12);assert.deepEqual(opened,['private','private']);
 fail=true;await a.joinRoomFromPanel('private');assert.equal(opened.length,2);assert.equal(toasts.at(-1).title,'Join failed');assert.equal(logs.length,1);
});
