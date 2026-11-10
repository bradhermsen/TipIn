import { loadConfig, getSession, login, logout, publicApi, api } from "./api.js";
import { $, esc } from "./ui.js";
import { renderRoster } from "./roster.js";
import { renderGames, renderLineup } from "./lineup.js";

const app = $("#app");
const topbar = $("#topbar");

// Tokens arrive in the URL fragment so they never reach server logs. Keep them in memory only.
let fragmentToken = "";
function captureFragmentToken() {
  const m = /[#&]token=([^&]+)/.exec(location.hash);
  if (m) {
    fragmentToken = decodeURIComponent(m[1]);
    history.replaceState(null, "", location.pathname + location.search);
  }
}

export function navigate(path, replace = false) {
  history[replace ? "replaceState" : "pushState"](null, "", path);
  route();
}

document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]");
  if (a && a.origin === location.origin) {
    e.preventDefault();
    navigate(a.pathname + a.search);
  }
});
window.addEventListener("popstate", route);
window.addEventListener("session-expired", () => navigate("/login", true));
$("#signout").addEventListener("click", async () => {
  await logout();
  navigate("/login", true);
});

const msg = (kind, text) => `<div class="msg ${kind}">${esc(text)}</div>`;

function authShell(title, body) {
  return `<div class="auth-wrap">
    <div class="auth-logo"><img src="/assets/tipin-logo.png" alt="TipIn" />
      <h1><b class="tip">Tip</b><b class="in">In</b> Scoring</h1>
      <div class="muted">${esc(title)}</div></div>
    <div class="card">${body}</div></div>`;
}

function busy(btn, on, label) {
  btn.disabled = on;
  if (label) btn.textContent = label;
}

function renderLogin(notice) {
  app.innerHTML = authShell(
    "Coach sign in",
    `<form id="f" novalidate>
      ${notice || ""}<div id="err"></div>
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="username" inputmode="email" required />
      <label for="pw">Password</label>
      <input id="pw" type="password" autocomplete="current-password" required />
      <label class="check"><input id="keep" type="checkbox" /> Keep me signed in on this device</label>
      <button class="block" type="submit">Sign in</button>
      <p class="small" style="text-align:center"><a href="/forgot" data-link>Forgot your password?</a></p>
    </form>`
  );
  $("#f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#f button");
    busy(btn, true, "Signing in…");
    try {
      await login($("#email").value.trim(), $("#pw").value, $("#keep").checked);
      navigate("/", true);
    } catch (err) {
      $("#err").innerHTML = msg("error", err.status === 401 ? "Incorrect email or password." : err.message);
      busy(btn, false, "Sign in");
    }
  });
}

function renderForgot() {
  app.innerHTML = authShell(
    "Reset your password",
    `<form id="f" novalidate><div id="note"></div>
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="username" inputmode="email" required />
      <button class="block" type="submit">Email me a reset link</button>
      <p class="small" style="text-align:center"><a href="/login" data-link>Back to sign in</a></p></form>`
  );
  $("#f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#f button");
    busy(btn, true, "Sending…");
    try {
      await publicApi("/auth/forgot-password", { email: $("#email").value.trim() });
      $("#note").innerHTML = msg("ok", "If an account exists for that email, a reset link has been sent.");
    } catch (err) {
      $("#note").innerHTML = msg("error", err.message);
    }
    busy(btn, false, "Email me a reset link");
  });
}

function renderReset(token) {
  if (!token) {
    app.innerHTML = authShell("Reset your password", msg("error", "This reset link is missing its token. Open the link from your email again.") +
      `<p class="small"><a href="/forgot" data-link>Request a new link</a></p>`);
    return;
  }
  app.innerHTML = authShell(
    "Choose a new password",
    `<form id="f" novalidate><div id="err"></div>
      <label for="pw">New password (10+ characters)</label>
      <input id="pw" type="password" autocomplete="new-password" minlength="10" required />
      <label for="pw2">Confirm password</label>
      <input id="pw2" type="password" autocomplete="new-password" required />
      <button class="block" type="submit">Set password</button></form>`
  );
  $("#f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = $("#pw").value;
    if (pw.length < 10) return ($("#err").innerHTML = msg("error", "Use at least 10 characters."));
    if (pw !== $("#pw2").value) return ($("#err").innerHTML = msg("error", "The passwords don't match."));
    const btn = $("#f button");
    busy(btn, true, "Saving…");
    try {
      await publicApi("/auth/reset-password", { token, password: pw });
      navigate("/login?reset=1", true);
    } catch (err) {
      $("#err").innerHTML = msg("error", err.message);
      busy(btn, false, "Set password");
    }
  });
}

