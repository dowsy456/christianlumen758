/* schedules/render: methods register before ordered initialization. */
(function (App) {
  "use strict";
App._timeToMinutes = function (t) {
  const m = String(t || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ap = m[3].toUpperCase();
  if (hh === 12) hh = 0;
  if (ap === "PM") hh += 12;
  return hh * 60 + mm;
};
App._parseRangeMinutes = function (range) {
  const s = String(range || "").trim();
  const m = s.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))\s*[-–—]\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
  if (!m) return null;
  const a = App._timeToMinutes(m[1]);
  const b = App._timeToMinutes(m[2]);
  if (a === null || b === null) return null;
  return {
    start: a,
    end: b
  };
};
App._getActiveScheduleBlockKey = function (dayType, person) {
  const times = App.SCHEDULE_TIMES[App._normalizeScheduleType(dayType)] || {};
  const p = App.getESTParts(App.getAccurateNow());
  const weekdayIndex = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  if (weekdayIndex === 0 || weekdayIndex === 6) return null;
  const now = p.hour * 60 + p.minute + p.second / 60;
  for (const b of App.SCHEDULE_BLOCKS) {
    const r = App._parseRangeMinutes(times?.[b.key]?.time || "");
    if (!r) continue;
    if (now >= r.start && now < r.end) return b.key;
  }
  return null;
};
App.applySchedulesActiveHighlight = function () {
  if (!App.messagesListEl) return;
  if (App.getStoredPlace() !== "schedules") return;
  if (!App.schedulesState.previewManual) {
    const automaticDay = App.getESTScheduleDay();
    if (automaticDay !== App.schedulesState.lastAutoDay) {
      App.scheduleRenderSchedulesUI();
      return;
    }
  }
  const dayType = App.schedulesState.dayType || "full";
  const active = App._getActiveScheduleBlockKey(dayType, App.schedulesState.person);
  App.messagesListEl.querySelectorAll(".sched-grid-row[data-sched-block]").forEach(row => {
    const k = row.getAttribute("data-sched-block");
    row.classList.toggle("is-active", !!active && k === active);
  });
  App.messagesListEl.querySelectorAll(".sched-times-row[data-sched-block]").forEach(row => {
    const k = row.getAttribute("data-sched-block");
    row.classList.toggle("is-active", !!active && k === active);
  });
};
App.startSchedulesHighlightTimer = function () {
  if (App.schedulesHighlightTimer) return;
  App.schedulesHighlightTimer = setInterval(() => {
    if (document.visibilityState === "hidden" || App.getStoredPlace() !== "schedules") return;
    App.applySchedulesActiveHighlight();
  }, 1000);
};
App.stopSchedulesHighlightTimer = function () {
  if (App.schedulesHighlightTimer) {
    clearInterval(App.schedulesHighlightTimer);
    App.schedulesHighlightTimer = null;
  }
  App.hideScheduleClassmatesFloating({
    immediate: true
  });
};
App.scheduleRenderSchedulesUI = function () {
  if (App.schedulesRenderRaf) return;
  App.schedulesRenderRaf = requestAnimationFrame(() => {
    App.schedulesRenderRaf = 0;
    if ((App.getStoredPlace() || "") !== "schedules") return;
    App.renderSchedulesUI();
  });
};
App._schedVal = function (v) {
  const s = String(v ?? "").trim();
  return s ? App.escapeHtml(s) : "";
};
App._renderScheduleTimesCard = function (dayType, person = null) {
  const schedulePerson = App._resolveSchedulePersonKey(dayType, person);
  const t = App.SCHEDULE_TIMES[App._normalizeScheduleType(dayType)] || {};
  const activeKey = App._getActiveScheduleBlockKey(dayType, schedulePerson);
  let rows = "";
  for (const b of App.SCHEDULE_BLOCKS) {
    const rec = t[b.key] || {
      time: "",
      duration: ""
    };
    const isActive = !!activeKey && b.key === activeKey;
    rows += `
      <div class="sched-times-row${isActive ? " is-active" : ""}" data-sched-block="${App.escapeHtml(b.key)}">
        <div class="sched-times-period">${App.escapeHtml(b.label)}</div>
        <div class="sched-times-time">${App._schedVal(rec.time)}</div>
        <div class="sched-times-dur">${App._schedVal(rec.duration)}</div>
      </div>`;
  }
  return `
    <div class="sched-card sched-card-times">
      <div class="sched-card-title">Schedule Times</div>
      <div class="sched-times">
        <div class="sched-times-head">
          <div>Period</div>
          <div>Time</div>
          <div>Minutes</div>
        </div>
        ${rows}
      </div>
    </div>
  `;
};
App._renderScheduleTable = function (dayType, person) {
  const schedulePerson = App._resolveSchedulePersonKey(dayType, person);
  const previewDay = App.schedulesState.previewManual ? App._normalizeScheduleWeekday(App.schedulesState.previewDay) : App.getESTScheduleDay();
  const times = App.SCHEDULE_TIMES[App._normalizeScheduleType(dayType)] || {};
  const activeKey = App._getActiveScheduleBlockKey(dayType, schedulePerson);
  const hasScheduleAssigned = !!App._findConfiguredScheduleUsername(person);
  if (!hasScheduleAssigned) {
    return `
      <div class="sched-card">
        <div class="sched-card-title">Schedule — ${App.escapeHtml(person)}</div>
        <div class="sched-grid">
          <div class="sched-grid-head">
            <div>Period</div>
            <div>Time</div>
            <div>Minutes</div>
            <div>Class Name</div>
            <div>Teacher</div>
            <div>Room</div>
          </div>
          <div class="sched-grid-row sched-grid-empty">
            <div class="sched-cell sched-cell-empty">No schedule assigned</div>
          </div>
        </div>
      </div>
    `;
  }
  let rows = "";
  for (const b of App.SCHEDULE_BLOCKS) {
    const t = times[b.key] || {
      time: "",
      duration: ""
    };
    const c = App._getClassForBlock(dayType, schedulePerson, b.key, previewDay);
    const isActive = !!activeKey && b.key === activeKey;
    rows += `
      <div class="sched-grid-row${isActive ? " is-active" : ""}" data-sched-block="${App.escapeHtml(b.key)}" data-sched-class-hover="1" data-sched-class-owner="${App.escapeHtml(schedulePerson)}" data-sched-weekday="${App.escapeHtml(previewDay || "")}" data-sched-day-type="${App.escapeHtml(App._normalizeScheduleType(dayType))}">
        <div class="sched-cell sched-cell-period">${App.escapeHtml(b.label)}</div>
        <div class="sched-cell sched-cell-time">${App._schedVal(t.time)}</div>
        <div class="sched-cell sched-cell-duration">${App._schedVal(t.duration)}</div>
        <div class="sched-cell sched-cell-class">${App._schedVal(c.className)}</div>
        <div class="sched-cell sched-cell-teacher">${App._schedVal(c.teacher)}</div>
        <div class="sched-cell sched-cell-room">${App._schedVal(c.room)}</div>
      </div>
    `;
  }
  return `
    <div class="sched-card">
      <div class="sched-card-title">Schedule — ${App.escapeHtml(person)}</div>
      <div class="sched-grid">
        <div class="sched-grid-head">
          <div>Period</div>
          <div>Time</div>
          <div>Minutes</div>
          <div>Class Name</div>
          <div>Teacher</div>
          <div>Room</div>
        </div>
        ${rows}
      </div>
    </div>
  `;
};
App.renderSchedulesUI = function () {
  if (!App.messagesListEl) return;
  App.hideScheduleClassmatesFloating({
    immediate: true
  });

  // Schedule type is controlled by Panel (Firebase)
  App.schedulesState.dayType = App.scheduleType || App.schedulesState.dayType || "full";
  const dayType = App.schedulesState.dayType || "full";
  const person = App.schedulesState.person;
  const automaticDay = App.getESTScheduleDay();
  const previewDay = App.schedulesState.previewManual ? App._normalizeScheduleWeekday(App.schedulesState.previewDay) : automaticDay;
  App.schedulesState.previewDay = previewDay;
  App.schedulesState.lastAutoDay = automaticDay;
  const typeLabel = App._scheduleTypeLabel(dayType);
  const dayLabel = previewDay ? `Day ${previewDay} · ${App._scheduleWeekdayLabel(previewDay)}` : "Day N/A";
  const typeIcon = k => {
    const key = App._normalizeScheduleType(k);
    if (key === "half") {
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
        <path d="M21 12.5A8.5 8.5 0 1 1 11.5 3a6.5 6.5 0 1 0 9.5 9.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      </svg>`;
    }
    if (key === "delay2") {
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>
        <path d="M12 7v6l4 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    }
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="2"/>
    </svg>`;
  };
  const personIcon = u => {
    const code = String(u?.code || "");
    return `<div class="sched-avatar" data-usercode="${App.escapeHtml(code)}" aria-hidden="true"></div>`;
  };
  const people = Array.isArray(App.schedulesPeopleCache) ? App.schedulesPeopleCache : [];
  const selectedPersonUser = person ? App.schedulesPeopleByUsername.get(String(person)) : null;
  const emptyLabel = App.schedulesPeopleLoadedOnce ? `No accounts found.` : `Loading accounts...`;
  const peopleGrid = people.length ? people.map(u => {
    const uname = String(u?.username || "User"),
      dname = String(u?.displayName || uname),
      code = String(u?.code || "");
    return `
      <button class="sched-person-card" data-sched-person="${App.escapeHtml(uname)}" type="button">
        ${personIcon(u)}
        <div class="sched-person-meta">
          <div class="sched-person-name" data-display-name-usercode="${App.escapeHtml(code)}">${App.escapeHtml(dname)}</div>
        </div>
        <div class="sched-person-go" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
            <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </button>
    `;
  }).join("") : `<div class="muted small" style="padding:6px 2px">${App.escapeHtml(emptyLabel)}</div>`;
  const previewButtons = App.SCHEDULE_WEEKDAYS.map(({
    key,
    label
  }) => `
    <button class="sched-preview-btn${previewDay === key ? " is-active" : ""}" data-sched-preview-day="${key}" type="button" data-tooltip="${App.escapeHtml(label)}" aria-label="Preview ${App.escapeHtml(label)} schedule">${key}</button>
  `).join("") + (!automaticDay ? `
    <button class="sched-preview-btn${previewDay ? "" : " is-active"}" data-sched-preview-day="" type="button">N/A</button>
  ` : "");
  const top = `
    <div class="sched-topcard">
      <div class="sched-top-left">
        <div class="sched-top-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
            <path d="M7 4h10a2 2 0 0 1 2 2v14l-3-2-4 2-4-2-3 2V6a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            <path d="M9 8h6M9 12h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <div>
          <div class="sched-title">Schedules</div>
          <div class="sched-sub">${App.escapeHtml(dayLabel)}</div>
        </div>
      </div>

      <div class="sched-top-right">
        <div class="sched-preview-group">
          <span class="sched-control-label">Weekday</span>
          <div class="sched-preview-days" aria-label="Preview day">
            ${previewButtons}
          </div>
        </div>
        <div class="sched-type-badge" data-tooltip="Controlled by Admin Panel">
          <span class="sched-type-ico">${typeIcon(dayType)}</span>
          <span class="sched-type-text">${App.escapeHtml(typeLabel)}</span>
        </div>
      </div>
    </div>
  `;
  let body = "";
  if (!person) {
    body = `
      <div class="sched-split">
        <div class="sched-card sched-card-people">
          <div class="sched-card-title">People</div>
          <div class="sched-people-grid">
            ${peopleGrid}
          </div>
        </div>

        ${App._renderScheduleTimesCard(dayType, null)}
      </div>
    `;
  } else {
    body = `
      <div class="sched-view-head">
        <button class="btn tiny" data-sched-back="1" type="button">Back</button>
        <div class="sched-person-title"${selectedPersonUser?.code ? ` data-display-name-usercode="${App.escapeHtml(String(selectedPersonUser.code))}"` : ``}>${App.escapeHtml(String(selectedPersonUser?.displayName || person))}</div>
      </div>

      ${App._renderScheduleTable(dayType, person)}
      <div style="height:12px"></div>
      ${App._renderScheduleTimesCard(dayType, person)}
    `;
  }
  App.messagesListEl.innerHTML = `
    <div class="sched-page">
      ${top}
      ${body}
    </div>
  `;

  // Hydrate avatars + keep them live
  App.messagesListEl.querySelectorAll(".sched-avatar[data-usercode]").forEach(el => {
    const code = el.getAttribute("data-usercode") || "";
    const username = el.closest("[data-sched-person]")?.getAttribute("data-sched-person") || "";
    const u = App.schedulesPeopleByCode.get(code) || App.schedulesPeopleByUsername.get(username);
    if (u) App.applyAvatar(el, u);
    if (code) App.ensureLiveUserListener(code);
  });

  // Wire preview day buttons
  App.messagesListEl.querySelectorAll("[data-sched-preview-day]").forEach(btn => {
    btn.addEventListener("click", () => {
      const raw = btn.getAttribute("data-sched-preview-day");
      App.schedulesState.previewManual = !!raw;
      App.schedulesState.previewDay = App._normalizeScheduleWeekday(raw);
      App.renderSchedulesUI();
    });
  });

  // Schedule rows use a hover-only classmate tooltip for this exact day and period.
  App.messagesListEl.querySelectorAll(".sched-grid-row[data-sched-class-hover='1']").forEach(row => {
    const show = () => App.showScheduleClassmatesFloating(row, {
      ownerUsername: row.getAttribute("data-sched-class-owner") || "",
      blockKey: row.getAttribute("data-sched-block") || "",
      weekday: row.getAttribute("data-sched-weekday") || "",
      dayType: row.getAttribute("data-sched-day-type") || dayType
    });
    row.addEventListener("mouseenter", show);
    row.addEventListener("mouseleave", () => App.hideScheduleClassmatesFloating());
  });

  // Wire name cards
  App.messagesListEl.querySelectorAll("[data-sched-person]").forEach(btn => {
    btn.addEventListener("click", () => {
      App.schedulesState.person = btn.getAttribute("data-sched-person");
      App.renderSchedulesUI();
    });
  });

  // Wire back
  const backBtn = App.messagesListEl.querySelector("[data-sched-back]");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      App.schedulesState.person = null;
      App.renderSchedulesUI();
    });
  }

  // Keep the yellow "active period" highlight updating live
  App.startSchedulesHighlightTimer();
  App.applySchedulesActiveHighlight();
};
App.clearMessagesToSchedules = function () {
  App.renderSchedulesUI();
};
App.showSchedulesPage = function (personOverride = null) {
  App.closeCallMenu();
  if (App.selectedGame?.roomActivityId) void App.closeGamesStage({
    preserve: false
  });
  // Always open to the name-picker screen (schedule type is controlled by Panel)
  App.schedulesState.dayType = App.scheduleType || "full";
  App.schedulesState.previewDay = App.getESTScheduleDay();
  App.schedulesState.previewManual = false;
  App.schedulesState.lastAutoDay = App.schedulesState.previewDay;
  const requestedPerson = personOverride ? String(personOverride).trim() || null : null;
  App.schedulesState.person = requestedPerson;
  App.stopAllChatAudio();
  App.stopRoomPresence();
  App.detachOnlineIndicator();
  App.detachMessages();
  try {
    App.clearReplyState({
      quiet: true
    });
  } catch {}
  try {
    App.clearPendingFiles({
      quiet: true
    });
  } catch {}
  try {
    App.closePingBar({
      quiet: true
    });
  } catch {}
  try {
    App.$("msg-input").value = "";
    App.$("msg-input").blur();
  } catch {}
  App.currentRoomId = null;
  App.syncCallButton();
  App.abortFirebaseUploadsForPlaceChange("schedules");
  App.setStoredPlace("schedules");
  App.setComposerEnabled(false);
  App.syncSidebarNavActive();
  App.syncSidebarRoomActiveStates();
  try {
    App.syncEmojiButtonVisibility();
  } catch {}
  try {
    if (App.messagesEl) App.messagesEl.scrollTop = 0;
    window.scrollTo(0, 0);
  } catch {}
  if (App.messagesListEl) {
    App.messagesListEl.innerHTML = `
      <div class="sched-page">
        <div class="sched-card">
          <div class="sched-card-title">Schedules</div>
          <div class="muted small">Loading schedules...</div>
        </div>
      </div>
    `;
  }
  requestAnimationFrame(() => {
    App.startScheduleTypeListener();
    App.startSchedulesPeopleListener();
    App.clearMessagesToSchedules();
  });
};

App.register("schedules/render", function initializeFeature() {
App.schedulesHighlightTimer = null;
App.schedulesState = {
  dayType: "full",
  previewDay: null,
  previewManual: false,
  lastAutoDay: null,
  person: null
};
App.schedulesRenderRaf = 0;
});
})(globalThis.ChatApp);
