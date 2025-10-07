import { onAuthStateChanged, signInWithPassword, signOut } from "./auth.js";
import { migrateLocalToCloud } from "./data.js";

const els = {
  avatarBtn: document.getElementById("profile-button"),
  menu: document.getElementById("profile-menu"),
  form: document.getElementById("signin-form"),
  email: document.getElementById("signin-email"),
  password: document.getElementById("signin-password"),
  signinBtn: document.getElementById("signin-submit"),
  signoutBtn: document.getElementById("signout-submit"),
  anonBanner: document.getElementById("anon-banner"),
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

els.form?.addEventListener("submit", async (evt) => {
  evt.preventDefault();
  const email = (els.email?.value || "").trim();
  const password = els.password?.value || "";
  if (!email || !password) {
    alert("Enter email and password.");
    return;
  }
  els.signinBtn.disabled = true;
  try {
    const { error } = await signInWithPassword(email, password);
    if (error) throw error;
    showMenu(false);
  } catch (err) {
    alert(err.message || "Sign-in failed");
  } finally {
    els.signinBtn.disabled = false;
    if (els.password) els.password.value = "";
  }
});

els.signoutBtn?.addEventListener("click", async () => {
  await signOut();
  showMenu(false);
});

onAuthStateChanged(async (user) => {
  const loggedIn = !!user;
  if (els.anonBanner) els.anonBanner.style.display = loggedIn ? "none" : "block";
  if (els.form) els.form.style.display = loggedIn ? "none" : "block";
  if (els.signoutBtn) els.signoutBtn.style.display = loggedIn ? "block" : "none";

  if (loggedIn) {
    const migrated = await migrateLocalToCloud();
    if (migrated) {
      alert(`Saved ${migrated} local dataset(s) to your account.`);
    }
  }
});
