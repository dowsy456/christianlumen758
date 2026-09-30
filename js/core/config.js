/* core/config: methods register before ordered initialization. */
(function (App) {
  "use strict";


App.register("core/config", function initializeFeature() {
App.firebaseConfig = Object.freeze({
  apiKey: "AIzaSyDOrpCbFAIj_5vr8pJHJXtHzEpgFjIOXgw",
  authDomain: "chatappv3-fea49.firebaseapp.com",
  databaseURL: "https://chatappv3-fea49-default-rtdb.firebaseio.com",
  projectId: "chatappv3-fea49",
  storageBucket: "chatappv3-fea49.firebasestorage.app",
  messagingSenderId: "1002693292688",
  appId: "1:1002693292688:web:de1f2fdaa52007c5ea5e15",
  measurementId: "G-ML1N1XLRSX"
});
App.firebase = globalThis.firebase || null;
if (!App.firebase?.initializeApp || !App.firebase?.database) {
  throw new Error("Firebase failed to load before app.js. Make sure firebase-app-compat.js and firebase-database-compat.js are loaded first.");
}
if (!App.firebase.apps.length) {
  App.firebase.initializeApp(App.firebaseConfig);
}
App.db = App.firebase.database();
});
})(globalThis.ChatApp);
