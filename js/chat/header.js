/* chat/header: methods register before ordered initialization. */
(function (App) {
  "use strict";
App.syncComposerPrimaryAction = function () {
  const placeNow = App.getStoredPlace() || "home";
  const send = App.$("btn-send");
  if (!send) return;
  const setAction = (action, label, svg) => {
    send.dataset.action = action;
    send.dataset.tooltip = label;
    send.setAttribute("aria-label", label);
    send.removeAttribute("title");
    send.innerHTML = `<span class="composer-send-icon" aria-hidden="true">${svg}</span>`;
  };
  const sendSvg = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21.25 3.75 10.4 14.6" stroke="currentColor" stroke-width="2.05" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M21.25 3.75 14.3 20.25l-3.9-5.75-5.65-3.9 16.5-6.85Z" fill="currentColor"/>
    </svg>
  `;
  const cancelSvg = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.75 5.5A2.75 2.75 0 0 1 7.5 2.75h6A2.75 2.75 0 0 1 16.25 5.5v3.25" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M7.75 8.5h5M7.75 11.5h3.25" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
      <path d="m15.85 13.85 5.4 5.4M21.25 13.85l-5.4 5.4" stroke="currentColor" stroke-width="2.15" stroke-linecap="round"/>
      <path d="M6.75 18.5h4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
    </svg>
  `;
  const roomId = App.sanitizeRoomCode(App.currentRoomId);
  const editingThisRoom = !!(App.editState && roomId && App.editState.roomId === roomId && placeNow === `room:${roomId}`);
  setAction(editingThisRoom ? "cancel" : "send", editingThisRoom ? "Cancel Editing" : "Send Message", editingThisRoom ? cancelSvg : sendSvg);
};
App.setComposerEnabled = function (enabled) {
  const placeNow = App.getStoredPlace() || "home";
  const isRoom = placeNow.startsWith("room:");
  document.body.classList.toggle("composer-hidden-page", !enabled && (placeNow === "home" || placeNow === "schedules" || placeNow === "calendar" || placeNow.startsWith("calendar:")));
  const input = App.$("msg-input");
  const send = App.$("btn-send");
  const up = App.$("btn-upload");
  if (input) {
    input.disabled = !enabled;
    input.setAttribute("aria-label", "Message");
  }
  if (send) send.disabled = !enabled;
  if (up) {
    if (!enabled) {
      up.hidden = true;
      up.disabled = true;
    } else if (isRoom) {
      up.hidden = false;
      up.disabled = false;
    } else {
      up.hidden = true;
      up.disabled = true;
    }
  }
  if (input) {
    const editingThisRoom = !!(App.editState && App.currentRoomId && App.editState.roomId === App.sanitizeRoomCode(App.currentRoomId) && isRoom);
    input.placeholder = !enabled ? "Select a room to chat…" : editingThisRoom ? "Edit your message…" : "Type a message…";
  }
  App.syncComposerPrimaryAction();
  App.syncComposerToolLayout();
};

App.register("chat/header", function initializeFeature() {

});
})(globalThis.ChatApp);
