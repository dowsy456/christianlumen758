# 2026.9.29-1 validation — current delivery

Web 2026.9.29-1, Windows 1.4.4, shared asset revision `20260929-performance-call-1`. The timestamp in `build-info.json` is the actual build time in UTC.

## Executed checks

- Shared unit suite: 358/358 pass. Desktop unit suite: 78/78 pass, including room clear epochs, delayed send metadata, complete-tail caching, independent RTP counters, active ICE-pair selection, capture constraints and overlay flags.
- Real Chrome six-participant WebRTC test passes with 30 audio endpoints, 35 seconds of sustained audio, a 720p screen sent to five viewers, simultaneous screen plus camera, independent camera closure, connection recovery, and rapid leave/rejoin. In this local run, all audio endpoints were active after 4.655 seconds, five screen viewers reached 720p in 999 ms, and the camera viewer reached 720p in 469 ms. These are local QA results, not internet performance guarantees.
- Large-history browser checks cover 12,000 messages per room, cold and cached room entry, atomic first message paint, desktop loader suppression, late edits/deletions, delayed snapshots after switching/clearing, seven older pages, forward pagination, and 400 live arrivals. Rendered history stays bounded to 360 rows, and the tests verify bounded message queries and listener residency.
- Browser smoke checks pass over both local files and HTTP. Chat scrolling checks cover desktop/mobile, layout changes, late media, intentional history reading, delayed sends, and room switches. Retained-cache asset-upgrade test passes.
- Menu checks pass on desktop and mobile, including the sidebar toggle, independent media viewers, camera selection, cancellation, one close control, and existing popup animation. The settled screen/camera menus were visually inspected.
- Unread checks include a visible unfocused app (a second-monitor scenario) and hidden/covered content. Physical multiple-monitor occlusion by another native application is not simulated by these browser fixtures.
- Real Electron checks pass for startup from the shared bundle, version identity, native badge IPC, Spotify configuration, screen-source enumeration, invalid source rejection, selected monitor capture capped at 720p30, and absence of a separate picker window. The temporary test stream is stopped immediately. Native overlay checks exercise visibility, minimize/restore, speaking updates, and participant changes; renderer checks include camera/screen indicators and large rosters.

## Test boundaries

All chat/signaling tests use local Firebase fixtures. WebRTC tests use real Chrome RTP, synthetic microphones/camera/canvas, and local host ICE candidates. Native checks use isolated profiles and block external app network requests. No user messages, production database, security rules, GitHub repository, hosting deployment, or calling service were changed.

The supplied `call-config.js` has no TURN relay endpoint or credentials. Internet/NAT traversal, sustained physical-device capture under load, and uninterrupted real-world calls are not certified. 720p30 is the capture/encoder target, subject to available source, hardware and network capacity. A first uncached room load still needs server data; cached recent history can paint before that response.

The original archive contains 463 files. The final ZIP is assembled from that exact original path inventory, excludes installed dependencies/build products, and verifies every archived byte against the edited source. Every top-level folder has at most 100 descendant files. The rebuilt EXE retains the original portable launcher and update mechanism; the native capture bridge is the reason a replacement EXE is included.

Historical checks below describe earlier releases and are not evidence for this delivery.
## 2026.9.28-6 validation (current delivery)

