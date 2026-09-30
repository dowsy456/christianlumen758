(() => {
  "use strict";

  // ======= SETTINGS =======
  const WINDOW_MS = 500;   // up to 0.5s between keys in a sequence
  const DEBOUNCE_MS = 120;

  // Blackout (Cloak hotkey; configurable)
  const BLACK_ID = "__shift_z_blackout__";
  const CLOAK_LS_KEY = "chatapp_cloak_keys";
  const CLOAK_DEFAULT = ["Shift", "Z"];

  const STYLE_ID = "__hotkey_overlays_style__";

  // ======= STATE =======
  let lastToggle = 0;

  let cloakKeysRaw = null;
  let cloakKeys = [...CLOAK_DEFAULT];
  let cloakIdx = 0, cloakLast = 0;

  const nowMs = () =>
    (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();

  // ----- Cloak keybind storage -----
  function normalizeKeyName(raw){
    let k = String(raw || "");
    if (!k) return null;
    if (k === " ") k = "Space";
    if (k === "Esc") k = "Escape";
    if (k.length === 1) k = k.toUpperCase();
    return k;
  }

  function parseCloakKeys(raw){
    if (!raw) return null;
    try{
      const v = JSON.parse(raw);
      if (Array.isArray(v) && v.length && v.length <= 4) return v.map(normalizeKeyName).filter(Boolean);
    }catch{}
    const parts = String(raw).split("+").map((s) => s.trim()).filter(Boolean).map(normalizeKeyName).filter(Boolean);
    if (parts.length && parts.length <= 4) return parts;
    return null;
  }

  function refreshCloakKeys(){
    const raw = localStorage.getItem(CLOAK_LS_KEY);
    if (raw === cloakKeysRaw) return;
    cloakKeysRaw = raw;
    cloakKeys = parseCloakKeys(raw) || [...CLOAK_DEFAULT];
    cloakIdx = 0;
    cloakLast = 0;
  }

  // ======= SELECTION CHECK =======
  function inputOrTextareaHasSelection() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = (el.tagName || "").toUpperCase();
    if (tag !== "INPUT" && tag !== "TEXTAREA") return false;
    if (tag === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (!/^(text|search|url|tel|email|password|number)$/i.test(type)) return false;
    }
    try {
      return typeof el.selectionStart === "number" && typeof el.selectionEnd === "number" && el.selectionEnd > el.selectionStart;
    } catch { return false; }
  }
  function pageHasSelection() {
    if (inputOrTextareaHasSelection()) return true;
    const sel = window.getSelection ? window.getSelection() : null;
    return !!(sel && !sel.isCollapsed);
  }

  // ======= STYLE + OVERLAYS =======
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      /* Shift+Z blackout */
      #${BLACK_ID}{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;background:#000!important;z-index:2147483647!important;margin:0!important;padding:0!important;border:0!important;display:none!important;pointer-events:none!important;}
      #${BLACK_ID}.on{display:block!important;pointer-events:auto!important;}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureBlackout() {
    ensureStyle();
    let el = document.getElementById(BLACK_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = BLACK_ID;
      el.setAttribute("aria-hidden", "true");
      (document.documentElement || document.body).appendChild(el);
      el.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
      el.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
    }
    return el;
  }

  function toggleBlackout(e) {
    const t = nowMs();
    if (t - lastToggle < DEBOUNCE_MS) return;

    const el = ensureBlackout();
    const currentlyOn = el.classList.contains("on");

    // only require "nothing selected" to turn ON; turning OFF always works
    if (!currentlyOn && pageHasSelection()) return;

    lastToggle = t;
    if (el.parentNode) el.parentNode.appendChild(el);
    el.classList.toggle("on");

    e.preventDefault();
    e.stopPropagation();
  }

  document.addEventListener("keydown", (e) => {
    const t = nowMs();
    if (e.repeat) return;

    refreshCloakKeys();

    const k = normalizeKeyName(e.key);
    if (!k) return;

    // reset sequence if too slow
    if (t - cloakLast > WINDOW_MS) {
      cloakIdx = 0;
      cloakLast = 0;
    }

    if (k === cloakKeys[cloakIdx]) {
      cloakIdx += 1;
      cloakLast = t;

      if (cloakIdx >= cloakKeys.length) {
        cloakIdx = 0;
        cloakLast = 0;
        toggleBlackout(e);
      }
      return;
    }

    // restart if key matches the first key in the sequence
    if (k === cloakKeys[0]) {
      cloakIdx = 1;
      cloakLast = t;
      return;
    }

    cloakIdx = 0;
    cloakLast = 0;
  }, true);
})();
