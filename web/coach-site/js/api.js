// API client and session handling for the coach site.
// With "keep me signed in" the refresh token lives in localStorage; otherwise the session only
// lasts for the browser tab (sessionStorage).

let apiBase = "";

export async function loadConfig() {
  const res = await fetch("/config.json", { cache: "no-store" });
  apiBase = (await res.json()).apiBase.replace(/\/$/, "");
}

const KEY = "tipin_coach_session";

export function getSession() {
  const raw = localStorage.getItem(KEY) || sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveSession(session) {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
  if (!session) return;
  (session.refreshToken ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(session));
}

export class ApiError extends Error {
  constructor(status, data, message) {
    super(message);
    this.status = status;
    this.data = data;
    this.code = data && data.details && data.details.code;
  }
}

async function parse(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

async function rawFetch(path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(apiBase + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, null, "Can't reach the server. Check your connection and try again.");
  }
  const data = await parse(res);
  if (!res.ok || (data && typeof data.error === "string")) {
    const message = (data && (data.error || data.message)) || `Request failed (${res.status})`;
    throw new ApiError(res.status, data, message);
  }
  return data;
}

let refreshing = null;

async function refreshSession() {
  const session = getSession();
  if (!session || !session.refreshToken) return false;
  if (!refreshing) {
    refreshing = rawFetch("/auth/refresh", { method: "POST", body: { refreshToken: session.refreshToken } })
      .then((r) => {
        saveSession({ ...session, token: r.token, refreshToken: r.refreshToken, role: r.role, userId: r.userId });
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export async function api(path, options = {}) {
  const session = getSession();
  try {
    return await rawFetch(path, { ...options, token: session && session.token });
  } catch (err) {
    if (err.status === 401 && session) {
      if (await refreshSession()) {
        return rawFetch(path, { ...options, token: getSession().token });
      }
      saveSession(null);
      window.dispatchEvent(new Event("session-expired"));
    }
    throw err;
  }
}

export async function login(email, password, keepSignedIn) {
  const r = await rawFetch("/auth/login", { method: "POST", body: { email, password, keepSignedIn } });
  saveSession({ token: r.token, refreshToken: r.refreshToken || null, role: r.role, userId: r.userId, email });
  return r;
}

export async function logout() {
  const session = getSession();
  saveSession(null);
  if (session && session.refreshToken) {
    try {
      await rawFetch("/auth/logout", { method: "POST", body: { refreshToken: session.refreshToken } });
    } catch {
      /* signing out locally is enough */
    }
  }
}

export const publicApi = (path, body) => rawFetch(path, { method: "POST", body });
