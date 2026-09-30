# Spotify connection

The supplied public Spotify Client ID is configured in `spotify-config.json` and included in the desktop build. No client secret is used or needed.

In the [Spotify developer dashboard](https://developer.spotify.com/dashboard), the app owner must register this exact redirect URI for that Client ID:

```
http://127.0.0.1:43821/spotify/callback
```

Spotify accepts HTTP for explicit loopback IP addresses. The app uses [authorization code with PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow), a cryptographic state value, and a short-lived listener bound only to `127.0.0.1`. The authorization flow requests only `user-read-currently-playing`. Tokens stay in the native process and are encrypted using Electron `safeStorage` (Windows user-protected storage), separately for each Chat App account.

Users connect and disconnect in **Settings → Account → Spotify** in the EXE. Disconnect clears the song, stops polling, and deletes the local encrypted connection. Logout stops publishing; the account's encrypted connection is available when that same account logs back in. The browser version displays listening activity but has no connection controls or token access.

The app checks the currently playing song every five seconds and respects Spotify's retry delays. Paused playback, local files, ads, and unavailable playback clear the indicator. Only song metadata is written to a session-owned Firebase presence record; server-side disconnect cleanup and a 90-second lease remove stale activity after network loss or crashes. Artist/title/artwork are shown on profiles, and the play action opens the Spotify desktop protocol with an HTTPS fallback.

As of September 2026, Spotify's [development-mode documentation](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) requires a Premium app owner and allows up to five allowlisted authenticated users. Each intended Spotify account needs to be allowed by the app owner unless Spotify has granted extended quota access. A successful browser sign-in by itself does not prove API access; Spotify can return 403 for a user who is not allowed. This is controlled by Spotify, outside Chat App's source code.

The implementation is covered by native PKCE, token isolation, late-response, rate-limit, public-presence and browser UI tests. Actual Spotify sign-in and redirect registration require the app owner's Spotify configuration and an authorized account; they were not asserted by the automated tests. No tests write to live Firebase.

Run:

```
node --test desktop/tests/spotify.test.cjs tests/spotify-presence.test.cjs
node tests/spotify.browser.cjs
```
