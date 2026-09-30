/* chat/emoji: methods register before ordered initialization. */
(function (App) {
  "use strict";
App.ensureEmojiPickerLoaded = function () {
  if (customElements.get("emoji-picker")) return Promise.resolve();
  if (!App.emojiPickerLoadPromise) {
    App.emojiPickerLoadPromise = import("https://cdn.jsdelivr.net/npm/emoji-picker-element@1.29.1/index.js").then(() => customElements.whenDefined("emoji-picker")).catch(error => {
      App.emojiPickerLoadPromise = null;
      throw error;
    });
  }
  return App.emojiPickerLoadPromise;
};
App.copyTextToClipboard = function (text) {
  const t = String(text ?? "");
  if (!t) return Promise.resolve();
  return (async () => {
    try {
      await navigator.clipboard.writeText(t);
      return;
    } catch {}
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch {}
    ta.remove();
  })();
};
App.ensureEmojiCtxMenu = function () {
  if (App.emojiCtxMenu) return App.emojiCtxMenu;
  const el = document.createElement("div");
  el.className = "msg-menu";
  el.id = "emoji-ctx-menu";
  el.style.display = "none";
  el.innerHTML = `
    <button class="msg-menu-btn" id="emoji-ctx-copy" type="button">
      <span class="msg-menu-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M8 8h10v12H8V8Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
          <path d="M6 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </span>
      <span class="msg-menu-label">Copy</span>
    </button>
  `;
  document.body.appendChild(el);
  App.$("emoji-ctx-copy").addEventListener("click", async () => {
    const emoji = el.dataset.emoji || "";
    await App.copyTextToClipboard(emoji);
    App.closeEmojiCtxMenu();
  });
  App.emojiCtxMenu = el;
  return el;
};
App.closeEmojiCtxMenu = function (immediate = false) {
  const el = App.emojiCtxMenu;
  if (!el || el.style.display === "none") return;
  if (App.emojiCtxMenuCloseTimer) {
    clearTimeout(App.emojiCtxMenuCloseTimer);
    App.emojiCtxMenuCloseTimer = null;
  }
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (immediate || reduce) {
    el.style.display = "none";
    el.classList.remove("open");
    el.classList.remove("closing");
    App.emojiCtxMenuClosing = false;
    return;
  }
  if (App.emojiCtxMenuClosing) return;
  App.emojiCtxMenuClosing = true;
  el.classList.remove("open");
  el.classList.add("closing");
  const finish = () => {
    App.emojiCtxMenuCloseTimer = null;
    el.style.display = "none";
    el.classList.remove("closing");
    App.emojiCtxMenuClosing = false;
  };
  App.emojiCtxMenuCloseTimer = setTimeout(finish, 140);
};
App.openEmojiCtxMenu = function ({
  x,
  y,
  emoji,
  anchor = null
}) {
  const el = App.ensureEmojiCtxMenu();
  App.closeCallScreenContextMenu?.(true);
  if (App.emojiCtxMenuCloseTimer) {
    clearTimeout(App.emojiCtxMenuCloseTimer);
    App.emojiCtxMenuCloseTimer = null;
  }
  App.emojiCtxMenuClosing = false;
  el.dataset.emoji = String(emoji || "");
  el.style.display = "";
  el.classList.remove("closing");
  el.classList.add("open");
  App.positionContextMenu(el, { x, y, anchor, avoidAnchor: !!anchor });
};
App.insertEmojiToComposer = function (emoji) {
  const input = App.$("msg-input");
  if (!input) return;

  // Always focus + append at end (matches your spec whether focused or not)
  input.focus();
  input.value = String(input.value || "") + String(emoji || "");

  // Trigger existing typing/ping logic
  input.dispatchEvent(new Event("input", {
    bubbles: true
  }));
};
App.closeEmojiPopover = function () {
  const pop = App.$("emoji-popover");
  if (!pop || pop.hidden) return;
  pop.classList.remove("open");
  pop.classList.add("closing");
  App.emojiPopoverOpen = false;
  const motion = App.emojiPopoverMotion = (App.emojiPopoverMotion || 0) + 1;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finish = () => {
    if (motion !== App.emojiPopoverMotion || App.emojiPopoverOpen) return;
    pop.hidden = true;
    pop.classList.remove("closing");
    App.emojiPopoverOpen = false;
  };
  if (reduce) {
    finish();
    return;
  }
  setTimeout(finish, 200);
};
App.openEmojiPopover = async function () {
  const pop = App.$("emoji-popover");
  if (!pop) return;
  App.closeRoomActivitiesMenu?.();
  App.closeStickerPopover?.({ immediate:true });
  App.closeVoicePopover?.();
  App.closeComposerMoreMenu?.({ immediate:true });
  App.emojiPopoverMotion = (App.emojiPopoverMotion || 0) + 1;
  pop.hidden = false;
  pop.classList.remove("closing");
  pop.dataset.loading = "1";
  // next frame so transition runs
  requestAnimationFrame(() => pop.classList.add("open"));
  App.emojiPopoverOpen = true;
  App.layoutChatPopovers?.();
  try {
    await App.ensureEmojiPickerLoaded();
  } catch {
    delete pop.dataset.loading;
    App.closeEmojiPopover();
    App.showToast({
      title: "Emoji picker unavailable",
      body: "The emoji library could not be loaded.",
      duration: 2400
    });
    return;
  }
  delete pop.dataset.loading;
  if (!App.emojiPopoverOpen || pop.hidden) return;

  // Lazy-bind picker events once
  const picker = App.$("emoji-picker");
  if (picker && picker.dataset.bound !== "1") {
    picker.dataset.bound = "1";

    // Left-click select -> insert
    picker.addEventListener("emoji-click", e => {
      const emoji = e?.detail?.unicode;
      if (!emoji) return;
      App.insertEmojiToComposer(emoji);
      // Keep picker open (your spec implies it stays open unless clicking off)
    });

    // Right-click any emoji -> custom menu with Copy only (styled like msg menu)
    // NOTE: emoji-picker-element uses shadow DOM; we bind to its shadow root.
    const tryBindShadow = () => {
      const sr = picker.shadowRoot;
      if (!sr) return false;
      sr.addEventListener("contextmenu", ev => {
        const t = ev.target;
        const btn = t && t.closest ? t.closest("button") : null;
        if (!btn) return;

        // Heuristic: emoji buttons usually contain the emoji as textContent.
        const emoji = (btn.textContent || "").trim();
        if (!emoji) return;
        ev.preventDefault();
        ev.stopPropagation();
        App.openEmojiCtxMenu({
          x: ev.clientX,
          y: ev.clientY,
          emoji,
          anchor: btn
        });
      });
      return true;
    };

    // Shadow root can appear after component upgrades
    if (!tryBindShadow()) {
      setTimeout(() => {
        try {
          tryBindShadow();
        } catch {}
      }, 60);
      setTimeout(() => {
        try {
          tryBindShadow();
        } catch {}
      }, 220);
      setTimeout(() => {
        try {
          tryBindShadow();
        } catch {}
      }, 600);
    }
  }
};
App.toggleEmojiPopover = function () {
  const placeNow = App.getStoredPlace() || "home";

  // Composer emoji picker only inside rooms (chat rooms)
  if (!App.currentRoomId || !placeNow.startsWith("room:") || App.views.chat.dataset.active !== "true") {
    App.showToast({
      title: "Pick a room",
      body: "Create or join a room first.",
      duration: 2200
    });
    return;
  }
  if (App.emojiPopoverOpen) App.closeEmojiPopover();else void App.openEmojiPopover();
};
App.isActiveChatRoomForMembersToggle = function () {
  const placeNow = App.getStoredPlace() || "home";
  return !!App.currentRoomId && placeNow.startsWith("room:") && App.views.chat.dataset.active === "true";
};
App.toggleMembersListVisibility = function () {
  if (!App.isActiveChatRoomForMembersToggle()) return false;
  App.closeEmojiCtxMenu();
  App.membersListVisible = !App.membersListVisible;
  App.syncEmojiButtonVisibility();
  return true;
};
App.closeComposerMoreMenu = function ({
  immediate = false
} = {}) {
  const menu = App.$("composer-more-menu");
  const button = App.$("btn-composer-more");
  if (!menu) return;
  App.composerMoreOpen = false;
  button?.setAttribute("aria-expanded", "false");
  menu.classList.remove("open");
  menu.classList.toggle("closing", !immediate);
  const finish = () => {
    if (App.composerMoreOpen) return;
    menu.hidden = true;
    menu.classList.remove("closing");
  };
  if (immediate) finish();else setTimeout(finish, 160);
};
App.openComposerMoreMenu = function () {
  const menu = App.$("composer-more-menu");
  const button = App.$("btn-composer-more");
  if (!menu || !button || button.hidden) return;
  if (App.voicePopoverOpen && App.voiceRecorder) return;
  App.closeEmojiPopover();
  App.closeVoicePopover();
  App.closeStickerPopover();
  menu.hidden = false;
  menu.classList.remove("closing");
  App.composerMoreOpen = true;
  App.layoutChatPopovers?.();
  button.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    if (App.composerMoreOpen) menu.classList.add("open");
  });
};
App.toggleComposerMoreMenu = function () {
  if (App.composerMoreOpen) App.closeComposerMoreMenu();else App.openComposerMoreMenu();
};
App.getComposerDirectToolCount = function (width, toolCount = App.COMPOSER_OPTIONAL_TOOL_IDS.length) {
  const w = Math.max(0, Number(width) || 0);
  const count = Math.max(0, Number(toolCount) || 0);
  const capacity = w >= 760 ? 5 : w >= 650 ? 4 : w >= 540 ? 3 : w >= 440 ? 2 : w >= 360 ? 1 : 0;
  const direct = Math.min(count, capacity);
  // The last tool uses exactly the space occupied by the More Tools button.
  // Keep it directly accessible instead of replacing it with a one-item menu.
  return count - direct === 1 ? count : direct;
};
App.syncComposerToolLayout = function () {
  const row = App.$("composer-row");
  const direct = App.$("composer-actions-direct");
  const overflow = App.$("composer-more-actions");
  const more = App.$("btn-composer-more");
  if (!row || !direct || !overflow || !more) return;
  const placeNow = App.getStoredPlace() || "home";
  const inRoom = !!App.currentRoomId && placeNow.startsWith("room:") && App.views.chat.dataset.active === "true";
  const tools = App.COMPOSER_OPTIONAL_TOOL_IDS.map(id => App.$(id)).filter(Boolean);
  const visibleTools = inRoom ? tools.filter(tool => !tool.hidden) : [];
  const directCount = inRoom ? App.getComposerDirectToolCount(row.getBoundingClientRect().width, visibleTools.length) : 0;
  const directTools = new Set(visibleTools.slice(0, directCount));
  tools.forEach(tool => {
    const destination = tool.hidden || directTools.has(tool) ? direct : overflow;
    if (tool.parentElement !== destination) destination.appendChild(tool);
    tool.dataset.composerLocation = destination === overflow ? "overflow" : "direct";
    if (destination === overflow) tool.setAttribute("role", "menuitem");else tool.removeAttribute("role");
  });

  // Re-appending in canonical order keeps the menu predictable while the
  // breakpoint moves one button at a time between the two containers.
  for (const host of [direct, overflow]) {
    App.COMPOSER_OPTIONAL_TOOL_IDS.forEach(id => {
      const tool = App.$(id);
      if (tool?.parentElement === host) host.appendChild(tool);
    });
  }
  const overflowCount = visibleTools.length - directCount;
  more.hidden = overflowCount === 0;
  if (!overflowCount) App.closeComposerMoreMenu({
    immediate: true
  });
};
App.bindResponsiveComposerOnce = function () {
  const row = App.$("composer-row");
  if (!row || row.dataset.responsiveBound === "1") return;
  row.dataset.responsiveBound = "1";
  App.$("btn-composer-more")?.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    App.toggleComposerMoreMenu();
  });
  App.$("composer-more-actions")?.addEventListener("click", event => {
    if (!event.target?.closest?.(".composer-tool-btn")) return;
    requestAnimationFrame(() => App.closeComposerMoreMenu());
  }, {
    capture: true
  });
  if (typeof ResizeObserver === "function") {
    App.composerLayoutObserver = new ResizeObserver(() => App.syncComposerToolLayout());
    App.composerLayoutObserver.observe(row);
  } else {
    window.addEventListener("resize", App.syncComposerToolLayout, {
      passive: true
    });
  }
  App.syncComposerToolLayout();
};
App.syncEmojiButtonVisibility = function () {
  const eBtn = App.$("btn-emoji");
  const sBtn = App.$("btn-stickers");
  const aBtn = App.$("btn-activities");
  const vBtn = App.$("btn-voice");
  const mBtn = App.$("btn-members");
  const membersSidebar = App.$("members-sidebar");
  if (!eBtn && !sBtn && !aBtn && !vBtn && !mBtn && !membersSidebar) return;
  const placeNow = App.getStoredPlace() || "home";
  const inRoom = !!App.currentRoomId && placeNow.startsWith("room:") && App.views.chat.dataset.active === "true";
  const showMembersSidebar = inRoom && App.membersListVisible;
  document.body.dataset.roomView = inRoom ? "1" : "0";
  document.body.dataset.membersSidebar = showMembersSidebar ? "1" : "0";
  if (eBtn) eBtn.hidden = !inRoom;
  if (sBtn) sBtn.hidden = !inRoom;
  if (aBtn) aBtn.hidden = !inRoom;
  if (vBtn) vBtn.hidden = !inRoom;
  if (mBtn) mBtn.hidden = !inRoom;
  if (mBtn) mBtn.setAttribute("aria-expanded", showMembersSidebar ? "true" : "false");
  if (membersSidebar) membersSidebar.hidden = !showMembersSidebar;
  App.syncCompanionMembersButton?.();
  if (!inRoom) {
    App.membersListVisible = document.body.dataset.mobileUi === "1" ? false : true;
    App.closeEmojiCtxMenu(true);
    App.closeEmojiPopover();
    App.closeStickerPopover();
    App.closeVoicePopover({
      keepRecorder: false
    });
  }
  App.syncRoomActivitiesButton();
  App.syncComposerToolLayout();
};
App.closeMobileDrawers = function () {
  document.body.dataset.mobileNav = "0";
  App.$("btn-mobile-nav")?.setAttribute("aria-expanded", "false");
  if (document.body.dataset.mobileUi === "1" && App.membersListVisible) {
    App.membersListVisible = false;
    App.syncEmojiButtonVisibility();
  }
};

