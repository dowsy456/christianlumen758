/* rooms/actions: methods register before ordered initialization. */
(function (App) {
  "use strict";
App.hardClearComposerAndOverlays = function () {
  App.clearPendingPoll?.();
  try {
    App.cancelEditMessage({
      quiet: true
    });
  } catch {}
  try {
    App.clearReplyState({
      quiet: true
    });
  } catch {}
  try {
    App.clearPendingFiles({
      quiet: true
    });
  } catch {}
  try {
    App.closePingBar({
      quiet: true
    });
  } catch {}
  try {
    App.$("msg-input").value = "";
  } catch {}
  try {
    App.syncChatOverlayMetrics();
  } catch {}
  try {
    App.closeMsgMenu(true);
  } catch {}
};
App.clearRoomMessages = async function (roomId) {
  const id = App.sanitizeRoomCode(roomId);
  if (!id || !App.isVinny()) return false;

  // One atomic write clears the stream, receipts, polls and room metadata.
  // Firebase immediately delivers its local events and rolls back on denial;
  // the live room listener performs the same reset on every connected client.
  const clearedMetaPatch = {
    messagesClearedAt: App.pollNow(),
    countedSystemMessages: null,
    lastMessageAt: null,
    lastMessagePreview: null,
    messageCount: 0
  };
  App.invalidateRecentRoomMessages?.(id);
  await App.db.ref().update({ [`messages/${id}`]: null, [`activePolls/${id}`]: null, [`readReceipts/${id}`]: { _clearedAt: clearedMetaPatch.messagesClearedAt },
    ...Object.fromEntries(Object.entries(clearedMetaPatch).map(([key, value]) => [`rooms/${id}/${key}`, value])) });
  // Auxiliary cleanup must never hold the visible clear hostage, reload the
  // room, or overwrite reads/new messages that arrived after the clear.
  void (async () => {
    const ms = await App.db.ref(`roomMembers/${id}`).once("value");
    const updates = {};
    for (const userCode of Object.keys(ms.val() || {})) {
        updates[`users/${userCode}/prefs/videoPlayerByRoom/${id}`] = null;
    }
    if (Object.keys(updates).length) await App.db.ref().update(updates);
  })().catch(error => console.warn("Room preference cleanup unavailable", error?.code));
  return true;
};
App.confirmClearRoomMessages = function (roomId) {
  const id = App.sanitizeRoomCode(roomId);
  if (!id || !App.isVinny()) return;
  const displayName = App.roomDisplayName(id, App.roomsMetaCache.get(id) || null);
  App.openModal({
    title: "Clear Messages",
    bodyHTML: `
      <div class="muted small">
        This will permanently clear every message in <span class="strong">${App.escapeHtml(displayName)}</span> for everyone in the room.
      </div>
    `,
    actionsHTML: `
      <button class="btn danger" id="btn-confirm-clear-room-messages" type="button">Clear Messages</button>
    `
  });
  App.$("btn-confirm-clear-room-messages")?.addEventListener("click", async () => {
    const confirmBtn = App.$("btn-confirm-clear-room-messages");
    if (confirmBtn) confirmBtn.disabled = true;
    App.closeModal();
    try {
      const cleared = await App.clearRoomMessages(id);
      if (!cleared) return;
      App.showToast({
        title: "Messages cleared",
        body: `Cleared all messages in ${displayName}.`,
        duration: 2200
      });
    } catch (err) {
      console.error("clear room messages failed:", err);
      App.showToast({
        title: "Clear failed",
        body: "Could not clear that room's messages. Check console / rules.",
        duration: 2800
      });
    }
  }, {
    once: true
  });
};
App.deleteRoomEverywhere = async function (roomId) {
  const id = App.sanitizeRoomCode(roomId);
  if (!id) return;

  // Root multi-path delete (null removes)
  const updates = {
    [`rooms/${id}`]: null,
    [`messages/${id}`]: null,
    [`calls/${id}`]: null
  };
  updates[`activePolls/${id}`] = null;
  updates[`roomSystemEvents/${id}`] = null;
  updates[`pendingCallEnds/${id}`] = null;

  // Remove the room from EVERYONE'S room list + delete per-room video prefs
  try {
    const ms = await App.db.ref("memberships").once("value");
    const all = ms.val() || {};
    for (const [userCode, rooms] of Object.entries(all)) {
      if (rooms && Object.prototype.hasOwnProperty.call(rooms, id)) {
        updates[`memberships/${userCode}/${id}`] = null;
        updates[`users/${userCode}/prefs/videoPlayerByRoom/${id}`] = null;
        updates[`users/${userCode}/${App.ADMIN_GHOST_ROOMS_NODE}/${id}`] = null;
        updates[`pings/${userCode}/${id}`] = null;
      }
    }
  } catch {}

  // Remove deleted-room pins for every user who pinned it, even if they are not currently a member.
  try {
    const usersSnap = await App.db.ref("users").once("value");
    const users = usersSnap.val() || {};
    for (const [userCode, user] of Object.entries(users)) {
      const pinned = user?.prefs?.pinnedRooms;
      if (pinned && Object.prototype.hasOwnProperty.call(pinned, id)) {
        updates[`users/${userCode}/prefs/pinnedRooms/${id}`] = null;
      }
    }
  } catch {}
  await App.db.ref().update(updates);
  if (App.pinnedRoomIds.has(id)) {
    const nextPins = App.getPinnedRoomSet();
    nextPins.delete(id);
    App.setPinnedRoomSetLocal(nextPins);
    App.refreshRoomCollectionsUI();
  }

  // If I’m in it, leave to Home immediately
  if (App.currentRoomId === id) {
    App.hardClearComposerAndOverlays();
    App.showLoggedInHome();
  }
};
App.openAdminPanel = function () {
  if (!App.isVinny()) return;
  App.openModal({
    title: "Panel",
    bodyHTML: `
      <div class="label" style="margin:0 0 10px">Schedule Type</div>
      <div class="settings-choice-row" id="panel-schedtypes">
        <button class="btn tiny" data-panel-schedtype="full" type="button">Full Day</button>
        <button class="btn tiny" data-panel-schedtype="half" type="button">Half Day</button>
        <button class="btn tiny" data-panel-schedtype="delay2" type="button">2 HR Delay</button>
      </div>

      <div style="height:16px"></div>

      <div class="label" style="margin:0 0 10px">Account Creation</div>
      <div class="settings-choice-row" id="panel-account-creation">
        <button class="btn tiny" data-panel-account-creation="enabled" type="button">Enabled</button>
        <button class="btn tiny primary" data-panel-account-creation="disabled" type="button">Disabled</button>
      </div>

      <div style="height:16px"></div>

      <div class="label" style="margin:0 0 10px">Room Management</div>
      <div class="panel-rooms" id="panel-rooms"><div class="muted small">Loading…</div></div>
    `,
    actionsHTML: `
      <button class="btn" id="btn-panel-refresh" type="button">Refresh</button>
    `
  });
  App.$("btn-panel-refresh")?.addEventListener("click", () => App.loadAdminPanelRooms());

  // Schedule Type + Account Creation controls (Vinny only)
  App.startScheduleTypeListener();
  App.startAccountCreationListener();
  App.startSchedulesPeopleListener();
  const schedWrap = App.$("panel-schedtypes");
  const accountWrap = App.$("panel-account-creation");
  if (schedWrap) {
    schedWrap.querySelectorAll("[data-panel-schedtype]").forEach(btn => {
      const k = btn.getAttribute("data-panel-schedtype") || "full";
      btn.classList.toggle("primary", App._normalizeScheduleType(k) === App._normalizeScheduleType(App.scheduleType));
    });
    if (schedWrap.dataset.bound !== "1") {
      schedWrap.dataset.bound = "1";
      schedWrap.addEventListener("click", async e => {
        const btn = e.target.closest("button[data-panel-schedtype]");
        if (!btn) return;
        const k = btn.getAttribute("data-panel-schedtype") || "full";
        try {
          await App.setScheduleType(k);
          App.showToast({
            title: "Schedule type saved",
            body: `Now set to ${App._scheduleTypeLabel(k)}.`,
            duration: 1700
          });
        } catch (err) {
          console.error("set scheduleType failed:", err);
          App.showToast({
            title: "Failed",
            body: "Could not save schedule type. Check console / rules.",
            duration: 2600
          });
        }
      });
    }
  }
  if (accountWrap) {
    accountWrap.querySelectorAll("[data-panel-account-creation]").forEach(btn => {
      const k = btn.getAttribute("data-panel-account-creation") || "disabled";
      btn.classList.toggle("primary", k === "enabled" === App.accountCreationEnabled);
    });
    if (accountWrap.dataset.bound !== "1") {
      accountWrap.dataset.bound = "1";
      accountWrap.addEventListener("click", async e => {
        const btn = e.target.closest("button[data-panel-account-creation]");
        if (!btn) return;
        const enabled = (btn.getAttribute("data-panel-account-creation") || "disabled") === "enabled";
        try {
          await App.setAccountCreationEnabled(enabled);
          App.showToast({
            title: "Account creation saved",
            body: `Account creation ${enabled ? "enabled" : "disabled"}.`,
            duration: 1700
          });
        } catch (err) {
          console.error("set account creation failed:", err);
          App.showToast({
            title: "Failed",
            body: "Could not save account creation. Check console / rules.",
            duration: 2600
          });
        }
      });
    }
  }
  const listEl = App.$("panel-rooms");
  if (listEl && listEl.dataset.bound !== "1") {
    listEl.dataset.bound = "1";
    listEl.addEventListener("click", async e => {
      const btn = e.target.closest("button[data-panel-act]");
      if (!btn) return;
      const act = btn.getAttribute("data-panel-act");
      const rid = btn.getAttribute("data-room-id");
      if (!act || !rid) return;
      btn.disabled = true;
      try {
        if (act === "clear") {
          await App.clearRoomMessages(rid);
          App.showToast({
            title: "Messages cleared",
            body: `Cleared all messages in ${rid}.`,
            duration: 2000
          });
          await App.loadAdminPanelRooms();
        } else if (act === "join") {
          await App.joinRoomFromPanel(rid);
        } else if (act === "ghost") {
          await App.setGhostModeForRoom(rid, !App.isGhostModeEnabledForRoom(rid, App.currentUser.code));
          await App.loadAdminPanelRooms();
        } else if (act === "delete") {
          await App.deleteRoomFromPanel(rid);
        }
      } catch (err) {
        console.error("panel action failed:", err);
        App.showToast({
          title: "Action failed",
          body: "Check console / rules.",
          duration: 2600
        });
      } finally {
        btn.disabled = false;
      }
    });
  }
  App.loadAdminPanelRooms();
};
App.loadAdminPanelRooms = async function () {
  if (!App.isVinny()) return;
  const listEl = App.$("panel-rooms");
  if (!listEl) return;
  try {
    const base = String(App.firebaseConfig?.databaseURL || "").replace(/\/+$/, "");
    if (!base) throw new Error("Missing databaseURL.");
    const [roomsRes, ghostSnap] = await Promise.all([fetch(`${base}/rooms.json?shallow=true`, {
      cache: "no-store"
    }), App.db.ref(`users/${App.currentUser.code}/${App.ADMIN_GHOST_ROOMS_NODE}`).once("value")]);
    if (!roomsRes.ok) throw new Error(`Room key fetch failed: ${roomsRes.status}`);
    const roomKeyData = await roomsRes.json();
    const ghostRooms = App.normalizeAdminGhostRooms(ghostSnap.val() || {});
    const rooms = roomKeyData && typeof roomKeyData === "object" ? Object.keys(roomKeyData).map(rawId => App.sanitizeRoomCode(rawId)).filter(Boolean).map(id => ({
      id,
      displayName: App.roomDisplayName(id, App.roomsMetaCache.get(id) || null) || id
    })) : [];
    rooms.sort((a, b) => String(a.displayName || a.id).localeCompare(String(b.displayName || b.id)));
    if (!rooms.length) {
      listEl.innerHTML = `<div class="empty"><div class="empty-title">No rooms.</div><div class="empty-sub">Nothing to manage yet.</div></div>`;
      return;
    }
    listEl.innerHTML = `
      <div class="panel-room-grid">
        ${rooms.map(({
      id,
      displayName
    }) => {
      const ghostOn = !!ghostRooms[id];
      return `
            <div class="panel-room ${ghostOn ? "ghost-active" : ""}">
              <div class="panel-room-card-main">
                <div class="panel-room-name" data-panel-room-name="${App.escapeAttr(id)}">${App.escapeHtml(displayName)}</div>
              </div>
              <div class="panel-room-actions">
                <button class="btn tiny" type="button" data-panel-act="join" data-room-id="${App.escapeAttr(id)}">Join</button>
                <button class="btn tiny" type="button" data-panel-act="clear" data-room-id="${App.escapeAttr(id)}">Clear</button>
                <button class="btn tiny ${ghostOn ? "primary" : ""}" type="button" data-panel-act="ghost" data-room-id="${App.escapeAttr(id)}">${ghostOn ? "Ghost On" : "Ghost Off"}</button>
                <button class="btn tiny danger" type="button" data-panel-act="delete" data-room-id="${App.escapeAttr(id)}">Delete</button>
              </div>
            </div>
          `;
    }).join("")}
      </div>
    `;
    rooms.forEach(({
      id
    }) => {
      App.db.ref(`rooms/${id}/name`).once("value").then(nameSnap => {
        const name = String(nameSnap.val() || id);
        const currentMeta = App.roomsMetaCache.get(id) || {};
        App.roomsMetaCache.set(id, {
          ...currentMeta,
          name
        });
        const nameEl = listEl.querySelector(`[data-panel-room-name="${CSS.escape(id)}"]`);
        if (nameEl) nameEl.textContent = name;
      }).catch(() => {});
    });
  } catch (e) {
    console.error("panel load rooms failed:", e);
    listEl.innerHTML = `<div class="muted small">Failed to load rooms.</div>`;
  }
};
App.joinRoomFromPanel = async function (roomId) {
  const id = App.sanitizeRoomCode(roomId);
  if (!id || !App.currentUser || !App.isVinny()) return;
  const roomSnap = await App.db.ref(`rooms/${id}`).once("value");
  if (!roomSnap.exists()) {
    App.showToast({
      title: "Not found",
      body: "That room doesn’t exist anymore.",
      duration: 2400
    });
    await App.loadAdminPanelRooms();
    return;
  }
  const roomMeta = roomSnap.val() || {};
  const displayName = App.roomDisplayName(id, roomMeta);
  const roomMessageCount = Math.max(0, Number(roomMeta?.messageCount) || 0);

  // Admin-panel join intentionally bypasses private room passwords.
  let membership;
  try {
    membership = await App.joinRoomMembership(id, roomMessageCount);
  } catch (error) {
    App.showToast({ title: "Join failed", body: "Could not join this room. Please try again.", duration: 2600 });
    return;
  }

  // Immediately reflect locally (no wait for listener)
  App.membershipMap.set(id, {
    joinedAt: Number(membership?.joinedAt) || 0,
    lastSeenAt: Number(membership?.lastSeenAt) || 0,
    lastSeenCount: Number(membership?.lastSeenCount) || 0
  });
  App.roomsMetaCache.set(id, roomMeta);
  App.renderRoomsList();
  App.closeModal();
  App.showToast({
    title: "Joined",
    body: `Joined ${displayName}.`,
    duration: 2000
  });
  App.openRoom(id);
};
App.deleteRoomFromPanel = async function (roomId) {
  const id = App.sanitizeRoomCode(roomId);
  if (!id) return;
  const displayName = App.roomDisplayName(id, App.roomsMetaCache.get(id) || null);
  const confirmId = `panel_delete_confirm_${Math.random().toString(36).slice(2)}`;
  App.showToast({
    title: "Delete Room",
    bodyHTML: `
      <div class="muted small" style="margin-top:2px">Really delete <span class="strong">${App.escapeHtml(displayName)}</span>? This removes the room and its data.</div>
      <div style="display:flex; gap:10px; margin-top:10px">
        <button class="btn tiny danger" id="${confirmId}" type="button">Delete Room</button>
      </div>
    `,
    duration: 15000
  });
  const confirmBtn = document.getElementById(confirmId);
  confirmBtn?.addEventListener("click", async () => {
    App.closeToast();
    try {
      // If this room is open, clear UI instantly
      if (App.currentRoomId === id) App.hardClearComposerAndOverlays();
      await App.deleteRoomEverywhere(id);
      App.showToast({
        title: "Room deleted",
        body: `Deleted room ${displayName}.`,
        duration: 2200
      });

      // Refresh panel list if it’s still open
      try {
        await App.loadAdminPanelRooms();
      } catch {}
    } catch (err) {
      console.error("delete room failed:", err);
      App.showToast({
        title: "Delete failed",
        body: "Check console / rules.",
        duration: 2600
      });
    }
  }, {
    once: true
  });
};

App.register("rooms/actions", function initializeFeature() {
App.membershipsRef = null;
App.membershipMap = new Map();
App.roomsMetaCache = new Map();
App.roomRowCache = new Map();
App.pinnedRoomsRef = null;
App.pinnedRoomsCb = null;
App.pinnedRoomIds = new Set();
App.pinnedRoomWriteSeq = 0;
App.pendingPinnedRoomWrites = new Map();
});
})(globalThis.ChatApp);
