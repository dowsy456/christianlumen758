/* profiles/avatars: methods register before ordered initialization. */
(function (App) {
  "use strict";
App.getAvatarFallbackSize = function (el) {
  if (!el) return 40;
  if (el.classList.contains("call-user-avatar")) return 96;
  if (el.classList.contains("call-share-avatar")) return 76;
  if (el.classList.contains("user-profile-avatar")) return 92;
  if (el.classList.contains("user-profile-classmate-avatar")) return 34;
  if (el.classList.contains("call-viewer-avatar")) return 28;
  if (el.classList.contains("room-avatar-image") || el.classList.contains("room-avatar")) return 42;
  if (el.classList.contains("sched-avatar")) return 42;
  if (el.classList.contains("msg-avatar")) return 34;
  if (el.classList.contains("reply-preview-avatar")) return 18;
  if (el.classList.contains("tip-ava")) return 22;
  if (el.classList.contains("online-ava-img")) return 28;
  if (el.classList.contains("mini-avatar") && el.closest?.(".me-pill-dock")) return 24;
  if (el.classList.contains("mini-avatar")) return 32;
  return 40;
};
App.getMediaFrameSize = function (el, fallback = 40) {
  if (!el) return Math.max(1, Number(fallback) || 40);
  const rect = el.getBoundingClientRect?.();
  let size = Math.round(rect?.width || 0);
  if (!size || size < 2) {
    try {
      const computed = getComputedStyle(el);
      size = Math.round(parseFloat(computed.width) || parseFloat(computed.height) || 0);
    } catch {}
  }
  if (!size || size < 2) size = App.getAvatarFallbackSize(el) || fallback;
  return Math.max(1, size);
};
App.formatMediaTransform = function (t, sizePx, legacySizePx = 84) {
  const size = Math.max(1, Number(sizePx) || 1);
  const tpx = App.transformToPixels(t, size, legacySizePx);
  const x = Math.round((Number(tpx.x) || 0) * 1000) / 1000;
  const y = Math.round((Number(tpx.y) || 0) * 1000) / 1000;
  const scale = Math.max(0.2, Number(tpx.scale) || 1);
  return `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${scale})`;
};
App.formatMediaTransformRelative = function (t, legacySizePx = 84) {
  const tr = App.normalizeTransformToRel(t, legacySizePx);
  const xPct = Math.round((-50 + (Number(tr.x) || 0) * 100) * 10000) / 10000;
  const yPct = Math.round((-50 + (Number(tr.y) || 0) * 100) * 10000) / 10000;
  const scale = Math.max(0.2, Number(tr.scale) || 1);
  return `translate(${xPct}%, ${yPct}%) scale(${scale})`;
};
App.formatMediaTransformCss = function (t, sizeCss, legacySizePx = 84) {
  const tr = App.normalizeTransformToRel(t, legacySizePx);
  const x = Math.round((Number(tr.x) || 0) * 100000) / 100000;
  const y = Math.round((Number(tr.y) || 0) * 100000) / 100000;
  const scale = Math.max(0.2, Number(tr.scale) || 1);
  const size = String(sizeCss || "1px");
  return `translate(calc(-50% + (${x} * ${size})), calc(-50% + (${y} * ${size}))) scale(${scale})`;
};
App.applyCroppedImage = function (img, src, transform, sizePx, legacySizePx = 84) {
  if (!img) return;
  const nextSrc = String(src || App.defaultStickmanDataURL());
  // User/avatar crop offsets are stored relative to the frame. Keeping them as
  // percentages makes the exact same crop survive responsive and expanded UI sizes.
  const nextTransform = App.formatMediaTransformRelative(transform, legacySizePx);
  const isRoomImage = img.classList?.contains("room-avatar-image");
  if (isRoomImage) {
    img.decoding = "async";
    img.fetchPriority = "high";
  }
  if (img.getAttribute("src") !== nextSrc) {
    if (isRoomImage) img.style.opacity = "0";
    img.src = nextSrc;
    if (isRoomImage) {
      const reveal = () => {
        if (img.getAttribute("src") === nextSrc) img.style.opacity = "";
      };
      if (typeof img.decode === "function") {
        img.decode().then(reveal).catch(reveal);
      } else if (img.complete) {
        reveal();
      } else {
        img.addEventListener("load", reveal, {
          once: true
        });
        img.addEventListener("error", reveal, {
          once: true
        });
      }
    }
  }
  if (img.style.transform !== nextTransform) img.style.transform = nextTransform;
};
App.applyAvatar = function (el, user) {
  if (!el) return;
  const isDirectImg = String(el.tagName || "").toLowerCase() === "img";
  let img = isDirectImg ? el : el.querySelector("img");
  if (!img) {
    el.innerHTML = "";
    img = document.createElement("img");
    img.draggable = false;
    el.appendChild(img);
  }
  const frameEl = isDirectImg ? el.parentElement || el : el;
  const userCode = String(user?.code || user?.userCode || el.dataset?.usercode || frameEl.dataset?.usercode || "").trim();
  if (userCode) {
    try {
      el.dataset.avatarUsercode = userCode;
    } catch {}
  }
  // Crops use percentages, so updating an avatar never needs a synchronous
  // layout measurement (especially costly for a full room roster).
  App.applyCroppedImage(img, String(user?.photoDataURL || App.defaultStickmanDataURL()), user?.photoTransform, App.getAvatarFallbackSize(frameEl));
};
App.refreshRenderedAvatarForUser = function (user) {
  const code = String(user?.code || "").trim();
  if (!code) return;
  const safeCode = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(code) : code.replace(/"/g, '\\"');
  document.querySelectorAll(`[data-avatar-usercode="${safeCode}"]`).forEach(el => App.applyAvatar(el, user));
  document.querySelectorAll(`.msg-avatar[data-usercode="${safeCode}"], ` + `.reply-preview-avatar[data-usercode="${safeCode}"], ` + `.reply-target-avatar[data-usercode="${safeCode}"], ` + `.sched-avatar[data-usercode="${safeCode}"], ` + `.tip-ava[data-usercode="${safeCode}"], ` + `.call-user-avatar[data-usercode="${safeCode}"], ` + `.ping-item-avatar[data-usercode="${safeCode}"]`).forEach(el => App.applyAvatar(el, user));
  document.querySelectorAll(`.online-ava[data-usercode="${safeCode}"] .online-ava-img`).forEach(el => App.applyAvatar(el, user));
  if (String(App.currentUser?.code || "") === code) {
    App.applyAvatar(App.$("me-avatar"), user);
  }
  if (App.callMembersCache?.some(member => String(member.code) === code)) App.callPublishDesktopOverlay?.();
};
App.stopLiveUserListeners = function () {
  for (const [, v] of App.liveUserListeners) {
    try {
      v.ref.off("value", v.cb);
    } catch {}
  }
  App.liveUserListeners.clear();
  App.liveUserCache.clear();
};
App.ensureLiveUserListener = function (userCode) {
  const code = (userCode || "").trim();
  if (!code) return;
  if (App.liveUserListeners.has(code)) return;
  const ref = App.db.ref(`users/${code}`);
  const listener = { ref, cb: null, revision: 0, identityKey: null, ownership: null, activityKey: null };
  const cb = async snap => {
    if (App.liveUserListeners.get(code) !== listener) return;
    const revision = ++listener.revision;
    const rec = snap.val() || {};
    // Memberships and old presence can outlive an account. An absent or partial
    // profile is not a person called "User". Remember the missing profile so a
    // cached Calendar author cannot put it back while its listener is active.
    if (!snap.exists() || typeof rec.username !== "string" || !rec.username.trim()) {
      listener.identityKey = listener.ownership = listener.activityKey = null;
      App.liveUserCache.set(code, null);
      if (String(App.currentUser?.code || "") === code && !App.passwordChangeInFlight) {
        if (App.invalidateAccountSession) await App.invalidateAccountSession(code);
        else await App.logoutToLanding?.();
        return;
      }
      if (App.userProfileOpen && App.userProfilePinnedCode === code) App.closeUserProfile?.(true);
      App.renderOnlineIndicator?.();
      return;
    }
    // Login and profile editing claim names. Reading another person's profile
    // must never wait for (or write) a name-ownership transaction.
    if (App.liveUserListeners.get(code) !== listener || revision !== listener.revision) return;
    const username = rec.username || "User";
    const displayName = rec.displayName || username;
    const displayNameLower = rec.displayNameLower || displayName.toLowerCase();
    const user = {
      code,
      username,
      usernameLower: rec.usernameLower || username.toLowerCase(),
      displayName,
      displayNameLower,
      bio: String(rec.bio || "").slice(0, 400),
      photoDataURL: rec.photoDataURL || App.defaultStickmanDataURL(),
      photoTransform: App.normalizeTransformToRel(rec.photoTransform, 84),
      bannerDataURL: String(rec.bannerDataURL || ""),
      bannerTransform: App.normalizeTransformToRel(rec.bannerTransform, 340),
      htmlActivity: App.getUserHtmlActivity(rec),
      htmlActivities: rec.htmlActivities || null,
      htmlActivitiesVersion: rec.htmlActivitiesVersion === 1 ? 1 : 0,
      gameActivitySessions: rec.gameActivitySessions || null,
      spotifySessions: rec.spotifySessions || null,
      notificationStatus: rec.notificationStatus === "dnd" ? "dnd" : rec.notificationStatus === "online" ? "online" : null,
      adminGhostRooms: App.normalizeAdminGhostRooms(rec.adminGhostRooms)
    };
    const previous = App.liveUserCache.get(code);
    const profileChanged = !previous || ["username", "usernameLower", "displayName", "displayNameLower", "bio", "photoDataURL", "bannerDataURL"].some(key => previous[key] !== user[key]) ||
      ["photoTransform", "bannerTransform", "adminGhostRooms"].some(key => JSON.stringify(previous[key]) !== JSON.stringify(user[key]));
    const statusChanged = previous?.notificationStatus !== user.notificationStatus;
    const activityKey = App.getActivityPresenceRenderKey?.(user) ?? JSON.stringify(App.getUserActivityItems?.(user) || []);
    // An expiry timer can hide an activity without another profile snapshot.
    // Compare the old lease at today's time as well as the last snapshot key:
    // renewing the same game/title must bring the hidden indicator back.
    const previousActivityKey = App.getActivityPresenceRenderKey?.(previous) ?? listener.activityKey;
    const activityChanged = listener.activityKey !== activityKey || previousActivityKey !== activityKey;
    listener.activityKey = activityKey;
    if (String(App.currentUser?.code || "") === code) {
      App.currentUser.username = user.username;
      App.currentUser.usernameLower = user.usernameLower;
      App.currentUser.displayName = user.displayName;
      App.currentUser.displayNameLower = user.displayNameLower;
      App.currentUser.bio = user.bio;
      App.currentUser.photoDataURL = user.photoDataURL;
      App.currentUser.photoTransform = user.photoTransform;
      App.currentUser.bannerDataURL = user.bannerDataURL;
      App.currentUser.bannerTransform = user.bannerTransform;
      App.currentUser.htmlActivity = user.htmlActivity;
      App.currentUser.htmlActivities = user.htmlActivities;
      App.currentUser.htmlActivitiesVersion = user.htmlActivitiesVersion;
      App.currentUser.gameActivitySessions = user.gameActivitySessions;
      App.currentUser.spotifySessions = user.spotifySessions;
      const statusChanged = App.currentUser.notificationStatus !== user.notificationStatus;
      App.currentUser.notificationStatus = user.notificationStatus;
      if (statusChanged) App.notifyStatusChanged?.();
      App.currentUser.adminGhostRooms = user.adminGhostRooms;
    }
    App.liveUserCache.set(code, user);
    App.observeActivityPresenceUser?.(user);
    // Timestamp-only changes keep leases fresh without rebuilding avatars,
    // messages, the call panel, or the bootstrap cache.
    if (!profileChanged) {
      if (activityChanged || statusChanged) {
        App.renderOnlineIndicator?.();
        if (App.userProfileOpen && App.userProfilePinnedCode === code) App.refreshOpenUserProfileCard?.();
      }
      return;
    }
    document.querySelectorAll(`[data-display-name-usercode="${code}"]`).forEach(el => {
      el.textContent = user.displayName;
    });
    document.querySelectorAll(`[data-username-usercode="${code}"]`).forEach(el => {
      el.textContent = user.username;
    });
    document.querySelectorAll(`.reply-preview-author[data-reply-usercode="${code}"]`).forEach(el => {
      el.textContent = App.normalizeReplyDisplayName(user.displayName || user.username || "User");
    });
    document.querySelectorAll(`.online-ava[data-usercode="${code}"] .online-tooltip`).forEach(el => {
      el.textContent = user.displayName;
    });
    App.refreshRenderedAvatarForUser(user);
    if (App.readReceiptState?.receipts?.[code]) App.renderReadReceipts?.();
    if (App.replyState && String(App.replyState.userCode || "") === code) {
      App.replyState.username = user.username;
      App.replyState.displayName = user.displayName;
      App.updateReplyBarPreview();
    }
    if (App.userProfileOpen && App.userProfilePinnedCode === code) {
      App.refreshOpenUserProfileCard();
    }
    try {
      App.renderOnlineIndicator();
    } catch {}
    try {
      App.renderCallMenu();
    } catch {}
    if (String(App.currentUser?.code || "") === code) {
      App.setMeHeader();
      App.writeCurrentUserBootstrapCache();
    }
    if (App.pingBarEl && !App.pingBarEl.hidden) App.renderPingList();
    App.refreshMentionFormattingForRenderedMessages();
  };
  listener.cb = cb;
  App.liveUserListeners.set(code, listener);
  ref.on("value", cb);
};
App.setMeHeader = function () {
  const displayName = App.currentUser?.displayName || App.currentUser?.username || "—";
  const username = App.currentUser?.username || "—";
  App.$("me-name").textContent = displayName;
  App.$("me-code").textContent = username;
  App.applyAvatar(App.$("me-avatar"), App.currentUser);
};

App.register("profiles/avatars", function initializeFeature() {

});
})(globalThis.ChatApp);
