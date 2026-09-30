/* core/validation: methods register before ordered initialization. */
(function (App) {
  "use strict";
App.sanitizeUsername = function (raw) {
  let s = (raw ?? "").replace(/\s+/g, " ").trim(); // collapses whitespace runs
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code < 32 || code > 126) return null; // ASCII printable only
  }
  if (!s) return null;
  if (s.length > 20) return null;
  return s;
};
App.sanitizeRoomName = function (raw) {
  let s = String(raw ?? "").replace(/\s+/g, " ").trim();
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code < 32 || code > 126) return null;
  }
  if (!s || s.length > 20) return null;
  if (/[.#$\[\]\/]/.test(s)) return null;
  return s;
};
App.sanitizeRoomCode = function (raw) {
  const name = App.sanitizeRoomName(raw);
  return name ? name.toLowerCase() : null;
};
App.roomDisplayName = function (roomId, meta = null) {
  const pending = App.pendingRoomNames?.get?.(App.sanitizeRoomCode(roomId));
  if (pending) return pending;
  // Room IDs are normalized for storage; visible names keep the creator's case.
  // Resolve cached metadata even when a menu only passes the stable room ID.
  const cached = App.roomsMetaCache?.get?.(App.sanitizeRoomCode(roomId));
  const metaName = App.sanitizeRoomName(meta?.name) || App.sanitizeRoomName(cached?.name);
  if (metaName) return metaName;
  const rawId = String(roomId ?? "").trim();
  const idName = App.sanitizeRoomName(rawId);
  if (idName) return idName;
  return rawId || "Room";
};
App.sanitizeRoomPassword = function (raw) {
  let s = String(raw ?? "").replace(/\s+/g, " ").trim();
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code < 32 || code > 126) return null;
  }
  return s || null;
};
App.legacyRoomPasswordHashInput = function (password, roomId) {
  const clean = App.sanitizeRoomPassword(password);
  if (!clean) return null;
  return `chatapp-room-password-v1:${App.sanitizeRoomCode(roomId) || ""}:${clean}`;
};
App.legacyRoomPasswordHashFallback = function (input) {
  let h = 2166136261;
  const s = String(input || "");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};
