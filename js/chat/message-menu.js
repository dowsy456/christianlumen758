/* chat/message-menu: methods register before ordered initialization. */
(function (App) {
  "use strict";
App.ensureMsgMenu = function () {
  if (App.msgMenuEl) return;
  App.msgMenuEl = document.createElement("div");
  App.msgMenuEl.id = "msg-menu";
  App.msgMenuEl.className = "msg-menu";
  App.msgMenuEl.hidden = true;
  App.msgMenuEl.innerHTML = `
    <div class="msg-menu-user"></div>
    <button class="msg-menu-btn" type="button" data-act="edit">
      <span class="msg-menu-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M5 19h4.2L18.6 9.6a2 2 0 0 0 0-2.8l-1.4-1.4a2 2 0 0 0-2.8 0L5 14.8V19Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13.5 6.3l4.2 4.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </span>
      <span class="msg-menu-label">Edit</span>
    </button>
    <button class="msg-menu-btn" type="button" data-act="reply">
      <span class="msg-menu-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M10 8L5 12l5 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 12h8a5 5 0 0 1 5 5v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </span>
      <span class="msg-menu-label">Reply</span>
    </button>
    <button class="msg-menu-btn" type="button" data-act="copy">
      <span class="msg-menu-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M8 8h10v12H8V8Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M6 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </span>
      <span class="msg-menu-label">Copy Text</span>
    </button>
    <button class="msg-menu-btn" type="button" data-act="copyImageAddress">
      <span class="msg-menu-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M10 13a4 4 0 0 0 5.7.2l2.1-2.1a4 4 0 1 0-5.7-5.7l-1.2 1.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 11a4 4 0 0 0-5.7-.2l-2.1 2.1a4 4 0 1 0 5.7 5.7l1.2-1.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </span>
      <span class="msg-menu-label">Copy PFP Address</span>
    </button>
    <button class="msg-menu-btn" type="button" data-act="downloadImage">
      <span class="msg-menu-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 4v10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 10l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 20h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </span>
      <span class="msg-menu-label">Download PFP</span>
    </button>
    <button class="msg-menu-btn" type="button" data-act="editRoomIcon">
      <span class="msg-menu-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M4 7a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M5 17l4.2-4.2a2 2 0 0 1 2.8 0L15 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.5 20.5l4.2-4.2a1.5 1.5 0 0 0-2.1-2.1l-4.2 4.2V21h2.1Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
      </span>
      <span class="msg-menu-label">Edit Icon</span>
    </button>
    <button class="msg-menu-btn" type="button" data-act="pinRoom">
      <span class="msg-menu-icon" aria-hidden="true">
        ${App.roomPinBadgeSVG()}
      </span>
      <span class="msg-menu-label">Pin Room</span>
    </button>
    <button class="msg-menu-btn" type="button" data-act="leaveRoom">
      <span class="msg-menu-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M15 8l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 12h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </span>
      <span class="msg-menu-label">Leave Room</span>
    </button>
    <button class="msg-menu-btn" type="button" data-act="showRoomPassword">
      <span class="msg-menu-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M15 7.5a4.5 4.5 0 1 1-1.5 3.36L21 18.36V21h-2.64l-1.4-1.4h-2v-2l-1.54-1.54" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8.5" cy="7.5" r=".75" fill="currentColor"/></svg>
      </span>
      <span class="msg-menu-label">Password</span>
    </button>
    <button class="msg-menu-btn" type="button" data-act="toggleRoomAccess">
      <span class="msg-menu-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M7 11V8a5 5 0 0 1 10 0v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6 11h12v9H6v-9Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 15v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </span>
      <span class="msg-menu-label">Toggle Access</span>
    </button>
    <button class="msg-menu-btn" type="button" data-act="copyBannerAddress">
      <span class="msg-menu-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M4 6h16v8H4V6Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 18h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 14l-2.2-2.2a2.7 2.7 0 0 1 0-3.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 14l2.2-2.2a2.7 2.7 0 0 0 0-3.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </span>
      <span class="msg-menu-label">Copy Banner Address</span>
    </button>
    <button class="msg-menu-btn" type="button" data-act="downloadBanner">
      <span class="msg-menu-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M4 5h16v10H4V5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 11v8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8.5 15.5L12 19l3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
      <span class="msg-menu-label">Download Banner</span>
    </button>
    <button class="msg-menu-btn" type="button" data-act="viewSchedule">
      <span class="msg-menu-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M3 10.5 12 5l9 5.5-9 5.5-9-5.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M6.5 13v4.2c1.6 1.2 3.4 1.8 5.5 1.8s3.9-.6 5.5-1.8V13" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M21 10.5v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </span>
      <span class="msg-menu-label">View Schedule</span>
    </button>
    <button class="msg-menu-btn danger" type="button" data-act="clearRoomMessages">
      <span class="msg-menu-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M9 7V4h6v3" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M6.5 7l.8 13h9.4l.8-13" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 11v5M14 11v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </span>
      <span class="msg-menu-label">Clear Messages</span>
    </button>
  `;
  const renameButton = document.createElement("button");
  renameButton.type = "button";
  renameButton.className = "msg-menu-btn";
  renameButton.dataset.act = "editRoomName";
  renameButton.innerHTML = '<span class="msg-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 20h4L20 8l-4-4L4 16v4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg></span><span class="msg-menu-label">Edit Name</span>';
  App.msgMenuEl.querySelector('[data-act="editRoomIcon"]').before(renameButton);
  App.msgMenuGroups = [];
  const addGroup = (name, label, actions, icon) => {
    const group = document.createElement("div");
    group.className = "msg-menu-group";
    group.innerHTML = `<button class="msg-menu-btn msg-menu-group-toggle" type="button" data-menu-group="${name}" aria-expanded="false" aria-controls="msg-menu-${name}"><span class="msg-menu-icon" aria-hidden="true">${icon}</span><span class="msg-menu-label">${label}</span></button><div class="msg-menu-group-content" id="msg-menu-${name}" inert><div class="msg-menu-group-inner"></div></div>`;
    const items = actions.map(action => App.msgMenuEl.querySelector(`[data-act="${action}"]`)).filter(Boolean);
    items[0].before(group);
    for (const item of items) group.querySelector('.msg-menu-group-inner').appendChild(item);
    const button = group.querySelector('button'), content = group.querySelector('.msg-menu-group-content');
    button.addEventListener('click', event => {
      event.stopPropagation();
      const open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(open));
      group.classList.toggle('expanded', open); content.inert = !open;
      App.positionMsgMenuFromAnchor();
    });
    App.msgMenuGroups.push({ group, button, content, items });
  };
  addGroup('assets', 'Assets', ['downloadImage', 'downloadBanner', 'copyImageAddress', 'copyBannerAddress'], '<svg viewBox="0 0 24 24" fill="none"><path d="M3 6h7l2 2h9v12H3V6Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>');
  addGroup('room', 'Edit Room', ['editRoomName', 'editRoomIcon', 'toggleRoomAccess'], '<svg viewBox="0 0 24 24" fill="none"><path d="M4 20h4L20 8l-4-4L4 16v4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>');
  document.body.appendChild(App.msgMenuEl);
  App.msgMenuResizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => App.positionMsgMenuFromAnchor()) : null;
  App.msgMenuResizeObserver?.observe(App.msgMenuEl);
  App.msgMenuUserEl = App.msgMenuEl.querySelector(".msg-menu-user");
  App.msgMenuBtns = {
    edit: App.msgMenuEl.querySelector('button[data-act="edit"]'),
    reply: App.msgMenuEl.querySelector('button[data-act="reply"]'),
    copy: App.msgMenuEl.querySelector('button[data-act="copy"]'),
    copyImageAddress: App.msgMenuEl.querySelector('button[data-act="copyImageAddress"]'),
    downloadImage: App.msgMenuEl.querySelector('button[data-act="downloadImage"]'),
    editRoomIcon: App.msgMenuEl.querySelector('button[data-act="editRoomIcon"]'),
    pinRoom: App.msgMenuEl.querySelector('button[data-act="pinRoom"]'),
    leaveRoom: App.msgMenuEl.querySelector('button[data-act="leaveRoom"]'),
    showRoomPassword: App.msgMenuEl.querySelector('button[data-act="showRoomPassword"]'),
    toggleRoomAccess: App.msgMenuEl.querySelector('button[data-act="toggleRoomAccess"]'),
    downloadBanner: App.msgMenuEl.querySelector('button[data-act="downloadBanner"]'),
    copyBannerAddress: App.msgMenuEl.querySelector('button[data-act="copyBannerAddress"]'),
    viewSchedule: App.msgMenuEl.querySelector('button[data-act="viewSchedule"]'),
    clearRoomMessages: App.msgMenuEl.querySelector('button[data-act="clearRoomMessages"]')
  };
  App.msgMenuEl.addEventListener("click", async e => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.getAttribute("data-act");
    if (act === "editRoomName") {
      const roomId = App.msgMenuCtx?.roomId;
      App.closeMsgMenu();
      if (roomId) App.openRoomNameEditor(roomId);
      return;
    }
    if (act === "edit") {
      if (App.msgMenuCtx?.key) {
        App.beginEditMessage(App.msgDataByKey.get(App.msgMenuCtx.key) || {
          ...App.msgMenuCtx,
          _key: App.msgMenuCtx.key
        });
      }
      App.closeMsgMenu();
      return;
    }
    if (act === "reply") {
      if (App.msgMenuCtx?.key) App.setReplyState(App.msgMenuCtx);
      App.closeMsgMenu();
      return;
    }
    if (act === "copy") {
      await App.copyMessageText(App.msgMenuCtx?.text || "");
      App.closeMsgMenu();
      return;
    }
    if (act === "copyImageAddress") {
      await App.copyImageAddress(App.msgMenuCtx?.imageDataURL || "");
      App.closeMsgMenu();
      return;
    }
    if (act === "downloadImage") {
      await App.downloadFileViaObjectURL(App.msgMenuCtx?.imageDataURL || "", App.msgMenuCtx?.imageFileName || "avatar.png");
      App.closeMsgMenu();
      return;
    }
    if (act === "editRoomIcon") {
      if (App.msgMenuCtx?.roomId) App.openRoomIconEditor(App.msgMenuCtx.roomId);
      App.closeMsgMenu();
      return;
    }
    if (act === "pinRoom") {
      if (App.msgMenuCtx?.roomId) await App.togglePinnedRoom(App.msgMenuCtx.roomId);
      App.closeMsgMenu();
      return;
    }
    if (act === "leaveRoom") {
      if (App.msgMenuCtx?.roomId) App.confirmLeaveRoom(App.msgMenuCtx.roomId);
      App.closeMsgMenu();
      return;
    }
    if (act === "showRoomPassword") {
      if (App.msgMenuCtx?.roomId) App.openRoomPasswordModal(App.msgMenuCtx.roomId);
      App.closeMsgMenu();
      return;
    }
    if (act === "toggleRoomAccess") {
      if (App.msgMenuCtx?.roomId) App.openToggleRoomAccessModal(App.msgMenuCtx.roomId);
      App.closeMsgMenu();
      return;
    }
    if (act === "downloadBanner") {
      if (App.msgMenuCtx?.bannerDataURL) {
        await App.downloadFileViaObjectURL(App.msgMenuCtx.bannerDataURL, App.msgMenuCtx.bannerFileName || "banner.png");
      }
      App.closeMsgMenu();
      return;
    }
    if (act === "copyBannerAddress") {
      await App.copyImageAddress(App.msgMenuCtx?.bannerDataURL || "");
      App.closeMsgMenu();
      return;
    }
    if (act === "viewSchedule") {
      const uname = String(App.msgMenuCtx?.username || "").trim();
      App.showSchedulesPage(uname || null);
      App.closeMsgMenu();
      return;
    }
    if (act === "clearRoomMessages") {
      const roomId = App.sanitizeRoomCode(App.msgMenuCtx?.roomId);
      App.closeMsgMenu();
      if (roomId && App.isVinny()) App.confirmClearRoomMessages(roomId);
      return;
    }
  });
  document.addEventListener("pointerdown", e => {
    if (!App.msgMenuEl || App.msgMenuEl.hidden) return;
    if (App.msgMenuEl.contains(e.target)) return;
    App.closeMsgMenu();
  }, {
    capture: true
  });
  window.addEventListener("blur", () => App.closeMsgMenu(true));
  window.addEventListener("resize", () => App.closeMsgMenu(true));
  const onMsgScroll = App.rafThrottle(() => {
    if (App.msgMenuEl && !App.msgMenuEl.hidden) {
      App.positionMsgMenuFromAnchor();
    }
    App.maybeLoadOlderMessages();
    const stickyPinActive = Date.now() <= (App.stickyBottomPinUntil || 0);
    const nearBottom = stickyPinActive || App.isNearBottom(180);
    if (nearBottom) {
      App.clearLiveUnreadForCurrentRoom();
    }
  });
  App.messagesEl.addEventListener("scroll", onMsgScroll, {
    passive: true
  });
};
App.positionMsgMenuFromAnchor = function () {
  if (!App.msgMenuEl || App.msgMenuEl.hidden) return;
  const bubble = App.msgMenuAnchorBubble?.isConnected ? App.msgMenuAnchorBubble : App.msgMenuAnchorEl?.querySelector?.(".bubble") || App.msgMenuAnchorEl;
  if (!bubble || !bubble.isConnected) {
    App.closeMsgMenu(true);
    return;
  }
  App.msgMenuAnchorBubble = bubble;
  const r = bubble.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) {
    App.closeMsgMenu(true);
    return;
  }
  App.positionContextMenu(App.msgMenuEl, App.msgMenuPlacement || { anchor: bubble });
};
App.openMsgMenuFor = function (rowEl, ctx) {
  App.ensureMsgMenu();
  App.msgMenuCtx = ctx || null;
  if (!App.msgMenuEl) return;
  App.closeCallScreenContextMenu?.(true);

  // If we’re switching menus while a close animation is pending, cancel it.
  App.msgMenuCloseSeq += 1;
  if (App.msgMenuCloseOnEnd) {
    App.msgMenuEl.removeEventListener("animationend", App.msgMenuCloseOnEnd);
    App.msgMenuCloseOnEnd = null;
  }
  const isAvatarMenu = App.msgMenuCtx?.menu === "avatar";
  const isRoomIconMenu = App.msgMenuCtx?.menu === "roomIcon";
  const isRoomButtonMenu = App.msgMenuCtx?.menu === "roomButton";
  const editBtn = App.msgMenuBtns?.edit || App.msgMenuEl.querySelector('button[data-act="edit"]');
  const replyBtn = App.msgMenuBtns?.reply || App.msgMenuEl.querySelector('button[data-act="reply"]');
  const copyTextBtn = App.msgMenuBtns?.copy || App.msgMenuEl.querySelector('button[data-act="copy"]');
  const copyImageAddrBtn = App.msgMenuBtns?.copyImageAddress || App.msgMenuEl.querySelector('button[data-act="copyImageAddress"]');
  const downloadImageBtn = App.msgMenuBtns?.downloadImage || App.msgMenuEl.querySelector('button[data-act="downloadImage"]');
  const editRoomIconBtn = App.msgMenuBtns?.editRoomIcon || App.msgMenuEl.querySelector('button[data-act="editRoomIcon"]');
  const pinRoomBtn = App.msgMenuBtns?.pinRoom || App.msgMenuEl.querySelector('button[data-act="pinRoom"]');
  const leaveRoomBtn = App.msgMenuBtns?.leaveRoom || App.msgMenuEl.querySelector('button[data-act="leaveRoom"]');
  const showRoomPasswordBtn = App.msgMenuBtns?.showRoomPassword || App.msgMenuEl.querySelector('button[data-act="showRoomPassword"]');
  const toggleRoomAccessBtn = App.msgMenuBtns?.toggleRoomAccess || App.msgMenuEl.querySelector('button[data-act="toggleRoomAccess"]');
  const downloadBannerBtn = App.msgMenuBtns?.downloadBanner || App.msgMenuEl.querySelector('button[data-act="downloadBanner"]');
  const copyBannerAddrBtn = App.msgMenuBtns?.copyBannerAddress || App.msgMenuEl.querySelector('button[data-act="copyBannerAddress"]');
  const viewScheduleBtn = App.msgMenuBtns?.viewSchedule || App.msgMenuEl.querySelector('button[data-act="viewSchedule"]');
  const clearRoomMessagesBtn = App.msgMenuBtns?.clearRoomMessages || App.msgMenuEl.querySelector('button[data-act="clearRoomMessages"]');
  if (App.msgMenuUserEl) App.msgMenuUserEl.style.display = isRoomIconMenu ? "none" : "";
  if (App.msgMenuUserEl) App.msgMenuUserEl.textContent = isRoomIconMenu ? "" : String(App.msgMenuCtx?.username || "User");
  if (editBtn) editBtn.style.display = !isAvatarMenu && !isRoomIconMenu && !isRoomButtonMenu && App.msgMenuCtx?.canEdit ? "" : "none";
  if (replyBtn) replyBtn.style.display = !isAvatarMenu && !isRoomIconMenu && !isRoomButtonMenu && App.msgMenuCtx?.canReply ? "" : "none";
  if (copyTextBtn) copyTextBtn.style.display = !isAvatarMenu && !isRoomIconMenu && !isRoomButtonMenu ? "" : "none";
  if (copyImageAddrBtn) copyImageAddrBtn.style.display = isAvatarMenu || isRoomIconMenu || isRoomButtonMenu ? "" : "none";
  if (downloadImageBtn) downloadImageBtn.style.display = isAvatarMenu || isRoomIconMenu || isRoomButtonMenu ? "" : "none";
  if (editRoomIconBtn) editRoomIconBtn.style.display = isRoomButtonMenu ? "" : "none";
  if (pinRoomBtn) pinRoomBtn.style.display = isRoomButtonMenu ? "" : "none";
  if (leaveRoomBtn) leaveRoomBtn.style.display = isRoomButtonMenu ? "" : "none";
  const roomButtonMeta = isRoomButtonMenu ? App.roomsMetaCache.get(App.msgMenuCtx?.roomId) || null : null;
  if (showRoomPasswordBtn) {
    showRoomPasswordBtn.style.display = isRoomButtonMenu && App.membershipMap.has(App.sanitizeRoomCode(App.msgMenuCtx?.roomId)) && App.isPrivateRoomMeta(roomButtonMeta) ? "" : "none";
  }
  if (toggleRoomAccessBtn) {
    toggleRoomAccessBtn.style.display = isRoomButtonMenu && roomButtonMeta?.createdBy === App.currentUser?.code ? "" : "none";
  }
  App.msgMenuEl.querySelector('[data-act="editRoomName"]').style.display = isRoomButtonMenu && roomButtonMeta?.createdBy === App.currentUser?.code ? "" : "none";
  if (copyBannerAddrBtn) copyBannerAddrBtn.style.display = isAvatarMenu && !!App.msgMenuCtx?.bannerDataURL ? "" : "none";
  if (downloadBannerBtn) downloadBannerBtn.style.display = isAvatarMenu && !!App.msgMenuCtx?.bannerDataURL ? "" : "none";
  if (viewScheduleBtn) viewScheduleBtn.style.display = isAvatarMenu ? "" : "none";
  if (clearRoomMessagesBtn) clearRoomMessagesBtn.style.display = isRoomButtonMenu && App.isVinny() ? "" : "none";
  for (const { group, button, content, items } of App.msgMenuGroups || []) {
    group.hidden = !items.some(item => item.style.display !== 'none');
    group.classList.remove('expanded'); button.setAttribute('aria-expanded', 'false'); content.inert = true;
  }
  const setMenuButtonLabel = (btn, label) => {
    const labelEl = btn?.querySelector?.(".msg-menu-label");
    if (labelEl) labelEl.textContent = label;else if (btn) btn.textContent = label;
  };
  setMenuButtonLabel(copyImageAddrBtn, isRoomIconMenu || isRoomButtonMenu ? "Copy Icon Address" : "Copy PFP Address");
  setMenuButtonLabel(downloadImageBtn, isRoomIconMenu || isRoomButtonMenu ? "Download Icon" : "Download PFP");
  setMenuButtonLabel(pinRoomBtn, App.getPinnedRoomSet().has(App.sanitizeRoomCode(App.msgMenuCtx?.roomId)) ? "Unpin Room" : "Pin Room");
  setMenuButtonLabel(copyBannerAddrBtn, "Copy Banner Address");
  App.msgMenuAnchorEl = rowEl || null;
  App.msgMenuAnchorBubble = rowEl?.querySelector?.(".bubble") || rowEl || null;
  if (!App.msgMenuAnchorBubble) return;
  App.msgMenuPlacement = {
    anchor: App.msgMenuAnchorBubble,
    x: ctx?.pointerX,
    y: ctx?.pointerY,
    preserveSide: true,
    avoidAnchor: !Number.isFinite(ctx?.pointerX) || !Number.isFinite(ctx?.pointerY)
  };
  App.msgMenuEl.hidden = false;
  App.msgMenuEl.classList.remove("closing");
  App.msgMenuEl.classList.add("open");
  App.callSyncRingMenu?.();
  App.positionMsgMenuFromAnchor();
  requestAnimationFrame(() => {
    if (!App.msgMenuEl || App.msgMenuEl.hidden) return;
    App.positionMsgMenuFromAnchor();
  });
};
App.closeMsgMenu = function (immediate = false) {
  if (!App.msgMenuEl || App.msgMenuEl.hidden) return;

  // Invalidate any previous pending close.
  App.msgMenuCloseSeq += 1;
  const seq = App.msgMenuCloseSeq;
  if (App.msgMenuCloseOnEnd) {
    App.msgMenuEl.removeEventListener("animationend", App.msgMenuCloseOnEnd);
    App.msgMenuCloseOnEnd = null;
  }
  const clearAnchor = () => {
    App.msgMenuAnchorEl = null;
    App.msgMenuAnchorBubble = null;
  };
  if (immediate) {
    App.msgMenuEl.hidden = true;
    App.msgMenuEl.classList.remove("open", "closing");
    clearAnchor();
    return;
  }
  App.msgMenuEl.classList.remove("open");
  App.msgMenuEl.classList.add("closing");
  const onEnd = event => {
    if (event && event.target !== App.msgMenuEl) return;
    // If another open/close happened since we started closing, ignore this.
    if (seq !== App.msgMenuCloseSeq) return;
    App.msgMenuCloseOnEnd = null;
    if (App.msgMenuEl) {
      App.msgMenuEl.hidden = true;
      App.msgMenuEl.classList.remove("closing");
    }
    clearAnchor();
  };
  App.msgMenuCloseOnEnd = onEnd;
  App.msgMenuEl.addEventListener("animationend", onEnd, {
    once: true
  });
  // Reduced motion and interrupted CSS animations do not always emit an end
  // event. Never leave an invisible menu intercepting the next interaction.
  setTimeout(onEnd, 180);
};
App.copyMessageText = async function (text) {
  const t = String(text || "").trim();
  if (!t) {
    App.showToast({
      title: "Nothing to copy",
      body: "This message has no text.",
      duration: 1600
    });
    return;
  }
  try {
    await navigator.clipboard.writeText(t);
    App.showToast({
      title: "Copied",
      body: "Message text copied.",
      duration: 1400
    });
    return;
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    ta.remove();
    App.showToast({
      title: "Copied",
      body: "Message text copied.",
      duration: 1400
    });
  } catch {
    App.showToast({
      title: "Copy failed",
      body: "Could not copy text.",
      duration: 2000
    });
  }
};
App.inferImageExt = function (dataURL) {
  const m = /^data:image\/([^;]+);/i.exec(String(dataURL || ""));
  if (!m) return "png";
  const t = String(m[1] || "").toLowerCase();
  if (t === "jpeg") return "jpg";
  if (t === "svg+xml") return "svg";
  return t.replace(/[^a-z0-9]+/g, "") || "png";
};
App.safeFileBaseName = function (name) {
  const base = String(name || "").trim();
  const cleaned = base.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 40) || "avatar";
};
App.copyImageAddress = async function (dataURL) {
  const u = String(dataURL || "").trim();
  if (!u) {
    App.showToast({
      title: "Nothing to copy",
      body: "No image address found.",
      duration: 1600
    });
    return;
  }
  try {
    await navigator.clipboard.writeText(u);
    App.showToast({
      title: "Copied",
      body: "Image address copied.",
      duration: 1400
    });
    return;
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = u;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    ta.remove();
    App.showToast({
      title: "Copied",
      body: "Image address copied.",
      duration: 1400
    });
  } catch {
    App.showToast({
      title: "Copy failed",
      body: "Could not copy image address.",
      duration: 2000
    });
  }
};
App.lockChatScroll = function () {
  if (App._scrollLocked || !App.messagesEl) return;
  App._scrollLocked = true;
  App.messagesEl.classList.add("scroll-locked");
  App.messagesEl.addEventListener("wheel", App._preventScroll, {
    passive: false
  });
  App.messagesEl.addEventListener("touchmove", App._preventScroll, {
    passive: false
  });
};
App.unlockChatScroll = function () {
  if (!App._scrollLocked) return;
  App._scrollLocked = false;
  App.messagesEl.classList.remove("scroll-locked");
  App.messagesEl.removeEventListener("wheel", App._preventScroll, {
    passive: false
  });
  App.messagesEl.removeEventListener("touchmove", App._preventScroll, {
    passive: false
  });
};
App.waitForScrollStop = function (done) {
  const start = performance.now();
  let last = App.messagesEl.scrollTop;
  let stable = 0;
  const tick = () => {
    const cur = App.messagesEl.scrollTop;
    if (Math.abs(cur - last) < 0.6) stable++;else stable = 0;
    last = cur;
    if (stable > 6 || performance.now() - start > 1300) {
      done?.();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
App.flashMessage = function (row) {
  const bubble = row?.querySelector?.(".bubble") || row;
  if (!bubble) return;
  bubble.classList.remove("reply-flash");
  void bubble.offsetWidth;
  bubble.classList.add("reply-flash");
  setTimeout(() => bubble.classList.remove("reply-flash"), 650);
};
App.scrollToMessageKey = async function (key) {
  if (!key || !App.messagesEl || !App.messagesListEl) return;

  // Don’t fight the user with bottom-pinning while jumping to an older message.
  App.stopChatBottomFollowing();
  App.suspendAutoScrollUntil = Date.now() + 2500;
  App.suppressHistoryAutoLoadUntil = Date.now() + 1400;
  const findRow = () => App.msgElByKey.get(key) || App.messagesListEl.querySelector(`[data-msgkey="${CSS.escape(key)}"]`);
  let row = findRow();

  // If it isn’t loaded yet, opportunistically page older history until we find it (or exhaust history).
  if (!row) {
    const placeNow = App.getStoredPlace() || "";
    if (placeNow.startsWith("room:") && App.currentRoomId && App.currentRoomId === App.msgHistoryRoomId) {
      for (let i = 0; i < 10; i++) {
        if (App.msgAllHistoryLoaded || App.msgLoadingOlder) break;
        await App.loadOlderMessagesPage({
          prefetch: false
        });
        row = findRow();
        if (row) break;
      }
    }
  }
  if (!row) {
    App.showToast({
      title: "Not found",
      body: "That message isn’t loaded.",
      duration: 1800
    });
    return;
  }

  // Compute target scrollTop using layout metrics (more reliable than getBoundingClientRect during smooth scroll).
  const main = document.querySelector(".chat-main");
  const overlaysH = main ? parseFloat(getComputedStyle(main).getPropertyValue("--overlays-h")) || 0 : 0;
  const padTop = 12;
  const targetTop = Math.max(0, (row.offsetTop || 0) - padTop);
  const targetBottom = targetTop + (row.offsetHeight || 0);
  const curTop = App.messagesEl.scrollTop || 0;
  const visibleTop = curTop + padTop;
  const visibleBottom = curTop + (App.messagesEl.clientHeight || 0) - overlaysH - padTop;
  const alreadyVisible = targetTop >= visibleTop && targetBottom <= visibleBottom;
  if (alreadyVisible) {
    App.flashMessage(row);
    return;
  }

  // Aim to place the message just below the top padding/overlays.
  const nextTop = Math.max(0, targetTop);
  App.lockChatScroll();
  try {
    App.messagesEl.scrollTo({
      top: nextTop,
      behavior: "smooth"
    });
  } catch {
    App.messagesEl.scrollTop = nextTop;
  }
  App.waitForScrollStop(() => {
    App.unlockChatScroll();
    App.flashMessage(row);
    // Keep the suspension alive briefly so the next incoming message doesn’t yank the view away.
    App.suspendAutoScrollUntil = Math.max(App.suspendAutoScrollUntil, Date.now() + 1200);
  });
};

App.register("chat/message-menu", function initializeFeature() {

});
})(globalThis.ChatApp);