function renderAccept(token) {
  if (!token) {
    app.innerHTML = authShell("Accept invitation", msg("error", "This invitation link is missing its token. Open the link from your email again."));
    return;
  }
  let isNew = true;
  const draw = () => {
    app.innerHTML = authShell(
      "Accept your coaching invitation",
      `<form id="f" novalidate><div id="err"></div>
        <div class="tabs" role="tablist">
          <button type="button" role="tab" id="t-new" aria-selected="${isNew}">I'm new</button>
          <button type="button" role="tab" id="t-old" aria-selected="${!isNew}">I have an account</button>
        </div>
        <label for="email">Email the invitation was sent to</label>
        <input id="email" type="email" autocomplete="username" inputmode="email" required />
        ${isNew ? `<div class="grid2"><div><label for="fn">First name</label><input id="fn" type="text" autocomplete="given-name" /></div>
          <div><label for="ln">Last name</label><input id="ln" type="text" autocomplete="family-name" /></div></div>` : ""}
        <label for="pw">${isNew ? "Choose a password (10+ characters)" : "Your current password"}</label>
        <input id="pw" type="password" autocomplete="${isNew ? "new-password" : "current-password"}" required />
        ${isNew ? `<label for="pw2">Confirm password</label><input id="pw2" type="password" autocomplete="new-password" />` : ""}
        <button class="block" type="submit">Accept invitation</button></form>`
    );
    $("#t-new").onclick = () => ((isNew = true), draw());
    $("#t-old").onclick = () => ((isNew = false), draw());
    $("#f").addEventListener("submit", submit);
  };

  async function submit(e) {
    e.preventDefault();
    const email = $("#email").value.trim();
    const password = $("#pw").value;
    const err = $("#err");
    if (isNew) {
      if (!$("#fn").value.trim() || !$("#ln").value.trim()) return (err.innerHTML = msg("error", "First and last name are required."));
      if (password.length < 10) return (err.innerHTML = msg("error", "Use at least 10 characters."));
      if (password !== $("#pw2").value) return (err.innerHTML = msg("error", "The passwords don't match."));
    }
    const btn = $("#f button[type=submit]");
    busy(btn, true, "Accepting…");
    try {
      await publicApi("/coach-invites/accept", {
        token, email, password,
        firstName: isNew ? $("#fn").value.trim() : null,
        lastName: isNew ? $("#ln").value.trim() : null,
      });
      fragmentToken = "";
      await login(email, password, false);
      navigate("/", true);
    } catch (ex) {
      err.innerHTML = msg("error", ex.message);
      busy(btn, false, "Accept invitation");
    }
  }
  draw();
}

async function renderHome(session) {
  app.innerHTML = `<p class="muted">Loading your teams…</p>`;
  let teams;
  try {
    teams = await api(`/coachteams/coach/${session.userId}`);
  } catch (err) {
    app.innerHTML = msg("error", err.message);
    return;
  }
  if (teams.length === 1) return navigate(`/teams/${teams[0].teamId}`, true);
  app.innerHTML = `<h1>Your teams</h1>` + (teams.length
    ? teams.map((t) => `<a class="card" href="/teams/${esc(t.teamId)}" data-link><b>${esc(t.teamName)}</b></a>`).join("")
    : `<div class="card muted">No teams are assigned to your account yet. Ask your administrator for an invitation.</div>`);
}

export async function route() {
  captureFragmentToken();
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const session = getSession();
  const publicRoutes = ["/login", "/forgot", "/reset", "/accept"];
  const isPublic = publicRoutes.includes(path);

  topbar.hidden = isPublic || !session;
  if (!isPublic && !session) return navigate("/login", true);
  window.scrollTo(0, 0);

  if (path === "/login") {
    if (session) return navigate("/", true);
    const notice = new URLSearchParams(location.search).get("reset") ? msg("ok", "Password updated. Sign in with your new password.") : "";
    return renderLogin(notice);
  }
  if (path === "/forgot") return renderForgot();
  if (path === "/reset") return renderReset(fragmentToken);
  if (path === "/accept") return renderAccept(fragmentToken);

  if (path === "/") return renderHome(session);
  let m;
  if ((m = /^\/teams\/([0-9a-f-]{36})$/i.exec(path))) return renderRoster(app, m[1], navigate);
  if ((m = /^\/teams\/([0-9a-f-]{36})\/games$/i.exec(path))) return renderGames(app, m[1], navigate);
  if ((m = /^\/teams\/([0-9a-f-]{36})\/games\/([0-9a-f-]{36})$/i.exec(path))) return renderLineup(app, m[1], m[2], navigate);
  app.innerHTML = msg("error", "Page not found.") + `<p><a href="/" data-link>Go home</a></p>`;
}

(async () => {
  try {
    await loadConfig();
  } catch {
    app.innerHTML = msg("error", "The site is not configured correctly.");
    return;
  }
  route();
})();