App.legacyFallbackRoomPasswordHash = function (password, roomId) {
  const input = App.legacyRoomPasswordHashInput(password, roomId);
  return input ? `fallback:${App.legacyRoomPasswordHashFallback(input)}` : null;
};
App.computeLegacyRoomPasswordHash = async function (password, roomId) {
  const input = App.legacyRoomPasswordHashInput(password, roomId);
  if (!input) return null;
  try {
    if (globalThis.crypto?.subtle && globalThis.TextEncoder) {
      const bytes = new TextEncoder().encode(input);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {}
  return App.legacyFallbackRoomPasswordHash(password, roomId);
};
App.isPrivateRoomMeta = function (meta) {
  return !!(meta && (meta.private === true || String(meta.password || "").trim() || String(meta.passwordHash || "").trim()));
};
App.verifyLegacyRoomPasswordHash = async function (meta, password, roomId) {
  const expectedHash = String(meta?.passwordHash || "").trim();
  if (!expectedHash) return false;
  if (expectedHash.startsWith("fallback:")) {
    return expectedHash === App.legacyFallbackRoomPasswordHash(password, roomId);
  }
  const hash = await App.computeLegacyRoomPasswordHash(password, roomId);
  return !!hash && hash === expectedHash;
};
App.migrateLegacyRoomPassword = async function (roomId, meta, password) {
  const id = App.sanitizeRoomCode(roomId);
  const clean = App.sanitizeRoomPassword(password);
  if (!id || !clean || !String(meta?.passwordHash || "").trim()) return;
  const nextMeta = {
    ...(App.roomsMetaCache.get(id) || meta || {}),
    private: true,
    password: clean,
    passwordHash: null
  };
  try {
    await App.db.ref(`rooms/${id}`).update({
      private: true,
      password: clean,
      passwordHash: null
    });
    App.roomsMetaCache.set(id, nextMeta);
    App.scheduleRoomsListCacheSave();
    App.refreshRoomIconSurfaces(id);
  } catch {}
};
App.verifyRoomPassword = async function (meta, password, roomId) {
  if (!App.isPrivateRoomMeta(meta)) return true;
  const clean = App.sanitizeRoomPassword(password);
  if (!clean) return false;
  const expectedPassword = String(meta?.password || "").trim();
  if (expectedPassword) return expectedPassword === clean;
  const legacyOk = await App.verifyLegacyRoomPasswordHash(meta, clean, roomId);
  if (legacyOk) await App.migrateLegacyRoomPassword(roomId, meta, clean);
  return legacyOk;
};
App.roomLockIconSVG = function () {
  return `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7.5 10V8a4.5 4.5 0 0 1 9 0v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <rect x="5.5" y="10" width="13" height="10" rx="2.4" stroke="currentColor" stroke-width="2"/>
      <path d="M12 14v2.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;
};
App.privateRoomMarkHTML = function (meta) {
  return App.isPrivateRoomMeta(meta) ? `<span class="room-lock-mark" aria-label="Private Room" data-tooltip="Private">${App.roomLockIconSVG()}</span>` : "";
};
App.fnv1aHex = function (str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
};
App.sha256Hex = async function (text) {
  try {
    if (!crypto?.subtle) return App.fnv1aHex(text);
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    const arr = Array.from(new Uint8Array(buf));
    return arr.map(b => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return App.fnv1aHex(text);
  }
};
App.claimDisplayName = async function (displayName, code) {
  const cleaned = App.sanitizeUsername(displayName);
  const ownerCode = String(code || "").trim();
  if (!cleaned || !ownerCode) return {
    ok: false,
    reason: "invalid"
  };
  const displayNameLower = cleaned.toLowerCase();
  const hash = await App.sha256Hex(displayNameLower);
  const ref = App.db.ref(`${App.DISPLAY_NAME_INDEX_NODE}/${hash}`);
  try {
    const snap = await ref.once("value");
    const current = snap.val();
    if (current) {
      const currentCode = typeof current === "string" ? current : String(current?.code || current?.c || "").trim();
      if (currentCode && currentCode !== ownerCode) {
        let stillTaken = false;
        try {
          const ownerSnap = await App.db.ref(`users/${currentCode}`).once("value");
          const owner = ownerSnap.val() || {};
          const ownerDisplayLower = String(owner.displayNameLower || owner.displayName || "").toLowerCase();
          stillTaken = ownerSnap.exists() && ownerDisplayLower === displayNameLower;
        } catch {
          stillTaken = true;
        }
        if (stillTaken) return {
          ok: false,
          reason: "taken"
        };
        try {
          await ref.remove();
        } catch {}
      } else if (!currentCode) {
        try {
          await ref.remove();
        } catch {}
      }
    }
    await ref.set({
      d: displayNameLower,
      code: ownerCode
    });
  } catch {
    return {
      ok: true,
      cleaned,
      displayNameLower,
      hash,
      ref: null
    };
  }
  return {
    ok: true,
    cleaned,
    displayNameLower,
    hash,
    ref
  };
};
App.releaseDisplayName = async function (displayName, code) {
  const cleaned = App.sanitizeUsername(displayName);
  const ownerCode = String(code || "").trim();
  if (!cleaned || !ownerCode) return;
  const displayNameLower = cleaned.toLowerCase();
  const hash = await App.sha256Hex(displayNameLower);
  const ref = App.db.ref(`${App.DISPLAY_NAME_INDEX_NODE}/${hash}`);
  try {
    const snap = await ref.once("value");
    const current = snap.val();
    const currentCode = typeof current === "string" ? current : String(current?.code || current?.c || "").trim();
    const currentName = typeof current === "object" && current ? String(current.d || current.displayNameLower || "").toLowerCase() : displayNameLower;
    if (currentCode === ownerCode && (!currentName || currentName === displayNameLower)) {
      await ref.remove();
    }
  } catch {}
};
App.buildDisplayNameFallback = function (base, ownerCode, n = 0) {
  const suffix = n <= 0 ? "" : String(ownerCode || "").slice(-Math.min(4, n + 1));
  const joiner = suffix ? "-" : "";
  const maxBaseLen = Math.max(1, 20 - joiner.length - suffix.length);
  const root = String(base || "User").slice(0, maxBaseLen) || "User";
  return `${root}${joiner}${suffix}`;
};
App.ensureOwnedDisplayNameForUser = async function (code, rec) {
  const ownerCode = String(code || "").trim();
  if (!ownerCode) return {
    displayName: "User",
    displayNameLower: "user"
  };
  const username = App.sanitizeUsername(rec?.username || "") || "User";
  const currentDisplay = App.sanitizeUsername(rec?.displayName || "") || username;
  const currentDisplayLower = String(rec?.displayNameLower || currentDisplay).toLowerCase();
  const candidates = [];
  const seen = new Set();
  const addCandidate = value => {
    const cleaned = App.sanitizeUsername(value);
    if (!cleaned) return;
    const lower = cleaned.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    candidates.push(cleaned);
  };
  addCandidate(currentDisplay);
  addCandidate(username);
  for (let i = 1; i <= 4; i += 1) {
    addCandidate(App.buildDisplayNameFallback(username, ownerCode, i));
  }
  let claim = null;
  for (const candidate of candidates) {
    claim = await App.claimDisplayName(candidate, ownerCode);
    if (claim?.ok) break;
  }
  if (!claim?.ok) {
    const forced = App.buildDisplayNameFallback("User", ownerCode, 4);
    claim = await App.claimDisplayName(forced, ownerCode);
  }
  if (!claim?.ok) {
    throw new Error("Could not secure a unique display name.");
  }
  const nextDisplayName = claim.cleaned;
  const nextDisplayNameLower = claim.displayNameLower;
  if (currentDisplayLower !== nextDisplayNameLower) {
    void App.releaseDisplayName(currentDisplay, ownerCode);
  }
  if (rec?.displayName !== nextDisplayName || String(rec?.displayNameLower || "").toLowerCase() !== nextDisplayNameLower) {
    await App.db.ref(`users/${ownerCode}`).update({
      displayName: nextDisplayName,
      displayNameLower: nextDisplayNameLower
    });
  }
  return {
    displayName: nextDisplayName,
    displayNameLower: nextDisplayNameLower
  };
};

App.register("core/validation", function initializeFeature() {
App.DISPLAY_NAME_INDEX_NODE = "displayNames";
});
})(globalThis.ChatApp);
