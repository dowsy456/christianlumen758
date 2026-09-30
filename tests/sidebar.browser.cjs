/* Fixture-only regression checks for the independent navigation/call dock. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const installFirebaseMock = require('./firebase-mock.js');
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  try {
    for (const viewport of [{width:1440,height:900},{width:390,height:844},{width:412,height:740},{width:740,height:390}]) {
      const context = await browser.newContext({ viewport, isMobile: viewport.width < 821, hasTouch: viewport.width < 821 });
      await context.addInitScript(installFirebaseMock);
      await context.route(/^https?:\/\//, route => route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'null'}));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);
      await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
      await page.click('#btn-go-login');
      await page.fill('#login-code','TEST-USER');
      await page.click('#btn-login');
      await page.waitForFunction(() => ChatApp.currentUser?.code === 'TEST-USER' && document.querySelector('#view-chat').dataset.active === 'true');
      await page.evaluate(async () => {
        await window.__testDatabase.ref('rooms/private-test').set({ name: 'Private room', private: true, createdBy: 'TEST-USER', createdAt: Date.now() });
        await window.__testDatabase.ref('memberships/TEST-USER/private-test').set(true);
        await ChatApp.openRoom('test',{quiet:true});
        if (document.body.dataset.mobileUi === '1') document.body.dataset.mobileNav='1';
        ChatApp.currentCallRoomId='test';
        ChatApp.callSessionId='sidebar-test';
        ChatApp.callMembersCache=[{code:'TEST-USER',connected:true,joinedAt:Date.now()-65000}];
        ChatApp.callMuted=false;
        ChatApp.syncCallControlsUI();
      });
      await page.waitForTimeout(400);
      assert.equal(await page.locator('#rooms-title').textContent(), 'Public Rooms');
      assert.equal(await page.locator('#rooms-title').isVisible(), true, 'expanded room filter label is visible');
      assert.equal(await page.locator('[data-room-row="private-test"]').count(), 0, 'public mode excludes private rooms');
      await page.click('#rooms-mode-toggle');
      assert.equal(await page.locator('#rooms-title').textContent(), 'All Rooms');
      assert.equal(await page.locator('[data-room-row="private-test"]').count(), 1, 'all mode includes private rooms');
      await page.click('#rooms-mode-toggle');
      for (const position of ['left','right']) {
      await page.evaluate(position => { document.body.dataset.sidebarPosition=position; }, position);
      for (const compact of [false,true]) {
        await page.evaluate(compact => ChatApp.setNavigationCompact(compact), compact);
        await page.waitForTimeout(380);
        const geometry = await page.evaluate(() => {
          const side=document.querySelector('#sidebar-nav-surface'), scroll=document.querySelector('#side-scroll'), dock=side.querySelector('.sidebar-dock');
          const bounds=el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};
          const time=document.querySelector('#btn-time-display');
          const toolBounds=[...side.querySelectorAll('.sidebar-tool-grid > button')].filter(el=>!el.hidden).map(bounds);
          return {side:bounds(side),scroll:bounds(scroll),dock:bounds(dock),settings:bounds(document.querySelector('#btn-side-settings')),toggle:bounds(document.querySelector('#btn-side-collapse')),callControls:[...side.querySelectorAll('.sidebar-call-actions button')].map(el => ({ ...bounds(el), dropdown: el.matches('[data-call-audio-settings]') })),toolGaps:toolBounds.slice(1).map((r,i)=>r.top-toolBounds[i].bottom),timeBackground:getComputedStyle(time).backgroundColor,timeBorder:getComputedStyle(time).borderTopColor,timeShadow:getComputedStyle(time).boxShadow,dockOverflow:getComputedStyle(dock).overflowY,scrollHeight:scroll.scrollHeight,scrollClientHeight:scroll.clientHeight};
        });
        assert.ok(geometry.dock.bottom<=geometry.side.bottom+1,'dock stays in sidebar');
        assert.ok(geometry.scroll.bottom<=geometry.dock.top+1,'scroll region ends above independent dock');
        assert.ok(geometry.settings.bottom<=geometry.dock.bottom+1,'settings remains inside dock');
        assert.ok(geometry.settings.left>=geometry.side.left && geometry.settings.right<=geometry.side.right+1,'settings remains in rail');
        assert.ok(geometry.toggle.left>=geometry.settings.right && geometry.toggle.left-geometry.settings.right<=4.1,'both sidebar positions keep the density control after settings');
        assert.ok(Math.abs(geometry.toggle.top-geometry.settings.top)<1 && geometry.toggle.right<=geometry.side.right+1,'collapse stays on the settings row inside the dock');
        geometry.toolGaps.forEach(gap=>assert.ok(Math.abs(gap-geometry.toolGaps[0])<1,'camera and time share the same gap as all tools'));
        if (compact) {
          assert.equal(geometry.timeBackground,'rgba(0, 0, 0, 0)','compact time has no background');
          assert.equal(geometry.timeBorder,'rgba(0, 0, 0, 0)','compact time has no border');
          assert.equal(geometry.timeShadow,'none','compact time has no shadow');
        } else {
          assert.notEqual(geometry.timeBackground,'rgba(0, 0, 0, 0)','expanded clock retains its card background');
        }
        assert.notEqual(geometry.dockOverflow,'auto');
        geometry.callControls.forEach(r=>assert.ok(r.width>=(r.dropdown ? 24 : 43) && r.height>=43,'call icons and dropdown arrows keep distinct accessible targets'));
        if (process.env.SIDEBAR_SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.SIDEBAR_SCREENSHOT_DIR, `sidebar-${position}-${viewport.width}-${compact ? "compact" : "expanded"}.png`)});
        assert.equal(await page.locator('#btn-side-collapse').getAttribute('aria-label'),compact?'Expand Navigation':'Collapse Navigation');
        await page.locator('#btn-time-display').scrollIntoViewIfNeeded();
        const clockGeometry=await page.locator('#btn-time-display').evaluate(button=>{
          const clock=button.querySelector(document.body.dataset.navCompact==='1'?'.sidebar-compact-clock':'.clock-time');
          const box=button.getBoundingClientRect(),text=clock.getBoundingClientRect();
          return {fits:text.width>15&&text.height>8&&text.left>=box.left&&text.right<=box.right&&text.top>=box.top&&text.bottom<=box.bottom,text:clock.textContent};
        });
        assert.equal(clockGeometry.fits,true,'clock fits both navigation sizes');
        assert.match(clockGeometry.text,/\d+:\d{2}/);
        if (compact && viewport.width >= 821) {
          const hoverStyle = button => button.evaluate(el => {
            const style=getComputedStyle(el);
            return { background:style.backgroundColor, border:style.borderTopColor, color:style.color, transform:style.transform };
          });
          await page.locator('#btn-side-camera').hover();
          await page.waitForTimeout(260);
          const toolHover=await hoverStyle(page.locator('#btn-side-camera'));
          await page.locator('#btn-time-display').hover();
          await page.waitForTimeout(260);
          const clockHover=await hoverStyle(page.locator('#btn-time-display'));
          assert.deepEqual(clockHover,toolHover,'compact clock matches the other navigation buttons on hover');
        }
        await page.click('#btn-time-display');
        await page.waitForFunction(()=>!ChatApp.modalEl.hidden&&ChatApp.modalEl.dataset.size==='time-display');
        assert.equal(await page.locator('#time-display-modal-time').isVisible(),true,'the clock button opens Time Display');
        const clockCenter=await page.locator('#time-display-modal-time').evaluate(time=>{
          const box=time.closest('.time-display-modal-clock').getBoundingClientRect(),text=time.getBoundingClientRect();
          return {x:Math.abs((text.left+text.right-box.left-box.right)/2),y:Math.abs((text.top+text.bottom-box.top-box.bottom)/2)};
        });
        assert.ok(clockCenter.x<1 && clockCenter.y<1,'normal Time Display clock is centered on both axes');
        await page.keyboard.press('Escape');
        await page.waitForFunction(()=>ChatApp.modalEl.hidden);
        await page.evaluate(()=>{if(document.body.dataset.mobileUi==='1')document.body.dataset.mobileNav='1';});
        const before=geometry.dock.top;
        await page.evaluate(()=>document.querySelector('#side-scroll').scrollTop=10000);
        const after=await page.locator('.sidebar-dock').boundingBox();
        assert.equal(after.y,before,'scrolling does not move dock');
        assert.match(await page.locator('#sidebar-call-time').textContent(),/^\d+:\d{2}$/);
        if (compact) {
          const controls=page.locator('#sidebar-nav-surface button:visible, #sidebar-nav-surface .room-row:visible, #sidebar-nav-surface .me-pill-dock');
          for (const control of await controls.all()) {
            await control.hover();
            await control.focus();
            assert.ok(await control.getAttribute('aria-label'),'compact controls retain accessible labels');
            assert.equal(await page.locator('#sidebar-tooltip').isVisible(),false,'compact hover and keyboard focus do not show tooltips');
          }
          assert.equal(await page.locator('#sidebar-nav-surface [title]').count(),0,'compact sidebar has no native tooltips');
        }
      }
      }
      await page.click('#btn-sidebar-call-mute');
      assert.equal(await page.locator('#btn-sidebar-call-mute').getAttribute('aria-pressed'),'true');
      await page.click('#btn-sidebar-call-deafen');
      assert.equal(await page.locator('#btn-sidebar-call-deafen').getAttribute('aria-pressed'),'true');
      // Toggle on touch preserves drawer, and closing a modal keeps the call panel.
      await page.click('#btn-side-collapse');
      if(viewport.width < 821) assert.equal(await page.locator('body').getAttribute('data-mobile-nav'),'1');
      await page.evaluate(()=>ChatApp.openCallMenu());
      await page.click('#btn-side-settings');
      await page.waitForFunction(()=>!ChatApp.modalEl.hidden);
      assert.equal(await page.evaluate(()=>ChatApp.callMenuOpen),true);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(()=>ChatApp.callMenuOpen),true,'Escape only dismisses the top modal');
      await page.evaluate(()=>{ChatApp.currentCallRoomId=null;ChatApp.syncCallControlsUI()});
      assert.equal(await page.locator('#sidebar-call').isHidden(),true);
      assert.equal(await page.evaluate(()=>ChatApp.sidebarCallTimer),0,'timer stops after leaving call');
      assert.deepEqual(errors,[]);
      console.log(JSON.stringify({viewport,compactAndExpanded:true,pinnedDock:true,modalCallPersistence:true,errors:0}));
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});


