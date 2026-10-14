const FacilityApi = {
  async request(path, options = {}) {
    const response = await authFetch(path, options);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Facility request failed");
    }
    return response.status === 204 ? null : response.json();
  },
  getContext() {
    return this.request("/facilities/context");
  },
  getForOrganization(organizationId) {
    return this.request(`/organizations/${organizationId}/arenas`);
  },
  getCatalog() {
    return this.request("/arenas/catalog", { cache: "no-store" });
  },
  createArena(organizationId, dto) {
    return this.request(`/organizations/${organizationId}/arenas`, {
      method: "POST",
      body: JSON.stringify(dto),
    });
  },
  updateArena(arenaId, dto) {
    return this.request(`/arenas/${arenaId}`, {
      method: "PUT",
      body: JSON.stringify(dto),
    });
  },
  deactivateArena(arenaId) {
    return this.request(`/arenas/${arenaId}`, { method: "DELETE" });
  },
  associateArena(organizationId, arenaId, dto) {
    return this.request(
      `/organizations/${organizationId}/arenas/${arenaId}/associate`,
      { method: "POST", body: JSON.stringify(dto) },
    );
  },
  removeArenaAssociation(organizationId, arenaId) {
    return this.request(
      `/organizations/${organizationId}/arenas/${arenaId}/associate`,
      { method: "DELETE" },
    );
  },
  createRink(arenaId, dto) {
    return this.request(`/arenas/${arenaId}/rinks`, {
      method: "POST",
      body: JSON.stringify(dto),
    });
  },
  updateRink(rinkId, dto) {
    return this.request(`/rinks/${rinkId}`, {
      method: "PUT",
      body: JSON.stringify(dto),
    });
  },
  createGateway(rinkId, dto) {
    return this.request(`/rinks/${rinkId}/gateways`, {
      method: "POST",
      body: JSON.stringify(dto),
    });
  },
  updateGateway(gatewayId, dto) {
    return this.request(`/gateways/${gatewayId}`, {
      method: "PUT",
      body: JSON.stringify(dto),
    });
  },
};
