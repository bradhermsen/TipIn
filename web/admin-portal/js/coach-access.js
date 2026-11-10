// =========================================================
// COACH ACCESS MODAL (team cards on the Teams page)
// =========================================================

const CoachAccessUi = {
  teamId: null,

  canManage() {
    const role = (localStorage.getItem("nf_role") || "").toLowerCase();
    return role === "superadmin" || role === "orgadmin";
  },

  canUnlock() {
    const role = (localStorage.getItem("nf_role") || "").toLowerCase();
    return role === "superadmin" || role === "orgadmin" || role === "orgowner";
  },

  async openLineups(game, teams) {
    this.ensureLineupModal();
    const nameOf = (id) => teams.find((t) => t.teamId === id)?.name || "Team";
    this.lineupGame = {
      gameId: game.gameId,
      sides: [
        { teamId: game.homeTeamId, name: nameOf(game.homeTeamId) },
        { teamId: game.awayTeamId, name: nameOf(game.awayTeamId) },
      ],
    };
    const overlay = document.getElementById("lineupOverlay");
    overlay.classList.remove("hidden");
    overlay.classList.add("active");
    await this.refreshLineups();
  },

  ensureLineupModal() {
    if (document.getElementById("lineupOverlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "lineupOverlay";
    overlay.className = "nf-modal-overlay hidden";
    overlay.innerHTML = `
      <div class="nf-modal">
        <div class="nf-modal-header"><h2>Game Lineups</h2></div>
        <div class="nf-modal-body full">
          <div id="lineupBody"></div>
          <p id="lineupMessage" style="margin-top:8px"></p>
        </div>
        <div class="nf-modal-footer">
          <button id="lineupClose" class="nf-btn nf-btn-secondary">Close</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById("lineupClose").onclick = () => {
      overlay.classList.remove("active");
      overlay.classList.add("hidden");
    };
  },

  setLineupMessage(text, isError = false) {
    const el = document.getElementById("lineupMessage");
    el.textContent = text;
    el.style.color = isError ? "#b00020" : "inherit";
  },

  async refreshLineups() {
    const body = document.getElementById("lineupBody");
    body.textContent = "Loading…";
    const { gameId, sides } = this.lineupGame;
    const rows = [];
    for (const side of sides) {
      let detail;
      try {
        const lineup = await CoachAccessApi.getLineup(gameId, side.teamId);
        if (lineup.locked) {
          const when = lineup.signedAtUtc ? new Date(lineup.signedAtUtc).toLocaleString() : "";
          detail = `Signed by ${this.escape(lineup.signedBy)} ${this.escape(when)}${lineup.signedVerified ? "" : " (tablet, unverified)"}
            <button class="nf-btn nf-btn-danger" data-unlock="${side.teamId}" style="margin-left:8px">Unlock</button>`;
        } else if (lineup.version > 0) {
          detail = `Saved, not signed (${lineup.starterIds.length} starters)`;
        } else {
          detail = "No lineup yet";
        }
      } catch (err) {
        detail = this.escape(err.message);
      }
      rows.push(`<div style="padding:6px 0"><strong>${this.escape(side.name)}</strong><br>${detail}</div>`);
    }
    body.innerHTML = rows.join("");
    body.querySelectorAll("[data-unlock]").forEach((btn) => {
      btn.onclick = () => this.unlock(btn.dataset.unlock);
    });
  },

  async unlock(teamId) {
    const reason = prompt("Reason for unlocking this lineup (required, recorded in the audit log):");
    if (reason === null) return;
    if (!reason.trim()) {
      this.setLineupMessage("A reason is required.", true);
      return;
    }
    try {
      await CoachAccessApi.unlockLineup(this.lineupGame.gameId, teamId, reason.trim());
      this.setLineupMessage("Lineup unlocked. The coach must sign again.");
      await this.refreshLineups();
    } catch (err) {
      this.setLineupMessage(err.message, true);
    }
  },

  escape(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
  },

  ensureModal() {
    if (document.getElementById("coachAccessOverlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "coachAccessOverlay";
    overlay.className = "nf-modal-overlay hidden";
    overlay.innerHTML = `
      <div class="nf-modal">
        <div class="nf-modal-header"><h2 id="coachAccessTitle">Coach Access</h2></div>
        <div class="nf-modal-body full">
          <h4>Coaches with access</h4>
          <div id="coachAccessCoaches"></div>
          <h4 style="margin-top:16px">Invite a coach</h4>
          <div style="display:flex;gap:8px">
            <input id="coachAccessEmail" type="email" class="nf-input" placeholder="coach@example.com" style="flex:1" />
            <button id="coachAccessSend" class="nf-btn nf-btn-primary">Send Invite</button>
          </div>
          <p id="coachAccessMessage" style="margin-top:8px"></p>
          <h4 style="margin-top:16px">Invitations</h4>
          <div id="coachAccessInvites"></div>
        </div>
        <div class="nf-modal-footer">
          <button id="coachAccessClose" class="nf-btn nf-btn-secondary">Close</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById("coachAccessClose").onclick = () => this.close();
    document.getElementById("coachAccessSend").onclick = () => this.sendInvite();
  },

  async open(teamId, teamName) {
    this.ensureModal();
    this.teamId = teamId;
    document.getElementById("coachAccessTitle").textContent = `Coach Access – ${teamName || "Team"}`;
    document.getElementById("coachAccessEmail").value = "";
    this.setMessage("");
    const overlay = document.getElementById("coachAccessOverlay");
    overlay.classList.remove("hidden");
    overlay.classList.add("active");
    await this.refresh();
  },

  close() {
    const overlay = document.getElementById("coachAccessOverlay");
    overlay.classList.remove("active");
    overlay.classList.add("hidden");
  },

  setMessage(text, isError = false) {
    const el = document.getElementById("coachAccessMessage");
    el.textContent = text;
    el.style.color = isError ? "#b00020" : "inherit";
  },

  async refresh() {
    const teamId = this.teamId;
    const coachesEl = document.getElementById("coachAccessCoaches");
    const invitesEl = document.getElementById("coachAccessInvites");
    coachesEl.textContent = "Loading…";
    invitesEl.textContent = "Loading…";

    try {
      const coaches = await CoachTeamsApi.getCoachesForTeam(teamId);
      coachesEl.innerHTML = coaches.length
        ? coaches
            .map(
              (c) => `<div style="display:flex;justify-content:space-between;padding:4px 0">
                <span>${this.escape(`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim())} &lt;${this.escape(c.email)}&gt;</span>
                <button class="nf-btn nf-btn-danger" data-remove="${c.userId}">Remove</button>
              </div>`,
            )
            .join("")
        : "<em>No coaches yet.</em>";
      coachesEl.querySelectorAll("[data-remove]").forEach((btn) => {
        btn.onclick = () => this.removeCoach(btn.dataset.remove);
      });
    } catch (err) {
      coachesEl.textContent = err.message;
    }

    try {
      const invites = await CoachAccessApi.listInvites(teamId);
      invitesEl.innerHTML = invites.length
        ? invites
            .map((i) => {
              const status = i.status === "Pending" && i.isExpired ? "Expired" : i.status;
              const revoke =
                i.status === "Pending" && !i.isExpired
                  ? `<button class="nf-btn nf-btn-secondary" data-revoke="${i.invitationId}">Revoke</button>`
                  : "";
              return `<div style="display:flex;justify-content:space-between;padding:4px 0">
                <span>${this.escape(i.email)} – ${this.escape(status)}</span>${revoke}
              </div>`;
            })
            .join("")
        : "<em>No invitations.</em>";
      invitesEl.querySelectorAll("[data-revoke]").forEach((btn) => {
        btn.onclick = () => this.revoke(btn.dataset.revoke);
      });
    } catch (err) {
      invitesEl.textContent = err.message;
    }
  },

  async sendInvite() {
    const input = document.getElementById("coachAccessEmail");
    const email = input.value.trim();
    if (!email) {
      this.setMessage("Enter an email address.", true);
      return;
    }
    const button = document.getElementById("coachAccessSend");
    button.disabled = true;
    try {
      const result = await CoachAccessApi.invite(this.teamId, email);
      input.value = "";
      this.setMessage(
        result.emailSent
          ? `Invitation emailed to ${result.email}.`
          : `Email is not enabled. Share this link with ${result.email}: ${result.link}`,
      );
      await this.refresh();
    } catch (err) {
      this.setMessage(err.message, true);
    } finally {
      button.disabled = false;
    }
  },

  async revoke(invitationId) {
    try {
      await CoachAccessApi.revoke(invitationId);
      await this.refresh();
    } catch (err) {
      this.setMessage(err.message, true);
    }
  },

  async removeCoach(userId) {
    if (!confirm("Remove this coach's access to the team?")) return;
    try {
      await CoachAccessApi.removeCoach(userId, this.teamId);
      await this.refresh();
    } catch (err) {
      this.setMessage(err.message, true);
    }
  },
};
