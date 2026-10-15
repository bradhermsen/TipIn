// =========================================================
// ORGANIZATIONS PAGE — MODERNIZED + COMPATIBLE VERSION
// =========================================================

let organizationDuplicateCheckTimer = null;
let organizationDuplicateRequestId = 0;
let organizationDuplicateCandidates = [];
const orgFacilityEscape = (value) =>
  String(value ?? "").replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ],
  );

async function loadOrganizationFacilities(organizationId) {
  const section = document.getElementById("org-facilities-section");
  const divider = document.getElementById("org-facilities-divider");
  const list = document.getElementById("org-facilities-list");
  section.classList.remove("hidden");
  divider.classList.remove("hidden");
  document.getElementById("org-manage-facilities").href =
    `facilities.html?organizationId=${encodeURIComponent(organizationId)}`;
  document.getElementById("org-add-arena").href =
    `facilities.html?organizationId=${encodeURIComponent(organizationId)}&action=addArena`;
  list.innerHTML = '<div class="org-facility-rinks">Loading arenas...</div>';
  try {
    const arenas = await FacilityApi.getForOrganization(organizationId);
    list.innerHTML = arenas.length
      ? arenas
          .map(
            (arena) =>
              `<div class="org-facility-row"><div><strong>${orgFacilityEscape(arena.name)} · ${orgFacilityEscape(arena.accessLevel)}</strong><div class="org-facility-rinks">${arena.rinks?.length ? arena.rinks.map((rink) => orgFacilityEscape(rink.name)).join(" · ") : "No rinks configured"}</div></div>${arena.accessLevel === "Manage" ? `<a class="nf-btn nf-btn-secondary" href="facilities.html?organizationId=${encodeURIComponent(organizationId)}&action=addRink&arenaId=${encodeURIComponent(arena.arenaId)}">Add Rink</a>` : ""}</div>`,
          )
          .join("")
      : '<div class="org-facility-rinks">No Arenas are associated with this organization.</div>';
  } catch (error) {
    list.innerHTML = `<div class="org-facility-rinks">${orgFacilityEscape(error.message)}</div>`;
  }
}

function getFilteredOrganizations(organizations = AdminPage?.allItems) {
  const source = Array.isArray(organizations) ? organizations : [];
  const searchTerm = (
    document.getElementById("org-search-bar")?.value || ""
  ).toLowerCase();
  const leagueFilter = document.getElementById("filter-league")?.value || "";
  const typeFilter =
    (document.getElementById("filter-organization-type")?.value || "").trim().toLowerCase();
  const statusFilter = document.getElementById("filter-status")?.value || "";

  return source.filter((org) => {
    const orgText = JSON.stringify(org || {}).toLowerCase();
    const orgLeague = org?.leagueId || "";
    const orgStatus = org?.isActive ? "active" : "inactive";

    const matchesSearch = !searchTerm || orgText.includes(searchTerm);
    const matchesLeague = !leagueFilter || orgLeague === leagueFilter;
    const organizationType = (org.organizationType || "Managed").trim().toLowerCase();
    const matchesType = !typeFilter || organizationType === typeFilter;
    const matchesStatus = !statusFilter || orgStatus === statusFilter;

    return matchesSearch && matchesLeague && matchesType && matchesStatus;
  });
}

function applyOrgFiltersAndSearch() {
  renderOrganizationsGrouped(getFilteredOrganizations());
}

function wireOrganizationDuplicateCheck() {
  const nameInput = document.getElementById("org-name");
  const leagueSelect = document.getElementById("org-league");
  if (!nameInput || !leagueSelect) return;

  nameInput.addEventListener("input", scheduleOrganizationDuplicateCheck);
  leagueSelect.addEventListener("change", scheduleOrganizationDuplicateCheck);
}

function clearOrganizationDuplicateCheck() {
  organizationDuplicateCandidates = [];
  const container = document.getElementById("org-duplicate-check");
  if (!container) return;
  container.hidden = true;
  container.replaceChildren();
}

