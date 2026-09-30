/* calling/policy: methods register before ordered initialization. */
(function (App) {
  "use strict";


App.register("calling/policy", function initializeFeature() {
/* Pure call policy, shared by runtime and offline regression tests. */
(function (root) {
  'use strict';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || min));
  function mediaBudget({
    subscribers = 1
  } = {}) {
    const viewers = clamp(subscribers, 1, 32);
    // Each subscribed path keeps the same 720p30 target. Dividing a fixed
    // aggregate budget by the audience made quality fall solely because people
    // joined. Congestion control can still adapt to each receiver's actual path;
    // a CPU/bandwidth sample from one encoder must not lower shared capture.
    const videoBitrate = 4000000;
    return {
      audioBitrate: 48000,
      screenAudioBitrate: 128000,
      videoBitrate,
      maxFramerate: 30,
      width: 1280,
      height: 720,
      totalVideoBudget: videoBitrate * viewers
    };
  }
  function wantsScreen(member, owner, shareId) {
    return !!(member && member.connected !== false && shareId && member.viewingSharesSessionId === member.sessionId && member.viewingShares?.[owner] === shareId);
  }
  function packetDelta(previous, current) {
    if (!previous || current.received < previous.received || current.lost < previous.lost) return 0;
    const lost = Math.max(0, current.lost - previous.lost);
    const received = Math.max(0, current.received - previous.received);
    return lost + received > 0 ? 100 * lost / (lost + received) : 0;
  }
  function isConnected(pc) {
    if (!pc || ['failed', 'closed', 'disconnected'].includes(pc.connectionState) || ['failed', 'closed', 'disconnected'].includes(pc.iceConnectionState)) return false;
    return pc?.connectionState === 'connected' || ['connected', 'completed'].includes(pc?.iceConnectionState);
  }
  function memberLastSeen(member) {
    if (member?.connected === false && Number(member.disconnectedAt) > 0) return Number(member.disconnectedAt);
    return Math.max(0, ...['disconnectedAt', 'lastSeenAt', 'updatedAt', 'joinedAt'].map(key => Number(member?.[key]) || 0));
  }
  function keepMember(member, pc, now, graceMs, heartbeatMs = 120000) {
    if (!member?.sessionId) return false;
    if (String(member.departedSessionId || '') === String(member.sessionId)) return false;
    if (pc && pc.__peerSessionId === member.sessionId && isConnected(pc)) return true;
    const last = memberLastSeen(member);
    // Missing legacy timestamps do not invalidate an otherwise live member.
    if (member.connected !== false) return !last || now - last <= heartbeatMs;
    // A confirmed signaling disconnect with no live media is already a
    // departure. The old extra 45-second grace left closed clients visible.
    return false;
  }
  function shouldCleanupMember(member, pc, now, graceMs = 45000, heartbeatMs = 120000) {
    if (!member?.sessionId) return false;
    if (String(member.departedSessionId || '') === String(member.sessionId)) return true;
    if (pc && pc.__peerSessionId === member.sessionId && isConnected(pc)) return false;
    const last = memberLastSeen(member);
    // Observers outside the call cannot know whether media still flows between
    // participants. Hide a disconnected tile immediately, but preserve shared
    // membership/SDP through the signaling reconnect grace period.
    return last > 0 && now - last > (member.connected === false ? graceMs : heartbeatMs);
  }
  function recoveryDelay(attempt, polite = false) {
    return Math.min(30000, 4000 * Math.pow(2, Math.max(0, attempt - 1))) + (polite ? 650 : 0);
  }
  const api = Object.freeze({
    mediaBudget,
    wantsScreen,
    packetDelta,
    isConnected,
    memberLastSeen,
    keepMember,
    shouldCleanupMember,
    recoveryDelay
  });
  root.ChatCallPolicy = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);

/* Deployment-owned, fresh ICE credentials. No embedded third-party password. */
});
})(globalThis.ChatApp);
