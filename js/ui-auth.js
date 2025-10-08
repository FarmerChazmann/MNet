// js/ui-auth.js
import { getUser, signInWithPassword, signOut, onAuthStateChanged } from "./auth.js";
import { openAllDatasets } from "./auto-open-all.js";
import { migrateLocalToCloud, clearCloudCache } from "./data.js";

const els = {
  avatarBtn: document.getElementById("profile-button"),
  avatarText: document.getElementById("profile-avatar-text"),
  menu: document.getElementById("profile-menu"),
  form: document.getElementById("signin-form"),
  email: document.getElementById("signin-email"),
  password: document.getElementById("signin-password"),
  signinBtn: document.getElementById("signin-submit"),
  signoutBtn: document.getElementById("signout-submit"),
  anonBanner: document.getElementById("anon-banner"),
  signedOut: document.getElementById("profile-signed-out"),
  signedIn: document.getElementById("profile-signed-in"),
  displayName: document.getElementById("profile-display-name"),
  subtitle: document.getElementById("profile-subtitle"),
  emailDisplay: document.getElementById("profile-email"),
  accountName: document.getElementById("profile-account-name"),
  rolePill: document.getElementById("profile-role-pill"),
};

let currentUserId = null;

function toggleMenu(open) {
  if (!els.menu) return;
  els.menu.style.display = open ? "block" : "none";
}

function setAnonUI(isAnon) {
  if (els.anonBanner) els.anonBanner.style.display = isAnon ? "block" : "none";
  if (els.signedOut) els.signedOut.style.display = isAnon ? "block" : "none";
  if (els.signedIn) els.signedIn.style.display = isAnon ? "none" : "block";
  if (els.signoutBtn) els.signoutBtn.style.display = isAnon ? "none" : "inline-flex";
  if (els.form) els.form.style.display = "";
}

function deriveDisplayName(user) {
  const meta = user?.user_metadata || {};
  return (
    meta.full_name ||
    meta.name ||
    [meta.first_name, meta.last_name].filter(Boolean).join(" ") ||
    (user?.email || "").split("@")[0] ||
    "Account"
  );
}

function deriveSubtitle(user) {
  const meta = user?.user_metadata || {};
  const appMeta = user?.app_metadata || {};
  return (
    meta.product ||
    meta.project ||
    meta.team ||
    meta.company ||
    meta.tenant ||
    appMeta.project ||
    "MNet Cloud"
  );
}

function deriveAccountName(user, fallback) {
  const meta = user?.user_metadata || {};
  return (
    meta.account ||
    meta.account_name ||
    meta.organisation ||
    meta.organization ||
    meta.company ||
    meta.tenant ||
    fallback
  );
}

function deriveRole(user) {
  const meta = user?.user_metadata || {};
  const appMeta = user?.app_metadata || {};
  return (
    meta.tier ||
    meta.plan ||
    meta.role ||
    appMeta.role ||
    ""
  );
}

function deriveInitials(name, email) {
  const source = (name || "").trim() || (email || "").split("@")[0] || "";
  if (!source) return "??";
  const letters = source
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase())
    .filter(Boolean);
  if (letters.length >= 2) {
    return `${letters[0]}${letters[letters.length - 1]}`;
  }
  const compact = source.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return compact.slice(0, 2) || "??";
}

