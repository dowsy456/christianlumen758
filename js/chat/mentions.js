/* chat/mentions: methods register before ordered initialization. */
(function (App) {
  "use strict";
App.preciseRangeValueFromPointer = function (range, e) {
  const rect = range.getBoundingClientRect();
  const min = Number(range.min || 0);
  const max = Number(range.max || 100);
  if (!rect.width || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return range.value;
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  let next = min + (max - min) * ratio;
  const stepRaw = range.getAttribute("step");
  if (stepRaw && stepRaw !== "any") {
    const step = Number(stepRaw);
    if (Number.isFinite(step) && step > 0) {
      next = min + Math.round((next - min) / step) * step;
    }
  }
  next = Math.max(min, Math.min(max, next));
  return String(Math.round(next * 1000000) / 1000000);
};
App.setPreciseRangeFromPointer = function (range, e, emitChange = false) {
  const next = App.preciseRangeValueFromPointer(range, e);
  if (range.value !== next) {
    range.value = next;
    App.syncPreciseRangeVisual(range);
    range.dispatchEvent(new Event("input", {
      bubbles: true
    }));
  } else {
    App.syncPreciseRangeVisual(range);
  }
  if (emitChange) range.dispatchEvent(new Event("change", {
    bubbles: true
  }));
};
App.initPreciseRangeSliders = function (root = document) {
  const scope = root instanceof Element || root instanceof Document || root instanceof DocumentFragment ? root : document;
  if (scope.matches?.('input[type="range"]')) App.syncPreciseRangeVisual(scope);
  scope.querySelectorAll?.('input[type="range"]').forEach(App.syncPreciseRangeVisual);
};
App.beginPreciseRangeDrag = function (e) {
  if (e.button != null && e.button !== 0) return;
  const range = e.target?.closest?.('input[type="range"]');
  if (!(range instanceof HTMLInputElement) || range.disabled) return;
  App.preciseRangeDragState = {
    range,
    pointerId: e.pointerId
  };
  try {
    range.focus({
      preventScroll: true
    });
  } catch {}
  try {
    range.setPointerCapture(e.pointerId);
  } catch {}
  App.setPreciseRangeFromPointer(range, e);
  e.preventDefault();
};
App.handlePreciseRangeMove = function (e) {
  if (!App.preciseRangeDragState || e.pointerId !== App.preciseRangeDragState.pointerId) return;
  App.setPreciseRangeFromPointer(App.preciseRangeDragState.range, e);
  e.preventDefault();
};
App.endPreciseRangeDrag = function (e) {
  if (!App.preciseRangeDragState || e.pointerId != null && e.pointerId !== App.preciseRangeDragState.pointerId) return;
  const range = App.preciseRangeDragState.range;
  App.preciseRangeDragState = null;
  if (range instanceof HTMLInputElement) {
    try {
      range.releasePointerCapture(e.pointerId);
    } catch {}
    App.syncPreciseRangeVisual(range);
    range.dispatchEvent(new Event("change", {
      bubbles: true
    }));
  }
};
App.showView = function (name) {
  if (name !== "chat") document.body.dataset.calendarPage = "0";
  if (name !== "chat" && App.callMenuOpen) App.closeCallMenu();
  Object.values(App.views).forEach(v => v.dataset.active = "false");
  App.views[name].dataset.active = "true";
  App.hideError("create");
  App.hideError("login");
  if (name === "chat") document.body.dataset.mode = "chat";else delete document.body.dataset.mode;
  App.syncTimeDisplayChatAction?.();

  // Landing-only educational disguise; revert instantly in chat view.
  try {
    const saved = localStorage.getItem("chatapp_tab_name");
    if (!saved) {
      document.title = name === "chat" ? "GradeSort | Grade Sorter, Study Helper" : "GradeSort | Grade Sorter, Study Helper";
    }
  } catch {}
  if (name === "home") {
    try {
      window.scrollTo(0, 0);
    } catch {}
  }
  try {
    App.syncSidebarRoomActiveStates();
  } catch {}
};
App.setError = function (which, msg) {
  const el = which === "create" ? App.$("create-error") : App.$("login-error");
  el.textContent = msg;
  el.hidden = false;
};
App.hideError = function (which) {
  const el = which === "create" ? App.$("create-error") : App.$("login-error");
  el.hidden = true;
  el.textContent = "";
};
App.escapeHtml = function (s) {
  return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
};
App.escapeRegExp = function (s) {
  return String(s ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};
App.getRoomMentionUsers = function () {
  const out = [];
  const codes = new Set();
  try {
    for (const code of App.roomMembersCache.keys()) {
      if (code) codes.add(String(code));
    }
  } catch {}
  const selfCode = String(App.currentUser?.code || "");
  try {
    if (selfCode && App.roomMembersCache.has(selfCode)) codes.add(selfCode);
  } catch {}
  for (const code of codes) {
    const u = String(App.currentUser?.code || "") === code ? App.currentUser : App.liveUserCache.get(code);
    const username = App.sanitizeUsername(u?.username || "");
    if (!username) continue;
    out.push({
      code,
      username,
      usernameLower: String(u?.usernameLower || username).toLowerCase(),
      displayName: App.sanitizeUsername(u?.displayName || username) || username,
      displayNameLower: String(u?.displayNameLower || u?.displayName || username).toLowerCase()
    });
  }
  return out;
};
App.getRoomMentionTargetByUsername = function (username) {
  const cleaned = App.sanitizeUsername(username);
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();
  for (const u of App.getRoomMentionUsers()) {
    if (u.usernameLower === lower) return u;
  }
  return null;
};
App.formatTextWithMentions = function (s) {
  const raw = String(s ?? "");
  const re = /(^|\s)@([A-Za-z0-9_]{1,32})\b/g;
  let out = "";
  let last = 0;
  let m;
  while (m = re.exec(raw)) {
    const start = m.index;
    const pre = m[1] || "";
    const username = m[2] || "";
    const mentionStart = start + pre.length;
    out += App.escapeHtml(raw.slice(last, mentionStart));
    const broadcast = username.toLowerCase();
    if (broadcast === "everyone" || broadcast === "all" || broadcast === "a") {
      out += `<span class="mention-label mention-broadcast" data-mention-kind="broadcast">@${App.escapeHtml(username)}</span>`;
      last = re.lastIndex;
      continue;
    }
    const target = App.getRoomMentionTargetByUsername(username);
    if (target) {
      out += `<button type="button" class="mention-label mention-link" data-usercode="${App.escapeHtml(target.code)}" aria-label="Open ${App.escapeHtml(target.username)}'s profile">@${App.escapeHtml(target.username)}</button>`;
    } else {
      out += App.escapeHtml(`@${username}`);
    }
    last = re.lastIndex;
  }
  out += App.escapeHtml(raw.slice(last));
  return out;
};
App.replaceDisplayNameMentionsInComposer = function (input) {
  if (!(input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement)) return false;
  const users = App.getRoomMentionUsers().filter(u => u.username && u.displayName && u.displayNameLower !== u.usernameLower).sort((a, b) => b.displayName.length - a.displayName.length);
  if (!users.length) return false;
  const original = String(input.value || "");
  let next = original;
  let delta = 0;
  const caret = typeof input.selectionStart === "number" ? input.selectionStart : original.length;
  for (const u of users) {
    const displayName = String(u.displayName || "").trim();
    const username = String(u.username || "").trim();
    if (!displayName || !username) continue;
    const re = new RegExp(`(^|\\s)@(${App.escapeRegExp(displayName)})(?=$|\\s)`, "gi");
    next = next.replace(re, (match, pre, typed, offset) => {
      const replacement = `${pre}@${username}`;
      if (offset < caret) delta += replacement.length - match.length;
      return replacement;
    });
  }
  if (next === original) return false;
  input.value = next;
  App.lastMsgInputVal = next;
  const newCaret = Math.max(0, Math.min(next.length, caret + delta));
  try {
    input.setSelectionRange(newCaret, newCaret);
  } catch {}
  if (App.pingBarEl && !App.pingBarEl.hidden) App.closePingBar({
    quiet: true
  });
  return true;
};
App.refreshMentionFormattingForRenderedMessages = function (root = document) {
  const scope = root && typeof root.querySelectorAll === "function" ? root : document;
  scope.querySelectorAll(".bubble-text[data-raw-text]").forEach(el => {
    el.innerHTML = App.formatTextWithMentions(el.dataset.rawText || "");
  });
};

App.register("chat/mentions", function initializeFeature() {
document.addEventListener("pointerdown", App.beginPreciseRangeDrag, true);
window.addEventListener("pointermove", App.handlePreciseRangeMove, {
  passive: false
});
window.addEventListener("pointerup", App.endPreciseRangeDrag, true);
window.addEventListener("pointercancel", App.endPreciseRangeDrag, true);
document.addEventListener("input", e => {
  if (e.target instanceof HTMLInputElement && e.target.type === "range") App.syncPreciseRangeVisual(e.target);
}, true);
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => App.initPreciseRangeSliders(), {
    once: true
  });
} else {
  App.initPreciseRangeSliders();
}
if (typeof MutationObserver !== "undefined") {
  new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => App.initPreciseRangeSliders(node));
    });
  }).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}
App.views = {
  home: App.$("view-home"),
  create: App.$("view-create"),
  login: App.$("view-login"),
  chat: App.$("view-chat")
};
});
})(globalThis.ChatApp);
