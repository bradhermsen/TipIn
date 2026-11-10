import { api, getSession } from "./api.js";
import { $, esc, modal, toast } from "./ui.js";
import { teamHeader, wireTabs } from "./team.js";

export const canManageCoaches = (role) => ["SuperAdmin", "OrgAdmin"].includes(role);

export async function renderCoaches(app, teamId, navigate) {
  app.innerHTML = `<p class="muted">Loading coaches...</p>`;
  const header = await teamHeader(teamId, "coaches");
  const admin = canManageCoaches(getSession()?.role);
  let coaches, staff, invitations = [];
  try {
    [coaches, staff] = await Promise.all([
      api(`/coachteams/team/${teamId}`),
      api(`/coach/teams/${teamId}/staff`),
    ]);
    if (admin) invitations = await api(`/teams/${teamId}/coach-invites`);
  } catch (err) {
    app.innerHTML = header + `<div class="msg error">${esc(err.message)}</div>`;
    wireTabs(app, navigate);
    return;
  }
  app.innerHTML = header + `<div class="row spread"><h2>Coaches</h2>
    ${admin ? `<button type="button" id="invite-coach">Invite Coach</button>` : ""}</div>
    <p class="muted small">The Head Coach is managed in Admin. Assistant listings do not grant or remove account access. Only administrators can invite accounts.</p>
    <div class="card">${staff.map((s) => `<div class="player"><div class="name">${esc(s.name || (s.slot === 0 ? "Not listed" : "Available slot"))}
      <small>${esc(s.title)}${s.email ? " · " + esc(s.email) : ""}</small></div>
      ${s.slot ? `<button type="button" class="secondary" data-staff="${s.slot}">${s.name ? "Edit" : "Add"}</button>` : ""}</div>`).join("")}</div>
    <h2>Account access</h2>
    <div class="card">${coaches.length ? coaches.map((c) => `<div class="player">
      <div class="name">${esc([c.firstName, c.lastName].filter(Boolean).join(" ") || c.email)}
        <small>${esc(c.email)}</small></div></div>`).join("") : `<p class="muted">No coaches assigned.</p>`}</div>
    ${admin ? `<h2>Invitations</h2><div class="card">${invitations.length
      ? invitations.map((i) => `<div class="player"><div class="name">${esc(i.email)}
          <small>${esc(i.isExpired ? "Expired" : i.status)}</small></div></div>`).join("")
      : `<p class="muted">No invitations yet.</p>`}</div>` : ""}`;
  wireTabs(app, navigate);
  app.querySelectorAll("[data-staff]").forEach((btn) => {
    btn.onclick = () => editAssistant(teamId, staff.find((s) => s.slot === Number(btn.dataset.staff)),
      () => renderCoaches(app, teamId, navigate));
  });
  if (admin) $("#invite-coach", app).onclick = () => openInvite(teamId, () => renderCoaches(app, teamId, navigate));
}

function editAssistant(teamId, staff, reload) {
  const m = modal(`<h2>Assistant Coach</h2><form id="staff-form">
    <div id="staff-error" role="alert"></div>
    <label for="staff-name">Name</label><input id="staff-name" type="text" maxlength="100" required value="${esc(staff.name)}" />
    <label for="staff-email">Email (optional)</label><input id="staff-email" type="email" maxlength="254" value="${esc(staff.email)}" />
    <button type="submit" class="block">Save assistant</button></form>
    ${staff.name || staff.email ? `<button type="button" class="danger block" id="remove-staff">Remove assistant listing</button>` : ""}
    <button type="button" class="link-btn" id="close-staff">Cancel</button>`);
  $("#close-staff", m.el).onclick = m.close;
  const save = async (remove) => {
    m.el.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    try {
      await api(`/coach/teams/${teamId}/staff/assistants/${staff.slot}`, {
        method: "PUT", body: { name: remove ? null : $("#staff-name", m.el).value.trim(),
          email: remove ? null : $("#staff-email", m.el).value.trim(),
          expectedName: staff.name, expectedEmail: staff.email },
      });
      m.close(); toast(remove ? "Assistant listing removed" : "Assistant saved"); reload();
    } catch (err) {
      $("#staff-error", m.el).innerHTML = `<div class="msg error">${esc(err.message)}</div>`;
      m.el.querySelectorAll("button").forEach((b) => { b.disabled = false; });
    }
  };
  $("#staff-form", m.el).onsubmit = (e) => { e.preventDefault(); save(false); };
  const remove = $("#remove-staff", m.el);
  if (remove) remove.onclick = () => {
    if (confirm("Remove this assistant staff listing? Account access will not change.")) save(true);
  };
}

function openInvite(teamId, reload) {
  if (!canManageCoaches(getSession()?.role)) return;
  const m = modal(`<h2>Invite Coach</h2>
    <p class="muted small">The coach must accept the email invitation before receiving access to this team.</p>
    <form id="invite-form"><div id="invite-error" role="alert"></div>
      <label for="coach-email">Coach email</label>
      <input id="coach-email" type="email" autocomplete="email" required />
      <button type="submit" class="block">Send invitation</button>
    </form><div id="invite-result"></div>
    <button type="button" class="link-btn" id="close-invite">Cancel</button>`);
  $("#close-invite", m.el).onclick = m.close;
  $("#invite-form", m.el).onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("button[type=submit]", m.el);
    btn.disabled = true;
    $("#invite-error", m.el).textContent = "";
    try {
      const result = await api(`/teams/${teamId}/coach-invites`, {
        method: "POST", body: { email: $("#coach-email", m.el).value.trim() },
      });
      $("#invite-form", m.el).hidden = true;
      $("#invite-result", m.el).innerHTML = `<div class="msg ${result.emailSent ? "ok" : "warn"}">
        ${result.emailSent ? "Invitation emailed." : "Invitation created, but the email was not sent. Share the invitation link with this coach."}</div>
        <label for="invite-link">Invitation link (expires in 7 days)</label>
        <input id="invite-link" type="text" readonly value="${esc(result.link)}" />`;
      $("#close-invite", m.el).textContent = "Done";
      $("#close-invite", m.el).onclick = () => { m.close(); reload(); };
      if (result.emailSent) toast("Invitation sent");
    } catch (err) {
      $("#invite-error", m.el).innerHTML = `<div class="msg error">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
  };
}