function scheduleOrganizationDuplicateCheck() {
  clearTimeout(organizationDuplicateCheckTimer);
  organizationDuplicateRequestId++;
  clearOrganizationDuplicateCheck();
  organizationDuplicateCheckTimer = setTimeout(checkSimilarOrganizations, 350);
}

async function checkSimilarOrganizations() {
  const requestId = ++organizationDuplicateRequestId;
  const name = document.getElementById("org-name")?.value?.trim() || "";
  const leagueId = document.getElementById("org-league")?.value || "";
  const container = document.getElementById("org-duplicate-check");

  if (!container || AdminPage.editingId || name.length < 3 || !leagueId) {
    clearOrganizationDuplicateCheck();
    return;
  }

  container.hidden = false;
  container.textContent = "Checking for similar organizations...";

  try {
    const matches = await OrgApi.findSimilar(name, leagueId);
    if (requestId !== organizationDuplicateRequestId) return;
    organizationDuplicateCandidates = Array.isArray(matches) ? matches : [];
    renderOrganizationDuplicateCandidates();
  } catch (error) {
    if (requestId !== organizationDuplicateRequestId) return;
    organizationDuplicateCandidates = [];
    container.hidden = false;
    container.textContent = "Unable to check similar organizations. Exact duplicates will still be blocked when saving.";
    console.warn("Organization similarity check failed:", error);
  }
}

function renderOrganizationDuplicateCandidates() {
  const container = document.getElementById("org-duplicate-check");
  if (!container) return;
  container.replaceChildren();
  if (!organizationDuplicateCandidates.length) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
  const heading = document.createElement("div");
  heading.className = "org-duplicate-heading";
  heading.textContent = "Possible existing organizations in this League";
  container.appendChild(heading);

  organizationDuplicateCandidates.forEach((organization) => {
    const row = document.createElement("div");
    row.className = "org-duplicate-row";

    const details = document.createElement("div");
    details.className = "org-duplicate-details";
    const name = document.createElement("strong");
    name.textContent = organization.name || "Unnamed organization";
    const location = [organization.city, organization.state].filter(Boolean).join(", ");
    const metadata = document.createElement("span");
    metadata.textContent = [location, `${organization.similarityScore}% match`]
      .filter(Boolean)
      .join(" · ");
    details.append(name, metadata);

    const openButton = document.createElement("button");
    openButton.className = "nf-btn nf-btn-secondary";
    openButton.type = "button";
    openButton.textContent = "Open existing";
    openButton.addEventListener("click", () => openEditOrganization(organization.organizationId));

    row.append(details, openButton);
    container.appendChild(row);
  });

  const note = document.createElement("div");
  note.className = "org-duplicate-note";
  note.textContent = "If this is the same organization, use Seasons > Manage Participation to add it to the current season.";
  container.appendChild(note);
}

async function confirmOrganizationNameMatches(payload) {
  let matches = organizationDuplicateCandidates;
  try {
    matches = await OrgApi.findSimilar(payload.name.trim(), payload.leagueId);
  } catch (error) {
    console.warn("Final organization duplicate check failed:", error);
  }

  const exactMatch = matches.find((candidate) => candidate.similarityScore >= 100);
  if (exactMatch) {
    const message = `An organization with this name already exists in this league. Open it or use Seasons > Manage Participation. Existing ID: ${exactMatch.organizationId}`;
    if (typeof window.showMessage === "function") window.showMessage(message, "error");
    else alert(message);
    return false;
  }

  if (!matches.length) return true;
  const examples = matches.slice(0, 3).map((candidate) => candidate.name).join(", ");
  return window.confirm(`Possible matching organizations were found: ${examples}. Create a separate organization anyway?`);
}

