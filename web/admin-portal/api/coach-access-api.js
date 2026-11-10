// =========================================================
// COACH ACCESS API (invitations, coach removal, lineup unlock)
// =========================================================

const CoachAccessApi = {
  async readError(res, fallback) {
    try {
      const body = await res.json();
      return body.error || body.message || fallback;
    } catch {
      return fallback;
    }
  },

  async listInvites(teamId) {
    const res = await authFetch(`/teams/${teamId}/coach-invites`);
    if (!res.ok) throw new Error(await this.readError(res, "Failed to load invitations"));
    return await res.json();
  },

  async invite(teamId, email) {
    const res = await authFetch(`/teams/${teamId}/coach-invites`, {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to send invitation"));
    return await res.json();
  },

  async revoke(invitationId) {
    const res = await authFetch(`/coach-invites/${invitationId}/revoke`, { method: "POST" });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to revoke invitation"));
  },

  async removeCoach(userId, teamId) {
    const res = await authFetch("/coachteams/remove", {
      method: "POST",
      body: JSON.stringify({ userId, teamId }),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to remove coach"));
  },

  async getLineup(gameId, teamId) {
    // Admin read goes through the coach route, which allows admins scoped to the team
    const res = await authFetch(`/coach/games/${gameId}/teams/${teamId}/lineup`);
    if (!res.ok) throw new Error(await this.readError(res, "Failed to load lineup"));
    return await res.json();
  },

  async unlockLineup(gameId, teamId, reason) {
    const res = await authFetch(`/admin/games/${gameId}/teams/${teamId}/lineup/unlock`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw new Error(await this.readError(res, "Failed to unlock lineup"));
  },
};
