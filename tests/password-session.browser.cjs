/* Credential lifecycle regression: isolated mock database, no live writes. */
const assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const mock=require('./firebase-mock.js');
(async()=>{
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
 try {
  const context=await browser.newContext();await context.addInitScript(mock);
  await context.route(/^https?:\/\//,route=>route.fulfill({status:200,contentType:'application/json',body:'null',headers:{'access-control-allow-origin':'*'}}));
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
  await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  await page.click('#btn-go-login');await page.fill('#login-code','TEST-USER');await page.click('#btn-login');
  await page.waitForFunction(()=>ChatApp.currentUser?.code==='TEST-USER'&&ChatApp.getStoredPlace()==='home');
  assert.equal(await page.evaluate(()=>ChatApp.liveUserListeners.has('TEST-USER')),false,'Home removes room-scoped profile listeners');
  assert.equal(await page.evaluate(()=>ChatApp.accountExistenceWatch?.code),'TEST-USER');
  const guard=await page.evaluate(async()=>{
    window.releasePendingSend=null;
    const pending=ChatApp.enqueueSendTask(()=>new Promise(resolve=>window.releasePendingSend=resolve));
    await Promise.resolve();
    let error='';try{await ChatApp.changePassword('NEW-PASS');}catch(failure){error=failure.message;}
    const beforeRelease={error,flag:!!ChatApp.passwordChangeInFlight,old:__testDatabase.get('users/TEST-USER')?.username,next:__testDatabase.get('users/NEW-PASS')};
    window.releasePendingSend();await pending;return beforeRelease;
  });
  assert.equal(guard.error,'An error occurred. Try a different password.');assert.equal(guard.flag,false);assert.equal(guard.old,'Tester');assert.equal(guard.next,null);
  const blocked=await page.evaluate(async()=>{
    await ChatApp.openRoom('test',{quiet:true});ChatApp.$('msg-input').value='Draft survives';
    ChatApp.passwordChangeInFlight=true;let ran=false;
    await ChatApp.enqueueSendTask(()=>{ran=true;});await ChatApp.sendTextMessage();await ChatApp.sendStickerMessage({id:'unused'});
    ChatApp.passwordChangeInFlight=false;
    return {ran,draft:ChatApp.$('msg-input').value,messages:__testDatabase.get('messages/test')};
  });
  assert.equal(blocked.ran,false);assert.equal(blocked.draft,'Draft survives');assert.equal(blocked.messages,null);
  await page.evaluate(()=>ChatApp.showLoggedInHome());
  await page.evaluate(async()=>{
    const original=ChatApp.logoutToLanding;
    ChatApp.logoutToLanding=async()=>{await new Promise(resolve=>window.finishRevokedLogout=resolve);return original();};
    await ChatApp.db.ref('users/TEST-USER').remove();
  });
  await page.waitForFunction(()=>ChatApp.accountSessionRevoked&&typeof window.finishRevokedLogout==='function');
  const revoked=await page.evaluate(()=>({session:ChatApp.appPresenceSession,roomPresence:ChatApp.myPresenceRef,settingsTimer:ChatApp.settingsSaveTimer,canChat:ChatApp.canChat()}));
  assert.equal(revoked.session,null);assert.equal(revoked.roomPresence,null);assert.ok(!revoked.settingsTimer);assert.equal(revoked.canChat,false);
  await page.evaluate(()=>window.finishRevokedLogout());await page.waitForFunction(()=>ChatApp.currentUser===null);
  assert.equal(await page.evaluate(()=>ChatApp.accountExistenceWatch),null);
  assert.equal(await page.evaluate(async()=>{await ChatApp.db.ref('users/TEST-USER/settings').set({soundEffectsEnabled:true});return ChatApp.loginWithCode('TEST-USER');}),null,'a leftover settings record cannot be logged in as a phantom account');
  assert.deepEqual(errors,[]);await context.close();
  console.log('PASS independent Home account watcher, immediate writer shutdown, pending-send/password exclusion, draft preservation, partial-account rejection');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
