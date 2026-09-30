/* calling/quality: methods register before ordered initialization. */
(function (App) {
  "use strict";
App.makeCallSessionId = /* Chat calling: quality. Classic script; see CALLING.md. */function () {
  return `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};
App.callGetMemberByCode = function (code) {
  const id = String(code || "");
  return App.callMembersCache.find(m => String(m?.code || "") === id) || null;
};
App.callGetPeerSessionId = function (peerCode) {
  return String(App.callGetMemberByCode(peerCode)?.sessionId || "");
};
App.callSyncMenuStatusDisplay = function () {
  const roomEl = App.$("call-menu-room");
  const statusEl = App.$("call-menu-status");
  const qualityDot = App.$("call-menu-quality-dot");
  const metaEl = App.$("call-menu-meta");
  if (roomEl) {
    const roomId = App.currentCallRoomId || App.observedCallRoomId || App.currentRoomId || "";
    const roomName = roomId ? App.roomDisplayName(roomId, App.roomsMetaCache.get(roomId) || null) : "";
    roomEl.textContent = roomName || "Room";
  }
  const connectedMembers = App.callMembersCache.filter(m => m && m.connected !== false).length;
  const isReconnecting = App.callConnectionQuality.level === "reconnecting";
  const quality = App.callConnectionQuality;
  const peopleText = `${connectedMembers || 1} ${connectedMembers === 1 || connectedMembers === 0 ? "person" : "people"}`;
  const connectedStatus = quality.connecting ? "Connecting…" : quality.level === "poor" ? "Poor connection" : "Connected";
  const statusText = App.callLeavePending ? "Leaving…" : App.callJoinPending ? "Joining…" : isReconnecting ? "Reconnecting" : App.currentCallRoomId ? connectedStatus : App.callActive ? "Call in progress" : "No active call";
  if (qualityDot) {
    qualityDot.className = `call-menu-live-dot ${App.callConnectionQuality.level || "idle"}`;
    qualityDot.dataset.tooltip = App.callConnectionQuality.detail || App.callConnectionQuality.label || "Call Status";
  }
  if (statusEl) statusEl.textContent = statusText;
  if (metaEl) metaEl.textContent = peopleText;
  App.syncSidebarCallDock?.();
};
App.callReadPeerStats = async function (pc) {
  const now = Date.now();
  const interval = document.visibilityState === 'hidden' ? 12000 : App.CALL_QUALITY_POLL_MS;
  if (pc.__qualityStats && now - Number(pc.__qualityStatsAt || 0) < interval - 100) return pc.__qualityStats;
  if (pc.__qualityStatsPromise) return pc.__qualityStatsPromise;
  const run = (async () => {
    const result = {
      lossPct: 0,
      rttMs: null,
      cpuLimited: false,
      bandwidthLimited: false,
      relay: false,
      videoBitrate: 0,
      availableOutgoingBitrate: null,
      videoStreams: []
    };
    try {
      const reports = await pc.getStats();
      let lost = 0, received = 0;
      const packetSamples = new Map();
      const videoSamples = new Map();
      const selectedPairs = new Set();
      reports.forEach(report => {
        if (report.type === 'transport' && report.selectedCandidatePairId) selectedPairs.add(report.selectedCandidatePairId);
      });
      reports.forEach((report, key) => {
        const reportId = String(report.id || key);
        const kind = report.kind || report.mediaType;
        if (report.type === 'inbound-rtp' && (kind === 'audio' || kind === 'video') && !report.isRemote) {
          const sample = { lost: Number(report.packetsLost) || 0, received: Number(report.packetsReceived) || 0 };
          const previous = pc.__inboundPacketSamples?.get(reportId);
          // RTP counters belong to an SSRC, not a whole connection. Opening or
          // closing a camera must not look like a burst of lost screen packets.
          if (previous && sample.received >= previous.received) {
            lost += Math.max(0, sample.lost - previous.lost);
            received += sample.received - previous.received;
          }
          packetSamples.set(reportId, sample);
        }
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && (selectedPairs.size ? selectedPairs.has(reportId) : report.nominated || report.selected)) {
          const ms = report.currentRoundTripTime == null ? NaN : Number(report.currentRoundTripTime) * 1000;
          if (Number.isFinite(ms) && ms >= 0) result.rttMs = ms;
          const local = reports.get(report.localCandidateId);
          const remote = reports.get(report.remoteCandidateId);
          result.relay = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
          const available = Number(report.availableOutgoingBitrate);
          if (Number.isFinite(available) && available > 0) result.availableOutgoingBitrate = available;
        }
        if (report.type === 'outbound-rtp' && kind === 'video') {
          result.cpuLimited ||= report.qualityLimitationReason === 'cpu';
          result.bandwidthLimited ||= report.qualityLimitationReason === 'bandwidth';
          const sample = { bytes: Number(report.bytesSent) || 0, at: Number(report.timestamp) || 0 };
          const prev = pc.__outboundVideoSamples?.get(reportId);
          const bitrate = prev && sample.at > prev.at && sample.bytes >= prev.bytes ? 8 * (sample.bytes - prev.bytes) * 1000 / (sample.at - prev.at) : 0;
          result.videoBitrate += bitrate;
          videoSamples.set(reportId, sample);
          result.videoStreams.push({
            source: report.mid != null && report.mid === pc.__cameraTx?.mid ? 'camera' : report.mid != null && report.mid === pc.__screenTx?.mid ? 'screen' : 'video',
            width: Number(report.frameWidth) || null,
            height: Number(report.frameHeight) || null,
            framesPerSecond: Number.isFinite(report.framesPerSecond) ? report.framesPerSecond : null,
            bitrate,
            limitation: report.qualityLimitationReason || 'unknown'
          });
        }
      });
      result.lossPct = lost + received ? 100 * lost / (lost + received) : 0;
      pc.__inboundPacketSamples = packetSamples;
      pc.__outboundVideoSamples = videoSamples;
      pc.__qualityStats = result;
      pc.__qualityStatsAt = Date.now();
    } catch {
      // Transient stats failures are not proof of excellent network quality.
      if (pc.__qualityStats) return pc.__qualityStats;
    }
    return result;
  })();
  pc.__qualityStatsPromise = run;
  try {
    return await run;
  } finally {
    if (pc.__qualityStatsPromise === run) pc.__qualityStatsPromise = null;
  }
};
App.callUpdateConnectionQuality = async function () {
  if (App.callQualityUpdatePending) return;
  App.callQualityUpdatePending = true;
  const roomAtStart = App.currentCallRoomId;
  const sessionAtStart = App.callSessionId;
  try {
    if (!App.currentCallRoomId) {
      App.callConnectionQuality = {
        level: "idle",
        label: "Idle",
        detail: "Join a call to measure connection quality.",
        rttMs: null,
        lossPct: null
      };
      App.callSyncMenuStatusDisplay();
      return;
    }
    const pcs = Array.from(App.callPeerMap.values());
    if (!pcs.length) {
      App.callConnectionQuality = {
        level: "self",
        label: "Solo",
        detail: "Connected. Waiting for other participants.",
        rttMs: null,
        lossPct: null
      };
      App.callSyncMenuStatusDisplay();
      return;
    }
    let hasFailed = false;
    let hasConnecting = false;
    let totalLoss = 0;
    let totalRtt = 0;
    let rttCount = 0;
    // Each query is independent. Serial getStats delayed the status refresh by
    // every peer's IPC latency, especially while multiple encoders were busy.
    const peerStats = await Promise.all(Array.from(App.callPeerMap.entries(), async ([peerCode, pc]) => ({ peerCode, pc, stats: await App.callReadPeerStats(pc) })));
    if (App.currentCallRoomId !== roomAtStart || App.callSessionId !== sessionAtStart) return;
    for (const { peerCode, pc, stats } of peerStats) {
      if (App.callPeerMap.get(peerCode) !== pc) continue;
      const connectionState = String(pc?.connectionState || "");
      const iceConnectionState = String(pc?.iceConnectionState || "");
      const receivingAudio = !!App.callRemoteAudioEls.get(peerCode)?.srcObject;
      App.callPeerStatusCache.set(String(peerCode), {
        connectionState,
        iceConnectionState,
        receivingAudio,
        peerSessionId: String(pc?.__peerSessionId || "")
      });
      if (["failed", "closed", "disconnected"].includes(connectionState) || ["failed", "closed", "disconnected"].includes(iceConnectionState)) {
        hasFailed = true;
        continue;
      }
      if (["new", "connecting", "disconnected"].includes(connectionState) || ["new", "checking", "disconnected"].includes(iceConnectionState)) {
        hasConnecting = true;
      }
      totalLoss += Number(stats.lossPct || 0);
      if (Number.isFinite(stats.rttMs) && stats.rttMs != null) {
        totalRtt += stats.rttMs;
        rttCount += 1;
      }
    }
    if (App.currentCallRoomId !== roomAtStart || App.callSessionId !== sessionAtStart) return;
    const avgLoss = pcs.length ? totalLoss / pcs.length : 0;
    const avgRtt = rttCount ? totalRtt / rttCount : null;
    let level = "excellent";
    let label = "Excellent";
    if (hasFailed) {
      level = "reconnecting";
      label = "Reconnecting";
    } else if (hasConnecting) {
      level = "fair";
      label = "Stabilizing";
    } else if (avgLoss >= 10 || avgRtt != null && avgRtt >= 350) {
      level = "poor";
      label = "Poor";
    } else if (avgLoss >= 4 || avgRtt != null && avgRtt >= 220) {
      level = "fair";
      label = "Fair";
    } else if (avgLoss >= 1.5 || avgRtt != null && avgRtt >= 120) {
      level = "good";
      label = "Good";
    }
    const detailBits = [];
    if (avgRtt != null) detailBits.push(`${Math.round(avgRtt)} ms RTT`);
    if (avgLoss > 0) detailBits.push(`${avgLoss.toFixed(1)}% loss`);
    App.callConnectionQuality = {
      level,
      label,
      detail: hasFailed ? "Recovering the media connection." : hasConnecting ? "Establishing participant media connections." : detailBits.length ? detailBits.join(" • ") : "Media paths look stable.",
      connecting: hasConnecting && !hasFailed,
      rttMs: avgRtt,
      lossPct: avgLoss
    };
    App.callSyncMenuStatusDisplay();
    App.callScheduleMediaBudget();
  } finally {
    App.callQualityUpdatePending = false;
  }
};
App.callStartQualityMonitor = function () {
  App.callStopQualityMonitor();
  App.callQualityTimer = setInterval(() => {
    void App.callUpdateConnectionQuality();
  }, App.CALL_QUALITY_POLL_MS);
  void App.callUpdateConnectionQuality();
};
App.callStopQualityMonitor = function () {
  if (App.callQualityTimer) {
    try {
      clearInterval(App.callQualityTimer);
    } catch {}
  }
  App.callQualityTimer = null;
  App.callConnectionQuality = {
    level: "idle",
    label: "Idle",
    detail: "Join a call to measure connection quality.",
    rttMs: null,
    lossPct: null
  };
  App.callSyncMenuStatusDisplay();
};

App.register("calling/quality", function initializeFeature() {

});
})(globalThis.ChatApp);

