// js/ui-auth.js
import { getUser, signInWithPassword, signOut, onAuthStateChanged } from "./auth.js";
import { openAllDatasets } from "./auto-open-all.js";

function qs(id) { return document.getElementById(id); }

function setAnonUI(isAnon) {
  const banner = qs("anon-banner");
  if (banner) banner.style.display = isAnon ? "block" : "none";

  const form = qs("signin-form");
  const signoutBtn = qs("signout-submit");
  if (form) form.style.display = isAnon ? "block" : "none";
  if (signoutBtn) signoutBtn.style.display = isAnon ? "none" : "block";
}

function toggleMenu(open) {
  const menu = qs("profile-menu");
  if (!menu) return;
  menu.style.display = open ? "block" : "none";
}

document.addEventListener("DOMContentLoaded", async () => {
  const btn = qs("profile-button");
  const menu = qs("profile-menu");
  const signinForm = qs("signin-form");
  const signoutBtn = qs("signout-submit");

  // open/close profile dropdown
  if (btn && menu) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenu(menu.style.display !== "block");
    });
    document.addEventListener("click", (e) => {
      if (!menu.contains(e.target) && !btn.contains(e.target)) toggleMenu(false);
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleMenu(false); });
  }

  // sign in
  if (signinForm) {
    signinForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = (qs("signin-email")?.value || "").trim();
      const password = (qs("signin-password")?.value || "").trim();
      if (!email || !password) return;

      const { error } = await signInWithPassword(email, password);
      if (error) {
        alert(error.message || "Sign-in failed");
        return;
      }
      // clear and close
      if (qs("signin-password")) qs("signin-password").value = "";
      toggleMenu(false);
    });
  }

  // sign out
  if (signoutBtn) {
    signoutBtn.addEventListener("click", async () => {
      await signOut();
      toggleMenu(false);
    });
  }

  // initial state (persisted session)
  const u = await getUser();
  setAnonUI(!u);

  // if already logged in on load, draw all datasets
  if (u) {
    try { await openAllDatasets(); } catch (e) { console.error(e); }
  }

  // react to changes
  onAuthStateChanged(async (user) => {
    setAnonUI(!user);
    if (user) {
      try { await openAllDatasets(); } catch (e) { console.error(e); }
    } else {
      // optional: remove auto-opened layers when logging out
      if (Array.isArray(window._openedDatasetLayers)) {
        try { window._openedDatasetLayers.forEach(g => window.map.removeLayer(g)); } catch {}
      }
      window._openedDatasetLayers = [];
    }
  });
});