- All 344 existing shared unit tests passed.
- Desktop browser smoke passed over file and HTTP: startup, login, rooms, sends, polls, profiles, settings, schedules, and home; zero page errors. Retained-cache upgrade test passed with the new asset revision.
- Mobile Chrome fixtures passed at 320, 360, 390, and 430 pixel portrait widths; calls also checked at 844 by 390 landscape. Welcome/login/send, left navigation, right members, swipes, vertical-scroll exclusions, text selection CSS, message/long-press menus, keyboard viewport, and desktop restoration passed. Screenshots visually inspected.
- Native bridge fixtures passed: permission denial/retry, message/inbox ping deduplication in both orders, stale OS call control rejection, current controls, call-state publication, draft update blocking, pending capture cancellation on leave, canvas MediaStream generation, stale stop rejection, and one-time OS-stop cleanup.
- Mobile website actual fixture ring leases present an incoming card; Decline removes the lease; Answer opens the room and routes through the join handler.
- Android Back fixture passed: closes active surfaces; busy-dialog guard preserved; room back retains the call and returns home; home permits native backgrounding; desktop not intercepted.
- Existing desktop ringing and notification/status browser suites passed.
- Original web archive file paths/count verified: 463 before and after, no added or missing files. Native projects and new verification scripts are in the separate mobile-source archive. All original desktop/ files remain byte-identical.
- Browser tests use local Firebase fixtures. No production database, security rules, hosting site, or GitHub repository was changed.

Native build status: Android Java/D8/aapt2 compilation and APK v2/v3 signature validation passed. Host-JVM updater boundary tests passed. No physical Android phone or configured emulator was available. iOS project/resource structure was checked, but Swift was NOT compiled and no IPA was built/signed; macOS/Xcode and signing are unavailable here. These checks do not certify screen capture, background audio, CallKit, or Dynamic Island behavior on phones.

Unfinished requirements: closed-app push delivery/VoIP wakeup, iOS whole-device screen broadcasting, native background iOS media/signaling, iOS signed distribution, and real-device testing. TURN service configuration is also absent from the supplied call config. See the current README and separate INSTALLATION.md.

Historical validation below describes older deliveries and is not evidence of native mobile verification.

## 2026.9.28-5 validation

- All 344 unit tests passed, including three new tests with key ordering, bounded query windows, deletion/refill, initial-subscription races and listener cleanup.
- Updated unread browser tests passed at 1440 and 390 pixels: normal messages display Seen by, system logs do not save local receipts, and old-client receipts never appear on poll-ended or membership logs. Logs continue to clear unread badges immediately.
- Existing notification/status browser checks passed for sound routing, pings, status persistence and Firebase synchronization.
- Existing media/receipt browser checks passed for overlays, cloaking, modal visibility and activity/call companions.
- Cache-upgrade browser check passed with the new asset revision.
- Verification used local Firebase fixtures and headless Chrome. No live database or security rules were modified. The missing createdAt-index queries were replaced with bounded orderByKey queries, which use Firebase's automatic key index.

## 2026.9.28-4 validation

- All 336 existing unit tests and five new unread-state tests passed (341 total).
- New browser tests passed at 1440 and 390 pixels: unread clears by the next paint for polls, incoming messages, poll-end logs and membership logs; stale membership updates and a delayed Firebase commit do not restore badges; sidebar/taskbar counts agree; covered logs stay unread until uncovered.
- Existing media/receipt and chat-files/sounds browser checks passed, including occlusion, activity/call companions and web/desktop unread totals.
- Tests use local Firebase fixtures, with cold-cache and delayed-write simulations. No live database was modified.

## 2026.9.28-2 validation

- npm test: 336 tests passed.
- Poll browser checks passed at 1440×900 and 390×844: custom duration validation, exact saved duration, draft editing, two-second expiry, one close control, profile click targets, voter placement and long lists. Screenshots were visually inspected.
- Room rename browser checks passed at 1440 and 390 pixels: numeric ID 1 to display name 1f, simulated cold transaction snapshot, pending server commit with immediate UI preview, unchanged message references, duplicate rejection, creator checks, and the X close control.
- Room/menu/password browser integration checks passed at 1360 and 390 pixels.
- Browser smoke flows passed for file:// and HTTP. Calendar browser checks and screen-picker renderer selection/Escape checks passed.
- Tests used local in-memory Firebase fixtures, including cold-cache/retry simulations. No live database or Firebase security-rule deployment was performed.
- Firebase transaction behavior reference: https://firebase.google.com/docs/database/web/read-and-write#save_data_as_transactions

