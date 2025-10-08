import { onAuthStateChanged, signInWithPassword, signOut } from "./auth.js";
import { migrateLocalToCloud } from "./data.js";

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

function showMenu(open) {
  if (!els.menu) return;
  els.menu.style.display = open ? "block" : "none";
}

els.avatarBtn?.addEventListener("click", (evt) => {
  evt.stopPropagation();
  const open = els.menu?.style.display !== "block";
  showMenu(open);
});

document.addEventListener("click", () => showMenu(false));
els.menu?.addEventListener("click", (evt) => evt.stopPropagation());
document.addEventListener("keydown", (evt) => {
  if (evt.key === "Escape") showMenu(false);
});

document.getElementById("profile-preferences-btn")?.addEventListener("click", (evt) => {
  evt.preventDefault();
  alert("Preferences are coming soon.");
});

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
  if (!source) return "👤";
  const letters = source
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase())
    .filter(Boolean);
  if (letters.length >= 2) {
    return `${letters[0]}${letters[letters.length - 1]}`;
  }
  const compact = source.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return compact.slice(0, 2) || "👤";
}

els.form?.addEventListener("submit", async (evt) => {
  evt.preventDefault();
  const email = (els.email?.value || "").trim();
  const password = els.password?.value || "";
  if (!email || !password) {
    alert("Enter email and password.");
    return;
  }
  if (els.signinBtn) els.signinBtn.disabled = true;
  try {
    const { error } = await signInWithPassword(email, password);
    if (error) throw error;
    showMenu(false);
  } catch (err) {
    alert(err.message || "Sign-in failed");
  } finally {
    if (els.signinBtn) els.signinBtn.disabled = false;
    if (els.password) els.password.value = "";
  }
});

els.signoutBtn?.addEventListener("click", async () => {
  await signOut();
  showMenu(false);
});

onAuthStateChanged(async (user) => {
  const loggedIn = !!user;
  const name = loggedIn ? deriveDisplayName(user) : "";
  const initials = loggedIn ? deriveInitials(name, user?.email) : "👤";
  const subtitle = loggedIn ? deriveSubtitle(user) : "MNet Cloud";
  const accountName = loggedIn ? deriveAccountName(user, name) : "Guest";
  const roleLabel = loggedIn ? deriveRole(user) : "";

  if (els.anonBanner) els.anonBanner.style.display = loggedIn ? "none" : "block";
  if (els.signedOut) els.signedOut.style.display = loggedIn ? "none" : "block";
  if (els.signedIn) els.signedIn.style.display = loggedIn ? "block" : "none";
  if (els.signoutBtn) els.signoutBtn.style.display = loggedIn ? "inline-flex" : "none";
  if (els.form) els.form.style.display = loggedIn ? "none" : "block";
  if (els.avatarText) els.avatarText.textContent = initials;
  if (els.subtitle) {
    els.subtitle.textContent = subtitle;
    els.subtitle.style.display = subtitle ? "block" : "none";
  }
  if (els.accountName) els.accountName.textContent = accountName;
  if (els.rolePill) {
    if (roleLabel) {
      els.rolePill.textContent = roleLabel;
      els.rolePill.style.display = "inline-flex";
    } else {
      els.rolePill.style.display = "none";
    }
  }

  if (loggedIn) {
    if (els.displayName) els.displayName.textContent = name;
    if (els.emailDisplay) {
      els.emailDisplay.textContent = user?.email || "";
      els.emailDisplay.style.display = user?.email ? "block" : "none";
    }
  } else {
    if (els.menu) showMenu(false);
    if (els.displayName) els.displayName.textContent = "there";
    if (els.emailDisplay) {
      els.emailDisplay.textContent = "";
      els.emailDisplay.style.display = "none";
    }
    if (els.rolePill) {
      els.rolePill.textContent = "";
      els.rolePill.style.display = "none";
    }
  }

  if (loggedIn) {
    const migrated = await migrateLocalToCloud();
    if (migrated) {
      alert(`Saved ${migrated} local dataset(s) to your account.`);
    }
  }
});
