/* schedules/presence: methods register before ordered initialization. */
(function (App) {
  "use strict";
App.isUserViewingSchedules = function (user) {
  const code = String(user?.code || user?.userCode || "").trim();
  return !!(code && App.scheduleViewerCodes.has(code));
};
App.applyScheduleViewersSnapshot = function (raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const cutoff = App.accurateNowMs() - App.SCHEDULE_VIEWER_STALE_MS;
  const next = new Set();
  for (const [code, sessionsRaw] of Object.entries(source)) {
    if (!code || !sessionsRaw || typeof sessionsRaw !== "object") continue;
    const sessions = Object.values(sessionsRaw);
    if (sessions.some(session => {
      const updatedAt = Number(session?.updatedAt || 0);
      return session && typeof session === "object" && session.viewing === true && updatedAt >= cutoff;
    })) next.add(code);
  }
  const changed = new Set([...App.scheduleViewerCodes, ...next].filter(code => App.scheduleViewerCodes.has(code) !== next.has(code)));
  App.scheduleViewerCodes = next;
  if (!changed.size) return;
  try {
    App.renderOnlineIndicator();
  } catch {}
  if (App.userProfileOpen && changed.has(String(App.userProfilePinnedCode || ""))) {
    try {
      App.refreshOpenUserProfileCard();
    } catch {}
  }
};
App.startScheduleViewersListener = function () {
  if (App.scheduleViewersRef) return;
  const ref = App.db.ref(App.SCHEDULE_VIEWERS_NODE);
  const cb = snap => {
    App.scheduleViewersSnapshot = snap.val() && typeof snap.val() === "object" ? snap.val() : {};
    App.applyScheduleViewersSnapshot(App.scheduleViewersSnapshot);
  };
  ref.on("value", cb);
  App.scheduleViewersRef = ref;
  App.scheduleViewersCb = cb;
  App.scheduleViewersExpiryTimer = setInterval(() => {
    App.applyScheduleViewersSnapshot(App.scheduleViewersSnapshot);
  }, 30000);
};
App.stopScheduleViewersListener = function () {
  if (App.scheduleViewersRef && App.scheduleViewersCb) {
    try {
      App.scheduleViewersRef.off("value", App.scheduleViewersCb);
    } catch {}
  }
  App.scheduleViewersRef = null;
  App.scheduleViewersCb = null;
  if (App.scheduleViewersExpiryTimer) clearInterval(App.scheduleViewersExpiryTimer);
  App.scheduleViewersExpiryTimer = 0;
  App.scheduleViewersSnapshot = {};
  App.scheduleViewerCodes = new Set();
};
App.stopMySchedulePresenceHeartbeat = function () {
  if (App.mySchedulePresenceHeartbeat) clearInterval(App.mySchedulePresenceHeartbeat);
  App.mySchedulePresenceHeartbeat = 0;
};
App.detachMySchedulePresenceConnection = function () {
  if (App.mySchedulePresenceConnRef && App.mySchedulePresenceConnCb) {
    try {
      App.mySchedulePresenceConnRef.off("value", App.mySchedulePresenceConnCb);
    } catch {}
  }
  App.mySchedulePresenceConnRef = null;
  App.mySchedulePresenceConnCb = null;
};
App.writeMySchedulePresence = async function (token = App.mySchedulePresenceToken) {
  const ref = App.mySchedulePresenceRef;
  if (!ref || !App.mySchedulePresenceDesired || token !== App.mySchedulePresenceToken) return;
  let disconnectArmed = false;
  try {
    await ref.onDisconnect().remove();
    disconnectArmed = true;
  } catch {}
  if (!disconnectArmed) return;
  if (!App.mySchedulePresenceDesired || token !== App.mySchedulePresenceToken || ref !== App.mySchedulePresenceRef) return;
  try {
    await ref.set({
      viewing: true,
      sessionId: App.CLIENT_INSTANCE_ID,
      updatedAt: App.firebase.database.ServerValue.TIMESTAMP
    });
  } catch {}
};
App.removeMySchedulePresenceRef = async function (ref, timeoutMs = 1200) {
  if (!ref) return false;
  const removed = await Promise.race([Promise.resolve().then(() => ref.remove()).then(() => true).catch(() => false), App.sleep(timeoutMs).then(() => false)]);
  if (removed) {
    // The tokenized path is never reused, so disconnect cleanup can remain
    // armed if this acknowledgement is slow or the connection drops.
    try {
      void ref.onDisconnect().cancel().catch(() => {});
    } catch {}
  }
  return removed;
};
App.syncMySchedulePresence = async function (viewing) {
  const desired = !!viewing && !!App.currentUser?.code;
  if (desired && App.mySchedulePresenceDesired && App.mySchedulePresenceRef) {
    await App.writeMySchedulePresence(App.mySchedulePresenceToken);
    return;
  }
  const token = ++App.mySchedulePresenceToken;
  App.mySchedulePresenceDesired = desired;
  if (!desired) {
    App.stopMySchedulePresenceHeartbeat();
    App.detachMySchedulePresenceConnection();
    const oldRef = App.mySchedulePresenceRef;
    App.mySchedulePresenceRef = null;
    if (oldRef) await App.removeMySchedulePresenceRef(oldRef);
    return;
  }
  const nextRef = App.db.ref(`${App.SCHEDULE_VIEWERS_NODE}/${App.currentUser.code}/${App.CLIENT_INSTANCE_ID}_${token}`);
  if (App.mySchedulePresenceRef && App.mySchedulePresenceRef.toString() !== nextRef.toString()) {
    const oldRef = App.mySchedulePresenceRef;
    await App.removeMySchedulePresenceRef(oldRef);
  }
  if (!App.mySchedulePresenceDesired || token !== App.mySchedulePresenceToken) return;
  App.mySchedulePresenceRef = nextRef;
  App.detachMySchedulePresenceConnection();
  const connRef = App.db.ref(".info/connected");
  const connCb = snap => {
    if (snap.val() === true && App.mySchedulePresenceDesired && token === App.mySchedulePresenceToken) {
      void App.writeMySchedulePresence(token);
    }
  };
  connRef.on("value", connCb);
  App.mySchedulePresenceConnRef = connRef;
  App.mySchedulePresenceConnCb = connCb;
  App.stopMySchedulePresenceHeartbeat();
  App.mySchedulePresenceHeartbeat = setInterval(() => {
    if (!App.mySchedulePresenceDesired || token !== App.mySchedulePresenceToken || !App.mySchedulePresenceRef) return;
    void App.writeMySchedulePresence(token);
  }, 45000);
  await App.writeMySchedulePresence(token);
};
App.suspendMySchedulePresenceForPageHide = function () {
  ++App.mySchedulePresenceToken;
  App.mySchedulePresenceDesired = false;
  App.stopMySchedulePresenceHeartbeat();
  App.detachMySchedulePresenceConnection();
  const oldRef = App.mySchedulePresenceRef;
  App.mySchedulePresenceRef = null;
  if (oldRef) void App.removeMySchedulePresenceRef(oldRef, 300);
};
App.openTempHtmlUploadPicker = function () {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".html,.htm,text/html";
  input.style.display = "none";
  document.body.appendChild(input);
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (file) await App.openUnsavedHtmlFile(file);
    try {
      input.remove();
    } catch {}
  }, {
    once: true
  });
  input.click();
};

App.register("schedules/presence", function initializeFeature() {
App.SCHEDULE_VIEWERS_NODE = "scheduleViewers";
App.SCHEDULE_VIEWER_STALE_MS = 150000;
App.scheduleViewerCodes = new Set();
App.scheduleViewersSnapshot = {};
App.scheduleViewersRef = null;
App.scheduleViewersCb = null;
App.scheduleViewersExpiryTimer = 0;
App.mySchedulePresenceRef = null;
App.mySchedulePresenceConnRef = null;
App.mySchedulePresenceConnCb = null;
App.mySchedulePresenceHeartbeat = 0;
App.mySchedulePresenceDesired = false;
App.mySchedulePresenceToken = 0;
window.addEventListener("pagehide", App.suspendMySchedulePresenceForPageHide, {
  capture: true
});
window.addEventListener("pageshow", () => {
  if (App.currentUser && (App.getStoredPlace() || "") === "schedules") void App.syncMySchedulePresence(true);
});
});
})(globalThis.ChatApp);
