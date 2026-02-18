import { supabase } from "./supabaseClient.js";

const loginForm = document.getElementById("loginForm");
const forgotForm = document.getElementById("forgotForm");
const setPwForm = document.getElementById("setPwForm");

const msg = document.getElementById("msg");
const forgotLink = document.getElementById("forgotLink");
const backToLogin1 = document.getElementById("backToLogin1");
const backToLogin2 = document.getElementById("backToLogin2");
const setPwNote = document.getElementById("setPwNote");

function setMode(mode) {
  loginForm.classList.toggle("hidden", mode !== "login");
  forgotForm.classList.toggle("hidden", mode !== "forgot");
  setPwForm.classList.toggle("hidden", mode !== "setpw");
  msg.textContent = "";
  msg.style.color = "var(--danger)";
}

function isRecoveryUrl() {
  // Supabase recovery links usually arrive as URL hash:
  // #access_token=...&refresh_token=...&type=recovery
  const u = new URL(location.href);
  const type = (u.searchParams.get("type") || "").toLowerCase();
  const hash = location.hash && location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const hashType = (new URLSearchParams(hash).get("type") || "").toLowerCase();
  return type === "recovery" || hashType === "recovery";
}

async function requireProfileOrSignOut(user) {
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("role, full_name, email")
    .eq("id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pErr || !profile) {
    console.error("PROFILE SELECT ERROR:", pErr);
    msg.textContent = `Profile check failed: ${pErr?.message || "No profile row found for this Auth user"}`;
    await supabase.auth.signOut();
    return null;
  }

  return profile;
}

async function finishAuthRedirect() {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session?.user) {
    msg.textContent = "Session not found. Please sign in again.";
    setMode("login");
    return;
  }

  const profile = await requireProfileOrSignOut(session.user);
  if (!profile) return;

  // Clear recovery tokens from the URL so refresh doesn't re-enter recovery.
  if (location.hash) history.replaceState(null, "", location.pathname);
  window.location.href = "./app.html";
}

forgotLink.addEventListener("click", () => {
  setMode("forgot");
  document.getElementById("forgotEmail").value = document.getElementById("email").value.trim();
});

backToLogin1.addEventListener("click", () => setMode("login"));
backToLogin2.addEventListener("click", async () => {
  await supabase.auth.signOut();
  setMode("login");
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "Signing in...";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    msg.textContent = error.message;
    return;
  }

  const user = data.user;

  const profile = await requireProfileOrSignOut(user);
  if (!profile) return;

  if (user.user_metadata?.must_change_password === true) {
    setPwNote.textContent = "First login: please set a new password before continuing.";
    setMode("setpw");
    return;
  }

  window.location.href = "./app.html";
});

forgotForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "Sending reset link...";

  const email = document.getElementById("forgotEmail").value.trim();
  const redirectTo = new URL("./index.html", location.href).toString();

  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    msg.textContent = error.message;
    return;
  }

  msg.style.color = "var(--success)";
  msg.textContent = "If an account exists for that email, a reset link has been sent.";
});

setPwForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "Updating password...";
  msg.style.color = "var(--danger)";

  const { data: sessData } = await supabase.auth.getSession();
  if (!sessData.session?.user) {
    msg.textContent = "Session not found. Please open the reset link again or sign in.";
    return;
  }

  const pw1 = document.getElementById("newPassword").value;
  const pw2 = document.getElementById("newPassword2").value;

  if (!pw1 || pw1.length < 8) {
    msg.textContent = "Password must be at least 8 characters.";
    return;
  }
  if (pw1 !== pw2) {
    msg.textContent = "Passwords do not match.";
    return;
  }

  const { error } = await supabase.auth.updateUser({
    password: pw1,
    data: { must_change_password: false },
  });

  if (error) {
    msg.textContent = error.message;
    return;
  }

  msg.style.color = "var(--success)";
  msg.textContent = "Password updated.";
  await finishAuthRedirect();
});

async function initRecoveryIfPresent() {
  const u = new URL(location.href);
  const code = u.searchParams.get("code");

  // Some Supabase links arrive as ?code=... (PKCE) rather than hash tokens.
  if (code) {
    try {
      await supabase.auth.exchangeCodeForSession(code);
      // Remove code from URL to avoid re-exchange on refresh.
      u.searchParams.delete("code");
      history.replaceState(null, "", u.toString());
    } catch (e) {
      msg.textContent = `Recovery link error: ${e?.message || e}`;
      return;
    }
  }

  if (isRecoveryUrl()) {
    setPwNote.textContent = "Password recovery: set a new password to continue.";
    setMode("setpw");
  }
}

initRecoveryIfPresent();
