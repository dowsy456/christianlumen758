/* Real Chrome click/tap regression coverage for focused screen controls.
 * Uses an in-memory Firebase fixture and live canvas media; all external HTTP is blocked.
 * Run: node tests/screen-focus.browser.cjs [report-directory]
 */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
const mock = require("./firebase-mock.js");
const reportDir = path.resolve(process.argv[2] || path.join(__dirname, "../../screen-focus-v2-checks"));

async function controls(page) {
  return page.evaluate(() => {
    const visible = node => {
      if (!node || !node.getBoundingClientRect().width || !node.getBoundingClientRect().height) return false;
      for (let parent = node; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    const menu = document.querySelector("#call-menu");
    return {
      toggled: menu.classList.contains("is-focus-controls-visible"),
      header: visible(menu.querySelector(".call-menu-head")),
      footer: visible(menu.querySelector(".call-menu-foot")),
      screen: visible(menu.querySelector(".call-view-tile.is-focused .call-view-head")),
      viewers: visible(menu.querySelector(".call-view-tile.is-focused .call-viewers-eye")),
    };
  });
}

async function expectControls(page, visible, label) {
  // Permit CSS transitions but require all four surfaces to reach the same state.
  for (let attempt = 0; attempt < 20; attempt++) {
    const actual = await controls(page);
    if (Object.values(actual).every(value => value === visible)) return;
    await page.waitForTimeout(50);
  }
  assert.deepEqual(await controls(page), { toggled: visible, header: visible, footer: visible, screen: visible, viewers: visible }, label);
}

async function screenGeometry(page) {
  return page.locator(".call-view-tile.is-focused video").evaluate(video => {
    const rect = video.getBoundingClientRect();
    const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const width = video.videoWidth * scale;
    const height = video.videoHeight * scale;
    const left = rect.x + (rect.width - width) / 2;
    const top = rect.y + (rect.height - height) / 2;
    const letterbox = rect.width - width > 12
      ? { x: rect.x + 4, y: rect.y + rect.height / 2 }
      : rect.height - height > 12
        ? { x: rect.x + rect.width / 2, y: rect.y + 4 }
        : null;
    return { x: left + width / 2, y: top + height / 2, width, height, letterbox };
  });
}

async function clickScreen(page, touch = false) {
  const point = await screenGeometry(page);
  assert.ok(point.width > 0 && point.height > 0, "A real video frame is displayed");
  await (touch ? page.touchscreen.tap(point.x, point.y) : page.mouse.click(point.x, point.y));
}

async function tileStyle(page) {
  // Roster fitting runs on animation frames after expand/unfocus. Sample only
  // after its geometry and border have settled, rather than a transient scale.
  await page.locator('.call-view-tile[data-share-code="ALICE"]').evaluate(async tile => {
    let previous = "", stableFrames = 0;
    for (let attempt = 0; attempt < 180; attempt++) {
      await new Promise(requestAnimationFrame);
      const bounds = tile.getBoundingClientRect();
      const style = getComputedStyle(tile);
      const current = [bounds.x, bounds.y, bounds.width, bounds.height, style.border, style.borderRadius].join("|");
      stableFrames = current === previous ? stableFrames + 1 : 0;
      if (stableFrames >= 3) return;
      previous = current;
    }
    throw new Error("Screen tile geometry did not settle before the style comparison");
  });
  return page.locator('.call-view-tile[data-share-code="ALICE"]').evaluate(tile => {
    const bounds = tile.getBoundingClientRect();
    const style = getComputedStyle(tile);
    const body = getComputedStyle(tile.querySelector(".call-view-body"));
    const video = getComputedStyle(tile.querySelector("video"));
    return { width: bounds.width, height: bounds.height, radius: style.borderRadius,
      border: style.border, background: style.backgroundColor, body: body.backgroundColor,
      video: video.backgroundColor, fit: video.objectFit,
      head: getComputedStyle(tile.querySelector(".call-view-head")).display };
  });
}

async function bootstrap(browser, viewport, mobile = false) {
  const context = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
  await context.addInitScript(mock);
  await context.route(/^https?:\/\//, route => route.fulfill({ status: 200,
    contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "null" }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve(__dirname, "../index.html")).href);
  await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
  await page.click("#btn-go-login");
  await page.fill("#login-code", "TEST-USER");
  await page.click("#btn-login");
  await page.waitForFunction(() => ChatApp.currentUser);
  await page.evaluate(async () => {
    await ChatApp.openRoom("test", { quiet: true });
    ChatApp.closeToast();
    // Fixture ownership of member updates avoids joining a remote/media call.
    ChatApp.detachCallObserver();
    ChatApp.attachCallObserver = () => {};
    ChatApp.currentCallRoomId = "test";
    ChatApp.callSessionId = "screen-focus-fixture";
    ChatApp.callMembersCache = [
      { code: "TEST-USER", username: "Tester", displayName: "Tester", connected: true, sessionId: "self-session" },
      { code: "ALICE", username: "Alice", displayName: "Alice", connected: true, sessionId: "alice-session", sharing: true, shareId: "alice-screen" },
      { code: "BOB", username: "Bob", displayName: "Bob", connected: true, sessionId: "bob-session", sharing: true, shareId: "bob-screen" },
    ];
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const pen = canvas.getContext("2d");
    let frame = 0;
    const paint = () => {
      pen.fillStyle = "#355c78";
      pen.fillRect(0, 0, 1280, 720);
      pen.fillStyle = "#47c9a1";
      pen.fillRect(40, 40, 1200, 640);
      pen.fillStyle = "#102d42";
      pen.fillRect(70, 70, 1140, 580);
      pen.fillStyle = "white";
      pen.font = "48px sans-serif";
      pen.fillText("Shared screen - live test " + frame++, 150, 330);
    };
    paint();
    window.__focusTestTimer = setInterval(paint, 100);
    window.__focusTestCanvas = canvas;
    window.__focusTestStream = canvas.captureStream(10);
    ChatApp.callRemoteVideoStreams.set("ALICE", window.__focusTestStream);
    ChatApp.callRemoteVideoStreams.set("BOB", window.__focusTestStream);
    ChatApp.callWatchedShareCodes = new Set(["ALICE", "BOB"]);
    ChatApp.callMultiViewEnabled = true;
    ChatApp.openCallMenu();
    ChatApp.syncShareViewStream();
  });
  await page.waitForFunction(() => [...document.querySelectorAll("#call-menu video")].length === 2 &&
    [...document.querySelectorAll("#call-menu video")].every(video => video.videoWidth === 1280 && video.readyState >= 2));
  return { page, context, errors };
}