function renderOrganizationsGrouped(orgs) {
  const container = document.getElementById("orgGroupedList");
  if (!container) return;

  if (!orgs.length) {
    container.innerHTML = `<div class="nf-empty-state">No organizations match your current filters.</div>`;
    return;
  }

  const byLeague = new Map();
  orgs.forEach((org) => {
    const leagueKey = org.leagueId || "no-league";
    const leagueLabel = org.leagueName || "No League";
    if (!byLeague.has(leagueKey)) {
      byLeague.set(leagueKey, { label: leagueLabel, organizations: [] });
    }
    byLeague.get(leagueKey).organizations.push(org);
  });

  container.innerHTML = [...byLeague.entries()]
    .sort(([, first], [, second]) => first.label.localeCompare(second.label))
    .map(([leagueKey, group]) => {
      const cards = group.organizations
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
        .map(
          (org) => `
              <article class="nf-item-card org-item-card">
                <div class="nf-item-card-top">
                  <h4>${org.name || "Unnamed Organization"}</h4>
                  <span class="status-badge ${org.isActive ? "active" : "inactive"}">${org.isActive ? "Active" : "Inactive"}</span>
                </div>
                <div class="nf-item-card-meta">
                  <span><i class="fa fa-circle-nodes"></i> ${org.organizationType === "External" ? "External Organization" : "Managed Organization"}</span>
                  <span><i class="fa fa-building"></i> ${org.abbreviation || "No abbreviation"}</span>
                  <span><i class="fa fa-map-marker-alt"></i> ${org.city || "Unknown city"}${org.state ? `, ${org.state}` : ""}</span>
                  <span><i class="fa fa-users"></i> ${org.teamCount || 0} teams</span>
                </div>
                <div class="nf-item-card-actions">
                  <button class="nf-btn-icon view org-view-btn" data-id="${org.organizationId}" title="View Teams"><i class="fa-solid fa-users"></i></button>
                  <button class="nf-btn-icon edit org-edit-btn" data-id="${org.organizationId}" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                  <button class="nf-btn-icon delete org-delete-btn" data-id="${org.organizationId}" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </div>
              </article>
            `,
        )
        .join("");

      return `
        <details class="nf-group org-league-group" data-league-id="${leagueKey}">
          <summary>
            <span>${group.label}</span>
            <span class="nf-group-count">${group.organizations.length}</span>
          </summary>
          <div class="nf-group-content"><div class="nf-card-grid">${cards}</div></div>
        </details>
      `;
    })
    .join("");

  wireOrganizationCardActions();
}

function wireOrganizationCardActions() {
  document.querySelectorAll(".org-view-btn").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      window.location.href = `teams.html?orgId=${id}`;
    };
  });

  document.querySelectorAll(".org-edit-btn").forEach((btn) => {
    btn.onclick = () => openEditOrganization(btn.dataset.id);
  });

  document.querySelectorAll(".org-delete-btn").forEach((btn) => {
    btn.onclick = () => openDeleteOrganization(btn.dataset.id);
  });
}

