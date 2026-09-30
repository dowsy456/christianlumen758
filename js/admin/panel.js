/* admin/panel: methods register before ordered initialization. */
(function (App) {
  "use strict";
App.isVinny = function () {
  return !!(App.currentUser && String(App.currentUser.username || "") === "Vinny");
};
App.syncPanelButtonVisibility = function () {
  const btn = App.$("btn-side-panel");
  if (!btn) return;
  btn.hidden = !App.isVinny();
};
App.normalizeAdminGhostRooms = function (raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [roomId, enabled] of Object.entries(raw)) {
    const id = App.sanitizeRoomCode(roomId);
    if (id && enabled === true) out[id] = true;
  }
  return out;
};
App.isGhostModeEnabledForRoom = function (roomId, userCode = App.currentUser?.code) {
  const id = App.sanitizeRoomCode(roomId);
  const code = String(userCode || "").trim();
  if (!id || !code) return false;
  const live = App.liveUserCache.get(code) || null;
  const user = String(App.currentUser?.code || "") === code ? App.currentUser : null;
  const ghostRooms = App.normalizeAdminGhostRooms(live?.adminGhostRooms || user?.adminGhostRooms || {});
  return ghostRooms[id] === true;
};
App.setGhostModeForRoom = async function (roomId, enabled) {
  const id = App.sanitizeRoomCode(roomId);
  if (!id || !App.currentUser || !App.isVinny()) return false;
  const selfCode = String(App.currentUser.code || "");
  const nextRooms = App.normalizeAdminGhostRooms(App.currentUser.adminGhostRooms || {});
  if (enabled) nextRooms[id] = true;else delete nextRooms[id];
  await App.db.ref(`users/${selfCode}/${App.ADMIN_GHOST_ROOMS_NODE}/${id}`).set(enabled ? true : null);
  App.currentUser.adminGhostRooms = nextRooms;
  App.liveUserCache.set(selfCode, {
    ...(App.liveUserCache.get(selfCode) || {}),
    code: selfCode,
    username: App.currentUser.username || "User",
    usernameLower: String(App.currentUser.usernameLower || App.currentUser.username || "user").toLowerCase(),
    displayName: App.currentUser.displayName || App.currentUser.username || "User",
    displayNameLower: String(App.currentUser.displayNameLower || App.currentUser.displayName || App.currentUser.username || "user").toLowerCase(),
    photoDataURL: App.currentUser.photoDataURL || App.defaultStickmanDataURL(),
    photoTransform: App.currentUser.photoTransform || null,
    adminGhostRooms: nextRooms
  });
  if (App.currentRoomId === id) {
    if (enabled) {
      App.stopRoomPresence();
      App.onlinePresenceCache.delete(selfCode);
      App.roomMembersCache.delete(selfCode);
      App.roomCallMembersCache.delete(selfCode);
    } else {
      App.roomMembersCache.set(selfCode, true);
      App.startRoomPresence(id);
    }
    try {
      App.renderOnlineIndicator();
    } catch {}
  }
  App.showToast({
    title: enabled ? "Ghost Mode enabled" : "Ghost Mode disabled",
    body: enabled ? `You are hidden in ${App.roomDisplayName(id)}.` : `You are visible in ${App.roomDisplayName(id)}.`,
    duration: 1800
  });
  return true;
};

App.register("admin/panel", function initializeFeature() {
App.ADMIN_GHOST_ROOMS_NODE = "adminGhostRooms";
});
})(globalThis.ChatApp);
