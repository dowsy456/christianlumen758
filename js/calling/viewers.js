/* calling/viewers: methods register before ordered initialization. */
(function (App) {
  "use strict";
// Keep legacy screen keys unchanged; camera keys carry their source explicitly.
App.callCameraKey = code => 'camera:' + String(code || '');
App.callShareOwner = key => String(key || '').replace(/^camera:/, '');
App.callShareIsCamera = key => String(key || '').startsWith('camera:');
App.callShareIsAvailable = function (key) {
  const code = App.callShareOwner(key), camera = App.callShareIsCamera(key);
  if (code === String(App.currentUser?.code || '')) return camera ? !!App.callCameraSharing : !!App.callSharing;
  const member = App.callGetMemberByCode(code);
  return member?.connected !== false && (camera ? !!member?.cameraSharing : !!member?.sharing);
};
App.callAvailableShareKeys = function () {
  const keys = new Set();
  for (const member of App.callMembersCache) {
    const code = String(member?.code || '');
    if (!code || member.connected === false) continue;
    if (App.callShareIsAvailable(code)) keys.add(code);
    if (App.callShareIsAvailable(App.callCameraKey(code))) keys.add(App.callCameraKey(code));
  }
  return keys;
};
App.callGetShareStream = function (key) {
  const code = App.callShareOwner(key), camera = App.callShareIsCamera(key);
  if (!code || !App.callShareIsAvailable(key)) return null;
  return code === String(App.currentUser?.code || '')
    ? (camera ? App.callCameraStream : App.callScreenStream) || null
    : App.callRemoteVideoStreams.get(String(key)) || null;
};
App.callGetShareId = function (key) {
  const code = App.callShareOwner(key), camera = App.callShareIsCamera(key);
  if (!code) return '';
  if (code === String(App.currentUser?.code || '')) return String((camera ? App.callCameraShareId : App.callScreenShareId) || '');
  const member = App.callGetMemberByCode(code);
  if (camera) return member?.cameraSharing ? String(member.cameraShareId || '') : '';
  if (!member?.sharing) return '';
  return String(member.shareId || `legacy:${member.sessionId || code}`);
};
App.callGetSharePreview = function (key) {
  const code = App.callShareOwner(key), camera = App.callShareIsCamera(key);
  const member = App.callGetMemberByCode(code);
  const value = code === String(App.currentUser?.code || '')
    ? (camera ? App.callCameraPreviewDataURL : App.callScreenPreviewDataURL)
    : (camera ? member?.cameraPreviewDataURL : member?.sharePreviewDataURL);
  return typeof value === 'string' && value.length <= 96000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value) ? value : null;
};
App.callNormalizeViewingShares = function (raw) {
  if (!raw || typeof raw !== "object") return {};
  const normalized = {};
  for (const [ownerCodeRaw, shareIdRaw] of Object.entries(raw)) {
    const ownerCode = String(ownerCodeRaw || "");
    const shareId = String(shareIdRaw || "");
    if (ownerCode && shareId) normalized[ownerCode] = shareId;
  }
  return normalized;
};
App.callViewingSharesSignature = function (shares) {
  return JSON.stringify(Object.entries(App.callNormalizeViewingShares(shares)).sort(([a], [b]) => a.localeCompare(b)));
};
App.callGetShareViewerUsers = function (ownerCode, {
  optimistic = true
} = {}) {
  const owner = String(ownerCode || "");
  if (!owner) return [];
  const expectedShareId = App.callGetShareId(owner);
  const viewerCodes = new Set();
  const cached = App.callShareViewersCache.get(owner);
  if (cached instanceof Map) {
    for (const [viewerCode, sessionRecords] of cached.entries()) {
      const code = String(viewerCode || "");
      if (!code || code === App.callShareOwner(owner)) continue;
      const member = App.callGetMemberByCode(code);
      const memberSessionId = String(member?.sessionId || "");
      const mirrorIsAuthoritative = !!memberSessionId && String(member?.viewingSharesSessionId || "") === memberSessionId;
      if (mirrorIsAuthoritative) {
        const mirroredShareId = String(App.callNormalizeViewingShares(member?.viewingShares)[owner] || "");
        if (mirroredShareId && (!expectedShareId || mirroredShareId === expectedShareId)) viewerCodes.add(code);
        continue;
      }
      const records = sessionRecords instanceof Map ? Array.from(sessionRecords.values()) : [sessionRecords];
      const record = records.find(candidate => String(candidate?.sessionId || "") === memberSessionId) || records.filter(candidate => {
        const candidateShareId = String(candidate?.shareId || "");
        return !expectedShareId || !candidateShareId || candidateShareId === expectedShareId;
      }).sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))[0];
      const recordSessionId = String(record?.sessionId || "");
      const recordShareId = String(record?.shareId || "");
      const recordAge = Date.now() - Number(record?.updatedAt || 0);
      const exactCurrentSession = !!memberSessionId && recordSessionId === memberSessionId;
      const recentlyReassertedSession = !!recordSessionId && Number.isFinite(recordAge) && recordAge >= 0 && recordAge <= App.CALL_HEARTBEAT_MS * 3;
      if (!member || member.connected === false || !exactCurrentSession && !recentlyReassertedSession) continue;
      if (expectedShareId && recordShareId && recordShareId !== expectedShareId) continue;
      viewerCodes.add(code);
    }
  }

  // Mirror viewership on the viewer's member record as a second source of
  // truth. This keeps the owner UI live even when a deployment's database
  // rules have not yet granted access to the newer screenViewers branch.
  for (const member of App.callMembersCache) {
    const code = String(member?.code || "");
    if (!code || code === App.callShareOwner(owner) || member?.connected === false) continue;
    if (!member?.sessionId || String(member.viewingSharesSessionId || "") !== String(member.sessionId)) continue;
    const mirroredShareId = String(App.callNormalizeViewingShares(member?.viewingShares)[owner] || "");
    if (!mirroredShareId) continue;
    if (expectedShareId && mirroredShareId !== expectedShareId) continue;
    viewerCodes.add(code);
  }
  const selfCode = String(App.currentUser?.code || "");
  if (optimistic && selfCode && selfCode !== App.callShareOwner(owner) && App.callMenuOpen && App.callWatchedShareCodes.has(owner)) {
    viewerCodes.add(selfCode);
  }
  return Array.from(viewerCodes).map(code => {
    if (code === selfCode && App.currentUser) return App.currentUser;
    const member = App.callGetMemberByCode(code);
    return App.getLiveOrStoredCallUser(member || App.liveUserCache.get(code) || {
      code
    });
  }).filter(Boolean).sort((a, b) => String(a?.displayName || a?.username || a?.code || "").localeCompare(String(b?.displayName || b?.username || b?.code || "")));
};
App.callStopShareViewerObserver = function ({
  roomId = null,
  sessionId = null
} = {}) {
  const id = App.sanitizeCallRoom(roomId || App.callShareViewersRoomId || App.currentCallRoomId);
  const sid = String(sessionId || App.callSessionId || "");
  App.callViewerPresenceSyncToken += 1;
  App.callViewerPresenceSyncQueued = false;
  App.callViewerPresenceForceQueued = false;
  if (App.callShareViewersRef && App.callShareViewersCb) {
    try {
      App.callShareViewersRef.off("value", App.callShareViewersCb);
    } catch {}
  }
  App.callShareViewersRef = null;
  App.callShareViewersCb = null;
  App.callShareViewersRoomId = null;
  App.callShareViewersCache.clear();
  App.callPublishDesktopOverlay?.();
  App.callPublishedViewingSharesSignature = null;
  for (const [ownerCode, entry] of Array.from(App.callViewerPresenceRefs.entries())) {
    if (id && entry?.roomId && entry.roomId !== id) continue;
    if (sid && entry?.sessionId && entry.sessionId !== sid) continue;
    try {
      entry.ref.onDisconnect().cancel();
    } catch {}
    try {
      entry.ref.remove();
    } catch {}
    App.callViewerPresenceRefs.delete(ownerCode);
  }
};
App.callStartShareViewerObserver = function (roomId) {
  const id = App.sanitizeCallRoom(roomId);
  if (!id || !App.currentUser || !App.callSessionId) return;
  if (App.callShareViewersRef && App.callShareViewersRoomId === id) return;
  App.callStopShareViewerObserver();
  App.callShareViewersRoomId = id;
  App.callShareViewersRef = App.db.ref(`calls/${id}/screenViewers`);
  App.callShareViewersCb = snap => {
    if (App.currentCallRoomId !== id || App.callShareViewersRoomId !== id) return;
    const root = snap.val() || {};
    const next = new Map();
    for (const [ownerCodeRaw, viewersRaw] of Object.entries(root)) {
      const ownerCode = String(ownerCodeRaw || "");
      if (!ownerCode || !viewersRaw || typeof viewersRaw !== "object") continue;
      const ownerMap = new Map();
      for (const [viewerCodeRaw, sessionsRaw] of Object.entries(viewersRaw)) {
        const viewerCode = String(viewerCodeRaw || "");
        if (!viewerCode || viewerCode === App.callShareOwner(ownerCode) || !sessionsRaw || typeof sessionsRaw !== "object") continue;
        const records = new Map();
        // Read the earlier non-session-nested shape defensively during rollout.
        if (sessionsRaw.sessionId) {
          records.set(String(sessionsRaw.sessionId), {
            sessionId: String(sessionsRaw.sessionId),
            shareId: String(sessionsRaw.shareId || ""),
            updatedAt: Number(sessionsRaw.updatedAt || 0)
          });
        } else {
          for (const [sessionKey, record] of Object.entries(sessionsRaw)) {
            if (!record || typeof record !== "object") continue;
            const recordSessionId = String(record.sessionId || sessionKey || "");
            if (!recordSessionId) continue;
            records.set(recordSessionId, {
              sessionId: recordSessionId,
              shareId: String(record.shareId || ""),
              updatedAt: Number(record.updatedAt || 0)
            });
          }
        }
        if (!records.size) continue;
        ownerMap.set(viewerCode, records);
        App.ensureLiveUserListener(viewerCode);
      }
      if (ownerMap.size) next.set(ownerCode, ownerMap);
    }
    App.callShareViewersCache = next;
    if (App.callMenuOpen) App.callRefreshScreenViewerDisplays();
    else App.callPublishDesktopOverlay?.();
  };
  App.callShareViewersRef.on("value", App.callShareViewersCb, error => {
    console.warn("screen viewer observer failed; using member-presence mirror:", error);
  });
};
App.callSyncViewerPresence = function ({
  force = false
} = {}) {
  App.callSyncScreenAudioPlayback();
  App.callViewerPresenceSyncQueued = true;
  App.callViewerPresenceForceQueued = App.callViewerPresenceForceQueued || !!force;
  if (App.callViewerPresenceSyncPromise) return App.callViewerPresenceSyncPromise;
  const drain = (async () => {
    while (App.callViewerPresenceSyncQueued) {
      const nextForce = App.callViewerPresenceForceQueued;
      App.callViewerPresenceSyncQueued = false;
      App.callViewerPresenceForceQueued = false;
      await App.callSyncViewerPresenceNow({
        force: nextForce
      });
    }
  })();
  App.callViewerPresenceSyncPromise = drain;
  const finish = () => {
    if (App.callViewerPresenceSyncPromise === drain) App.callViewerPresenceSyncPromise = null;
    if (App.callViewerPresenceSyncQueued) void App.callSyncViewerPresence({
      force: App.callViewerPresenceForceQueued
    });
  };
  void drain.then(finish, finish);
  return drain;
};
App.callSyncViewerPresenceNow = async function ({
  force = false
} = {}) {
  const token = ++App.callViewerPresenceSyncToken;
  const roomId = App.sanitizeCallRoom(App.currentCallRoomId);
  const sessionId = String(App.callSessionId || "");
  const selfCode = String(App.currentUser?.code || "");
  // Do not gate this on Page Visibility. iOS/Android native fullscreen and
  // capture UI can mark the document hidden while the watched share remains
  // the active media surface. Closing the call menu is the explicit stop.
  const viewingSurfaceOpen = App.callMenuOpen;
  const desired = new Map();
  if (roomId && sessionId && selfCode && viewingSurfaceOpen) {
    for (const ownerCodeRaw of App.callWatchedShareCodes) {
      const ownerCode = String(ownerCodeRaw || "");
      const owner = App.callGetMemberByCode(App.callShareOwner(ownerCode));
      const shareId = App.callGetShareId(ownerCode);
      if (!ownerCode || App.callShareOwner(ownerCode) === selfCode || !owner || !App.callShareIsAvailable(ownerCode) || !shareId) continue;
      desired.set(ownerCode, shareId);
    }
  }
  // The member mirror controls sender attachment. Publish the new selection
  // before old viewer-leaf cleanup or heartbeat acknowledgements can delay it.
  const mirroredViewingShares = Object.fromEntries(Array.from(desired.entries()).sort(([a], [b]) => a.localeCompare(b)));
  const mirroredSignature = App.callViewingSharesSignature(mirroredViewingShares);
  if (App.myCallMemberRef && roomId && sessionId && selfCode && (force || mirroredSignature !== App.callPublishedViewingSharesSignature)) {
    try {
      await App.myCallMemberRef.update({
        viewingShares: Object.keys(mirroredViewingShares).length ? mirroredViewingShares : null,
        viewingSharesSessionId: sessionId
      });
      if (token === App.callViewerPresenceSyncToken && App.currentCallRoomId === roomId && App.callSessionId === sessionId) {
        App.callPublishedViewingSharesSignature = mirroredSignature;
      }
    } catch (e) {
      console.warn("member viewer-presence mirror failed:", e);
    }
  }
  if (token !== App.callViewerPresenceSyncToken) return;
  for (const [ownerCode, entry] of Array.from(App.callViewerPresenceRefs.entries())) {
    const wantedShareId = desired.get(ownerCode) || "";
    const keep = !!wantedShareId && entry.roomId === roomId && entry.sessionId === sessionId && entry.shareId === wantedShareId;
    if (keep) {
      if (force || Date.now() - Number(entry.lastWriteAt || 0) >= App.CALL_HEARTBEAT_MS) {
        try {
          await entry.ref.set({
            sessionId,
            shareId: wantedShareId,
            updatedAt: App.firebase.database.ServerValue.TIMESTAMP
          });
          entry.lastWriteAt = Date.now();
        } catch (e) {
          // Treat the local entry as a cache, not proof the backend leaf still
          // exists. Dropping it lets the creation pass below repair it.
          App.callViewerPresenceRefs.delete(ownerCode);
          console.warn("screen viewer presence reassert failed:", e);
        }
      }
      continue;
    }
    try {
      await entry.ref.onDisconnect().cancel();
    } catch {}
    try {
      await entry.ref.remove();
    } catch {}
    App.callViewerPresenceRefs.delete(ownerCode);
  }
  if (token !== App.callViewerPresenceSyncToken || !roomId || !sessionId || !selfCode || !viewingSurfaceOpen) return;
  for (const [ownerCode, shareId] of desired.entries()) {
    if (App.callViewerPresenceRefs.has(ownerCode)) continue;
    const ref = App.db.ref(`calls/${roomId}/screenViewers/${ownerCode}/${selfCode}/${sessionId}`);
    const entry = {
      ref,
      roomId,
      sessionId,
      shareId,
      lastWriteAt: 0
    };
    App.callViewerPresenceRefs.set(ownerCode, entry);
    try {
      await ref.onDisconnect().remove();
      if (token !== App.callViewerPresenceSyncToken || App.currentCallRoomId !== roomId || App.callSessionId !== sessionId) {
        try {
          await ref.onDisconnect().cancel();
        } catch {}
        try {
          await ref.remove();
        } catch {}
        if (App.callViewerPresenceRefs.get(ownerCode) === entry) App.callViewerPresenceRefs.delete(ownerCode);
        continue;
      }
      await ref.set({
        sessionId,
        shareId,
        updatedAt: App.firebase.database.ServerValue.TIMESTAMP
      });
      entry.lastWriteAt = Date.now();
    } catch (e) {
      if (App.callViewerPresenceRefs.get(ownerCode) === entry) App.callViewerPresenceRefs.delete(ownerCode);
      console.warn("screen viewer presence failed:", e);
    }
  }
};
App.callPruneWatchedShares = function (sharingCodes = null) {
  const available = sharingCodes instanceof Set ? sharingCodes : App.callAvailableShareKeys();
  for (const code of Array.from(App.callWatchedShareCodes)) {
    if (!available.has(code)) App.callWatchedShareCodes.delete(code);
  }
  if (App.callFocusedShareCode && !App.callWatchedShareCodes.has(App.callFocusedShareCode)) {
    App.callFocusedShareCode = null;
  }
  if (App.shareViewUserCode && !available.has(String(App.shareViewUserCode))) {
    App.shareViewUserCode = null;
    App.shareViewUsername = null;
  }
  App.shareViewOpen = App.callWatchedShareCodes.size > 0;
  if (!App.shareViewOpen) App.callMultiViewEnabled = false;
  void App.callSyncViewerPresence();
};
App.callCanMultiView = function () {
  const selfCode = String(App.currentUser?.code || "");
  const remoteShares = new Set(Array.from(App.callAvailableShareKeys()).filter(key => App.callShareOwner(key) !== selfCode));
  return remoteShares.size >= 2;
};
App.openShareView = function (userCode, username, {
  multi = false
} = {}) {
  const code = String(userCode || "");
  if (!code) return;
  App.shareViewUserCode = code;
  App.shareViewUsername = String(username || "User");
  // Every media tile is an independent subscription, including your own
  // screen and camera. Opening another tile never closes an existing stream.
  App.callFocusedShareCode = null;
  App.callWatchedShareCodes.add(code);
  App.callMultiViewEnabled = App.callWatchedShareCodes.size > 1;
  App.shareViewOpen = true;
  if (App.callMenuOpen) App.renderCallMenu();
  void App.callSyncViewerPresence();
  requestAnimationFrame(App.syncShareViewStream);
};
App.callCloseWatchedShare = function (userCode) {
  const code = String(userCode || "");
  if (!code) return;
  App.callWatchedShareCodes.delete(code);
  if (App.callFocusedShareCode === code) App.callFocusedShareCode = null;
  if (String(App.shareViewUserCode || "") === code) {
    const next = Array.from(App.callWatchedShareCodes).at(-1) || null;
    App.shareViewUserCode = next;
    App.shareViewUsername = next ? String(App.callGetMemberByCode(App.callShareOwner(next))?.displayName || App.callGetMemberByCode(App.callShareOwner(next))?.username || "User") : null;
  }
  if (App.callWatchedShareCodes.size < 2) App.callMultiViewEnabled = false;
  App.shareViewOpen = App.callWatchedShareCodes.size > 0;
  if (App.callMenuOpen) App.renderCallMenu();
  void App.callSyncViewerPresence();
};
App.callToggleShareFocus = function (userCode) {
  const code = String(userCode || "");
  if (!code || !App.callWatchedShareCodes.has(code)) return;
  App.callFocusedShareCode = App.callFocusedShareCode === code ? null : code;
  App.callFocusedControlsVisible = !!App.callFocusedShareCode;
  App.shareViewOpen = true;
  App.shareViewUserCode = code;
  if (App.callMenuOpen) App.renderCallMenu();
  App.$("call-menu-list")?.querySelector(".call-view-tile.is-focused .call-view-body")?.focus({ preventScroll: true });
  void App.callSyncViewerPresence();
};
App.callFullscreenShare = async function (userCode) {
  const code = String(userCode || "");
  const tile = document.querySelector(`.call-view-tile[data-share-code="${CSS.escape(code)}"]`);
  const video = tile?.querySelector(".call-view-video");
  const target = video && !video.hidden ? video : tile;
  if (!target?.requestFullscreen) return;
  try {
    await target.requestFullscreen();
  } catch {}
};
App.closeShareView = function (immediate = false) {
  const code = String(App.shareViewUserCode || App.callFocusedShareCode || "");
  App.callFocusedShareCode = null;
  if (immediate && code) App.callWatchedShareCodes.delete(code);
  if (!App.callWatchedShareCodes.size) {
    App.shareViewOpen = false;
    App.shareViewUserCode = null;
    App.shareViewUsername = null;
    App.callMultiViewEnabled = false;
  }
  if (App.callMenuOpen) App.renderCallMenu();
  void App.callSyncViewerPresence();
};
App.syncShareViewStream = function () {
  document.querySelectorAll(".call-view-tile[data-share-code]").forEach(tile => {
    const code = String(tile.getAttribute("data-share-code") || "");
    const video = tile.querySelector(".call-view-video");
    const placeholder = tile.querySelector(".call-view-placeholder");
    if (!video || !placeholder || !code) return;
    const stream = App.callGetShareStream(code);
    const liveTrack = stream?.getVideoTracks?.().find(track => track.readyState === "live") || null;
    const hasLiveVideo = !!(liveTrack && !liveTrack.muted);
    placeholder.hidden = hasLiveVideo;
    video.hidden = !hasLiveVideo;
    if (!hasLiveVideo) {
      try {
        video.pause();
      } catch {}
      try {
        video.srcObject = null;
      } catch {}
      const isSelf = String(App.currentUser?.code || "") === App.callShareOwner(code);
      if (!isSelf && App.callShareIsAvailable(code)) {
        void App.callSyncViewerPresence();
      }
      return;
    }
    try {
      video.muted = true;
    } catch {}
    if (video.srcObject !== stream) video.srcObject = stream;
    try {
      video.play()?.catch?.(() => {});
    } catch {}
  });
};
App.setCallMenuExpanded = function (expanded) {
  App.callMenuExpanded = !!expanded && !!App.callMenuOpen && !!App.currentCallRoomId;
  const menu = App.$("call-menu");
  const button = App.$("btn-call-menu-expand");
  menu?.classList.toggle("is-expanded", App.callMenuExpanded);
  document.body.classList.toggle("call-menu-expanded", App.callMenuExpanded);
  if (button) {
    const label = App.callMenuExpanded ? "Restore Call Menu" : "Expand Call Menu";
    button.setAttribute("aria-label", label);
    button.dataset.tooltip = label;
    button.setAttribute("aria-pressed", App.callMenuExpanded ? "true" : "false");
  }
  App.syncExpandedCallChat?.();
};

App.register("calling/viewers", function initializeFeature() {

});
})(globalThis.ChatApp);