// ---------------------------------------------------------
// ADMIN PAGE INITIALIZATION
// ---------------------------------------------------------
AdminPage.init({
  tableBodyId: "orgGroupedList",
  searchInputId: "org-search-bar",

  modalId: "orgModalOverlay",
  modalTitleId: "orgModalTitle",
  addButtonId: "btnAddOrganization",
  saveButtonId: "orgSave",
  cancelButtonId: "orgCancel",

  deleteModalId: "orgDeleteModalOverlay",
  deleteConfirmId: "deleteConfirm",
  deleteCancelId: "deleteCancel",

  editHandlerName: "openEditOrganization",
  deleteHandlerName: "openDeleteOrganization",
  addHandler: openAddOrganization,

  addTitle: "Add Organization",
  editTitle: "Edit Organization",

  saveHandler: async () => {
    const payload = AdminPage.config.collectFormData();
    const previousType = window.editingOrganizationType || "Managed";
    if (AdminPage.editingId && previousType !== payload.organizationType) {
      const message =
        payload.organizationType === "External"
          ? "Convert this organization to External? Team access codes will be removed and organization users will no longer be able to sign in. Historical data will be preserved."
          : "Convert this organization to Managed? Historical data will be preserved. Portal users and new team access codes can then be configured.";
      if (!window.confirm(message)) return;
    }

    if (AdminPage.editingId) {
      await OrgApi.update(AdminPage.editingId, payload);
    } else {
      if (!(await confirmOrganizationNameMatches(payload))) return;
      try {
        await OrgApi.create(payload);
      } catch (error) {
        if (error.existingOrganizationId) {
          const message = `${error.message} Existing Organization ID: ${error.existingOrganizationId}. Use Seasons > Manage Participation to add it to the current season.`;
          if (typeof window.showMessage === "function") {
            window.showMessage(message, "error");
          } else {
            alert(message);
          }
          return;
        }
        throw error;
      }
    }

    window.editingOrganizationType = null;
    if (window.SeasonContext) window.SeasonContext.clear();
    AdminPage.closeModal();
    await AdminPage.loadData();
  },

  api: {
    ...OrgApi,
    getAll: () => OrgApi.getAll(),
  },

  // -------------------------------------------------------
  // DROPDOWNS
  // -------------------------------------------------------
  loadDropdowns: async () => {
    await loadLeagues();
    wireOrgFilterEvents();
    wireOrganizationDuplicateCheck();
  },

  // -------------------------------------------------------
  // TABLE RENDERING (MODERNIZED)
  // -------------------------------------------------------
  renderTable: (orgs) => {
    renderOrganizationsGrouped(getFilteredOrganizations(orgs));
  },

  // -------------------------------------------------------
  // CLEAR FORM
  // -------------------------------------------------------
  clearForm: () => {
    [
      "org-name",
      "org-abbrev",
      "org-street",
      "org-city",
      "org-state",
      "org-zip",
      "org-country",
      "org-mascot",
      "org-contact-first",
      "org-contact-last",
      "org-contact-email",
      "billing-street",
      "billing-city",
      "billing-state",
      "billing-zip",
      "billing-contact-name",
      "billing-contact-email",
    ].forEach((id) => (document.getElementById(id).value = ""));

    document.getElementById("org-league").value = "";
    document.getElementById("org-type-managed").checked = true;
    document.getElementById("org-type-external").checked = false;
    document.getElementById("org-active").checked = true;
  },

  // -------------------------------------------------------
  // POPULATE FORM
  // -------------------------------------------------------
  populateForm: (org) => {
    window.editingOrganizationType = org.organizationType || "Managed";
    document.getElementById("org-name").value = org.name;
    document.getElementById("org-abbrev").value = org.abbreviation;

    document.getElementById("org-street").value = org.streetAddress ?? "";
    document.getElementById("org-city").value = org.city ?? "";
    document.getElementById("org-state").value = org.state ?? "";
    document.getElementById("org-zip").value = org.zipCode ?? "";
    document.getElementById("org-country").value = org.country ?? "";
    document.getElementById("org-mascot").value = org.mascot ?? "";
    document.getElementById("org-league").value = org.leagueId ?? "";
    document.getElementById("org-type-managed").checked =
      org.organizationType !== "External";
    document.getElementById("org-type-external").checked =
      org.organizationType === "External";

    document.getElementById("org-contact-first").value =
      org.primaryContactFirstName ?? "";
    document.getElementById("org-contact-last").value =
      org.primaryContactLastName ?? "";
    document.getElementById("org-contact-email").value =
      org.primaryContactEmail ?? "";

    document.getElementById("billing-street").value =
      org.billingStreetAddress ?? "";
    document.getElementById("billing-city").value = org.billingCity ?? "";
    document.getElementById("billing-state").value = org.billingState ?? "";
    document.getElementById("billing-zip").value = org.billingZipCode ?? "";
    document.getElementById("billing-contact-name").value =
      org.billingContactName ?? "";
    document.getElementById("billing-contact-email").value =
      org.billingContactEmail ?? "";

    document.getElementById("org-active").checked = org.isActive;
  },

  // -------------------------------------------------------
  // COLLECT FORM DATA
  // -------------------------------------------------------
  collectFormData: () => ({
    name: document.getElementById("org-name").value,
    abbreviation: document.getElementById("org-abbrev").value,

    streetAddress: document.getElementById("org-street").value,
    city: document.getElementById("org-city").value,
    state: document.getElementById("org-state").value,
    zipCode: document.getElementById("org-zip").value,
    country: document.getElementById("org-country").value,
    mascot: document.getElementById("org-mascot").value,
    leagueId: document.getElementById("org-league").value,
    organizationType:
      document.querySelector('input[name="organization-type"]:checked')
        ?.value || "Managed",

    primaryContactFirstName: document.getElementById("org-contact-first").value,
    primaryContactLastName: document.getElementById("org-contact-last").value,
    primaryContactEmail: document.getElementById("org-contact-email").value,

    billingStreetAddress: document.getElementById("billing-street").value,
    billingCity: document.getElementById("billing-city").value,
    billingState: document.getElementById("billing-state").value,
    billingZipCode: document.getElementById("billing-zip").value,
    billingContactName: document.getElementById("billing-contact-name").value,
    billingContactEmail: document.getElementById("billing-contact-email").value,

    isActive: document.getElementById("org-active").checked,
  }),
});

