/* Room IDs remain stable so a live rename never disconnects chat or calls. */
(function (App) {
  "use strict";
  const normalized = name => App.sanitizeRoomCode(name);
  const pendingRenames = new Map();
  App.pendingRoomNames = new Map();
  App.refreshRoomNameUI = function (id) {
    App.updateRoomListItem?.(id);
    App.syncSidebarDock?.(); App.callSyncMenuStatusDisplay?.();
    App.callPublishDesktopOverlay?.(); App.callPublishIncomingRings?.();
    const displayName = App.roomDisplayName(id);
    if (App.msgMenuCtx?.roomId === id && App.msgMenuUserEl) App.msgMenuUserEl.textContent = displayName;
    for (const el of globalThis.document?.querySelectorAll?.('[data-panel-room-name]') || []) {
      if (el.dataset.panelRoomName === id) el.textContent = displayName;
    }
    if (!App.currentRoomId && App.views?.chat?.dataset.active === "true" && App.getStoredPlace?.() === "home") App.clearMessagesToHome?.();
  };
  const awaitRename = async operation => {
    let timer;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("The room server has not confirmed the save. Check your connection and the room name before trying again.")), 12000);
      })]);
    } finally { clearTimeout(timer); }
  };
  App.roomNameTaken = function (rooms, name, exceptId = "") {
    const wanted = normalized(name);
    return Object.entries(rooms || {}).some(([id, room]) => room && id !== exceptId && normalized(room.name || id) === wanted);
  };
  App.createNamedRoom = async function (name, record) {
    const clean = App.sanitizeRoomName(name), base = normalized(clean);
    if (!base || !App.currentUser) throw new Error("Invalid room name.");
    const alternate = App.sanitizeRoomCode(App.db.ref("rooms").push().key);
    let id = base;
    const result = await App.db.ref("rooms").transaction(rooms => {
      rooms = rooms || {};
      if (App.roomNameTaken(rooms, clean)) return;
      id = rooms[base] ? alternate : base;
      return { ...rooms, [id]: { ...record, name: clean } };
    }, undefined, false);
    return result.committed ? id : null;
  };
  App.findRoomByName = async function (name) {
    const wanted = normalized(name);
    if (!wanted) return null;
    const rooms = (await App.db.ref("rooms").once("value")).val() || {};
    const match = Object.entries(rooms).find(([id, room]) => normalized(room?.name || id) === wanted);
    return match ? { id: match[0], meta: match[1] } : null;
  };
  App.renameRoomData = function (root, roomId, name, owner) {
    const clean = App.sanitizeRoomName(name);
    if (!clean || !root?.rooms?.[roomId] || root.rooms[roomId].createdBy !== owner) throw new Error("Only the room creator can edit its name.");
    if (App.roomNameTaken(root.rooms, clean, roomId)) throw new Error("A room with that name already exists.");
    const next = JSON.parse(JSON.stringify(root));
    next.rooms[roomId].name = clean;
    next.rooms[roomId].nameLower = normalized(clean);
    // Refresh denormalized notification/call labels as part of the same commit.
    function labels(value, path = []) {
      if (!value || typeof value !== "object") return;
      if (value.roomId === roomId || value.room === roomId || path[0] === 'calls' && path[1] === roomId || path[0] === 'pings' && path[2] === roomId) {
        if (Object.hasOwn(value, 'roomName')) value.roomName = clean;
        if (Object.hasOwn(value, 'roomDisplayName')) value.roomDisplayName = clean;
      }
      for (const [key, item] of Object.entries(value)) labels(item, [...path, key]);
    }
    labels(next);
    return next;
  };
  App.renameRoom = async function (roomId, name) {
    const id = App.sanitizeRoomCode(roomId), owner = App.currentUser?.code;
    if (!id || !owner) throw new Error("Open a room first.");
    const clean = App.sanitizeRoomName(name);
    if (!clean) throw new Error("Use 1–20 printable characters without . # $ [ ] or /.");
    // A root transaction downloaded every attachment and was canceled by call
    // signaling and presence writes. Keep the atomic name/owner checks inside
    // room metadata only; labels resolve from each room's stable ID.
    if (pendingRenames.has(id)) return awaitRename(pendingRenames.get(id));
    const cached = App.roomsMetaCache.get(id);
    if (cached && cached.createdBy !== owner) throw new Error("Only the room creator can edit its name.");
    if (App.roomNameTaken(Object.fromEntries(App.roomsMetaCache), clean, id)) throw new Error("A room with that name already exists.");
    // Show the new label immediately while the server atomically checks the
    // owner and uniqueness. IDs used by messages, members, polls and calls stay
    // unchanged. A failed save removes this preview without losing live data.
    App.pendingRoomNames.set(id, clean);
    App.refreshRoomNameUI(id);
    let active = true;
    const operation = (async () => {
      const ref = App.db.ref("rooms");
      // Keep a value listener through the transaction so the SDK retains a
      // complete metadata cache (a one-shot read may immediately be evicted).
      const keepMetadata = () => {};
      ref.on?.("value", keepMetadata);
      try {
        await awaitRename(ref.once("value"));
        if (!active) return;
        let result, failure;
        for (let attempt = 0; ; attempt += 1) {
          try {
            result = await ref.transaction(rooms => {
              failure = null;
              if (!active) return;
              // Firebase may call this with null even though the server has
              // rooms. Returning null requests server comparison/retry; returning
              // undefined aborts locally with the false "no longer exists" error.
              if (rooms === null) return null;
              const meta = rooms?.[id];
              if (!meta) failure = new Error("This room no longer exists.");
              else if (meta.createdBy !== owner || App.currentUser?.code !== owner) failure = new Error("Only the room creator can edit its name.");
              else if (App.roomNameTaken(rooms, clean, id)) failure = new Error("A room with that name already exists.");
              if (failure) return;
              return { ...rooms, [id]: { ...meta, name: clean, nameLower: normalized(clean) } };
            }, undefined, false);
            break;
          } catch (error) {
            // Firebase rejects an overlapping local presence/preview update as
            // Error("set"). Retry only that cancellation, with a small limit.
            if (!active || attempt >= 4 || !/^set$/i.test(String(error?.message || ""))) throw error;
            await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
          }
        }
        const meta = result?.snapshot?.val()?.[id];
        if (!meta) throw failure || new Error("This room no longer exists.");
        if (!result?.committed || meta.name !== clean) throw failure || new Error("The room name was not saved. Please try again.");
        App.roomsMetaCache.set(id, meta);
        App.pendingRoomNames.delete(id);
        App.refreshRoomNameUI(id); App.scheduleRoomsListCacheSave?.();
        return clean;
      } finally { ref.off?.("value", keepMetadata); }
    })();
    pendingRenames.set(id, operation);
    operation.then(() => pendingRenames.delete(id), () => pendingRenames.delete(id));
    try { return await awaitRename(operation); }
    catch (error) {
      active = false;
      App.pendingRoomNames.delete(id);
      App.refreshRoomNameUI(id);
      if (/permission.denied/i.test(String(error?.code || error?.message || ""))) throw new Error("The database did not allow this room name to be saved. Check this room's write permissions.");
      throw error;
    }
  };
  App.openRoomNameEditor = function (roomId) {
    const meta = App.roomsMetaCache.get(roomId);
    if (!App.currentUser || meta?.createdBy !== App.currentUser.code) return;
    App.openModal({ title: "Edit Name", bodyHTML: `<label class="label" for="room-name-edit">Room Name</label><input class="input" id="room-name-edit" maxlength="20" value="${App.escapeAttr(App.roomDisplayName(roomId, meta))}" /><div class="muted small" id="room-name-error" role="alert"></div>`, actionsHTML: '<button class="btn primary" id="room-name-save" type="button">Save</button>' });
    const input = App.$("room-name-edit"), button = App.$("room-name-save"), errorEl = App.$("room-name-error");
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = "Saving…"; errorEl.textContent = "";
      try { await App.renameRoom(roomId, input.value); if (App.$("room-name-edit") === input) App.closeModal(); }
      catch (error) { if (errorEl.isConnected) errorEl.textContent = error.message; }
      finally { button.disabled = false; button.textContent = "Save"; }
    });
    input.addEventListener('keydown', event => { if (event.key === 'Enter') button.click(); });
    input.focus(); input.select();
  };
  App.register("rooms/names", function () {});
})(globalThis.ChatApp);
