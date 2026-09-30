/* accounts/create: methods register before ordered initialization. */
(function (App) {
  "use strict";
App.generateUniqueAccountCode = async function () {
  for (let i = 0; i < 16; i++) {
    const code = App.formatCode(App.randomCode16());
    const [userSnap, reservationSnap] = await Promise.all([App.db.ref(`users/${code}`).once("value"), App.db.ref(`${App.ACCOUNT_CODE_RESERVATIONS_NODE}/${code}`).once("value")]);
    if (!userSnap.exists() && !reservationSnap.exists()) return code;
  }
  throw new Error("Could not generate a unique code.");
};

App.register("accounts/create", function initializeFeature() {
App.$("btn-create-account").addEventListener("click", async () => {
  App.hideError("create");
  const username = App.sanitizeUsername(App.$("create-username").value);
  if (!username) {
    App.setError("create", "Username must be 1–20 chars, ASCII only, no emojis/invisible chars.");
    return;
  }
  const usernameLower = username.toLowerCase();
  const hash = await App.sha256Hex(usernameLower);
  const unameRef = App.db.ref(`usernames/${hash}`);
  let code;
  let usernameClaimed = false;
  let displayClaim = null;
  try {
    code = await App.generateUniqueAccountCode();
  } catch (e) {
    console.error("generateUniqueAccountCode failed:", e);
    App.setError("create", "Create failed. Check console / rules.");
    return;
  }
  try {
    const txResult = await new Promise((resolve, reject) => {
      unameRef.transaction(current => {
        if (current === null) {
          return {
            u: usernameLower,
            code
          };
        }
        if (current && current.u === usernameLower) return; // abort
        return;
      }, (error, committed, snapshot) => {
        if (error) return reject(error);
        resolve({
          committed,
          snapshot
        });
      }, false);
    });
    if (!txResult.committed) {
      App.setError("create", "That username is already taken.");
      return;
    }
    usernameClaimed = true;
    displayClaim = await App.claimDisplayName(username, code);
    if (!displayClaim?.ok) {
      try {
        await unameRef.remove();
      } catch {}
      App.setError("create", "That display name is already taken.");
      return;
    }
    const userRecord = {
      username,
      usernameLower,
      displayName: displayClaim.cleaned,
      displayNameLower: displayClaim.displayNameLower,
      bio: "",
      photoDataURL: App.pfpState.dataURL,
      photoTransform: App.packTransformForStorage(),
      bannerDataURL: "",
      bannerTransform: {
        unit: "rel",
        scale: 1,
        x: 0,
        y: 0
      },
      createdAt: Date.now(),
      settings: App.cloneDefaultSettings()
    };
    const account = await App.db.ref(`users/${code}`).transaction(current => current == null ? userRecord : undefined, undefined, false);
    if (!account.committed) throw new Error("Could not reserve a unique password. Try again.");
    App.showView("home");
    App.$("create-username").value = "";
    App.pfpInput.value = "";
    App.setDefaultPfp();
    App.showToast({
      title: "Account created",
      body: "Save this code. You’ll use it to log in.",
      code,
      showCopy: true,
      duration: 10000
    });
  } catch (err) {
    if (displayClaim?.ok) {
      try {
        await App.releaseDisplayName(displayClaim.cleaned, code);
      } catch {}
    }
    if (usernameClaimed) {
      try {
        await unameRef.remove();
      } catch {}
    }
    console.error("Create account failed:", err);
    App.setError("create", "Could not create account. Check console / rules.");
  }
});
});
})(globalThis.ChatApp);