if (require.main === module) (async () => {
  fs.mkdirSync(reportDir, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"] });
  const result = { cases: [], passed: false };
  try {
    for (const testCase of [
      { name: "desktop", viewport: { width: 1440, height: 900 }, expanded: false },
      { name: "expanded", viewport: { width: 1440, height: 900 }, expanded: true },
      { name: "mobile", viewport: { width: 390, height: 844 }, expanded: true, mobile: true },
    ]) {
      const { page, context, errors } = await bootstrap(browser, testCase.viewport, testCase.mobile);
      try {
        if (testCase.expanded) await page.click("#btn-call-menu-expand");
        const original = await tileStyle(page);
        assert.equal(original.fit, "contain", "Unfocused screen keeps contained video");
        assert.notEqual(original.head, "none", "Unfocused screen controls remain displayed");
        assert.equal(await page.locator(".call-view-live-dot").count(), 0, "The screen-label green dot is removed");
        await page.screenshot({ path: path.join(reportDir, `${testCase.name}-unfocused.png`) });
        await page.locator('.call-view-tile[data-share-code="ALICE"] .call-view-focus').click();
        assert.equal(await page.locator(".call-viewers-floating").isVisible(), false, "Focusing immediately removes the thumbnail viewers tooltip");
        await expectControls(page, true, "Focusing shows every control surface by default");
        const focused = await tileStyle(page);
        for (const field of ["background", "body", "video"]) assert.equal(focused[field], "rgba(0, 0, 0, 0)", `Focused ${field} has no black fill`);
        if (testCase.name === "expanded") {
          const upper = await page.locator(".call-view-tile.is-focused video").evaluate(video => {
            const rect = video.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + 12 };
          });
          assert.equal(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.tagName, upper), "VIDEO", "Empty screen-header space does not intercept the upper frame");
          await page.mouse.click(upper.x, upper.y);
          await expectControls(page, false, "Clicking the upper frame under the header hides controls");
        } else {
          await clickScreen(page, testCase.mobile);
        }
        await expectControls(page, false, "A screen click hides the initially visible controls");
        await page.screenshot({ path: path.join(reportDir, `${testCase.name}-focused-hidden.png`) });

        const point = await screenGeometry(page);
        await page.mouse.move(point.x, point.y);
        await expectControls(page, false, "Hovering over the screen never reveals controls");
        assert.ok(point.letterbox, "Fixture exposes letterbox space for hit testing");
        await page.mouse.click(point.letterbox.x, point.letterbox.y);
        await expectControls(page, false, "Clicking outside the actual frame does not reveal controls");

        if (!testCase.mobile) {
          await page.locator(".call-view-tile.is-focused .call-view-body").focus();
          await page.keyboard.press("Enter");
          await expectControls(page, true, "Keyboard users can reveal the controls from the focused screen");
          await page.keyboard.press("Space");
          await expectControls(page, false, "Keyboard users can hide the controls from the focused screen");
        }

        await clickScreen(page, testCase.mobile);
        await expectControls(page, true, "Clicking/tapping the actual frame reveals all controls");
        await page.screenshot({ path: path.join(reportDir, `${testCase.name}-focused-visible.png`) });
        await page.locator(".call-view-tile.is-focused .call-viewers-eye").click();
        await expectControls(page, true, "The viewers control cannot toggle the screen");
        await page.click("#btn-call-mute");
        await expectControls(page, true, "Call controls cannot toggle the screen");
        await page.evaluate(() => {
          window.__retainedFocusVideo = document.querySelector(".call-view-tile.is-focused video");
          ChatApp.callMembersCache[1].speaking = true;
          ChatApp.renderCallMenu();
        });
        await expectControls(page, true, "A live roster rerender retains the selected visibility");
        assert.equal(await page.evaluate(() => window.__retainedFocusVideo === document.querySelector(".call-view-tile.is-focused video")), true, "Roster rerenders preserve the playing video node");
        await clickScreen(page, testCase.mobile);
        await expectControls(page, false, "A second screen click/tap hides every control surface");
        await page.evaluate(() => ChatApp.renderCallMenu());
        await expectControls(page, false, "Hidden controls remain hidden after rerender");
        await clickScreen(page, testCase.mobile);
        await page.locator(".call-view-tile.is-focused .call-view-focus").click();
        assert.deepEqual(await tileStyle(page), original, "Unfocusing restores the original thumbnail appearance and geometry");
        assert.equal(await page.locator("#call-menu").evaluate(menu => menu.classList.contains("is-focus-controls-visible")), false, "The focused visibility class clears on exit");
        await page.locator('.call-view-tile[data-share-code="BOB"] .call-view-focus').click();
        await expectControls(page, true, "Focusing a different share resets to visible controls");
        await page.locator(".call-view-tile.is-focused .call-view-close").click();
        assert.equal(await page.locator(".call-view-tile.is-focused").count(), 0, "Closing a focused screen exits focus");
        assert.ok(await page.locator(".call-menu-head").isVisible(), "Closing a focused screen restores the top bar");
        assert.ok(await page.locator(".call-menu-foot").isVisible(), "Closing a focused screen restores call controls");
        assert.deepEqual(errors, [], "No browser runtime errors");
        result.cases.push({ name: testCase.name, passed: true, original, focused });
        console.log(`PASS ${testCase.name}: focus defaults, frame-only click/tap, controls, rerender, transparency, restoration`);
      } catch (error) {
        await page.screenshot({ path: path.join(reportDir, `${testCase.name}-failure.png`) });
        result.cases.push({ name: testCase.name, passed: false, failure: error.stack, controls: await controls(page), errors });
        throw error;
      } finally {
        await context.close();
      }
    }
    result.passed = true;
    console.log("Screen-focus browser checks passed; screenshots:", reportDir);
  } finally {
    fs.writeFileSync(path.join(reportDir, "screen-focus-report.json"), JSON.stringify(result, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { bootstrap, controls, expectControls, screenGeometry };