App.register("chat/emoji", function initializeFeature() {
App.emojiPopoverOpen = false;
App.emojiCtxMenu = null;
App.emojiCtxMenuClosing = false;
App.emojiCtxMenuCloseTimer = null;
App.emojiPickerLoadPromise = null;
App.membersListVisible = document.body.dataset.mobileUi === "1" ? false : true;
App.COMPOSER_OPTIONAL_TOOL_IDS = ["btn-emoji", "btn-stickers", "btn-voice", "btn-members", "btn-activities", "btn-poll"];
App.stickerPopoverOpen = false;
App.composerMoreOpen = false;
App.composerLayoutObserver = null;
App.bindResponsiveComposerOnce();
App.$("btn-emoji")?.addEventListener("click", e => {
  e.preventDefault();
  e.stopPropagation();
  App.closeEmojiCtxMenu();
  App.toggleEmojiPopover();
});
App.$("btn-activities")?.addEventListener("click", e => {
  e.preventDefault();
  e.stopPropagation();
  App.closeEmojiCtxMenu();
  App.openRoomActivitiesModal();
});
App.$("btn-voice")?.addEventListener("click", e => {
  e.preventDefault();
  e.stopPropagation();
  App.closeEmojiCtxMenu();
  App.toggleVoicePopover();
});
App.$("btn-members")?.addEventListener("click", e => {
  e.preventDefault();
  e.stopPropagation();
  document.body.dataset.mobileNav = "0";
  App.$("btn-mobile-nav")?.setAttribute("aria-expanded", "false");
  App.toggleMembersListVisibility();
});
App.$("btn-mobile-nav")?.addEventListener("click", e => {
  e.preventDefault();
  e.stopPropagation();
  if (document.body.dataset.mobileUi !== "1") return;
  if (App.membersListVisible) {
    App.membersListVisible = false;
    App.syncEmojiButtonVisibility();
  }
  const open = document.body.dataset.mobileNav !== "1";
  document.body.dataset.mobileNav = open ? "1" : "0";
  e.currentTarget.setAttribute("aria-expanded", open ? "true" : "false");
});
App.$("mobile-drawer-scrim")?.addEventListener("click", App.closeMobileDrawers);
document.addEventListener("click", e => {
  if (document.body.dataset.mobileNav !== "1") return;
  if (!e.target?.closest?.(".sidebar:not(.members-sidebar) .side-btn, .sidebar:not(.members-sidebar) .room-row, .sidebar:not(.members-sidebar) .time-display-card")) return;
  App.closeMobileDrawers();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.body.dataset.mobileUi === "1") App.closeMobileDrawers();
});
document.addEventListener("keydown", e => {
  if (e.repeat) return;
  if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
  if (String(e.key || "").toLowerCase() !== "u") return;
  if (!App.isActiveChatRoomForMembersToggle()) return;
  e.preventDefault();
  e.stopPropagation();
  App.toggleMembersListVisibility();
});
document.addEventListener("pointerdown", e => {
  const ePop = App.$("emoji-popover");
  const eBtn = App.$("btn-emoji");
  const vPop = App.$("voice-popover");
  const vBtn = App.$("btn-voice");
  const composerMore = App.$("composer-more-menu");
  const composerMoreBtn = App.$("btn-composer-more");
  if (App.composerMoreOpen && composerMore) {
    const target = e.target;
    if (!composerMore.contains(target) && !composerMoreBtn?.contains(target)) App.closeComposerMoreMenu();
  }
  if (App.emojiCtxMenu && App.emojiCtxMenu.style.display !== "none") {
    const inside = App.emojiCtxMenu.contains(e.target);
    if (!inside) App.closeEmojiCtxMenu();
  }
  if (App.emojiPopoverOpen && ePop && !ePop.hidden) {
    const target = e.target;
    const insideEmoji = ePop.contains(target);
    const onEmojiBtn = eBtn && eBtn.contains(target);
    const insideCtx = App.emojiCtxMenu && App.emojiCtxMenu.style.display !== "none" && App.emojiCtxMenu.contains(target);
    if (!insideEmoji && !onEmojiBtn && !insideCtx) App.closeEmojiPopover();
  }
  if (App.voicePopoverOpen && vPop && !vPop.hidden) {
    const target = e.target;
    const insideVoice = vPop.contains(target);
    const onVoiceBtn = vBtn && vBtn.contains(target);
    if (!insideVoice && !onVoiceBtn && !App.voiceRecorder) App.closeVoicePopover();
  }
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (App.emojiPopoverOpen) App.closeEmojiPopover();
  if (App.voicePopoverOpen) App.closeVoicePopover({
    keepRecorder: false
  });
  if (App.composerMoreOpen) App.closeComposerMoreMenu();
  App.closeEmojiCtxMenu();
});
});
})(globalThis.ChatApp);
