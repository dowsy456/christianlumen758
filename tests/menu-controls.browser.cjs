/* UI regressions use in-memory fixtures; remote requests are blocked. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const installFirebaseMock=require('./firebase-mock.js');
const captures=path.resolve(__dirname,'../../ui-v3-checks');
(async()=>{
  fs.mkdirSync(captures,{recursive:true});
  const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
  try {
    for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
      const context=await browser.newContext({viewport,isMobile:viewport.width<821,hasTouch:viewport.width<821});
      await context.addInitScript(installFirebaseMock);
      await context.route(/^https?:\/\//,route=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'null'}));
      const page=await context.newPage();
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
      await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
      await page.click('#btn-go-login');await page.fill('#login-code','TEST-USER');await page.click('#btn-login');
      await page.waitForFunction(()=>ChatApp.currentUser?.code==='TEST-USER');
      await page.evaluate(async()=>{
        for(let i=0;i<8;i++) {
          const id=`visual-sticker-${i}`,color=['#60b3e8','#f5ac59','#8bceaa','#a69cdf'][i%4];
          const dataURL='data:image/svg+xml;base64,'+btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="45" fill="${color}"/><circle cx="45" cy="48" r="5" fill="#1b2937"/><circle cx="75" cy="48" r="5" fill="#1b2937"/><path d="M40 72q20 20 40 0" fill="none" stroke="#1b2937" stroke-width="5" stroke-linecap="round"/></svg>`);
          await __testDatabase.ref(`stickers/meta/${id}`).set({id,name:`Smile ${i+1}`,kind:'image',mimeType:'image/svg+xml',state:'ready',creatorCode:'TEST-USER',creatorUsername:'Tester',createdAt:i+1});
          await __testDatabase.ref(`stickers/assets/${id}`).set({dataURL});
          await __testDatabase.ref(`stickerCollections/TEST-USER/${id}`).set({savedAt:i+1});
        }
        await ChatApp.openRoom('test',{quiet:true});ChatApp.closeToast();ChatApp.closeMobileDrawers();ChatApp.prepareStickerPicker();
      });
      await page.waitForFunction(()=>ChatApp.stickerLibraryMeta.size===8&&!ChatApp.bulkLoading);
      const iconGeometry=async selector=>{
        await page.locator(selector).waitFor({state:'visible'});
        const geometry=await page.locator(selector).evaluate(button=>{
          const b=button.getBoundingClientRect(),svg=button.querySelector('svg'),i=svg?.getBoundingClientRect();
          return {width:b.width,height:b.height,iconWidth:i?.width,iconHeight:i?.height,dx:i?Math.abs((b.left+b.right-i.left-i.right)/2):999,dy:i?Math.abs((b.top+b.bottom-i.top-i.bottom)/2):999,text:button.textContent.trim()};
        });
        assert.ok(geometry.width>=40&&geometry.height>=40,`${selector} has a full-size click target`);
        assert.ok(geometry.iconWidth>=20&&geometry.iconHeight>=20,`${selector} uses a legible SVG`);
        assert.ok(geometry.dx<.6&&geometry.dy<.6,`${selector} centered: ${JSON.stringify(geometry)}`);
        assert.equal(geometry.text,'',`${selector} has no text-glyph fallback`);
      };
      for(const [open,menu,close] of [['openStickerPopover','#sticker-popover','#btn-sticker-menu-close'],['openVoicePopover','#voice-popover','#btn-voice-close'],['openRoomActivitiesModal','#room-activities-menu','#room-activities-close']]) {
        await page.evaluate(name=>ChatApp[name](),open);
        await page.waitForTimeout(250);await iconGeometry(close);
        await page.locator(menu).screenshot({path:path.join(captures,`${viewport.width}-${open}.png`)});
        await page.click(close);await page.locator(menu).waitFor({state:'hidden'});
      }
      await page.evaluate(()=>{
        ChatApp.currentCallRoomId='test';ChatApp.callSessionId='ui-fixture';
        ChatApp.callMembersCache=[{code:'TEST-USER',username:'Tester',displayName:'Tester',joinedAt:Date.now()-60000,connected:true}];
        ChatApp.syncCallControlsUI();ChatApp.openCallMenu();
      });
      await page.waitForTimeout(250);
      for(const compact of [false,true]) {
        await page.evaluate(compact=>{ChatApp.setNavigationCompact(compact);if(document.body.dataset.mobileUi==='1')document.body.dataset.mobileNav='1';},compact);
        await page.waitForTimeout(300);
        const leave=await page.evaluate(()=>{
          const values=id=>{const b=document.getElementById(id),s=getComputedStyle(b),svg=b.querySelector('svg'),r=svg.getBoundingClientRect(),box=b.getBoundingClientRect();return {bg:s.backgroundColor,color:s.color,border:s.borderTopColor,width:r.width,dx:Math.abs((r.left+r.right-box.left-box.right)/2),dy:Math.abs((r.top+r.bottom-box.top-box.bottom)/2),path:svg.innerHTML};};
          return {call:values('btn-call-leave'),side:values('btn-sidebar-call-leave')};
        });
        assert.equal(leave.call.bg,leave.side.bg,'Leave has the same filled treatment in panel and dock');
        assert.equal(leave.call.color,leave.side.color,'Leave icon colors match');
        assert.equal(leave.call.path,leave.side.path,'Leave uses one receiver drawing');
        for(const icon of [leave.call,leave.side])assert.ok(icon.width>=20&&icon.dx<.6&&icon.dy<.6,'Leave icon remains legible and centered');
        if(viewport.width===1440)await page.locator('#sidebar-nav-surface').screenshot({path:path.join(captures,`sidebar-call-${compact?'compact':'expanded'}.png`)});
      }
      await page.evaluate(()=>{ChatApp.closeMobileDrawers();ChatApp.closeCallMenu();ChatApp.gamesStageOpen=true;ChatApp.selectedGame={roomActivityId:'merge-party',roomActivityRoomId:'test'};ChatApp.activityChatWidth=30;ChatApp.setActivityChatOpen(true);ChatApp.membersListVisible=true;ChatApp.syncEmojiButtonVisibility();ChatApp.syncActivityChatLayout();});
      await page.waitForTimeout(250);
      await iconGeometry('#activity-chat-close');await iconGeometry('#activity-chat-members-back');
      const actions=await page.locator('.activity-chat-head-actions').evaluate(el=>{const r=el.getBoundingClientRect(),buttons=[...el.querySelectorAll('button')].filter(button=>!button.hidden).map(button=>button.getBoundingClientRect());return buttons.every(b=>b.left>=r.left-.5&&b.right<=r.right+.5);});
      assert.equal(actions,true,'companion header actions stay inside their container');
      await page.locator('.activity-chat-head').screenshot({path:path.join(captures,`${viewport.width}-companion-header.png`)});
      await page.evaluate(()=>{ChatApp.activityChatWidth=15;ChatApp.syncActivityChatLayout();});
      await page.waitForTimeout(200);
      await iconGeometry('#activity-chat-close');await iconGeometry('#activity-chat-members-back');
      const fitsHeader=await page.locator('.activity-chat-head').evaluate(el=>{const r=el.getBoundingClientRect();return [...el.querySelectorAll('button')].filter(button=>!button.hidden).every(button=>{const b=button.getBoundingClientRect();return b.left>=r.left-.5&&b.right<=r.right+.5&&b.top>=r.top-.5&&b.bottom<=r.bottom+.5;});});
      await page.locator('.activity-chat-head').screenshot({path:path.join(captures,`${viewport.width}-companion-header-min.png`)});
      assert.equal(fitsHeader,true,`${viewport.width}: minimum-width companion header contains both full-size controls`);
      assert.deepEqual(errors,[]);
      await context.close();
    }
    // A short room list must delegate wheel handling to the browser, exactly
    // like the rest of the sidebar, while the sidebar itself has overflow.
    const context=await browser.newContext({viewport:{width:1200,height:510}});
    await context.addInitScript(installFirebaseMock);
    await context.route(/^https?:\/\//,route=>route.fulfill({status:200,contentType:'application/json',body:'null'}));
    const page=await context.newPage();await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
    await page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
    await page.click('#btn-go-login');await page.fill('#login-code','TEST-USER');await page.click('#btn-login');
    await page.waitForFunction(()=>ChatApp.currentUser?.code==='TEST-USER');
    await page.evaluate(()=>{ChatApp.closeToast();window.__roomWheelPrevented=null;document.addEventListener('wheel',event=>{window.__roomWheelPrevented=event.defaultPrevented;},{passive:true});});
    const before=await page.evaluate(()=>{const list=document.querySelector('#rooms-list'),scroll=document.querySelector('#side-scroll');scroll.scrollTop=0;return {listOverflow:list.scrollHeight-list.clientHeight,sidebarOverflow:scroll.scrollHeight-scroll.clientHeight};});
    assert.ok(before.listOverflow<=1&&before.sidebarOverflow>10,'fixture has a short list inside a scrollable sidebar');
    await page.locator('#rooms-list').hover();await page.mouse.wheel(0,120);
    await page.waitForFunction(()=>document.querySelector('#side-scroll').scrollTop>0);
    assert.equal(await page.evaluate(()=>window.__roomWheelPrevented),false,'room list preserves native wheel momentum');
    await context.close();
    console.log('Menu/companion icon centering, shared Leave controls, close actions, and native sidebar wheel behavior passed.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