function updateUserUI(user) {
  const isAnon = !user;
  currentUserId = user?.id || null;
  setAnonUI(isAnon);

  if (isAnon) {
    if (els.avatarText) els.avatarText.textContent = "??";
    if (els.displayName) els.displayName.textContent = "there";
    if (els.subtitle) els.subtitle.textContent = "MNet Cloud";
    if (els.accountName) els.accountName.textContent = "Guest";
    if (els.email) els.email.value = "";
    if (els.password) els.password.value = "";
    if (els.emailDisplay) {
      els.emailDisplay.textContent = "";
      els.emailDisplay.style.display = "none";
    }
    if (els.rolePill) {
      els.rolePill.textContent = "";
      els.rolePill.style.display = "none";
    }
    return;
  }

  const name = deriveDisplayName(user);
  const initials = deriveInitials(name, user.email);
  const subtitle = deriveSubtitle(user);
  const accountName = deriveAccountName(user, name);
  const roleLabel = deriveRole(user);

  if (els.avatarText) els.avatarText.textContent = initials;
  if (els.displayName) els.displayName.textContent = name;
  if (els.subtitle) {
    els.subtitle.textContent = subtitle;
    els.subtitle.style.display = subtitle ? "block" : "none";
  }
  if (els.accountName) els.accountName.textContent = accountName;
  if (els.emailDisplay) {
    els.emailDisplay.textContent = user.email || "";
    els.emailDisplay.style.display = user.email ? "block" : "none";
  }
  if (els.rolePill) {
    if (roleLabel) {
      els.rolePill.textContent = roleLabel;
      els.rolePill.style.display = "inline-flex";
    } else {
      els.rolePill.textContent = "";
      els.rolePill.style.display = "none";
    }
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (els.avatarBtn && els.menu) {
    els.avatarBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      const open = els.menu.style.display === "block";
      toggleMenu(!open);
    });

    document.addEventListener("click", (evt) => {
      if (els.menu && !els.menu.contains(evt.target) && !els.avatarBtn.contains(evt.target)) {
        toggleMenu(false);
      }
    });

    document.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape") toggleMenu(false);
    });
  }

  if (els.form) {
    els.form.addEventListener("submit", async (evt) => {
      evt.preventDefault();
      const email = (els.email?.value || "").trim();
      const password = (els.password?.value || "").trim();
      if (!email || !password) {
        alert("Enter email and password.");
        return;
      }
      if (els.signinBtn) els.signinBtn.disabled = true;
      try {
        const { error } = await signInWithPassword(email, password);
        if (error) throw error;
        if (els.password) els.password.value = "";
        toggleMenu(false);
      } catch (err) {
        console.error("[auth] sign-in failed:", err);
        alert(err.message || "Sign-in failed.");
      } finally {
        if (els.signinBtn) els.signinBtn.disabled = false;
      }
    });
  }

  if (els.signoutBtn) {
    els.signoutBtn.addEventListener("click", async () => {
      if (els.signoutBtn) els.signoutBtn.disabled = true;
      try {
        await signOut();
      } catch (err) {
        console.error("[auth] sign-out failed:", err);
        alert(err.message || "Sign-out failed.");
      } finally {
        if (els.signoutBtn) els.signoutBtn.disabled = false;
        toggleMenu(false);
      }
    });
  }

  const initialUser = await getUser();
  updateUserUI(initialUser);

  if (initialUser) {
    try {
      const migrated = await migrateLocalToCloud();
      if (migrated) {
        alert(`Saved ${migrated} local dataset(s) to your account.`);
      }
    } catch (err) {
      console.error("[auth] migrateLocalToCloud failed:", err);
    }
    try {
      try {
        const loadResult = await openAllDatasets({ forceRefresh: true, fitToBounds: true });
        if (loadResult?.error) {
          console.error("[auth] openAllDatasets error:", loadResult.error);
          alert("We signed you in but could not load your datasets from the cloud. Please check the console for details.");
        } else if (!loadResult?.groups?.length) {
          console.info("[auth] No datasets to draw for this user.");
        }
      } catch (err) {
        console.error("[auth] openAllDatasets threw:", err);
        alert("We signed you in but there was a problem drawing your datasets. Please check the console for details.");
      }
    } catch (err) {
      console.error("[auth] openAllDatasets threw:", err);
      alert("We signed you in but there was a problem drawing your datasets. Please check the console for details.");
    }
  }

  onAuthStateChanged(async (user) => {
    const previousUserId = currentUserId;
    updateUserUI(user);
    if (user) {
      try {
        const migrated = await migrateLocalToCloud();
        if (migrated) {
          alert(`Saved ${migrated} local dataset(s) to your account.`);
        }
      } catch (err) {
        console.error("[auth] migrateLocalToCloud failed:", err);
      }
      const loadResult = await openAllDatasets({ forceRefresh: true, fitToBounds: true });
      if (loadResult?.error) {
        console.error("[auth] openAllDatasets error:", loadResult.error);
        alert("We signed you in but could not load your datasets from the cloud. Please check the console for details.");
      } else if (!loadResult?.groups?.length) {
        console.info("[auth] No datasets to draw for this user.");
      }
    } else {
      if (Array.isArray(window._openedDatasetLayers)) {
        try { window._openedDatasetLayers.forEach((layer) => window.map.removeLayer(layer)); } catch {}
      }
      window._openedDatasetLayers = [];
      if (previousUserId) {
        try { await clearCloudCache(previousUserId); } catch (err) { console.error("[auth] clearCloudCache failed:", err); }
      }
      if (typeof window.resetMapView === "function") {
        window.resetMapView();
      }
      if (window._lastUploadedLayer) {
        try { window.map.removeLayer(window._lastUploadedLayer); } catch {}
        window._lastUploadedLayer = null;
      }
    }
  });
});
