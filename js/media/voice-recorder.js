/* media/voice-recorder: methods register before ordered initialization. */
(function (App) {
  "use strict";
App.canUseVoiceComposer = function () {
  const placeNow = App.getStoredPlace() || "home";
  return !!(App.currentUser && App.currentRoomId && placeNow.startsWith("room:") && App.views.chat.dataset.active === "true");
};
App.getBestVoiceMimeType = function () {
  const candidates = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/ogg", "audio/mp4"];
  for (const mime of candidates) {
    try {
      if (globalThis.MediaRecorder?.isTypeSupported?.(mime)) return mime;
    } catch {}
  }
  return "";
};
App.getVoiceFileExtension = function (mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mp4")) return "m4a";
  return "webm";
};
App.formatVoiceComposerTime = function (totalMs) {
  const totalSec = Math.max(0, Math.floor((Number(totalMs) || 0) / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
};
App.getVoiceRecordingElapsedMs = function () {
  if (!App.voiceRecordingStartAt) return App.voiceRecordingElapsedBeforePause;
  if (App.voiceRecordingPaused) return App.voiceRecordingElapsedBeforePause;
  return App.voiceRecordingElapsedBeforePause + Math.max(0, Date.now() - App.voiceRecordingStartAt);
};
App.getVoicePreviewAudio = function () {
  return App.$("voice-preview-audio");
};
App.stopVoicePreviewPlayback = function ({
  resetTime = false
} = {}) {
  const audio = App.getVoicePreviewAudio();
  if (!audio) return;
  try {
    audio.pause();
  } catch {}
  if (resetTime) {
    try {
      audio.currentTime = 0;
    } catch {}
  }
};
App.revokeVoicePreviewUrl = function () {
  if (!App.voicePreviewUrl) return;
  try {
    URL.revokeObjectURL(App.voicePreviewUrl);
  } catch {}
  App.voicePreviewUrl = "";
};
App.syncVoicePreviewMedia = function () {
  const audio = App.getVoicePreviewAudio();
  if (!audio) return;
  if (App.voicePreviewUrl) {
    if (audio.src !== App.voicePreviewUrl) audio.src = App.voicePreviewUrl;
    audio.hidden = true;
  } else {
    App.stopVoicePreviewPlayback({
      resetTime: true
    });
    audio.removeAttribute("src");
    try {
      audio.load();
    } catch {}
    audio.hidden = true;
  }
};
App.clearVoicePreview = function ({
  keepUi = false
} = {}) {
  App.stopVoicePreviewPlayback({
    resetTime: true
  });
  App.voicePreviewBlob = null;
  App.voicePreviewMimeType = "";
  App.voicePreviewFile = null;
  App.revokeVoicePreviewUrl();
  App.syncVoicePreviewMedia();
  if (!keepUi) App.syncVoicePopoverUI();
};
App.getVoicePreviewFile = function () {
  if (App.voicePreviewFile instanceof File) return App.voicePreviewFile;
  if (!(App.voicePreviewBlob instanceof Blob)) return null;
  const mime = String(App.voicePreviewMimeType || App.voicePreviewBlob.type || "audio/webm");
  const ext = App.getVoiceFileExtension(mime);
  App.voicePreviewFile = new File([App.voicePreviewBlob], `voice-message-${Date.now()}.${ext}`, {
    type: mime
  });
  return App.voicePreviewFile;
};
App.stopVoiceRecordingTimer = function () {
  if (App.voiceRecordingTimer) {
    clearInterval(App.voiceRecordingTimer);
    App.voiceRecordingTimer = 0;
  }
};
App.startVoiceRecordingTimer = function () {
  App.stopVoiceRecordingTimer();
  App.voiceRecordingTimer = setInterval(() => {
    App.syncVoicePopoverUI();
  }, 120);
};
App.resetVoiceRecorderState = function ({
  keepStream = false
} = {}) {
  App.stopVoiceRecordingTimer();
  App.voiceRecorder = null;
  App.voiceRecorderChunks = [];
  App.voiceRecordingStartAt = 0;
  App.voiceRecordingElapsedBeforePause = 0;
  App.voiceRecordingPaused = false;
  App.voiceRecorderStopMode = "preview";
  if (!keepStream && App.voiceRecorderStream) {
    try {
      App.voiceRecorderStream.getTracks().forEach(track => track.stop());
    } catch {}
    App.voiceRecorderStream = null;
  }
};
App.ensureVoiceRecorderStream = async function () {
  if (App.voiceRecorderStream) return App.voiceRecorderStream;
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is not supported in this browser.");
  }
  return navigator.mediaDevices.getUserMedia({
    audio: true
  });
};
App.syncVoicePopoverUI = function () {
  const pop = App.$("voice-popover");
  const preview = App.$("voice-preview-time");
  const state = App.$("voice-state-text");
  const pauseBtn = App.$("btn-voice-pause");
  const stopBtn = App.$("btn-voice-stop");
  const startBtn = App.$("btn-voice-start");
  const uploadBtn = App.$("btn-voice-upload");
  const clearBtn = App.$("btn-voice-clear");
  const previewAudio = App.getVoicePreviewAudio();
  const previewPlayer = App.$("voice-preview-player");
  const previewPlay = App.$("btn-voice-preview-play");
  const previewSeek = App.$("voice-preview-seek");
  const previewDuration = App.$("voice-preview-duration");
  const countEl = App.$("voice-count");
  const hasRecorder = !!App.voiceRecorder;
  const hasPreview = !!App.voicePreviewBlob;
  const overLimit = App.countPendingVoiceMessages() >= 3;
  const previewMs = (() => {
    if (hasRecorder) return App.getVoiceRecordingElapsedMs();
    if (previewAudio) {
      const dur = Number(previewAudio.duration);
      if (Number.isFinite(dur) && dur > 0) return dur * 1000;
    }
    return 0;
  })();
  if (pop) {
    pop.dataset.recording = hasRecorder && !App.voiceRecordingPaused ? "1" : "0";
    pop.dataset.paused = hasRecorder && App.voiceRecordingPaused ? "1" : "0";
    pop.dataset.hasPreview = hasPreview ? "1" : "0";
  }
  if (preview) preview.textContent = App.formatVoiceComposerTime(previewMs);
  if (state) {
    state.textContent = hasRecorder ? App.voiceRecordingPaused ? "Paused" : "Recording…" : hasPreview ? "Preview ready" : "Ready to record";
  }
  if (startBtn) {
    startBtn.hidden = hasRecorder;
    startBtn.disabled = overLimit;
    startBtn.textContent = hasPreview ? "Record Again" : "Start Recording";
  }
  if (uploadBtn) {
    uploadBtn.disabled = overLimit || hasRecorder;
  }
  if (pauseBtn) {
    pauseBtn.hidden = !hasRecorder;
    pauseBtn.disabled = !hasRecorder;
    pauseBtn.textContent = App.voiceRecordingPaused ? "Resume" : "Pause";
  }
  if (stopBtn) {
    stopBtn.hidden = !hasRecorder && !hasPreview;
    stopBtn.disabled = hasRecorder ? false : !hasPreview || overLimit;
    stopBtn.textContent = hasRecorder ? "Stop Recording" : "Attach Clip";
  }
  if (clearBtn) {
    clearBtn.hidden = !hasRecorder && !hasPreview;
    clearBtn.disabled = false;
    clearBtn.textContent = hasRecorder ? "Cancel" : "Discard";
  }
  if (previewAudio) {
    previewAudio.hidden = true;
  }
  if (previewPlayer) previewPlayer.hidden = !hasPreview;
  if (previewPlay && previewAudio) {
    const playing = hasPreview && !previewAudio.paused && !previewAudio.ended;
    previewPlay.setAttribute("aria-label", playing ? "Pause voice preview" : "Play voice preview");
    previewPlay.innerHTML = playing ? `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 7v10M16 7v10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>` : `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 7.5v9l7-4.5-7-4.5Z" fill="currentColor"/></svg>`;
  }
  if (previewAudio && previewSeek instanceof HTMLInputElement) {
    const duration = Number.isFinite(previewAudio.duration) ? Math.max(0, previewAudio.duration) : 0;
    const current = Number.isFinite(previewAudio.currentTime) ? Math.max(0, previewAudio.currentTime) : 0;
    previewSeek.max = String(duration);
    if (!previewSeek.matches(":active")) previewSeek.value = String(Math.min(current, duration));
    if (previewDuration) previewDuration.textContent = `${App.formatVoiceComposerTime(current * 1000)} / ${App.formatVoiceComposerTime(duration * 1000)}`;
  }
  if (countEl) countEl.textContent = `${App.countPendingVoiceMessages()} / 3 attached`;
};
App.addVoiceMessageFile = async function (file) {
  if (!file) return false;
  if (App.countPendingVoiceMessages() >= 3) {
    App.showToast({
      title: "Max voice messages",
      body: "You can attach up to 3 voice messages per message.",
      duration: 2400
    });
    return false;
  }
  const added = await App.addPendingFile(file, {
    isVoiceMessage: true,
    displayName: "Voice Message",
    voiceTrimStartSec: 0
  });
  if (!added) return false;
  App.renderFilesBar();
  App.syncChatOverlayMetrics();
  return true;
};
App.sendVoicePreviewToComposer = async function () {
  const file = App.getVoicePreviewFile();
  if (!file) return;
  App.stopVoicePreviewPlayback({
    resetTime: true
  });
  const added = await App.addVoiceMessageFile(file);
  if (!added) return;
  App.clearVoicePreview({
    keepUi: true
  });
  App.syncVoicePopoverUI();
  App.closeVoicePopover({
    keepRecorder: false
  });
};
App.startVoiceRecording = async function () {
  if (!App.canUseVoiceComposer()) return;
  if (App.voiceRecorder) return;
  if (App.countPendingVoiceMessages() >= 3) {
    App.showToast({
      title: "Max voice messages",
      body: "You can attach up to 3 voice messages per message.",
      duration: 2400
    });
    return;
  }
  const requestToken = ++App.voiceRecorderRequestToken;
  try {
    App.stopVoicePreviewPlayback({
      resetTime: true
    });
    App.clearVoicePreview({
      keepUi: true
    });
    const stream = await App.ensureVoiceRecorderStream();
    if (requestToken !== App.voiceRecorderRequestToken || !App.voicePopoverOpen || !App.canUseVoiceComposer()) {
      try {
        stream.getTracks().forEach(track => track.stop());
      } catch {}
      if (App.voiceRecorderStream === stream) App.voiceRecorderStream = null;
      return;
    }
    App.voiceRecorderStream = stream;
    const mimeType = App.getBestVoiceMimeType();
    App.voiceRecorderChunks = [];
    App.voiceRecordingElapsedBeforePause = 0;
    App.voiceRecordingStartAt = Date.now();
    App.voiceRecordingPaused = false;
    App.voiceRecorderStopMode = "preview";
    const recorder = mimeType ? new MediaRecorder(stream, {
      mimeType
    }) : new MediaRecorder(stream);
    App.voiceRecorder = recorder;
    recorder.addEventListener("dataavailable", e => {
      if (e.data && e.data.size > 0) App.voiceRecorderChunks.push(e.data);
    });
    recorder.addEventListener("stop", () => {
      const shouldSavePreview = App.voiceRecorderStopMode !== "discard";
      const mime = String(recorder.mimeType || mimeType || "audio/webm");
      const chunks = App.voiceRecorderChunks.slice();
      App.resetVoiceRecorderState({
        keepStream: false
      });
      if (shouldSavePreview && chunks.length) {
        try {
          App.voicePreviewBlob = new Blob(chunks, {
            type: mime
          });
          App.voicePreviewMimeType = mime;
          App.voicePreviewFile = null;
          App.revokeVoicePreviewUrl();
          App.voicePreviewUrl = URL.createObjectURL(App.voicePreviewBlob);
          App.syncVoicePreviewMedia();
        } catch (e) {
          console.error("voice preview build failed:", e);
          App.clearVoicePreview({
            keepUi: true
          });
          App.showToast({
            title: "Voice message failed",
            body: "Couldn’t prepare the preview.",
            duration: 2400
          });
        }
      } else {
        App.clearVoicePreview({
          keepUi: true
        });
      }
      App.syncVoicePopoverUI();
    });
    recorder.start(250);
    App.syncVoicePreviewMedia();
    App.startVoiceRecordingTimer();
    App.syncVoicePopoverUI();
  } catch (e) {
    if (requestToken !== App.voiceRecorderRequestToken) return;
    console.error("voice recording start failed:", e);
    App.resetVoiceRecorderState({
      keepStream: false
    });
    App.clearVoicePreview({
      keepUi: true
    });
    App.syncVoicePopoverUI();
    App.showToast({
      title: "Microphone unavailable",
      body: "Allow microphone access and try again.",
      duration: 2800
    });
  }
};
App.toggleVoiceRecordingPause = function () {
  if (!App.voiceRecorder) return;
  try {
    if (App.voiceRecorder.state === "recording") {
      App.voiceRecordingElapsedBeforePause = App.getVoiceRecordingElapsedMs();
      try {
        App.voiceRecorder.requestData?.();
      } catch {}
      App.voiceRecordingPaused = true;
      App.voiceRecorder.pause();
    } else if (App.voiceRecorder.state === "paused") {
      App.voiceRecordingStartAt = Date.now();
      App.voiceRecordingPaused = false;
      App.voiceRecorder.resume();
    }
  } catch {}
  App.syncVoicePopoverUI();
};
App.finishVoiceRecording = function ({
  savePreview = true
} = {}) {
  if (!App.voiceRecorder) return;
  App.voiceRecorderStopMode = savePreview ? "preview" : "discard";
  try {
    if (App.voiceRecorder.state !== "inactive") App.voiceRecorder.stop();
  } catch (e) {
    console.error("voice recording stop failed:", e);
    App.resetVoiceRecorderState({
      keepStream: false
    });
    if (!savePreview) App.clearVoicePreview({
      keepUi: true
    });
    App.syncVoicePopoverUI();
    App.showToast({
      title: "Voice message failed",
      body: "Couldn’t finish the recording.",
      duration: 2400
    });
  }
};
App.clearVoiceRecordingDraft = function () {
  if (App.voiceRecorder) {
    App.finishVoiceRecording({
      savePreview: false
    });
    return;
  }
  App.clearVoicePreview();
};
App.closeVoicePopover = function ({
  keepRecorder = true
} = {}) {
  const pop = App.$("voice-popover");
  if (!pop) return;
  App.voiceRecorderRequestToken += 1;
  App.$("btn-voice")?.setAttribute("aria-expanded", "false");
  if (pop.hidden) {
    if (!keepRecorder && App.voiceRecorder) App.finishVoiceRecording({
      savePreview: false
    });
    return;
  }
  App.stopVoicePreviewPlayback({
    resetTime: false
  });
  pop.classList.remove("open");
  pop.classList.add("closing");
  const closeToken = ++App.voicePopoverCloseToken;
  const finish = () => {
    if (closeToken !== App.voicePopoverCloseToken) return;
    pop.hidden = true;
    pop.classList.remove("closing");
    App.voicePopoverOpen = false;
  };
  setTimeout(finish, 200);
  if (!keepRecorder && App.voiceRecorder) {
    App.finishVoiceRecording({
      savePreview: false
    });
  }
};
App.bindVoicePopoverOnce = function () {
  if (App.voiceRecorderBound) return;
  App.voiceRecorderBound = true;
  App.voiceUploadInputEl = document.createElement("input");
  App.voiceUploadInputEl.type = "file";
  App.voiceUploadInputEl.accept = "audio/*";
  App.voiceUploadInputEl.hidden = true;
  document.body.appendChild(App.voiceUploadInputEl);
  App.voiceUploadInputEl.addEventListener("change", async () => {
    const file = App.voiceUploadInputEl.files?.[0];
    App.voiceUploadInputEl.value = "";
    if (!file) return;
    await App.addVoiceMessageFile(file);
    App.closeVoicePopover();
  });
  const previewAudio = App.getVoicePreviewAudio();
  if (previewAudio && previewAudio.dataset.bound !== "1") {
    previewAudio.dataset.bound = "1";
    previewAudio.addEventListener("loadedmetadata", App.syncVoicePopoverUI);
    previewAudio.addEventListener("durationchange", App.syncVoicePopoverUI);
    previewAudio.addEventListener("timeupdate", App.syncVoicePopoverUI);
    previewAudio.addEventListener("play", App.syncVoicePopoverUI);
    previewAudio.addEventListener("pause", App.syncVoicePopoverUI);
    previewAudio.addEventListener("ended", App.syncVoicePopoverUI);
  }
  App.$("btn-voice-preview-play")?.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    const audio = App.getVoicePreviewAudio();
    if (!audio || !App.voicePreviewBlob) return;
    if (audio.paused || audio.ended) {
      if (audio.ended) audio.currentTime = 0;
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
    App.syncVoicePopoverUI();
  });
  App.$("voice-preview-seek")?.addEventListener("input", e => {
    e.stopPropagation();
    const audio = App.getVoicePreviewAudio();
    if (!audio) return;
    const next = Number(e.currentTarget?.value);
    if (Number.isFinite(next)) audio.currentTime = next;
    App.syncVoicePopoverUI();
  });
  App.$("btn-voice-close")?.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    App.closeVoicePopover({
      keepRecorder: false
    });
  });
  App.$("btn-voice-start")?.addEventListener("click", async e => {
    e.preventDefault();
    e.stopPropagation();
    await App.startVoiceRecording();
  });
  App.$("btn-voice-pause")?.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    App.toggleVoiceRecordingPause();
  });
  App.$("btn-voice-stop")?.addEventListener("click", async e => {
    e.preventDefault();
    e.stopPropagation();
    if (App.voiceRecorder) {
      App.finishVoiceRecording({
        savePreview: true
      });
      return;
    }
    await App.sendVoicePreviewToComposer();
  });
  App.$("btn-voice-clear")?.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    App.clearVoiceRecordingDraft();
  });
  App.$("btn-voice-upload")?.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    if (App.countPendingVoiceMessages() >= 3) {
      App.showToast({
        title: "Max voice messages",
        body: "You can attach up to 3 voice messages per message.",
        duration: 2400
      });
      return;
    }
    App.voiceUploadInputEl?.click();
  });
};
App.openVoicePopover = function () {
  const pop = App.$("voice-popover");
  if (!pop) return;
  App.closeRoomActivitiesMenu?.();
  App.closeEmojiPopover?.();
  App.closeStickerPopover?.({ immediate:true });
  App.closeComposerMoreMenu?.({ immediate:true });
  App.bindVoicePopoverOnce();
  App.voicePopoverCloseToken += 1;
  App.syncVoicePreviewMedia();
  pop.hidden = false;
  pop.classList.remove("closing");
  requestAnimationFrame(() => pop.classList.add("open"));
  App.voicePopoverOpen = true;
  App.layoutChatPopovers?.();
  App.$("btn-voice")?.setAttribute("aria-expanded", "true");
  App.syncVoicePopoverUI();
};
App.toggleVoicePopover = function () {
  if (!App.canUseVoiceComposer()) {
    App.showToast({
      title: "Pick a room",
      body: "Create or join a room first.",
      duration: 2200
    });
    return;
  }
  if (App.voicePopoverOpen) App.closeVoicePopover({
    keepRecorder: false
  });else App.openVoicePopover();
};

App.register("media/voice-recorder", function initializeFeature() {
App.voicePopoverOpen = false;
App.voicePopoverCloseToken = 0;
App.voiceRecorderRequestToken = 0;
App.voiceRecorderBound = false;
App.voiceRecorder = null;
App.voiceRecorderStream = null;
App.voiceRecorderChunks = [];
App.voiceRecordingStartAt = 0;
App.voiceRecordingElapsedBeforePause = 0;
App.voiceRecordingTimer = 0;
App.voiceRecordingPaused = false;
App.voiceUploadInputEl = null;
App.voicePreviewBlob = null;
App.voicePreviewMimeType = "";
App.voicePreviewFile = null;
App.voicePreviewUrl = "";
App.voiceRecorderStopMode = "preview";
App.syncEmojiButtonVisibility();
});
})(globalThis.ChatApp);
