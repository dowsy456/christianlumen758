/* Feature methods are registered in parallel; startup side effects run once,
 * in the manifest's explicit dependency order. State lives in one namespace. */
(() => {
  "use strict";
  const initializers = new Map();
  const application = Object.create(null);
  let started = false;
  Object.defineProperties(application, {
    register: { value(id, initialize) {
      if (initializers.has(id)) throw new Error(`Duplicate application module: ${id}`);
      initializers.set(id, initialize);
    } },
    initialize: { value(entries) {
      if (started) return;
      for (const entry of entries) {
        if (!initializers.has(entry.id)) throw new Error(`Module did not register: ${entry.id}`);
      }
      started = true;
      for (const entry of entries) {
        try { initializers.get(entry.id)(); }
        catch (cause) { throw new Error(`Startup failed in ${entry.id}`, { cause }); }
      }
      initializers.clear();
      document.documentElement.dataset.appReady = "true";
      window.dispatchEvent(new Event("chatapp:ready"));
    } }
  });
  globalThis.ChatApp = application;
})();
