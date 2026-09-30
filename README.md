# Chat App — web 2026.9.29-1 / desktop 1.4.4

This release shares the same chat, call, and menu code between the website and Windows app. The desktop rebuild adds the native source-selection bridge needed for the in-app screen menu. It preserves the portable launcher, application identity, account storage, and numbered GitHub repository updater. Future shared web changes can continue through that updater.

`build-info.json` records the actual UTC creation time and asset revision. `VALIDATION.md` records this delivery's checks and their limits; `RELEASE-NOTES.md` describes the changes.

## Upload one top-level folder at a time

Extract the ZIP and open the extracted folder. Upload its top-level folders individually into the repository root, then upload the loose root files. Do not upload the enclosing extracted folder as a single browser batch. Keep `index.html` and `.nojekyll` at the repository root.

This archive preserves all **463 original files and paths**. Each top-level folder fits GitHub's browser limit, counting every descendant file:

| Folder | Files |
| --- | ---: |
| js | 100 |
| unread-icons | 100 |
| tests | 92 |
| desktop | 74 |
| css | 33 |
| activities | 19 |
| assets | 11 |
| activity-modules | 9 |
| backend | 5 |
| vendor | 3 |
| scripts | 1 |

There are also 16 loose root files. Build dependencies, generated reports, and build outputs are excluded. Do not upload the separately supplied EXE to the website repository.

GitHub's browser counts nested files toward its 100-file batch limit. A folder rename cannot make a 463-file enclosing folder upload in one browser batch. If you want to upload the **entire project at once**, use GitHub Desktop: clone your intended `dowsy456/christianlumenN` repository, copy the ZIP contents into that checkout, commit, then Push origin. This also avoids exposing an incomplete release between browser uploads. See [GitHub's upload documentation](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository).

For browser uploads, upload the folders first, root assets next, and `desktop-capabilities.json` / `build-info.json` last. Allow your existing website deployment to finish, then restart Chat App to check for it. A new higher-numbered release repository should receive the complete project before it is considered ready.

## Calling and performance

Screen and camera capture target 1280 × 720 at 30 fps. WebRTC still adapts to the source, hardware, and network; no client-side change can guarantee 30 fps or a failure-free connection on every network. `call-config.js` currently has no deployed TURN relay. See `CALLING.md` for the existing authenticated short-lived credential configuration. No production infrastructure or Firebase data was changed while preparing this release.

Recent room history is cached and rendered together; older history stays accessible through bounded pagination. First-time uncached room loads still require the server. The desktop does not show the room-loading banner. Large histories are not all mounted in the DOM at once.

## Development

- `npm ci` and `npm test` run the shared unit checks.
- `npm run test:room-loading` checks large histories using local fixtures.
- `npm run test:browser` checks the app over both HTTP and local files (Chrome required).
- `npm --prefix desktop ci` and `npm --prefix desktop test` run native unit checks.
- `npm --prefix desktop run dist` rebuilds the portable Windows EXE from the same shared source.

The previous mobile UI and native-bridge metadata remain included. This delivery contains only the requested web source ZIP and Windows EXE; it does not rebuild Android or iOS applications.