## 2026.9.28-1 validation

- All 334 existing unit tests passed (npm test).
- Poll browser tests passed at 1440×900 and 390×844: all six durations, persisted draft duration, dropdown cleanup, plain names, profile pictures, stationary opening, viewport placement, long voter lists, and empty results.
- Existing profile/receipt browser tests passed for desktop, iOS emulation, and Android emulation.
- Existing menu-control and cached-asset update browser checks passed. Full browser smoke flows passed over both file:// and HTTP, including creating, voting, changing votes, ending polls, and system logs.
- Browser checks used local in-memory Firebase fixtures; no live user data was modified.

# Verification — September 26, 2026

Release: shared web 2026.9.26-1, desktop 1.4.3, asset revision 20260926-menu-poll-call-fixes-1. The test source is included in the archive; generated reports and dependencies are excluded.

## Checks performed

- Full shared unit suite: npm test (334 tests pass, including non-call observer cleanup and reconnect-preservation regressions).
- Desktop unit suite: 77 tests pass, including update discovery, compatible future updates, rejecting older web content, native popup lifetime/security, overlay, clipboard, taskbar and unread badges.
- Real Electron ring renderer: verified full/30%/full opacity, native ignore-mouse state changes, Join/Decline bridge commands, first presentation without focus theft, window restoration, stacking, and fade removal. The deterministic cursor and CDP clicks verify Electron's native API state; an underlying third-party Windows app receiving a physical click was not separately tested.
- Desktop overlay renderer: camera indicator is inside the name pill, no camera element covers the profile picture, matching green state color, 6/32-person layouts, bounds and fallback-avatar rendering.
- Native release boot: app version, shared revision, isolated offline profile, 12-file attachment limit, sound catalog, clipboard/Spotify bridges, and Windows unread overlay.
- Shared browser cache: existing cached assets advance to the new revision without requiring a future EXE rebuild for shared content updates.
- Browser smoke tests pass using file:// and HTTP, including poll creation, votes, explicit Change Vote, SVG controls, voter profile clicks, ending a poll, idempotent system logs, timestamps, settings and room flows.
- Poll screenshots were inspected at desktop/mobile sizes and a 700x420 window. The short menu scrolls to its footer, and mobile content stays within the viewport.
- Menu placement, menu controls, profile receipts, password-room menus, stickers, media receipts, and popover bounds pass at desktop/mobile sizes; dropdown expansion/repeated collapse, scrolling, tooltip removal, 50% sticker zoom and saved room-name case are covered.
- Call UI and real Firebase SDK tests pass. The pagehide departure test deliberately stalls the slower membership cleanup to verify that the session-specific departure still removes the caller.
- Six independent Chromium clients exchanged real WebRTC audio/video using local shared signaling. All 30 audio endpoints remained connected, five screen viewers reached 1280x720 in 583 ms, a fresh camera viewer reached 1280x720 in 573 ms, and pagehide removed the departing caller from other rosters in 325 ms. Video senders retained a 30fps target and 4Mbps ceiling. Audio continuity, transport recovery and rapid leave/rejoin also passed.

## Limits

Startup timings are measurements on this machine and the local fixture, not latency, sustained-30fps or quality guarantees on other hardware or wide-area networks. No physical power-loss test was performed. Abrupt disconnect detection still depends on WebRTC/Firebase; the app removes the additional visual grace after a confirmed departure while retaining conservative cleanup for recoverable signaling outages.

The live GitHub repository and production Firebase backend were not modified. Native tests use isolated test profiles.

## Archive integrity

The archive is built from the original 458-file inventory. Every original path is preserved; dependency directories, build outputs and QA files are not included. Every top-level upload folder contains at most 100 files recursively. The EXE is built from the same shared source plus the updated native popup code. Its portable launch architecture and GitHub updater remain in place.
