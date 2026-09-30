## 2026.9.29-1 — Chat performance and call controls / Windows 1.4.4

- Complete recent message snapshots render together, including cached room entry. An oversized cache entry is discarded instead of showing only its newest message. Existing notification snapshots warm the bounded room cache; uncached data still needs a server response.
- The desktop room-loading banner is suppressed. Chat keeps a bounded window of message elements and history subscriptions; older and newer history remain reachable by pagination.
- Clear Messages immediately resets the local room and uses shared clear-state synchronization instead of scanning every user's memberships and reopening the room.
- Visible messages can be read on a second monitor while another window has focus. Hidden/minimized and covered in-app message content retain visibility guards.
- The sidebar's current-call/time button toggles the call panel. Screens and cameras open independently and retain separate close controls; the extra eye/multiwatch control is removed.
- Desktop screen and camera selection use the app's existing menu chrome, one top-right close button, and shared opening/closing animations. The screen source bridge requires Windows 1.4.4; older native hosts retain their compatible capture path.
- Local overlay flags reflect live camera/screen tracks, including simultaneous camera, screen, mute, and deafen states.
- Screen and camera senders target 720p30. Screen degradation preserves detail, while camera degradation balances detail and motion. Sender configuration is retried when a new track replaces an old one.
- Video stats keep separate histories for camera and screen. Quality sampling queries peers concurrently and follows the selected ICE pair. Status text distinguishes connection establishment, poor quality, and reconnection.
- Successful connection shows a single `Connected` toast for one second. The direct-connection toast is removed.

The EXE is rebuilt from these same web files with its existing portable startup and GitHub updater. No remote repository, hosting deployment, Firebase records, or relay service was changed. The supplied calling configuration has no TURN service: uninterrupted real-network connectivity and fixed delivered frame rate cannot be guaranteed by this release.
## 2026.9.28-6 — Mobile web and native bridge

Mobile conversation header, swipe navigation and member drawers, message action buttons, selectable message text, keyboard/safe-area layouts, and mobile welcome branding. Existing chat/call handlers now connect to optional Android/iOS native notification and call controls. Android screen capture uses consented native frames and the existing WebRTC video path.

The Windows executable and desktop native sources are unchanged. All supplied source paths and the file count are preserved. The mobile shells use the desktop's numbered GitHub repository channel, with a mobile compatibility marker and rollback safeguards. Native binaries need native installation for native changes.

Closed-app push, iOS VoIP wakeup, iOS screen broadcast, and physical-device certification remain incomplete. The iOS project requires a Mac and Apple signing before an installable IPA can be produced. See the current README and the separate installation guide for exact limits.

## 2026.9.28-5 — Chat log receipts and Firebase queries

Chat logs never show or save Seen by receipts, including receipts written by older clients. Normal message receipts and immediate unread clearing remain active. Room notification and latest-message queries use the built-in Firebase key index, eliminating the missing createdAt-index warning.

- Poll-ended, membership and call logs remain readable for unread-badge tracking, without Seen by avatars.
- Notification queries use the same push-key ordering as live room history and download at most 120 messages per room; the unread guard watches the newest key.
- Initial history, old messages re-entering a limited query after deletion, and reconnect duplicates stay silent. New arrivals during initial subscription still notify.
- No Firebase rules deployment is required for these queries. Firebase [indexes keys automatically](https://firebase.google.com/docs/database/security/indexing-data).
- All shared assets have a new revision so cached clients load these fixes.

## 2026.9.28-4 — Immediate unread clearing

Visible messages, polls and system logs clear unread badges immediately. Read saves start without a debounce, retain local progress while Firebase confirms, coalesce per room, and retry transient failures. Hidden or covered content stays unread.

- Poll questions/options and system-log content now participate in visibility checks.
- Removed the 900 ms unread-save debounce and 350 ms receipt dwell.
- Old membership snapshots cannot undo pending reads; cold transactions retry safely.
- Queued reads are invalidated on logout, membership changes and cleared-room epochs.

## 2026.9.28-2 — Custom poll duration and room renaming

- Removed the question textarea resize handle.
- Added exact days, hours, minutes and seconds, preserving legacy drafts and showing seconds in short countdowns.
- Removed redundant Close/Cancel dismissal buttons; retained one X per surface and separate content actions.
- Fixed renaming numeric rooms after an empty initial Firebase transaction snapshot. Creator/duplicate checks remain atomic, local names preview immediately, and failed saves restore the current server label. Room IDs remain stable so all Firebase references stay connected.
- Refreshed all entry-point asset revisions.

## 2026.9.28-1 — Poll menus and profile click targets

- Chat event and poll voter display names are plain text; profile pictures retain profile access.
- Duration options appear above the poll editor and selection keeps the editor open. Closing the editor also closes its dropdown.
- Voter menus are populated before opening, remain next to the vote count, and scroll within the viewport. No modal is used.
- Refreshed asset revision and build timestamp: 2026-09-28T20:16:37.989Z.

# September 26, 2026 — web 2026.9.26-1 / desktop 1.4.3

This release updates the shared web interface and the native incoming-call popup. See README.md for the complete change list and per-folder GitHub uploads; see VALIDATION.md for verification. build-info.json is the release metadata.

Native changes: click-through hover treatment for incoming call cards; a fresh build enables the dedicated camera indicator already supported by the desktop overlay. The shared app no longer creates avatar images containing camera badges. Existing launch behavior and automatic GitHub web-content updates are preserved.

Shared changes: bounded animated dropdown menus, correct room headings and saved capitalization, menus and consistent controls for polls, explicit vote editing, plain voter/profile identities, inline system timestamps and reliable tooltip cleanup, 50% sticker zoom, call-control state icons, session-scoped fast departures, and initial screen/camera video tuning.

No source files are added or removed. All 458 original paths remain present and each top-level folder contains at most 100 files recursively.
