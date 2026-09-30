/* Manual desktop status is an account preference, never an idle timer. */
(function (App) {
  "use strict";
  App.getUserNotificationStatus = user => user?.notificationStatus === "dnd" ? "dnd" : "online";
  App.isDoNotDisturb = () => App.getUserNotificationStatus(App.currentUser) === "dnd";
  App.statusSelectionAvailable = () => globalThis.chatDesktopOverlay?.version === 1;
  App.userPresenceLabel = state => state === "dnd" ? "Do Not Disturb" : state === "online" ? "Online" : state === "idle" ? "Idle" : "Offline";
  App.getUserVisiblePresence = function (code) {
    const id = String(code || "");
    const self = id === String(App.currentUser?.code || "");
    const user = self ? App.currentUser : App.liveUserCache?.get(id) || App.schedulesPeopleByCode?.get(id);
    const state = App.appPresenceCache?.get(id) || (self && App.appPresenceSession?.connected && App.appPresenceSession?.ready
      ? (App.isAppIdleNow?.() ? "idle" : "online") : "offline");
    if (state === "offline") return state;
    if (user?.notificationStatus === "dnd") return "dnd";
    // "Online" enables notifications; it must not override measured idle state.
    return state;
  };
  App.notifyStatusChanged = function () {
    App.refreshOpenUserProfilePresence?.();
    App.renderOnlineIndicator?.();
    App.syncProfileStatusControl?.();
    window.dispatchEvent(new CustomEvent("app:status-changed", { detail: { status: App.getUserNotificationStatus(App.currentUser) } }));
  };
  App.initializeNotificationStatus = function () {
    const user = App.currentUser;
    if (!App.statusSelectionAvailable() || !user?.code || user.notificationStatus) return;
    // Transaction protects a DND selection made on another device during login.
    void App.db.ref(`users/${user.code}/notificationStatus`).transaction(value => value === "dnd" || value === "online" ? undefined : "online").then(result => {
      if (App.currentUser !== user) return;
      user.notificationStatus = result.snapshot.val() === "dnd" ? "dnd" : "online";
      App.notifyStatusChanged();
      App.writeCurrentUserBootstrapCache?.();
    }).catch(() => {});
  };
  let statusSubscription = null;
  App.stopNotificationStatusSync = function () {
    if (statusSubscription) statusSubscription.ref.off("value", statusSubscription.callback);
    statusSubscription = null;
  };
  App.startNotificationStatusSync = function () {
    App.stopNotificationStatusSync();
    const code = String(App.currentUser?.code || "");
    if (!code || !App.db) return;
    const subscription = { ref: App.db.ref(`users/${code}/notificationStatus`), callback: null };
    statusSubscription = subscription;
    subscription.callback = snap => {
      if (statusSubscription !== subscription || String(App.currentUser?.code) !== code) return;
      const value = snap.val();
      const next = value === "online" || value === "dnd" ? value : null;
      if (App.currentUser.notificationStatus === next) return;
      App.currentUser.notificationStatus = next;
      App.notifyStatusChanged();
      App.writeCurrentUserBootstrapCache?.();
    };
    subscription.ref.on("value", subscription.callback);
  };
  App.setNotificationStatus = async function (status) {
    if (!App.statusSelectionAvailable() || !App.currentUser?.code || !["online", "dnd"].includes(status)) return false;
    const user = App.currentUser;
    const previous = user.notificationStatus;
    user.notificationStatus = status;
    App.notifyStatusChanged();
    App.writeCurrentUserBootstrapCache?.();
    try {
      await App.db.ref(`users/${user.code}/notificationStatus`).set(status);
      return true;
    } catch {
      if (App.currentUser === user && user.notificationStatus === status) {
        user.notificationStatus = previous;
        App.notifyStatusChanged();
        App.writeCurrentUserBootstrapCache?.();
      }
      App.showToast?.({ title: "Status not saved", body: "Please try changing your status again.", duration: 3500 });
      return false;
    }
  };
  let menu = null, anchor = null, closeTimer = null;
  App.closeProfileStatusMenu = function (immediate = false) {
    if (!menu || menu.hidden) return;
    clearTimeout(closeTimer);
    menu.classList.remove("open");
    menu.classList.add("closing");
    anchor?.setAttribute("aria-expanded", "false");
    const hide = () => { menu.hidden = true; menu.classList.remove("closing"); };
    if (immediate) hide(); else closeTimer = setTimeout(hide, 150);
  };
  App.openProfileStatusMenu = function (avatar, event = null) {
    if (!App.statusSelectionAvailable() || !App.currentUser || !avatar) return;
    if (!menu) {
      menu = document.createElement("div");
      menu.id = "profile-status-menu";
      menu.className = "msg-menu profile-status-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "Set your status");
      menu.hidden = true;
      menu.innerHTML = [ ["online", "Online"], ["dnd", "Do Not Disturb"] ].map(([state, label]) => `<button type="button" class="msg-menu-btn" role="menuitemradio" data-status="${state}"><span class="msg-menu-icon"><span class="profile-status-dot" data-state="${state}"></span></span><span class="msg-menu-label">${label}</span></button>`).join("");
      menu.addEventListener("click", event => {
        const button = event.target.closest("[data-status]");
        if (!button) return;
        const next = button.dataset.status;
        App.closeProfileStatusMenu();
        void App.setNotificationStatus(next);
      });
      menu.addEventListener("keydown", event => {
        const buttons = [...menu.querySelectorAll("button")];
        if (event.key === "Escape") { event.preventDefault(); App.closeProfileStatusMenu(); anchor?.focus(); }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const direction = event.key === "ArrowDown" ? 1 : -1;
          buttons[(buttons.indexOf(document.activeElement) + direction + buttons.length) % buttons.length]?.focus();
        }
      });
      document.body.appendChild(menu);
    }
    if (!menu.hidden && !menu.classList.contains("closing") && anchor === avatar) { App.closeProfileStatusMenu(); return; }
    clearTimeout(closeTimer);
    App.closeMsgMenu?.(true);
    anchor = avatar;
    for (const button of menu.querySelectorAll("[data-status]")) button.setAttribute("aria-checked", String(button.dataset.status === App.getUserNotificationStatus(App.currentUser)));
    avatar.setAttribute("aria-expanded", "true");
    menu.hidden = false;
    menu.classList.remove("closing");
    menu.classList.add("open");
    App.positionContextMenu(menu, { anchor: avatar, x: event?.clientX, y: event?.clientY, avoidAnchor: !event });
    menu.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
  };
  App.syncProfileStatusControl = function () {
    if (menu && !menu.hidden) for (const button of menu.querySelectorAll("[data-status]")) button.setAttribute("aria-checked", String(button.dataset.status === App.getUserNotificationStatus(App.currentUser)));
    const avatar = App.userProfileCardEl?.querySelector(".user-profile-avatar");
    if (!avatar) return;
    const available = App.statusSelectionAvailable() && App.userProfilePinnedCode === App.currentUser?.code;
    avatar.classList.toggle("can-set-status", available);
    if (available) {
      avatar.tabIndex = 0;
      avatar.setAttribute("role", "button");
      avatar.setAttribute("aria-label", `Change status: ${App.userPresenceLabel(App.getUserNotificationStatus(App.currentUser))}`);
      avatar.setAttribute("aria-haspopup", "menu");
    }
  };
  App.register("profiles/status", function () {
    const hit = target => {
      const avatar = target?.closest?.("#user-profile-card .user-profile-avatar");
      return avatar && App.statusSelectionAvailable() && App.userProfilePinnedCode === App.currentUser?.code ? avatar : null;
    };
    for (const eventName of ["click", "contextmenu"]) document.addEventListener(eventName, event => {
      const avatar = hit(event.target);
      if (!avatar) return;
      event.preventDefault(); event.stopPropagation();
      App.openProfileStatusMenu(avatar, eventName === "contextmenu" ? event : null);
    }, true);
    document.addEventListener("keydown", event => {
      const avatar = hit(event.target);
      if (!avatar || !["Enter", " "].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); App.openProfileStatusMenu(avatar);
    }, true);
    document.addEventListener("pointerdown", event => {
      if (menu && !menu.hidden && !menu.contains(event.target) && !anchor?.contains(event.target)) App.closeProfileStatusMenu();
    }, true);
    window.addEventListener("blur", () => App.closeProfileStatusMenu(true));
    window.addEventListener("resize", () => App.closeProfileStatusMenu(true));
  });
})(globalThis.ChatApp);