// =========================================================
// LEAGUES
// =========================================================
async function loadLeagues() {
  try {
    const res = await authFetch(`/leagues`);
    if (!res || !res.ok) {
      throw new Error("Failed to load leagues");
    }
    const leagues = await res.json();

    const modalSelect = document.getElementById("org-league");
    if (modalSelect) {
      modalSelect.innerHTML = `<option value="">Select League</option>`;
      leagues.forEach((l) => {
        const opt = document.createElement("option");
        opt.value = l.leagueId;
        opt.textContent = l.leagueName;
        modalSelect.appendChild(opt);
      });
    }

    const filterSelect = document.getElementById("filter-league");
    if (filterSelect) {
      filterSelect.innerHTML = `<option value="">League: All</option>`;
      leagues.forEach((l) => {
        const opt = document.createElement("option");
        opt.value = l.leagueId;
        opt.textContent = l.leagueName;
        filterSelect.appendChild(opt);
      });
    }
  } catch (err) {
    console.error("Failed to load leagues:", err);
  }
}

// =========================================================
// FILTER + SEARCH
// =========================================================
function wireOrgFilterEvents() {
  const search = document.getElementById("org-search-bar");
  const league = document.getElementById("filter-league");
  const organizationType = document.getElementById("filter-organization-type");
  const status = document.getElementById("filter-status");

  if (search) {
    search.addEventListener("input", () => {
      applyOrgFiltersAndSearch();
    });
  }

  if (league) {
    league.addEventListener("change", () => {
      applyOrgFiltersAndSearch();
    });
  }

  if (organizationType) {
    organizationType.addEventListener("change", () => {
      applyOrgFiltersAndSearch();
    });
  }

  if (status) {
    status.addEventListener("change", () => {
      applyOrgFiltersAndSearch();
    });
  }
}

// =========================================================
// ADD ORGANIZATION HANDLER
// =========================================================
function openAddOrganization() {
  AdminPage.editingId = null;
  window.editingOrganizationType = null;
  clearOrganizationDuplicateCheck();
  AdminPage.config.clearForm();
  document.getElementById("orgModalTitle").textContent = "Add Organization";
  document.getElementById("org-facilities-section")?.classList.add("hidden");
  document.getElementById("org-facilities-divider")?.classList.add("hidden");

  const overlay = document.getElementById("orgModalOverlay");
  overlay.classList.remove("hidden");
  overlay.classList.add("active");
  document.getElementById("orgModal").classList.add("active");
}

// =========================================================
// EDIT HANDLER
// =========================================================
async function openEditOrganization(id) {
  try {
    clearOrganizationDuplicateCheck();
    const org = await OrgApi.getById(id);
    AdminPage.editingId = id;
    AdminPage.config.populateForm(org);

    document.getElementById("orgModalTitle").textContent = "Edit Organization";
    void loadOrganizationFacilities(id);

    const overlay = document.getElementById("orgModalOverlay");
    overlay.classList.remove("hidden");
    overlay.classList.add("active");
    document.getElementById("orgModal").classList.add("active");
  } catch (err) {
    console.error("Failed to load organization:", err);
    alert("Unable to load organization details.");
  }
}

// =========================================================
// DELETE HANDLER
// =========================================================
function openDeleteOrganization(id) {
  AdminPage.deleteId = id;
  document.getElementById("deleteModal").classList.add("active");
}
