export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const $ = (sel, root = document) => root.querySelector(sel);

let toastTimer;
export function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

export function modal(html) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  back.addEventListener("click", (e) => {
    if (e.target === back) back.remove();
  });
  document.body.appendChild(back);
  const first = back.querySelector("input, select, button");
  if (first) first.focus();
  return { el: back.firstElementChild, close: () => back.remove() };
}

export const POSITIONS = [
  ["", "No position"],
  ["F", "Forward"],
  ["D", "Defense"],
  ["G", "Goalie"],
];

export const positionLabel = (p) => (POSITIONS.find(([v]) => v === (p || "")) || ["", p || ""])[1];

export function formatGameTime(iso) {
  // Game times are stored as local wall-clock time, so a zone-less string is parsed as local
  const d = new Date(iso);
  return d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function needsLineup(game, now = new Date()) {
  if (!game.isTipInManaged) return false;
  const date = new Date(game.gameDateTime);
  if (Number.isNaN(date.getTime())) throw new Error("Cannot check lineup reminder: invalid game date.");
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(today);
  end.setDate(end.getDate() + 11);
  return game.needsLineup && date >= today && date < end;
}
