/* schedules/admin: methods register before ordered initialization. */
(function (App) {
  "use strict";
App._normalizeScheduleWeekday = function (v) {
  const key = String(v ?? "").trim().toUpperCase();
  return App.SCHEDULE_WEEKDAYS.some(day => day.key === key) ? key : null;
};
App.getESTScheduleDay = function (date = App.getAccurateNow()) {
  const timestamp = date instanceof Date ? date.getTime() : Number(date);
  const index = App._getESTWeekdayIndexAt(Number.isFinite(timestamp) ? timestamp : Date.now());
  return App.SCHEDULE_WEEKDAYS.find(day => day.index === index)?.key || null;
};
App._scheduleWeekdayLabel = function (key) {
  const normalized = App._normalizeScheduleWeekday(key);
  return App.SCHEDULE_WEEKDAYS.find(day => day.key === normalized)?.label || "N/A";
};
App._normalizeScheduleType = function (v) {
  const s = String(v ?? "").trim();
  return s === "full" || s === "half" || s === "delay2" ? s : "full";
};
App._normalizeAccountCreationEnabled = function (v) {
  return v === true;
};
App._scheduleTypeLabel = function (key) {
  const k = App._normalizeScheduleType(key);
  return App.SCHEDULE_DAY_TYPES.find(x => x.key === k)?.label || "Full Day";
};
App.startScheduleTypeListener = function () {
  if (App.scheduleTypeListener) return;
  const ref = App.db.ref(App.ADMIN_SCHEDULETYPE_PATH);
  const cb = snap => {
    App.scheduleType = App._normalizeScheduleType(snap.val());
    const wrap = App.$("panel-schedtypes");
    if (wrap) {
      wrap.querySelectorAll("[data-panel-schedtype]").forEach(btn => {
        const k = btn.getAttribute("data-panel-schedtype") || "full";
        btn.classList.toggle("primary", App._normalizeScheduleType(k) === App.scheduleType);
      });
    }
    if (App.getStoredPlace() === "schedules") {
      App.schedulesState.dayType = App.scheduleType;
      try {
        App.scheduleRenderSchedulesUI();
      } catch {}
    }
  };
  ref.on("value", cb);
  App.scheduleTypeListener = {
    ref,
    cb
  };
};
App.stopScheduleTypeListener = function () {
  if (!App.scheduleTypeListener) return;
  try {
    App.scheduleTypeListener.ref.off("value", App.scheduleTypeListener.cb);
  } catch {}
  App.scheduleTypeListener = null;
  App.scheduleType = "full";
};
App.setScheduleType = async function (key) {
  const k = App._normalizeScheduleType(key);
  await App.db.ref(App.ADMIN_SCHEDULETYPE_PATH).set(k);
};
App.startAccountCreationListener = function () {
  if (App.accountCreationListener) return;
  const ref = App.db.ref(App.ADMIN_ACCOUNTCREATION_PATH);
  const cb = snap => {
    App.accountCreationEnabled = App._normalizeAccountCreationEnabled(snap.val());
    App.bindCreateAccountButton();
    const wrap = App.$("panel-account-creation");
    if (wrap) {
      wrap.querySelectorAll("[data-panel-account-creation]").forEach(btn => {
        const k = btn.getAttribute("data-panel-account-creation") || "disabled";
        btn.classList.toggle("primary", k === "enabled" === App.accountCreationEnabled);
      });
    }
  };
  ref.on("value", cb);
  App.accountCreationListener = {
    ref,
    cb
  };
};
App.setAccountCreationEnabled = async function (enabled) {
  await App.db.ref(App.ADMIN_ACCOUNTCREATION_PATH).set(!!enabled);
};
App._getClassForBlock = function (dayType, person, blockKey, weekdayOverride = App.getESTScheduleDay()) {
  const weekday = App._normalizeScheduleWeekday(weekdayOverride);
  const configuredPerson = App._findConfiguredScheduleUsername(person);
  const record = weekday && configuredPerson ? App.SCHEDULES?.[configuredPerson]?.[weekday]?.[blockKey] : null;
  if (record && typeof record === "object") {
    return {
      className: record.className ?? "",
      teacher: record.teacher ?? "",
      room: record.room ?? ""
    };
  }
  return {
    className: "",
    teacher: "",
    room: ""
  };
};

App.register("schedules/admin", function initializeFeature() {
App.ADMIN_SCHEDULETYPE_PATH = "admin/scheduleType";
App.ADMIN_ACCOUNTCREATION_PATH = "admin/accountCreationEnabled";
App.SCHEDULE_WEEKDAYS = [{
  key: "M",
  label: "Monday",
  index: 1
}, {
  key: "T",
  label: "Tuesday",
  index: 2
}, {
  key: "W",
  label: "Wednesday",
  index: 3
}, {
  key: "R",
  label: "Thursday",
  index: 4
}, {
  key: "F",
  label: "Friday",
  index: 5
}];
App.scheduleType = "full";
App.scheduleTypeListener = null;
App.accountCreationListener = null;
App.schedulesModuleReady = true;
});
})(globalThis.ChatApp);
