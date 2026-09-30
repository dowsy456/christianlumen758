/* ui/tool-buttons: methods register before ordered initialization. */
(function (App) {
  "use strict";


App.register("ui/tool-buttons", function initializeFeature() {
App.btnSideNotepad = App.$("btn-side-notepad");
if (App.btnSideNotepad) App.btnSideNotepad.addEventListener("click", e => {
  e.preventDefault();
  e.stopPropagation();
  if (!App.currentUser) return;
  try {
    App.closeGamesStage();
  } catch {}
  try {
    App.closeModal();
  } catch {}
  App.openNotepadModal();
});
App.btnSideCamera = App.$("btn-side-camera");
if (App.btnSideCamera) App.btnSideCamera.addEventListener("click", e => {
  e.preventDefault();
  e.stopPropagation();
  if (!App.currentUser) return;
  try {
    App.closeGamesStage();
  } catch {}
  try {
    App.closeModal();
  } catch {}
  void App.openCameraModal();
});
});
})(globalThis.ChatApp);
