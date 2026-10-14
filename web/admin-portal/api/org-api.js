// org-api.js

const OrgApi = {
  async getAll(options = {}) {
    const res = await authFetch("/organizations");
    if (!res.ok) throw new Error("Failed to load organizations");
    const organizations = await res.json();
    return options.activeSeasonOnly
      ? await SeasonContext.filterOrganizations(organizations)
      : organizations;
  },

  async getById(id) {
    const res = await authFetch(`/organizations/${id}`);
    if (!res.ok) throw new Error("Failed to load organization");
    return await res.json();
  },

  async findSimilar(name, leagueId) {
    const params = new URLSearchParams({ name, leagueId });
    const res = await authFetch(`/organizations/similar?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to check for similar organizations");
    return await res.json();
  },

  async create(dto) {
    const res = await authFetch("/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dto),
    });

    if (!res.ok) {
      let details = {};
      try {
        details = await res.json();
      } catch {
        // Some API errors return plain text.
      }
      const error = new Error(details.message || "Failed to create organization");
      error.status = res.status;
      error.existingOrganizationId = details.existingOrganizationId || null;
      throw error;
    }
    const result = await res.json();
    if (window.SeasonContext) window.SeasonContext.clear();
    return result;
  },

  async update(id, dto) {
    const res = await authFetch(`/organizations/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dto),
    });

    if (!res.ok) throw new Error("Failed to update organization");
  },

  async delete(id) {
    const res = await authFetch(`/organizations/${id}`, {
      method: "DELETE",
    });

    if (!res.ok) throw new Error("Failed to delete organization");
  },
};
