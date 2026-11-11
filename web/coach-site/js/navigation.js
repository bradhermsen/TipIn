const teamRoute = /^\/teams\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?:\/(?:roster(?:\/print)?|coaches|games(?:\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})?))?$/i;
const supportedRoute = (path) => path === "/players" || teamRoute.test(path);

export function loginPath(path) {
  return supportedRoute(path) ? `/login?returnTo=${encodeURIComponent(path)}` : "/login";
}

export function loginDestination(search) {
  const path = new URLSearchParams(search).get("returnTo") || "";
  return supportedRoute(path) ? path : "/";
}
