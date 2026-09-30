/* Passwords are legacy account identifiers. Move every reference atomically. */
(function (App) {
  "use strict";
  const failure = () => new Error("An error occurred. Try a different password.");
  const identifierField = /^(?:code|c|\w*Code|createdBy|updatedBy|startedBy|endedBy|deletedBy|from|to)$/;
  function identityMap(path) {
    return /^(users|memberships|pings|appPresence|scheduleViewers|calendarReminders|stickerCollections|passwordReservations|passwordSourceLocks|accountCodeReservations|accountCodeSourceLocks)$/.test(path) ||
      /^(htmlHub|stickers)\/byOwner$/.test(path) || /^stickerSavers\/[^/]+$/.test(path) ||
      /^roomMembers\/[^/]+$/.test(path) || /^readReceipts\/[^/]+\/[^/]+$/.test(path) ||
      /^rooms\/[^/]+\/(online|typing)$/.test(path) ||
      /^calls\/[^/]+\/(members|rings|webrtc|screenViewers)$/.test(path) ||
      /^calls\/[^/]+\/audioPreferences$/.test(path) ||
      /^calls\/[^/]+\/audioPreferences\/[^/]+\/(users|screens|mutedScreens)$/.test(path) ||
      /^calls\/[^/]+\/members\/[^/]+\/viewingShares$/.test(path) ||
      /^calls\/[^/]+\/webrtc\/[^/]+\/[^/]+$/.test(path) ||
      /^calls\/[^/]+\/screenViewers\/[^/]+$/.test(path) ||
      /^activities\/roomActivityClaims$/.test(path) ||
      /^activities\/(?:boplRoyale|mergeParty)\/rooms\/[^/]+\/players$/.test(path) ||
      /^users\/[^/]+\/prefs\/(callAudio|callVolumes|userVolumes|peerVolumes)/.test(path);
  }
  App.migratePasswordData = function (root, oldPassword, nextPassword) {
    if (!root?.users?.[oldPassword]?.username || root.users[nextPassword] ||
        root.passwordReservations?.[nextPassword] || root.accountCodeReservations?.[nextPassword]) throw failure();
    function visit(value, path = "", field = "") {
      if (typeof value === "string") {
        const indexValue = /^(usernames|displayNames)\/[^/]+$/.test(path);
        const activityIdentity = path.startsWith("activities/") && /^(?:password|coordinatorId|hostId|owner|killer|winnerIds|drawIds)$/.test(field);
        return value === oldPassword && (identifierField.test(field) || indexValue || activityIdentity) ? nextPassword : value;
      }
      if (!value || typeof value !== "object") return value;
      if (Array.isArray(value)) return value.map(item => visit(item, path, field));
      const out = {};
      for (const [key, item] of Object.entries(value)) {
        const mapped = key === oldPassword && identityMap(path) ? nextPassword : key === "accountCode" && path.startsWith("activities/") ? "password" : key;
        out[mapped] = key === "targetId" && item === oldPassword && path.startsWith("activities/") && ["player", "self"].includes(value.targetType)
          ? nextPassword : visit(item, path ? `${path}/${key}` : key, key);
      }
      return out;
    }
    const result = visit(root);
    // Leases belong to actual connections. Old tabs are signed out by their
    // account listener and must not leave immortal leases under the new key.
    for (const name of ["appPresence", "scheduleViewers"]) if (result[name]) delete result[name][nextPassword];
    if (result.activities?.roomActivityClaims) delete result.activities.roomActivityClaims[nextPassword];
    for (const room of Object.values(result.rooms || {})) {
      if (room?.online) delete room.online[nextPassword];
      if (room?.typing) delete room.typing[nextPassword];
    }
    const user = result.users[nextPassword];
    delete user.htmlActivities; delete user.gameActivitySessions; delete user.spotifySessions;
    for (const legacy of ["accountCodeReservations", "accountCodeSourceLocks"]) {
      const name = legacy === "accountCodeReservations" ? "passwordReservations" : "passwordSourceLocks";
      if (result[legacy]) result[name] = { ...result[legacy], ...result[name] };
      delete result[legacy];
    }
    return result;
  };
  App.changePassword = async function (draft) {
    const next = App.normalizeCodeInput(draft), old = App.currentUser?.code;
    if (!next || !old || App.passwordChangeInFlight || App.accountSessionRevoked || Number(App.pendingSendCount) > 0) throw failure();
    if (next === old) return next;
    App.passwordChangeInFlight = true;
    const room = App.currentRoomId, callRoom = App.currentCallRoomId;
    const callAudioState = callRoom ? { muted: !!App.callMuted, deafened: !!App.callDeafened } : null;
    const inSchedules = (App.getStoredPlace?.() || "") === "schedules";
    let stopped = false, committed = false, activityResume = null;
    try {
      // Check before interrupting an active call. The transaction checks again
      // against its latest server snapshot, including concurrent sign-ups.
      const destination = await App.db.ref(`users/${next}`).once("value");
      if (destination.exists()) throw failure();
      await App.waitForCustomSoundSaves?.();
      if (await App.flushCurrentSettingsSave?.(old) === false) throw failure();
      App.cancelQueuedSettingsSave?.();
      activityResume = await App.suspendRoomActivityForPasswordChange?.();
      await App.callFlushAudioPreferences?.();
      if (callRoom) await App.leaveCall({ roomId: callRoom, quiet: true });
      await App.callFlushAudioPreferences?.();
      await App.syncMySchedulePresence?.(false);
      App.stopCalendarSession?.();
      App.stopHtmlActivityStackPresence?.({ preservePopups: true });
      App.stopAppPresence?.(); App.stopRoomPresence?.(); App.stopReadReceipts?.();
      App.stopStickerCollectionListener?.(); App.stopPinnedRoomsSync?.();
      App.detachPingsInbox?.(); App.detachRoomMessageNotifications?.();
      if (App.membershipsRef) App.membershipsRef.off();
      App.membershipsRef = null;
      stopped = true;
      await App.db.ref().once("value");
      const result = await App.db.ref().transaction(root => {
        if (!root) return root;
        try { return App.migratePasswordData(root, old, next); } catch { return; }
      }, undefined, false);
      if (!result.committed || !result.snapshot.val()?.users?.[next]?.username || result.snapshot.val()?.users?.[old]) throw failure();
      committed = true;
      try {
        const movedSpotify = await globalThis.chatDesktopSpotify?.rekeyUser?.(old, next);
        if (movedSpotify === false) throw new Error("Spotify connection could not move");
      } catch {
        App.showToast?.({ title: "Spotify", body: "Password saved. Reconnect Spotify in Settings to resume sharing your music.", duration: 4500 });
      }
      App.stopLiveUserListeners?.();
      App.currentUser.code = next;
      App.setStoredAccountCode(next);
      try {
        const key = `chat.notepad.draft.v1:${old}`, value = localStorage.getItem(key);
        if (value !== null) { localStorage.setItem(`chat.notepad.draft.v1:${next}`, value); localStorage.removeItem(key); }
      } catch {}
      App.clearRecentRoomMessages?.();
      App.clearBootstrapCaches?.();
      App.writeCurrentUserBootstrapCache?.();
      App.setMeHeader?.();
      return next;
    } catch (error) {
      if (!committed) throw failure();
      // The database commit is authoritative even if a UI cache failed.
      App.currentUser.code = next;
      App.setStoredAccountCode(next);
      return next;
    } finally {
      try { if (stopped && App.currentUser) {
        App.ensureLiveUserListener?.(App.currentUser.code);
        App.startCalendarSession?.(); App.startAppPresence?.();
        App.attachMemberships?.(); App.attachPingsInbox?.(); App.ensureStickerCollectionListener?.();
        if (room) {
          App.attachOnlineIndicator?.(room); App.startRoomPresence?.(room);
          App.syncReadReceipts?.(); App.queueReadReceiptSync?.();
        }
        if (inSchedules) await App.syncMySchedulePresence?.(true);
        if (callRoom) {
          try { await App.joinCall(callRoom, { openMenu: false, preserveAudioState: callAudioState }); }
          catch { App.showToast?.({ title: "Call", body: "Password saved. Rejoin the call when your connection is ready.", duration: 3500 }); }
        }
        if (committed && App.htmlActivityPopups?.size) App.htmlActivityPopupsCode = next;
        void App.syncMyHtmlActivityPresence?.();
      }
      if (activityResume && App.currentUser) {
        try { await App.resumeRoomActivityAfterPasswordChange?.(activityResume); }
        catch { App.showToast?.({ title: "Activity", body: "Reopen your activity to reconnect.", duration: 3500 }); }
      }
      } finally {
        App.passwordChangeInFlight = false;
        // A second device may have changed this credential while our own
        // attempt was rejected. Replay the current account snapshot after the
        // migration guard is lowered instead of missing that deletion forever.
        if (App.currentUser) {
          App.stopAccountExistenceWatch?.();
          App.startAccountExistenceWatch?.();
        }
        App.queueCurrentSettingsSave?.();
      }
    }
  };
  App.bindPasswordEditor = function (syncEye) {
    const button = App.$("btn-settings-change-code"), editor = App.$("settings-code-editor"), input = App.$("settings-code-input");
    if (!button || !editor || !input) return;
    button.addEventListener("click", () => {
      button.hidden = true; editor.hidden = false; input.value = ""; input.focus();
    });
    const save = async () => {
      if (editor.hidden || !input.value.trim() || App.passwordChangeInFlight) return;
      input.disabled = true;
      try {
        const next = await App.changePassword(input.value);
        const display = App.$("settings-code-display");
        if (display) display.value = next;
        syncEye?.(); editor.hidden = true; button.hidden = false;
        App.showToast({ title: "Password Updated", body: "Your new password is now active.", duration: 2200 });
      } catch {
        App.showToast({ title: "Password", body: "An error occurred. Try a different password.", duration: 3000 });
      } finally { input.disabled = false; }
    };
    input.addEventListener("blur", save);
    input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void save(); } });
    return save;
  };
  App.stopAccountExistenceWatch = function () {
    const watch = App.accountExistenceWatch;
    App.accountExistenceWatch = null;
    if (watch) watch.ref.off("value", watch.callback);
  };
  App.invalidateAccountSession = function (code) {
    if (String(App.currentUser?.code || "") !== code || App.passwordChangeInFlight || App.accountSessionRevoked) return;
    App.accountSessionRevoked = true;
    // Stop writers synchronously before logout waits for call/game teardown.
    // A removed credential must not produce a partial account at its old key.
    App.cancelQueuedSettingsSave?.();
    App.stopCalendarSession?.();
    App.stopAppPresence?.(); App.stopRoomPresence?.(); App.stopReadReceipts?.();
    App.stopHtmlActivityStackPresence?.({ preservePopups: true });
    App.clearRoomActivityClaimHeartbeat?.(); App.callStopHeartbeat?.();
    App.abortAllFirebaseUploads?.("Account password changed");
    App.setComposerEnabled?.(false);
    return App.logoutToLanding?.();
  };
  App.startAccountExistenceWatch = function () {
    const code = String(App.currentUser?.code || "");
    if (!code || !App.db || App.accountExistenceWatch?.code === code) return;
    App.stopAccountExistenceWatch();
    App.accountSessionRevoked = false;
    const watch = { code, ref: App.db.ref(`users/${code}/username`), callback: null };
    App.accountExistenceWatch = watch;
    watch.callback = snapshot => {
      if (App.accountExistenceWatch !== watch || String(App.currentUser?.code || "") !== code || App.passwordChangeInFlight) return;
      const username = snapshot.val();
      if (typeof username !== "string" || !username.trim()) void App.invalidateAccountSession(code);
    };
    watch.ref.on("value", watch.callback);
  };
  App.register("accounts/password", function () {
    // Room/profile listeners are routinely removed on Home, Calendar, and
    // Schedules. Credential validity belongs to the logged-in app session.
    const start = App.startAppPresence, stop = App.stopAppPresence;
    App.startAppPresence = function (...args) {
      const result = start.apply(this, args);
      App.startAccountExistenceWatch();
      return result;
    };
    App.stopAppPresence = function (...args) {
      App.stopAccountExistenceWatch();
      return stop.apply(this, args);
    };
  });
})(globalThis.ChatApp);
