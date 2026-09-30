# Application structure

`index.html` is the main application document for both direct local opening and an HTTPS deployment. The package uses ordinary browser scripts, relative asset paths, and an explicit module manifest. Running or editing it does not require a bundler, development server, or build step.

## Startup and shared state

1. `index.html` loads the runtime, public call configuration, module manifest, and `app.js`.
2. `app.js` loads the bundled Firebase SDK and the feature scripts. `js/runtime/loader.js` schedules independent feature downloads in parallel and lets the browser manage connections.
3. Each feature registers its methods on `globalThis.ChatApp` and supplies an initializer through `App.register(id, initializer)`.
4. `js/runtime/application.js` verifies the registrations, then runs initializers synchronously in `js/module-manifest.js` order. State initialization, DOM listeners, and subscriptions belong in these initializers.

Feature files receive `ChatApp` as the local `App` parameter. Cross-feature calls use `App.method()` and shared state uses `App.property`. Methods are registered before initialization begins, so an earlier initializer can call a method implemented in a later file. Its required state must still be initialized first.

The other runtime globals are `ChatRuntime` (loader), `ChatAppModules` (ordered manifest), `ChatActivities` (activity documents), and `firebase` (the bundled SDK). Calling also exposes `ChatCallPolicy`, `CHAT_CALL_CONFIG`, and `getChatCallDiagnostics()`; activity launch configurations and controllers retain their existing parent/iframe communication properties.

This arrangement separates editing responsibilities while retaining shared application state and existing cross-feature dependencies. Features are not independently isolated packages. Private helper state can live inside a feature's closure; shared state belongs on `App`. Add new application features to the manifest and preserve initialization dependencies when changing its order.

## Module map

| Location | Responsibility |
| --- | --- |
| `app.js` | Startup coordination and startup error display |
| `js/runtime/` | Script loading, application registration, and lazy activity loading |
| `js/core/` | Firebase configuration, shared validation, session state, formatter cache, and startup |
| `js/accounts/`, `js/admin/` | Account creation, login, logout, and administrative UI |
| `js/chat/` | Message rendering/history, sending, composer controls, mentions, presence, and menus |
| `js/rooms/` | Room navigation, lists, membership, management, and cached room metadata |
| `js/profiles/` | Avatars, profile editing, and profile/activity popovers |
| `js/calling/` | Call signaling, connections, media, quality, presence, lifecycle, and panel controls |
| `activity-modules/` | HTML library storage, activity claims, and embedded window management |
| `js/media/`, `js/stickers/` | Uploads, playback, recording, media viewers, and sticker editing/library |
| `js/schedules/` | Schedule data, editing, rendering, and viewer presence |
| `js/tools/`, `js/settings/`, `js/ui/` | Notepad, camera, preferences, and shared interface behavior |
| `activities/` | On-demand game documents, scripts, styles, and image assets |
| `styles.css`, `css/` | Foundation styles and ordered feature/responsive overrides |
| `vendor/` | Locally bundled Firebase compatibility scripts |
| `tests/` | Offline regression fixtures and browser checks |

`js/calling/panel-resize.js` is a separately loaded UI enhancement. Its pointer handling does not need the main call transport to initialize. `call-config.js` exposes `CHAT_CALL_CONFIG` for deployment configuration; see [CALLING.md](CALLING.md).

## Embedded activities

`js/runtime/activity-loader.js` exposes `ChatActivities`. Selecting a bundled activity loads its `document.js` registration, followed by its iframe-only `game.js`, stylesheet, and images. These files do not load during ordinary chat startup.

Activity documents run in the existing sandboxed iframe using `srcdoc` or a blob URL with a base URL pointing at the app folder. This preserves relative assets, direct local opening, and the existing parent-window launch configuration. Launching an activity does not replace the main page.

## Editing and validation

Keep the CSS links in `index.html` in their existing cascade order. Keep the full folder together when uploading or copying the app. Changes to shared state or initialization order should be checked through the affected user flow, in addition to syntax checks. Browser checks should cover both local-file and HTTP operation; call transport tests and deployment requirements are described in [CALLING.md](CALLING.md).
