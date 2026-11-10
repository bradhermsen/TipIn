const teamRoute = /^\/teams\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?:\/(?:roster|coaches|games(?:\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})?))?$/i;

export function loginPath(path) {
  return teamRoute.test(path) ? `/login?returnTo=${encodeURIComponent(path)}` : "/login";
}

export function loginDestination(search) {
  const path = new URLSearchParams(search).get("returnTo") || "";
  return teamRoute.test(path) ? path : "/";
}
