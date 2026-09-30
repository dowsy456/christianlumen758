/* media/viewer: methods register before ordered initialization. */
(function (App) {
  "use strict";
App.cleanupMediaModalSrcCache = function () {
  for (const entry of App.mediaModalSrcCache.values()) {
    try {
      if (entry?.url && String(entry.url).startsWith("blob:")) URL.revokeObjectURL(entry.url);
    } catch {}
  }
  App.mediaModalSrcCache.clear();
};
App.bindMediaModalSrcCacheCleanup = function () {
  if (App.mediaModalSrcCacheBound) return;
  App.mediaModalSrcCacheBound = true;
  window.addEventListener("pagehide", App.cleanupMediaModalSrcCache);
  window.addEventListener("beforeunload", App.cleanupMediaModalSrcCache);
};
App.getFastMediaModalSrc = async function (dataURL, mimeType = "") {
  const src = String(dataURL || "").trim();
  if (!src) return "";
  if (!/^data:/i.test(src)) return src;
  App.bindMediaModalSrcCacheCleanup();
  const hit = App.mediaModalSrcCache.get(src);
  if (hit?.url) return hit.url;
  if (hit?.promise) return hit.promise;
  const promise = (async () => {
    try {
      const res = await fetch(src);
      const rawBlob = await res.blob();
      const type = String(mimeType || rawBlob.type || "").trim();
      const blob = type && rawBlob.type !== type ? rawBlob.slice(0, rawBlob.size, type) : rawBlob;
      const url = URL.createObjectURL(blob);
      App.mediaModalSrcCache.set(src, {
        url,
        ts: Date.now()
      });
      return url;
    } catch {
      App.mediaModalSrcCache.delete(src);
      return src;
    }
  })();
  App.mediaModalSrcCache.set(src, {
    promise,
    ts: Date.now()
  });
  return promise;
};
App.openMediaModal = function (kind, dataURL, {
  fileName = null,
  mimeType = "",
  stickerRecord = null
} = {}) {
  const src = String(dataURL || "").trim();
  if (!src) return;
  const isStickerViewer = !!stickerRecord;
  const isStickerVideo = isStickerViewer && String(stickerRecord?.kind || kind) === "video";
  const modalTitle = fileName ? String(fileName) : isStickerViewer ? "Sticker" : "Media";
  const mountId = `media_mount_${Math.random().toString(36).slice(2, 9)}`;
  let mediaPlayerId = "";
  let mediaZoomTeardown = null;
  function initMediaZoomViewer(root, cfg = {}) {
    if (!root) return () => {};
    const viewport = root.querySelector(".media-zoom-viewport");
    const target = root.querySelector(".media-zoom-target");
    const btnIn = root.querySelector('[data-media-zoom="in"]');
    const btnOut = root.querySelector('[data-media-zoom="out"]');
    const btnReset = root.querySelector('[data-media-zoom="reset"]');
    const readout = root.querySelector('[data-media-zoom="percent"]');
    if (!viewport || !target) return () => {};
    const maxScale = App.clampNum(Math.max(Number(cfg.maxScale) || 0, 20), 1.25, 24, 20);
    const step = App.clampNum(Math.max(Number(cfg.step) || 0, 0.5), 0.05, 2, 0.5);
    const wheelStep = App.clampNum(Math.max(Number(cfg.wheelStep) || 0, 0.5), 0.02, 1, 0.5);
    const dblScale = App.clampNum(cfg.doubleTapScale, 1.25, maxScale, 2.5);
    let scale = 1;
    let panX = 0;
    let panY = 0;
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragPanStartX = 0;
    let dragPanStartY = 0;
    let pinchDistance = 0;
    let pinchStartScale = 1;
    let pointerDownX = 0;
    let pointerDownY = 0;
    let clickCanceledByDrag = false;
    const clickDragThreshold = 6;
    const pointers = new Map();
    const off = [];
    function getLimits(nextScale = scale) {
      const rect = viewport.getBoundingClientRect();
      const baseW = target.clientWidth || rect.width || 0;
      const baseH = target.clientHeight || rect.height || 0;
      const extraX = Math.max(0, (baseW * nextScale - rect.width) / 2);
      const extraY = Math.max(0, (baseH * nextScale - rect.height) / 2);
      return {
        x: extraX,
        y: extraY
      };
    }
    function clampPan(nextX, nextY, nextScale = scale) {
      const lim = getLimits(nextScale);
      return {
        x: Math.min(lim.x, Math.max(-lim.x, nextX)),
        y: Math.min(lim.y, Math.max(-lim.y, nextY))
      };
    }
    function updateReadout() {
      if (readout) readout.textContent = `${Math.round(scale * 100)}%`;
      if (btnOut) btnOut.disabled = scale <= 1.001;
      if (btnIn) btnIn.disabled = scale >= maxScale - 0.001;
    }
    function apply() {
      const clamped = scale <= 1 ? {
        x: 0,
        y: 0
      } : clampPan(panX, panY, scale);
      panX = clamped.x;
      panY = clamped.y;
      target.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
      viewport.classList.toggle("is-zoomed", scale > 1.001);
      viewport.classList.toggle("is-dragging", dragging && scale > 1.001);
      viewport.setAttribute("aria-label", scale > 1.001 ? "Zoomed media viewer. Drag to pan." : "Media viewer");
      updateReadout();
    }
    function setScale(nextScale, anchorClientX = null, anchorClientY = null) {
      const prevScale = scale;
      const clampedScale = Math.min(maxScale, Math.max(1, Number(nextScale) || 1));
      if (Math.abs(clampedScale - prevScale) < 0.0001) return;
      if (anchorClientX != null && anchorClientY != null) {
        const rect = viewport.getBoundingClientRect();
        const offsetX = anchorClientX - rect.left - rect.width / 2;
        const offsetY = anchorClientY - rect.top - rect.height / 2;
        const contentX = (offsetX - panX) / prevScale;
        const contentY = (offsetY - panY) / prevScale;
        scale = clampedScale;
        panX = offsetX - contentX * scale;
        panY = offsetY - contentY * scale;
      } else {
        scale = clampedScale;
      }
      if (scale <= 1) {
        panX = 0;
        panY = 0;
      }
      apply();
    }
    function zoomBy(delta, anchorClientX = null, anchorClientY = null) {
      setScale(scale + delta, anchorClientX, anchorClientY);
    }
    function resetZoom() {
      scale = 1;
      panX = 0;
      panY = 0;
      dragging = false;
      pinchDistance = 0;
      apply();
    }
    function beginDrag(clientX, clientY) {
      if (scale <= 1.001) return;
      dragging = true;
      dragStartX = clientX;
      dragStartY = clientY;
      dragPanStartX = panX;
      dragPanStartY = panY;
      apply();
    }
    function moveDrag(clientX, clientY) {
      if (!dragging || scale <= 1.001) return;
      panX = dragPanStartX + (clientX - dragStartX);
      panY = dragPanStartY + (clientY - dragStartY);
      apply();
    }
    function endDrag() {
      dragging = false;
      apply();
    }
    function getPointerCenter() {
      const pts = Array.from(pointers.values());
      if (pts.length < 2) return null;
      return {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2
      };
    }
    function getPointerDistance() {
      const pts = Array.from(pointers.values());
      if (pts.length < 2) return 0;
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
    function onPointerDown(e) {
      if (e.button === 1) {
        e.preventDefault();
        return;
      }
      if (e.button != null && e.button !== 0 && e.pointerType !== "touch") return;
      pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY
      });
      if (target.tagName === "VIDEO" && !cfg.continuous) {
        try {
          viewport.focus({
            preventScroll: true
          });
        } catch {
          try {
            viewport.focus();
          } catch {}
        }
      }
      if (pointers.size === 2) {
        clickCanceledByDrag = true;
        pinchDistance = getPointerDistance();
        pinchStartScale = scale;
        dragging = false;
        apply();
      } else {
        pointerDownX = e.clientX;
        pointerDownY = e.clientY;
        clickCanceledByDrag = false;
        if (scale > 1.001) beginDrag(e.clientX, e.clientY);
      }
      try {
        viewport.setPointerCapture(e.pointerId);
      } catch {}
      e.preventDefault();
    }
    function onPointerMove(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY
      });
      if (pointers.size >= 2) {
        clickCanceledByDrag = true;
        root.dataset.mediaSuppressCloseUntil = String(Date.now() + 350);
        const dist = getPointerDistance();
        const center = getPointerCenter();
        if (pinchDistance > 0 && dist > 0 && center) {
          const ratio = dist / pinchDistance;
          setScale(pinchStartScale * ratio, center.x, center.y);
        }
        return;
      }
      if (!clickCanceledByDrag) {
        const moved = Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY);
        if (moved > clickDragThreshold) {
          clickCanceledByDrag = true;
          root.dataset.mediaSuppressCloseUntil = String(Date.now() + 350);
        }
      }
      moveDrag(e.clientX, e.clientY);
    }
    function clearPointer(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) {
        pinchDistance = 0;
      }
      if (!pointers.size) endDrag();
    }
    function onWheel(e) {
      const rect = viewport.getBoundingClientRect();
      const ax = e.clientX || rect.left + rect.width / 2;
      const ay = e.clientY || rect.top + rect.height / 2;
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      zoomBy(dir * wheelStep, ax, ay);
    }
    function onAuxClick(e) {
      if (e.button !== 1) return;
      e.preventDefault();
      if (scale > 1.001) resetZoom();else setScale(dblScale, e.clientX, e.clientY);
    }
    function onDoubleClick(e) {
      if (e.target?.closest?.(".media-zoom-controls")) return;
      e.preventDefault();
      if (scale > 1.001) resetZoom();else setScale(dblScale, e.clientX, e.clientY);
    }
    function onKeyDown(e) {
      if ((e.key === " " || e.key === "Spacebar" || e.code === "Space") && target.tagName === "VIDEO" && !cfg.continuous) {
        e.preventDefault();
        const video = target;
        if (video.paused) video.play().catch(() => {});else video.pause();
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomBy(step);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomBy(-step);
      } else if (e.key === "0") {
        e.preventDefault();
        resetZoom();
      } else if (scale > 1.001 && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const delta = 40;
        if (e.key === "ArrowUp") panY += delta;
        if (e.key === "ArrowDown") panY -= delta;
        if (e.key === "ArrowLeft") panX += delta;
        if (e.key === "ArrowRight") panX -= delta;
        apply();
      }
    }
    function onClick(e) {
      if (target.tagName !== "VIDEO" || cfg.continuous) return;
      if (clickCanceledByDrag) {
        clickCanceledByDrag = false;
        return;
      }
      e.preventDefault();
      const video = target;
      if (video.paused) video.play().catch(() => {});else video.pause();
    }
    const zoomIn = () => zoomBy(step);
    const zoomOut = () => zoomBy(-step);
    if (btnIn) btnIn.addEventListener("click", zoomIn);
    if (btnOut) btnOut.addEventListener("click", zoomOut);
    if (btnReset) btnReset.addEventListener("click", resetZoom);
    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", clearPointer);
    viewport.addEventListener("pointercancel", clearPointer);
    viewport.addEventListener("click", onClick);
    viewport.addEventListener("wheel", onWheel, {
      passive: false
    });
    viewport.addEventListener("auxclick", onAuxClick);
    viewport.addEventListener("dblclick", onDoubleClick);
    viewport.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", apply);
    off.push(() => viewport.removeEventListener("pointerdown", onPointerDown));
    off.push(() => viewport.removeEventListener("pointermove", onPointerMove));
    off.push(() => viewport.removeEventListener("pointerup", clearPointer));
    off.push(() => viewport.removeEventListener("pointercancel", clearPointer));
    off.push(() => viewport.removeEventListener("click", onClick));
    off.push(() => viewport.removeEventListener("wheel", onWheel));
    off.push(() => viewport.removeEventListener("auxclick", onAuxClick));
    off.push(() => viewport.removeEventListener("dblclick", onDoubleClick));
    off.push(() => viewport.removeEventListener("keydown", onKeyDown));
    if (btnIn) off.push(() => btnIn.removeEventListener("click", zoomIn));
    if (btnOut) off.push(() => btnOut.removeEventListener("click", zoomOut));
    if (btnReset) off.push(() => btnReset.removeEventListener("click", resetZoom));
    off.push(() => window.removeEventListener("resize", apply));
    if (target.tagName === "IMG") {
      target.addEventListener("load", apply, {
        once: true
      });
    } else if (target.tagName === "VIDEO") {
      target.addEventListener("loadedmetadata", apply, {
        once: true
      });
      target.addEventListener("loadeddata", apply, {
        once: true
      });
    }
    resetZoom();
    return () => {
      pointers.clear();
      endDrag();
      resetZoom();
      off.reverse().forEach(fn => {
        try {
          fn();
        } catch {}
      });
    };
  }
  App.openModal({
    title: modalTitle,
    size: "media",
    bodyHTML: `
      <div class="media-viewer${kind === "video" || isStickerVideo ? " media-viewer-video" : ""}${isStickerViewer ? " sticker-media-viewer" : ""}" id="${mountId}">
        <div class="media-modal-loading">Loading preview...</div>
      </div>
      ${isStickerViewer ? `
        <div class="sticker-viewer-meta" data-sticker-id="${App.escapeAttr(String(stickerRecord?.id || ""))}">
          <strong data-sticker-viewer-name>${App.escapeHtml(String(stickerRecord?.name || "Sticker"))}</strong>
          <span class="sticker-viewer-uploader" data-sticker-uploader-code="${App.escapeAttr(String(stickerRecord?.creatorCode || ""))}">
            <span class="sticker-viewer-uploader-avatar" data-avatar-usercode="${App.escapeAttr(String(stickerRecord?.creatorCode || ""))}" aria-hidden="true"></span>
            <span class="sticker-viewer-uploader-copy">Uploaded by <span data-username-usercode="${App.escapeAttr(String(stickerRecord?.creatorCode || ""))}">${App.escapeHtml(String(stickerRecord?.creatorUsername || "Unknown"))}</span></span>
          </span>
        </div>
      ` : ""}
    `,
    onBeforeClose: () => {
      try {
        if (typeof mediaZoomTeardown === "function") mediaZoomTeardown();
      } catch {}
      mediaZoomTeardown = null;
      if (!mediaPlayerId) return;
      try {
        const tdNow = App.videoPlayerTeardowns.get(mediaPlayerId);
        if (tdNow) {
          tdNow();
          App.videoPlayerTeardowns.delete(mediaPlayerId);
        }
      } catch {}
    }
  });
  if (isStickerViewer) {
    App.configureStickerViewerActions(stickerRecord);
    App.hydrateStickerViewerUploader(stickerRecord);
  } else if (kind === "image" || kind === "video") App.configureMediaStickerAction({
    kind,
    dataURL: src,
    fileName,
    mimeType
  });
  (async () => {
    const mount = document.getElementById(mountId);
    if (!mount) return;
    const fastSrc = await App.getFastMediaModalSrc(src, mimeType);
    if (!mount.isConnected) return;
    const cfg = await App.getVideoUiConfig();
    const zoomCfg = cfg.mediaZoom || {};
    if (isStickerVideo) {
      mount.innerHTML = `
        <div class="media-zoom-shell media-zoom-shell-video sticker-zoom-shell">
          <div class="media-zoom-controls media-zoom-controls-video" aria-label="Sticker zoom controls">
            <button class="media-zoom-btn" type="button" data-media-zoom="out" aria-label="Zoom out">−</button>
            <button class="media-zoom-btn" type="button" data-media-zoom="reset" aria-label="Reset zoom"><span data-media-zoom="percent">100%</span></button>
            <button class="media-zoom-btn" type="button" data-media-zoom="in" aria-label="Zoom in">+</button>
          </div>
          <div class="media-zoom-viewport" tabindex="0" aria-label="Zoomable animated sticker viewer">
            <div class="media-zoom-surface">
              <video class="media-img media-zoom-target sticker-viewer-video" src="${App.escapeHtml(fastSrc)}" autoplay loop muted playsinline preload="auto" aria-label="${App.escapeHtml(String(stickerRecord?.name || "Animated sticker"))}"></video>
            </div>
          </div>
        </div>
      `;
      const stickerVideo = mount.querySelector("video");
      try {
        stickerVideo?.play?.().catch(() => {});
      } catch {}
      mediaZoomTeardown = initMediaZoomViewer(mount.querySelector(".media-zoom-shell"), {
        ...zoomCfg,
        continuous: true
      });
      return;
    }
    if (kind !== "video") {
      mount.innerHTML = `
        <div class="media-zoom-shell media-zoom-shell-image">
          <div class="media-zoom-controls" aria-label="Image zoom controls">
            <button class="media-zoom-btn" type="button" data-media-zoom="out" aria-label="Zoom out">−</button>
            <button class="media-zoom-btn" type="button" data-media-zoom="reset" aria-label="Reset zoom"><span data-media-zoom="percent">100%</span></button>
            <button class="media-zoom-btn" type="button" data-media-zoom="in" aria-label="Zoom in">+</button>
          </div>
          <div class="media-zoom-viewport" tabindex="0" aria-label="Zoomable image viewer">
            <div class="media-zoom-surface">
              <img class="media-img media-zoom-target" src="${App.escapeHtml(fastSrc)}" alt="Media" draggable="false" />
            </div>
          </div>
        </div>
      `;
      const imageShell = mount.querySelector(".media-zoom-shell");
      imageShell?.addEventListener("click", e => {
        if (e.target.closest(".media-zoom-controls")) return;
        const target = imageShell.querySelector(".media-zoom-target");
        if (target) {
          const r = target.getBoundingClientRect();
          const clickedInsideTarget = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
          if (clickedInsideTarget) return;
        }
        const suppressCloseUntil = Number(imageShell.dataset.mediaSuppressCloseUntil || 0);
        if (Date.now() < suppressCloseUntil) return;
        App.closeModal();
      });
      mediaZoomTeardown = initMediaZoomViewer(imageShell, zoomCfg);
      return;
    }
    const id = `vpu_${Math.random().toString(36).slice(2, 9)}`;
    mediaPlayerId = id;
    mount.innerHTML = `
      <div class="vpu" id="${id}" data-step-back="5" data-step-fwd="5" data-max-custom-speed="10" data-menu="0" data-loop="0">
        <div class="vpu-stage">
          <div class="media-zoom-shell media-zoom-shell-video">
            <div class="media-zoom-controls media-zoom-controls-video" aria-label="Video zoom controls">
              <button class="media-zoom-btn" type="button" data-media-zoom="out" aria-label="Zoom out">−</button>
              <button class="media-zoom-btn" type="button" data-media-zoom="reset" aria-label="Reset zoom"><span data-media-zoom="percent">100%</span></button>
              <button class="media-zoom-btn" type="button" data-media-zoom="in" aria-label="Zoom in">+</button>
            </div>
            <div class="media-zoom-viewport" tabindex="0" aria-label="Zoomable video viewer">
              <div class="media-zoom-surface">
                <video class="vpu-video media-zoom-target" preload="auto" playsinline>${App.videoSourceMarkup(fastSrc, mimeType)}</video>
              </div>
            </div>
          </div>
        </div>

        <div class="vpu-controls">
          <div class="vpu-row vpu-row1">
            <div class="vpu-time">0:00 / 0:00</div>
            <input class="vpu-seek" type="range" min="0" max="0" value="0" step="0.01" />
          </div>

          <div class="vpu-row vpu-row2">
            <div class="vpu-left">
              <button class="vpu-btn vpu-play" type="button" aria-label="Play/Pause">${App.svgIcon("play")}</button>
              <button class="vpu-btn vpu-back" type="button" aria-label="Back 5 seconds">${App.svgIcon("back5")}</button>
              <button class="vpu-btn vpu-fwd" type="button" aria-label="Forward 5 seconds">${App.svgIcon("fwd5")}</button>
            </div>

            <div class="vpu-mid">
              <button class="vpu-btn vpu-volbtn" type="button" aria-label="Mute/Unmute">${App.svgIcon("vol")}</button>
              <input class="vpu-volrange" type="range" min="0" max="2" value="1" step="0.05" />
              <div class="vpu-volpct">100%</div>
            </div>

            <div class="vpu-right">
              <button class="vpu-btn vpu-loop" type="button" aria-label="Loop video" aria-pressed="false">${App.svgIcon("loop")}</button>
              <button class="vpu-btn vpu-menu" type="button" aria-label="More">${App.svgIcon("menu")}</button>
              <button class="vpu-btn vpu-full" type="button" aria-label="Fullscreen">${App.svgIcon("full")}</button>
            </div>
          </div>

          <div class="vpu-pop" hidden>
            <div class="vpu-pop-head">
              <div class="vpu-pop-title">Playback speed</div>
              <div class="vpu-pop-sub">Choose a preset, or set a custom speed.</div>
            </div>
            <div class="vpu-speedwrap"></div>
            <div class="vpu-custom">
              <label class="vpu-custom-label" for="${id}_custom">Custom (up to 10×)</label>
              <input id="${id}_custom" class="vpu-speedcustom" type="number" min="0.05" max="10" step="0.05" placeholder="e.g. 3" />
            </div>
          </div>
        </div>
      </div>
    `;
    const videoKey = await App.videoKeyFor(fileName || "video.mp4", src);
    const prefs = await App.getVideoPrefs(App.currentRoomId, videoKey);
    const host = document.getElementById(id);
    if (!host) return;
    host.dataset.stepBack = String(cfg.stepBackSec);
    host.dataset.stepFwd = String(cfg.stepFwdSec);
    host.dataset.maxCustomSpeed = String(cfg.maxCustomSpeed);
    const wrap = host.querySelector(".vpu-speedwrap");
    if (wrap) {
      wrap.innerHTML = cfg.speeds.map(r => {
        const label = Math.abs(r - 1) < 1e-9 ? "1 (Normal)" : String(r);
        return `<button type="button" class="vpu-rate" data-rate="${r}">${label}</button>`;
      }).join("");
    }
    const speedCustom = host.querySelector(".vpu-speedcustom");
    if (speedCustom) {
      speedCustom.max = String(cfg.maxCustomSpeed);
      const lbl = host.querySelector(".vpu-custom-label");
      if (lbl) lbl.textContent = `Custom (up to ${cfg.maxCustomSpeed}×)`;
    }
    if (typeof prefs.muted === "boolean") host.dataset.initialMuted = prefs.muted ? "1" : "0";
    const vol = App.clampNum(prefs.volume, 0, 2, null);
    if (vol != null) host.dataset.initialVolume = String(vol);
    const rate = App.clampNum(prefs.playbackRate, 0.05, cfg.maxCustomSpeed, null);
    if (rate != null) host.dataset.initialRate = String(rate);
    const cr = App.clampNum(prefs.customRate, 0.05, cfg.maxCustomSpeed, null);
    if (cr != null) host.dataset.initialCustomRate = String(cr);else delete host.dataset.initialCustomRate;
    const td = App.initVideoPlayer(host, {
      fileName,
      videoKey,
      roomId: App.currentRoomId
    });
    App.videoPlayerTeardowns.set(id, td);
    mediaZoomTeardown = initMediaZoomViewer(host.querySelector(".media-zoom-shell"), zoomCfg);
  })();
};
App.downloadHtmlViaObjectURL = async function (dataURL, fileName) {
  let fn = String(fileName || "experience.html").trim();
  if (!/\.html?$/i.test(fn)) fn += ".html";
  let url = "";
  try {
    const resp = await fetch(dataURL);
    const b = await resp.blob();
    const blob = b.type ? b : b.slice(0, b.size, "text/html");
    url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fn;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    console.error("download html failed:", e);
    App.showToast({
      title: "Download failed",
      body: "Could not download that HTML file.",
      duration: 2200
    });
  } finally {
    if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};
App.downloadFileViaObjectURL = async function (dataURL, fileName) {
  let fn = String(fileName || "file").trim();
  if (!fn) fn = "file";
  let url = "";
  try {
    const resp = await fetch(dataURL);
    const b = await resp.blob();
    const blob = b.type ? b : b.slice(0, b.size, "application/octet-stream");
    url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fn;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    console.error("download file failed:", e);
    App.showToast({
      title: "Download failed",
      body: "Could not download that file.",
      duration: 2200
    });
  } finally {
    if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};

App.register("media/viewer", function initializeFeature() {
App.mediaModalSrcCache = new Map();
App.mediaModalSrcCacheBound = false;
});
})(globalThis.ChatApp);
