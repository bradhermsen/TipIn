const goBoundPreviewState = {
  teams: [],
  gameTypes: [],
  organizations: [],
  leagues: [],
  levels: [],
  facilityCatalog: [],
  facilityCatalogError: "",
  activeSeason: null,
  previewRows: [],
  previewFile: null,
  opponentSetup: [],
  venueSetup: [],
  venueMappings: new Map(),
  gamesImported: false,
  excludedTeams: new Set(),
  previewCounts: { fileRowCount: 0, skippedScrimmages: 0, duplicates: 0 },
};

function splitGoBoundCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }

  values.push(value);
  return values;
}

function parseGoBoundCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerLine = lines.findIndex((line) => line.trim());
  if (headerLine < 0) return [];

  const normalizeHeader = (value) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const headers = splitGoBoundCsvLine(lines[headerLine]).map(normalizeHeader);
  const rows = [];

  for (let index = headerLine + 1; index < lines.length; index++) {
    if (!lines[index].trim()) continue;
    const values = splitGoBoundCsvLine(lines[index]);
    const row = {};
    headers.forEach((header, column) => {
      row[header] = String(values[column] || "").trim();
    });
    rows.push(row);
  }

  return rows;
}

function normalizeScheduleName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\b(?:sr|senior)\b/g, "senior")
    .replace(/\b(?:jr|junior)\b/g, "junior")
    .replace(/\b(?:hs|high\s+school)\b/g, "high school")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function goBoundOpponent(eventName) {
  const event = String(eventName || "").trim();
  let match = event.match(/^Winona\s+vs\s+(.+)$/i);
  if (match) return { opponent: match[1].trim(), winonaIsHome: false };
  match = event.match(/^(.+?)\s+vs\s+Winona$/i);
  if (match) return { opponent: match[1].trim(), winonaIsHome: true };
  return { opponent: "", winonaIsHome: null };
}

function goBoundDivision(activity) {
  const value = String(activity || "").toLowerCase();
  if (/\bjv\b/.test(value)) return "JV";
  if (/\bvarsity\b/.test(value)) return "Varsity";
  return "";
}

function goBoundTeamType(activity) {
  const value = String(activity || "").toLowerCase();
  if (/\bboys?\b/.test(value)) return "Boys";
  if (/\bgirls?\b/.test(value)) return "Girls";
  return "";
}

function organizationNameMatch(candidateName, opponentName) {
  const candidate = normalizeScheduleName(candidateName);
  const opponent = normalizeScheduleName(opponentName);
  if (!candidate || !opponent) return false;
  if (candidate === opponent) return true;

  const candidateWords = new Set(candidate.split(" "));
  const opponentWords = opponent.split(" ").filter((word) => word.length > 2);
  return opponentWords.length > 0 && opponentWords.every((word) => candidateWords.has(word));
}

function findWinonaTeam(division, teamType) {
  return goBoundPreviewState.teams.find((team) =>
    String(team.teamType || "").toLowerCase() === String(teamType || "").toLowerCase() &&
    String(team.levelName || "").toLowerCase() === String(division || "").toLowerCase() &&
    normalizeScheduleName(`${team.organizationName || ""} ${team.name || ""}`).includes("winona"),
  );
}

function teamMatchLabel(team) {
  const classification = [team.teamType, team.levelName].filter(Boolean).join(" ");
  return `${team.organizationName || "External"} / ${team.name}${classification ? ` (${classification})` : ""}`;
}

function getOpponentMapping(opponentName, division, teamType) {
  const normalizedOpponent = normalizeScheduleName(opponentName);
  const nameMatches = goBoundPreviewState.teams.filter((team) =>
    normalizeScheduleName(team.name) === normalizedOpponent ||
    organizationNameMatch(team.organizationName, opponentName),
  );
  const classificationMatches = nameMatches.filter((team) =>
    String(team.levelName || "").toLowerCase() === String(division || "").toLowerCase() &&
    String(team.teamType || "").toLowerCase() === String(teamType || "").toLowerCase(),
  );

  if (classificationMatches.length === 1) {
    const team = classificationMatches[0];
    return {
      kind: "team",
      teamId: team.teamId || team.id || null,
      organizationId: team.organizationId || null,
      organizationName: team.organizationName || "",
      organizationType: team.organizationType || "External",
      leagueId: team.leagueId || "",
      label: teamMatchLabel(team),
      ready: true,
    };
  }
  if (classificationMatches.length > 1) {
    return { kind: "ambiguous-team", candidates: classificationMatches, label: `${classificationMatches.length} ${teamType} ${division} Teams match; choose one`, ready: false };
  }
  if (nameMatches.length > 1) {
    const candidates = new Map();
    nameMatches.forEach((team) => {
      if (team.organizationId && !candidates.has(team.organizationId)) {
        candidates.set(team.organizationId, {
          organizationId: team.organizationId,
          name: team.organizationName || team.name,
          organizationType: team.organizationType || "External",
          leagueId: team.leagueId || "",
        });
      }
    });
    return {
      kind: "ambiguous-organization",
      candidates: [...candidates.values()],
      label: `${nameMatches.length} Teams match the school, but none is ${teamType} ${division}`,
      ready: false,
    };
  }
  if (nameMatches.length === 1) {
    const team = nameMatches[0];
    return {
      kind: "existing-organization",
      organizationId: team.organizationId,
      organizationName: team.organizationName,
      organizationType: team.organizationType,
      leagueId: team.leagueId,
      label: `${team.organizationName || "Organization"} exists; current-season Team needed`,
      ready: false,
    };
  }

  const organizations = goBoundPreviewState.organizations.filter((organization) =>
    organizationNameMatch(organization.name, opponentName),
  );
  if (organizations.length === 1) {
    return {
      kind: "existing-organization",
      organizationId: organizations[0].organizationId,
      organizationName: organizations[0].name,
      organizationType: organizations[0].organizationType,
      leagueId: organizations[0].leagueId,
      label: `${organizations[0].name} exists; current-season Team needed`,
      ready: false,
    };
  }
  if (organizations.length > 1) {
    return {
      kind: "ambiguous-organization",
      candidates: organizations.map((organization) => ({
        organizationId: organization.organizationId,
        name: organization.name,
        organizationType: organization.organizationType || "External",
        leagueId: organization.leagueId || "",
      })),
      label: `${organizations.length} Organization matches; choose one`,
      ready: false,
    };
  }

  return {
    kind: "new-organization",
    organizationName: opponentName,
    label: "External Organization and Team needed",
    ready: false,
  };
}

async function loadGoBoundPreviewLookups() {
  if (goBoundPreviewState.teams.length && goBoundPreviewState.gameTypes.length) {
    if (goBoundPreviewState.facilityCatalogError) {
      try {
        goBoundPreviewState.facilityCatalog = await FacilityApi.getCatalog();
        goBoundPreviewState.facilityCatalogError = "";
      } catch (error) {
        goBoundPreviewState.facilityCatalogError = error.message || "Could not load managed venues.";
      }
    }
    return;
  }

  const [teamsResponse, gameTypesResponse, organizationsResponse, leaguesResponse, levelsResponse, facilityCatalog] = await Promise.all([
    authFetch("/teams", { cache: "no-store" }),
    authFetch("/gametypes", { cache: "no-store" }),
    authFetch("/organizations", { cache: "no-store" }),
    authFetch("/leagues", { cache: "no-store" }),
    authFetch("/levels", { cache: "no-store" }),
    FacilityApi.getCatalog().catch((error) => ({ error: error.message || "Could not load managed venues." })),
  ]);
  if (!teamsResponse.ok || !gameTypesResponse.ok || !organizationsResponse.ok || !leaguesResponse.ok || !levelsResponse.ok) {
    throw new Error("Could not load current Season catalog data.");
  }

  goBoundPreviewState.teams = await SeasonContext.filterTeams(await teamsResponse.json());
  goBoundPreviewState.gameTypes = await gameTypesResponse.json();
  goBoundPreviewState.organizations = await organizationsResponse.json();
  goBoundPreviewState.leagues = await leaguesResponse.json();
  goBoundPreviewState.levels = await levelsResponse.json();
  goBoundPreviewState.facilityCatalogError = facilityCatalog.error || "";
  goBoundPreviewState.facilityCatalog = Array.isArray(facilityCatalog) ? facilityCatalog : [];
  goBoundPreviewState.activeSeason = await SeasonContext.getActiveSeason();
}

function classifyGoBoundRow(row) {
  const event = row.event || "";
  const activity = row.activity || "";
  const direction = goBoundOpponent(event);
  const division = goBoundDivision(activity);
  const teamType = goBoundTeamType(activity);
  const winonaTeam = division && teamType ? findWinonaTeam(division, teamType) : null;
  const classification = (row.cnc || "").trim().toUpperCase();
  const gameTypeName = classification === "C"
    ? "Conference"
    : classification === "NC"
      ? "Non-Conference"
      : "";
  const gameTypeMatches = gameTypeName
    ? goBoundPreviewState.gameTypes.filter((item) => normalizeScheduleName(item.name) === normalizeScheduleName(gameTypeName))
    : [];
  const opponent = direction.opponent
    ? getOpponentMapping(direction.opponent, division, teamType)
    : null;
  const problems = [];

  if (!division) problems.push("Unrecognized Varsity/JV activity");
  if (!teamType) problems.push("Unrecognized Team Type in activity");
  if (division && teamType && !winonaTeam) {
    problems.push(`Winona ${teamType} ${division} Team not found in active Season`);
  }
  if (!direction.opponent) problems.push("Could not determine opponent/home-away from Event");
  else if (!opponent?.ready) problems.push(opponent?.label || "Opponent Team needs mapping");
  if (!row.date || !row.time) problems.push("Date or time missing");
  if (!row.location) problems.push("Venue/location missing");
  if (!gameTypeName) problems.push("C / NC value missing or unrecognized");
  else if (!gameTypeMatches.length) problems.push(`${gameTypeName} Game Type missing`);
  else if (gameTypeMatches.length > 1) problems.push(`${gameTypeName} has duplicate catalog entries`);

  return {
    sourceEvent: event,
    activity,
    division,
    teamName: winonaTeam?.name || "Winona",
    levelName: winonaTeam?.levelName || division,
    teamType: winonaTeam?.teamType || teamType,
    winonaTeamId: winonaTeam?.teamId || null,
    opponent: direction.opponent,
    opponentMapping: opponent?.label || "",
    opponentMappingDetails: opponent,
    homeAway: direction.winonaIsHome === null ? "Unknown" : direction.winonaIsHome ? "Home" : "Away",
    date: row.date,
    time: row.time,
    gameType: gameTypeName || "Unmapped",
    venue: row.location || "",
    problems,
    ready: problems.length === 0,
  };
}

function escapeGoBoundPreview(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function goBoundTeamImportKey(opponent, teamType, levelName) {
  return [opponent, teamType, levelName].map(normalizeScheduleName).join("|");
}

function isGoBoundTeamIncluded(opponent, teamType, levelName) {
  return !goBoundPreviewState.excludedTeams.has(goBoundTeamImportKey(opponent, teamType, levelName));
}

function includedGoBoundTeamSpecs(proposal) {
  return proposal.teamSpecs.filter((spec) => isGoBoundTeamIncluded(proposal.opponent, spec.teamType, spec.levelName));
}

function buildExternalOpponentSetup(rows) {
  const proposalsByOpponent = new Map();

  rows.forEach((row) => {
    if (!row.opponent || !row.levelName || !row.teamType) return;
    const mapping = row.opponentMappingDetails;
    if (!mapping || mapping.kind === "team") return;

    const key = normalizeScheduleName(row.opponent);
    if (!proposalsByOpponent.has(key)) {
      const organizationCandidates = goBoundPreviewState.organizations
        .filter((organization) => organizationNameMatch(organization.name, row.opponent))
        .map((organization) => ({
          organizationId: organization.organizationId,
          name: organization.name,
          organizationType: organization.organizationType || "External",
          leagueId: organization.leagueId || "",
          mascot: organization.mascot || "",
        }));
      proposalsByOpponent.set(key, {
        opponent: row.opponent,
        organizationCandidates,
        teamSpecs: new Map(),
        manualTeamReview: false,
      });
    }

    const proposal = proposalsByOpponent.get(key);
    const teamKey = `${row.teamType.toLowerCase()}|${row.levelName.toLowerCase()}`;
    proposal.teamSpecs.set(teamKey, {
      name: row.opponent,
      teamType: row.teamType,
      levelName: row.levelName,
    });
    if (mapping.kind === "ambiguous-team") proposal.manualTeamReview = true;
  });

  return [...proposalsByOpponent.values()].map((proposal) => ({
    ...proposal,
    teamSpecs: [...proposal.teamSpecs.values()],
  }));
}

function getGoBoundVenueKey(location) {
  return String(location || "").trim().toLowerCase();
}

function buildGoBoundVenueSetup(rows) {
  const proposals = new Map();
  rows.forEach((row) => {
    if (!isGoBoundTeamIncluded(row.opponent, row.teamType, row.levelName)) return;
    const location = String(row.venue || "").trim();
    const key = getGoBoundVenueKey(location);
    if (!key) return;
    if (!proposals.has(key)) {
      const winonaTeam = goBoundPreviewState.teams.find((team) =>
        String(team.teamId || team.id || "") === String(row.winonaTeamId || ""),
      );
      proposals.set(key, {
        key,
        location,
        games: 0,
        homeCount: 0,
        awayCount: 0,
        organizationId: winonaTeam?.organizationId || "",
      });
    }
    const proposal = proposals.get(key);
    proposal.games++;
    if (row.homeAway === "Home") proposal.homeCount++;
    if (row.homeAway === "Away") proposal.awayCount++;
  });
  return [...proposals.values()];
}

function getWinonaManagedArenas(organizationId) {
  if (!organizationId) return [];
  return goBoundPreviewState.facilityCatalog.filter((arena) =>
    arena.isActive && Array.isArray(arena.organizations) &&
    arena.organizations.some((organization) => String(organization.organizationId) === String(organizationId)),
  );
}

function suggestGoBoundVenueNames(location) {
  const value = String(location || "").trim();
  const rinkSuffix = value.match(/^(.*?)\s+((?:(?:East|West|North|South)\s+Rink)|(?:Graham\s+\d+))$/i);
  return rinkSuffix
    ? { arenaName: rinkSuffix[1].trim(), rinkName: rinkSuffix[2].trim() }
    : { arenaName: value, rinkName: "Main" };
}

function defaultGoBoundVenueChoice(proposal) {
  return { mode: "external-new", ...suggestGoBoundVenueNames(proposal.location) };
}

function renderGoBoundVenueSetup(rows) {
  const section = document.getElementById("scheduleVenueSetupSection");
  const list = document.getElementById("scheduleVenueSetupList");
  const button = document.getElementById("createReviewedManagedVenues");
  const messages = document.getElementById("scheduleVenueSetupMessages");
  if (!section || !list || !button || !messages) return;

  const proposals = buildGoBoundVenueSetup(rows);
  goBoundPreviewState.venueSetup = proposals;
  proposals.forEach((proposal) => {
    if (!goBoundPreviewState.venueMappings.has(proposal.key)) {
      goBoundPreviewState.venueMappings.set(proposal.key, defaultGoBoundVenueChoice(proposal));
    }
  });
  if (!proposals.length) {
    section.classList.add("hidden");
    list.replaceChildren();
    button.disabled = true;
    updateGoBoundGameImportButton();
    return;
  }

  section.classList.remove("hidden");
  messages.textContent = goBoundPreviewState.facilityCatalogError
    ? "Managed venue catalog unavailable. Locations can remain external; retry the preview to load managed venues."
    : "Locations default to importing into Arena Manager as External Team Venues. Confirm the suggested Arena/Rink names or choose Don't import. No Organization or Game link is created here.";

  list.innerHTML = proposals.map((proposal, index) => {
    const current = goBoundPreviewState.venueMappings.get(proposal.key) || { mode: "external" };
    const canCreateManaged = proposal.homeCount > 0 && proposal.awayCount === 0 && proposal.organizationId && !goBoundPreviewState.facilityCatalogError;
    const canCreateExternal = Auth.hasRole(window.ROLES.SuperAdmin) && !goBoundPreviewState.facilityCatalogError;
    const managedOptions = goBoundPreviewState.facilityCatalog.filter((arena) => arena.isActive).flatMap((arena) =>
      (arena.rinks || []).filter((rink) => rink.isActive).map((rink) => {
        const value = `managed:${arena.arenaId}:${rink.rinkId}`;
        const associationLabel = (arena.organizations || []).map((organization) => organization.name).filter(Boolean).join(", ") || "External Team Venue";
        const label = `${arena.name} / ${rink.name} · ${associationLabel}${arena.city ? ` · ${arena.city}` : ""}`;
        return `<option value="${escapeGoBoundPreview(value)}" ${current.mode === "managed" && current.arenaId === arena.arenaId && current.rinkId === rink.rinkId ? "selected" : ""}>Use ${escapeGoBoundPreview(label)}</option>`;
      }),
    ).join("");
    const managedArenaOptions = canCreateManaged
      ? getWinonaManagedArenas(proposal.organizationId).map((arena) => {
        const value = `new-rink:${arena.arenaId}`;
        return `<option value="${escapeGoBoundPreview(value)}" ${current.mode === "new-rink" && current.arenaId === arena.arenaId ? "selected" : ""}>Add a Rink to ${escapeGoBoundPreview(arena.name)}</option>`;
      }).join("")
      : "";
    const selectedAction = current.mode === "managed"
      ? `managed:${current.arenaId}:${current.rinkId}`
      : current.mode === "new-rink"
        ? `new-rink:${current.arenaId}`
        : current.mode === "external-new" ? "external-new"
        : current.mode === "new" ? "new" : "external";
    const isNewPair = selectedAction === "new";
    const isNewRink = selectedAction.startsWith("new-rink:");
    const isExternalNew = selectedAction === "external-new";
    const detail = current.mode === "new" || current.mode === "new-rink" || current.mode === "external-new" ? current : {};
    return `
      <article class="schedule-opponent-proposal" data-venue-index="${index}">
        <h4>${escapeGoBoundPreview(proposal.location)}</h4>
        <p class="schedule-opponent-teams">${proposal.games} games · ${proposal.homeCount} home · ${proposal.awayCount} away</p>
        <label class="schedule-import-file-label">Venue handling
          <select class="nf-input" data-venue-action>
            <option value="external" ${selectedAction === "external" ? "selected" : ""}>Don't import to Arena Manager; keep venue text on Games</option>
            ${managedOptions}
            ${managedArenaOptions}
            ${canCreateManaged ? `<option value="new" ${selectedAction === "new" ? "selected" : ""}>Create Winona managed Arena and Rink</option>` : ""}
            ${canCreateExternal ? `<option value="external-new" ${selectedAction === "external-new" ? "selected" : ""}>Import to Arena Manager as External Team Venue</option>` : ""}
          </select>
        </label>
        <div class="schedule-opponent-fields" data-new-venue-fields ${isNewPair || isNewRink || isExternalNew ? "" : "hidden"}>
          <label class="schedule-import-file-label" data-new-arena-wrap ${isNewPair || isExternalNew ? "" : "hidden"}>Arena name
            <input class="nf-input" type="text" maxlength="200" data-venue-arena-name value="${escapeGoBoundPreview(detail.arenaName || "")}" />
          </label>
          <label class="schedule-import-file-label">Confirmed Rink name
            <input class="nf-input" type="text" maxlength="200" data-venue-rink-name value="${escapeGoBoundPreview(detail.rinkName || "")}" />
          </label>
        </div>
        ${canCreateManaged ? "" : proposal.homeCount > 0 ? `<p class="schedule-import-status-review">This location cannot be added as a Winona-managed venue because it also has away games, lacks a Winona Team mapping, or the facility catalog did not load.</p>` : ""}
      </article>
    `;
  }).join("");

  list.querySelectorAll("[data-venue-action]").forEach((select) => {
    select.addEventListener("change", () => {
      const card = select.closest("[data-venue-index]");
      const isNewPair = select.value === "new";
      const isNewRink = select.value.startsWith("new-rink:");
      const isExternalNew = select.value === "external-new";
      card.querySelector("[data-new-venue-fields]").hidden = !isNewPair && !isNewRink && !isExternalNew;
      card.querySelector("[data-new-arena-wrap]").hidden = !isNewPair && !isExternalNew;
      if (isNewPair || isNewRink || isExternalNew) {
        const suggestions = suggestGoBoundVenueNames(
          goBoundPreviewState.venueSetup[Number(card.dataset.venueIndex)]?.location,
        );
        const arenaName = card.querySelector("[data-venue-arena-name]");
        const rinkName = card.querySelector("[data-venue-rink-name]");
        if (isNewPair && arenaName && !arenaName.value.trim()) arenaName.value = suggestions.arenaName;
        if (rinkName && !rinkName.value.trim()) rinkName.value = suggestions.rinkName;
      }
      saveGoBoundVenueChoice(card, select.value);
      updateReviewedManagedVenueButton();
      updateGoBoundGameImportButton();
    });
  });
  list.querySelectorAll("[data-venue-arena-name], [data-venue-rink-name]").forEach((input) => {
    input.addEventListener("input", () => {
      const card = input.closest("[data-venue-index]");
      saveGoBoundVenueChoice(card, card.querySelector("[data-venue-action]")?.value || "external");
      updateReviewedManagedVenueButton();
      updateGoBoundGameImportButton();
    });
  });
  button.disabled = true;
  updateReviewedManagedVenueButton();
  updateGoBoundGameImportButton();
}

function saveGoBoundVenueChoice(card, action) {
  const proposal = goBoundPreviewState.venueSetup[Number(card.dataset.venueIndex)];
  if (!proposal) return;
  if (action === "new") {
    goBoundPreviewState.venueMappings.set(proposal.key, {
      mode: "new",
      arenaName: card.querySelector("[data-venue-arena-name]")?.value.trim() || "",
      rinkName: card.querySelector("[data-venue-rink-name]")?.value.trim() || "",
    });
    return;
  }
  if (action.startsWith("new-rink:")) {
    goBoundPreviewState.venueMappings.set(proposal.key, {
      mode: "new-rink",
      arenaId: action.split(":")[1],
      rinkName: card.querySelector("[data-venue-rink-name]")?.value.trim() || "",
    });
    return;
  }
  if (action === "external-new") {
    goBoundPreviewState.venueMappings.set(proposal.key, {
      mode: "external-new",
      ...suggestGoBoundVenueNames(proposal.location),
    });
    return;
  }
  if (action.startsWith("managed:")) {
    const [, arenaId, rinkId] = action.split(":");
    goBoundPreviewState.venueMappings.set(proposal.key, { mode: "managed", arenaId, rinkId });
    return;
  }
  goBoundPreviewState.venueMappings.set(proposal.key, { mode: "external", location: proposal.location });
}

function updateReviewedManagedVenueButton() {
  const button = document.getElementById("createReviewedManagedVenues");
  const list = document.getElementById("scheduleVenueSetupList");
  const messages = document.getElementById("scheduleVenueSetupMessages");
  if (!button || !list || !messages) return;
  const newCards = [...list.querySelectorAll("[data-venue-index]")].filter((card) => {
    const action = card.querySelector("[data-venue-action]")?.value || "";
    return action === "new" || action.startsWith("new-rink:") || action === "external-new";
  });
  const requiresSuperAdmin = newCards.some((card) => card.querySelector("[data-venue-action]")?.value === "external-new");
  const canManageFacilities = requiresSuperAdmin
    ? Auth.hasRole(window.ROLES.SuperAdmin)
    : Auth.hasRole(window.ROLES.SuperAdmin, window.ROLES.OrgAdmin, window.ROLES.OrgOwner);
  const hasIncompleteNames = newCards.some((card) =>
    (["new", "external-new"].includes(card.querySelector("[data-venue-action]")?.value) &&
      !card.querySelector("[data-venue-arena-name]")?.value.trim()) ||
    !card.querySelector("[data-venue-rink-name]")?.value.trim(),
  );
  button.disabled = !canManageFacilities || !newCards.length || hasIncompleteNames;
  if (!canManageFacilities) {
    messages.textContent = requiresSuperAdmin
      ? "Only a SuperAdmin can add unassociated External Team Venues to Arena Manager."
      : "Your account needs SuperAdmin, OrgAdmin, or OrgOwner access to create managed venues.";
  } else if (goBoundPreviewState.facilityCatalogError) {
    messages.textContent = "The managed venue catalog failed to load. Reload the CSV preview before creating venues.";
  } else if (!newCards.length) {
    messages.textContent = "No Arena Manager changes selected. Keep locations as game text, choose an existing Arena/Rink, or explicitly add a venue to the catalog.";
  } else if (hasIncompleteNames) {
    messages.textContent = "Enter both the Arena and Rink names for every selected venue.";
  } else {
    messages.textContent = `${newCards.length} venue${newCards.length === 1 ? "" : "s"} ready to add to Arena Manager. This does not import Games.`;
  }
}

  async function createReviewedManagedVenues() {
    const button = document.getElementById("createReviewedManagedVenues");
    const messages = document.getElementById("scheduleVenueSetupMessages");
    const list = document.getElementById("scheduleVenueSetupList");
    if (!button || !messages || !list) return;
    const cards = [...list.querySelectorAll("[data-venue-index]")];
    cards.forEach((card) => {
      const action = card.querySelector("[data-venue-action]")?.value || "";
      if (action === "new" || action.startsWith("new-rink:") || action === "external-new") {
        saveGoBoundVenueChoice(card, action);
      }
    });
    const newSelections = cards.map((card) => ({
      card,
      proposal: goBoundPreviewState.venueSetup[Number(card.dataset.venueIndex)],
      action: card.querySelector("[data-venue-action]")?.value || "",
      arenaName: card.querySelector("[data-venue-arena-name]")?.value.trim() || "",
      rinkName: card.querySelector("[data-venue-rink-name]")?.value.trim() || "",
    })).filter((item) => item.action === "new" || item.action.startsWith("new-rink:") || item.action === "external-new");
    const includesExternalVenues = newSelections.some((item) => item.action === "external-new");
    if (includesExternalVenues && !Auth.hasRole(window.ROLES.SuperAdmin)) {
      messages.textContent = "Only a SuperAdmin can add unassociated External Team Venues to Arena Manager.";
      return;
    }
    if (!includesExternalVenues && !Auth.hasRole(window.ROLES.SuperAdmin, window.ROLES.OrgAdmin, window.ROLES.OrgOwner)) {
      messages.textContent = "A facility administrator must create Winona-managed venues.";
      return;
    }
    if (!newSelections.length) {
      messages.textContent = "No Arena Manager changes are selected. Existing and external-text choices are ready for Game import.";
      return;
    }

    const invalid = newSelections.find((item) =>
        !item.proposal || !item.rinkName ||
        (item.action === "external-new" && (!item.arenaName || !includesExternalVenues)) ||
        (item.action !== "external-new" && (!item.proposal.organizationId || item.proposal.homeCount < 1 || item.proposal.awayCount > 0)) ||
        ((item.action === "new" || item.action === "external-new") && !item.arenaName) ||
        (item.action.startsWith("new-rink:") && !getWinonaManagedArenas(item.proposal.organizationId)
          .some((arena) => String(arena.arenaId) === item.action.split(":")[1])),
    );
    if (invalid) {
        messages.textContent = "Confirm Arena and Rink names. Winona-managed venues must be home-only; External Team Venues can be added for any location.";
      return;
    }
    if (goBoundPreviewState.facilityCatalogError) {
      messages.textContent = "Managed venue catalog is unavailable; no venues were created. Reload the preview and retry.";
      return;
    }

    const managedPairCount = newSelections.filter((item) => item.action === "new").length;
    const externalPairCount = newSelections.filter((item) => item.action === "external-new").length;
    const rinkCount = newSelections.length;
    if (!window.confirm(`Add ${managedPairCount} Winona-managed Arena${managedPairCount === 1 ? "" : "s"} and ${externalPairCount} External Team Venue${externalPairCount === 1 ? "" : "s"}, with ${rinkCount} Rink${rinkCount === 1 ? "" : "s"}, to Arena Manager? Games will not be imported.`)) return;
    button.disabled = true;
    messages.textContent = "Creating the reviewed managed venues...";
    let createdArenaCount = 0;
    let createdExternalArenaCount = 0;
    let createdRinkCount = 0;
    let reusedVenueCount = 0;
    let skippedExistingVenueCount = 0;
    const venueWarnings = [];
    let failedMessage = "";

    try {
      for (const item of newSelections) {
        let arena;
        if (item.action === "external-new") {
          const matchingArenas = goBoundPreviewState.facilityCatalog.filter((candidate) =>
            candidate.isActive &&
            normalizeScheduleName(candidate.name) === normalizeScheduleName(item.arenaName),
          );
          if (matchingArenas.length > 1) {
            skippedExistingVenueCount++;
            venueWarnings.push(`${item.arenaName} matches multiple existing Arenas; no duplicate was created.`);
            goBoundPreviewState.venueMappings.set(item.proposal.key, { mode: "external", location: item.proposal.location });
            continue;
          }
          arena = matchingArenas[0];
          if (arena?.organizations?.length) {
            const existingRink = (arena.rinks || []).some((rink) =>
              rink.isActive && normalizeScheduleName(rink.name) === normalizeScheduleName(item.rinkName),
            );
            skippedExistingVenueCount++;
            if (!existingRink) venueWarnings.push(`${item.arenaName} already exists with an Organization but not the selected Rink; no duplicate or association was created.`);
            goBoundPreviewState.venueMappings.set(item.proposal.key, { mode: "external", location: item.proposal.location });
            continue;
          }
          if (!arena) {
            const result = await FacilityApi.createExternalArena({
              name: item.arenaName,
              streetAddress: null,
              city: null,
              state: null,
              postalCode: null,
              isActive: true,
            });
            if (!result?.arenaId) throw new Error(`External Arena ${item.arenaName} was created without a returned ID.`);
            const refreshedCatalog = await FacilityApi.getCatalog();
            arena = refreshedCatalog.find((candidate) => String(candidate.arenaId) === String(result.arenaId));
            if (!arena) throw new Error(`External Arena ${item.arenaName} was created but could not be reloaded.`);
            goBoundPreviewState.facilityCatalog = refreshedCatalog;
            createdExternalArenaCount += result.created === false ? 0 : 1;
          }
        } else if (item.action.startsWith("new-rink:")) {
          arena = getWinonaManagedArenas(item.proposal.organizationId).find((candidate) =>
            String(candidate.arenaId) === item.action.split(":")[1],
          );
          if (!arena) throw new Error("The selected Winona Arena is no longer available.");
        } else {
          const matchingArenas = getWinonaManagedArenas(item.proposal.organizationId).filter((candidate) =>
            normalizeScheduleName(candidate.name) === normalizeScheduleName(item.arenaName),
          );
          if (matchingArenas.length > 1) throw new Error(`More than one Winona Arena is named ${item.arenaName}; select an existing venue instead.`);

          arena = matchingArenas[0];
          if (!arena) {
            const result = await FacilityApi.createArena(item.proposal.organizationId, {
              name: item.arenaName,
              streetAddress: null,
              city: null,
              state: null,
              postalCode: null,
              isPrimary: getWinonaManagedArenas(item.proposal.organizationId).length === 0,
              isActive: true,
            });
            if (!result?.arenaId) throw new Error(`Arena ${item.arenaName} was created without a returned ID.`);
            arena = {
              arenaId: result.arenaId,
              name: item.arenaName,
              isActive: true,
              organizations: [{ organizationId: item.proposal.organizationId }],
              rinks: [],
            };
            goBoundPreviewState.facilityCatalog.push(arena);
            createdArenaCount++;
          }
        }

        const matchingRinks = (arena.rinks || []).filter((rink) =>
          rink.isActive && normalizeScheduleName(rink.name) === normalizeScheduleName(item.rinkName),
        );
        if (matchingRinks.length > 1) throw new Error(`More than one Rink named ${item.rinkName} exists at ${item.arenaName}; select an existing venue instead.`);

        let rink = matchingRinks[0];
        if (!rink) {
          const result = await FacilityApi.createRink(arena.arenaId, {
            name: item.rinkName,
            displayOrder: (arena.rinks || []).length,
            isActive: true,
          });
          if (!result?.rinkId) throw new Error(`Rink ${item.rinkName} was created without a returned ID.`);
          rink = { rinkId: result.rinkId, arenaId: arena.arenaId, name: item.rinkName, isActive: true };
          arena.rinks = [...(arena.rinks || []), rink];
          createdRinkCount++;
        } else {
          reusedVenueCount++;
        }

        goBoundPreviewState.venueMappings.set(item.proposal.key, item.action === "external-new"
          ? { mode: "external", location: item.proposal.location }
          : { mode: "managed", arenaId: arena.arenaId, rinkId: rink.rinkId });
      }
      failedMessage = `Arena Manager update complete: ${createdArenaCount} Winona Arenas and ${createdExternalArenaCount} External Team Venues created; ${createdRinkCount} Rinks created, ${reusedVenueCount} Rinks reused, and ${skippedExistingVenueCount} existing venues skipped. No Games were imported.${venueWarnings.length ? ` ${venueWarnings.join(" ")}` : ""}`;
    } catch (error) {
      failedMessage = `Venue setup stopped: ${error.message || "Unknown error"}. Completed facilities are retained; retrying will reuse matching Arenas and Rinks.`;
    }

    try {
      goBoundPreviewState.facilityCatalog = await FacilityApi.getCatalog();
      goBoundPreviewState.facilityCatalogError = "";
    } catch (error) {
      goBoundPreviewState.facilityCatalogError = error.message || "Could not refresh managed venues.";
    }
    renderGoBoundVenueSetup(goBoundPreviewState.previewRows);
    messages.textContent = failedMessage;
  }

function proposalSelectionValue(proposal) {
  if (proposal.organizationCandidates.length === 1) {
    return `existing:${proposal.organizationCandidates[0].organizationId}`;
  }
  if (proposal.organizationCandidates.length === 0) return "new";
  return "";
}

function renderExternalOpponentSetup(rows) {
  const section = document.getElementById("scheduleExternalSetupSection");
  const list = document.getElementById("scheduleExternalSetupList");
  const button = document.getElementById("createReviewedExternalRecords");
  if (!section || !list || !button) return;

  const proposals = buildExternalOpponentSetup(rows);
  goBoundPreviewState.opponentSetup = proposals;
  if (!proposals.length) {
    section.classList.add("hidden");
    list.replaceChildren();
    button.disabled = true;
    return;
  }

  section.classList.remove("hidden");
  const canManageTeams = Auth.hasRole(window.ROLES.SuperAdmin, window.ROLES.OrgAdmin);
  const canCreateOrganizations = Auth.hasRole(window.ROLES.SuperAdmin);
  document.getElementById("scheduleExternalSetupMessages").textContent = !canManageTeams
    ? "Only a SuperAdmin or OrgAdmin can create the proposed Teams."
    : !goBoundPreviewState.activeSeason?.seasonId
      ? "No active Season is available; opponent records cannot be created."
    : canCreateOrganizations
      ? "Review proposed records. Selecting Create adds only Organizations/Teams for this active Season; it does not import Games."
      : "OrgAdmins can reuse existing Organizations and create Teams. Only a SuperAdmin can create a new Organization.";

  list.innerHTML = proposals.map((proposal, index) => {
    const selection = proposalSelectionValue(proposal);
    const existingOptions = proposal.organizationCandidates.map((organization) =>
      `<option value="existing:${escapeGoBoundPreview(organization.organizationId)}" ${selection === `existing:${organization.organizationId}` ? "selected" : ""}>Use ${escapeGoBoundPreview(organization.name)} (${escapeGoBoundPreview(organization.organizationType)})</option>`,
    ).join("");
    const createOptionSelected = selection === "new";
    const requiresChoice = proposal.organizationCandidates.length > 1;
    const leagueOptions = goBoundPreviewState.leagues.map((league) =>
      `<option value="${escapeGoBoundPreview(league.leagueId)}">${escapeGoBoundPreview(league.leagueName)}</option>`,
    ).join("");

    return `
      <article class="schedule-opponent-proposal" data-proposal-index="${index}">
        <h4>${escapeGoBoundPreview(proposal.opponent)}</h4>
        ${proposal.manualTeamReview ? `<p class="schedule-import-status-review">Existing same-level/type Team matches are ambiguous; resolve the Team mapping manually before creating records.</p>` : ""}
        <div class="schedule-opponent-fields">
          <label class="schedule-import-file-label">Organization action
            <select class="nf-input" data-proposal-organization>
              <option value="" ${requiresChoice ? "selected" : ""}>Choose an existing Organization</option>
              ${existingOptions}
              <option value="new" ${createOptionSelected ? "selected" : ""}>Create External Organization</option>
            </select>
          </label>
          <label class="schedule-import-file-label" data-new-org-name-wrap ${createOptionSelected ? "" : "hidden"}>New Organization Name
            <input class="nf-input" type="text" maxlength="200" data-proposal-name value="${escapeGoBoundPreview(proposal.opponent)}" />
          </label>
          <label class="schedule-import-file-label" data-new-org-league-wrap ${createOptionSelected ? "" : "hidden"}>League
            <select class="nf-input" data-proposal-league>
              <option value="">Select League</option>
              ${leagueOptions}
            </select>
          </label>
          <div class="schedule-import-file-label">Teams to create
            <div class="schedule-opponent-teams">${proposal.teamSpecs.map((team, teamIndex) => `
              <label class="schedule-team-import-option">
                <span>${escapeGoBoundPreview(team.teamName || team.name || proposal.opponent)} - ${escapeGoBoundPreview(team.teamType)} - ${escapeGoBoundPreview(team.levelName)}</span>
                <span class="schedule-team-import-switch">
                  <input type="checkbox" role="switch" data-team-import-index="${teamIndex}" aria-label="Include ${escapeGoBoundPreview(proposal.opponent)} ${escapeGoBoundPreview(team.teamType)} ${escapeGoBoundPreview(team.levelName)} in import" ${isGoBoundTeamIncluded(proposal.opponent, team.teamType, team.levelName) ? "checked" : ""} />
                  <span class="schedule-team-import-track" aria-hidden="true"></span>
                </span>
              </label>
            `).join("")}</div>
          </div>
        </div>
      </article>
    `;
  }).join("");

  list.querySelectorAll("[data-proposal-organization]").forEach((select) => {
    select.addEventListener("change", () => {
      const card = select.closest("[data-proposal-index]");
      const isNew = select.value === "new";
      card.querySelector("[data-new-org-name-wrap]").hidden = !isNew;
      card.querySelector("[data-new-org-league-wrap]").hidden = !isNew;
      updateExternalSetupButton();
    });
  });
  list.querySelectorAll("[data-proposal-name], [data-proposal-league]").forEach((control) => {
    control.addEventListener("input", updateExternalSetupButton);
    control.addEventListener("change", updateExternalSetupButton);
  });
  list.querySelectorAll("[data-team-import-index]").forEach((control) => {
    control.addEventListener("change", () => {
      const proposal = goBoundPreviewState.opponentSetup[Number(control.closest("[data-proposal-index]").dataset.proposalIndex)];
      const spec = proposal.teamSpecs[Number(control.dataset.teamImportIndex)];
      const key = goBoundTeamImportKey(proposal.opponent, spec.teamType, spec.levelName);
      if (control.checked) goBoundPreviewState.excludedTeams.delete(key);
      else goBoundPreviewState.excludedTeams.add(key);
      updateExternalSetupButton();
      renderGoBoundVenueSetup(goBoundPreviewState.previewRows);
      const counts = goBoundPreviewState.previewCounts;
      renderGoBoundPreview(goBoundPreviewState.previewRows, counts.fileRowCount, counts.skippedScrimmages, counts.duplicates);
    });
  });
  button.disabled = !canManageTeams;
  updateExternalSetupButton();
}

function updateExternalSetupButton() {
  const button = document.getElementById("createReviewedExternalRecords");
  const list = document.getElementById("scheduleExternalSetupList");
  if (!button || !list) return;
  const cards = [...list.querySelectorAll("[data-proposal-index]")].filter((card) => {
    const proposal = goBoundPreviewState.opponentSetup[Number(card.dataset.proposalIndex)];
    return proposal && includedGoBoundTeamSpecs(proposal).length > 0;
  });
  const valid = cards.every((card) => {
    const index = Number(card.dataset.proposalIndex);
    const proposal = goBoundPreviewState.opponentSetup[index];
    const selection = card.querySelector("[data-proposal-organization]")?.value || "";
    if (!proposal || proposal.manualTeamReview || !selection) return false;
    if (selection === "new") {
      return Auth.hasRole(window.ROLES.SuperAdmin) &&
        Boolean(card.querySelector("[data-proposal-name]")?.value.trim()) &&
        Boolean(card.querySelector("[data-proposal-league]")?.value);
    }
    return selection.startsWith("existing:");
  });
  button.disabled = !Auth.hasRole(window.ROLES.SuperAdmin, window.ROLES.OrgAdmin) ||
    !goBoundPreviewState.activeSeason?.seasonId || !cards.length || !valid;
}

function renderGoBoundPreview(rows, fileRowCount, skippedScrimmages, duplicates) {
  goBoundPreviewState.previewCounts = { fileRowCount, skippedScrimmages, duplicates };
  const summary = document.getElementById("scheduleImportSummary");
  const messages = document.getElementById("scheduleImportMessages");
  const body = document.getElementById("scheduleImportRows");
  const includedRows = rows.filter((row) => isGoBoundTeamIncluded(row.opponent, row.teamType, row.levelName));
  const readyCount = includedRows.filter((row) => row.ready).length;
  const reviewCount = includedRows.length - readyCount;
  const excludedCount = rows.length - includedRows.length;
  const missingNonConference = !goBoundPreviewState.gameTypes.some(
    (item) => normalizeScheduleName(item.name) === "non conference",
  );

  summary.textContent = `${fileRowCount} CSV rows · ${rows.length} games · ${skippedScrimmages} scrimmage rows excluded · ${duplicates} duplicate rows skipped · ${excludedCount} games excluded by Team · ${readyCount} ready · ${reviewCount} need mapping`;
  messages.textContent = missingNonConference
    ? "Non-Conference is missing from the current Game Type catalog; add it before import."
    : "Schedule preview only: no Games are created or changed here.";

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="11">No eligible non-scrimmage game rows found.</td></tr>';
    updateGoBoundGameImportButton();
    return;
  }

  body.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeGoBoundPreview(row.date)}</td>
      <td>${escapeGoBoundPreview(row.time)}</td>
      <td>${escapeGoBoundPreview(row.teamName)}</td>
      <td>${escapeGoBoundPreview(row.levelName)}</td>
      <td>${escapeGoBoundPreview(row.teamType)}</td>
      <td>${escapeGoBoundPreview(row.opponent)}</td>
      <td>${escapeGoBoundPreview(row.opponentMapping)}</td>
      <td>${escapeGoBoundPreview(row.homeAway)}</td>
      <td>${escapeGoBoundPreview(row.gameType)}</td>
      <td>${escapeGoBoundPreview(row.venue)}</td>
      <td class="${row.ready ? "schedule-import-status-ready" : "schedule-import-status-review"}">${escapeGoBoundPreview(!isGoBoundTeamIncluded(row.opponent, row.teamType, row.levelName) ? "Excluded - Team import is off" : row.ready ? "Ready for review" : row.problems.join("; "))}</td>
    </tr>
  `).join("");
  updateGoBoundGameImportButton();
}

async function previewGoBoundCsv(file) {
  const sameFile = goBoundPreviewState.previewFile === file;
  if (!sameFile) {
    goBoundPreviewState.venueMappings = new Map();
    goBoundPreviewState.gamesImported = false;
    goBoundPreviewState.excludedTeams = new Set();
  }
  goBoundPreviewState.previewFile = file;
  goBoundPreviewState.previewRows = [];
  goBoundPreviewState.opponentSetup = [];
  goBoundPreviewState.venueSetup = [];
  updateGoBoundGameImportButton();
  renderExternalOpponentSetup([]);
  renderGoBoundVenueSetup([]);
  const messages = document.getElementById("scheduleImportMessages");
  const body = document.getElementById("scheduleImportRows");
  messages.textContent = "Loading active Season Teams and catalogs...";
  body.innerHTML = '<tr><td colspan="8">Checking file...</td></tr>';

  try {
    await loadGoBoundPreviewLookups();
    const sourceRows = parseGoBoundCsv(await file.text());
    const activities = sourceRows.filter((row) => row.activity);
    const scrimmages = activities.filter((row) => /scrimmage/i.test(`${row.event} ${row.activity}`));
    const gameRows = activities.filter((row) => !/scrimmage/i.test(`${row.event} ${row.activity}`));
    const seen = new Set();
    let duplicates = 0;
    const uniqueRows = gameRows.filter((row) => {
      const key = [row.event,row.activity,row.date,row.time,row.versus,row.location]
        .map((value) => String(value || "").trim().toLowerCase())
        .join("|");
      if (seen.has(key)) {
        duplicates++;
        return false;
      }
      seen.add(key);
      return true;
    });
    const previewRows = uniqueRows.map(classifyGoBoundRow);
    goBoundPreviewState.previewRows = previewRows;
    renderExternalOpponentSetup(previewRows);
    renderGoBoundVenueSetup(previewRows);
    renderGoBoundPreview(previewRows, sourceRows.length, scrimmages.length, duplicates);
  } catch (error) {
    summaryMessage(`Preview failed: ${error.message || "Unable to read schedule."}`);
    body.innerHTML = '<tr><td colspan="11">Unable to preview this file.</td></tr>';
  }
}

async function createReviewedExternalRecords() {
  const button = document.getElementById("createReviewedExternalRecords");
  const messages = document.getElementById("scheduleExternalSetupMessages");
  const list = document.getElementById("scheduleExternalSetupList");
  const season = goBoundPreviewState.activeSeason;
  const proposals = goBoundPreviewState.opponentSetup;
  if (!button || !messages || !list || !season?.seasonId || !proposals.length) return;
  const isSuperAdmin = Auth.hasRole(window.ROLES.SuperAdmin);
  if (!Auth.hasRole(window.ROLES.SuperAdmin, window.ROLES.OrgAdmin)) {
    messages.textContent = "Only a SuperAdmin or OrgAdmin can create External Organizations and Teams.";
    return;
  }

  const cards = [...list.querySelectorAll("[data-proposal-index]")];
  const selections = cards.map((card) => {
    const proposal = proposals[Number(card.dataset.proposalIndex)];
    const choice = card.querySelector("[data-proposal-organization]")?.value || "";
    const existingId = choice.startsWith("existing:") ? choice.slice("existing:".length) : "";
    return {
      proposal,
      teamSpecs: proposal ? includedGoBoundTeamSpecs(proposal) : [],
      choice,
      existingOrganization: existingId
        ? goBoundPreviewState.organizations.find((organization) => String(organization.organizationId) === existingId)
        : null,
      newName: card.querySelector("[data-proposal-name]")?.value?.trim() || "",
      newLeagueId: card.querySelector("[data-proposal-league]")?.value || "",
    };
  }).filter((selection) => selection.teamSpecs.length > 0);

  if (!selections.length) {
    messages.textContent = "No Teams are included. No Organizations or Teams were created.";
    return;
  }

  const invalid = selections.find((selection) =>
    !selection.proposal || selection.proposal.manualTeamReview || !selection.choice ||
    (selection.choice === "new" && (!selection.newName || !selection.newLeagueId)) ||
    (selection.choice === "new" && !isSuperAdmin) ||
    (selection.choice.startsWith("existing:") && !selection.existingOrganization),
  );
  if (invalid) {
    messages.textContent = "Resolve every Organization and League choice before creating records.";
    return;
  }

  const missingLevel = selections.flatMap((selection) => selection.teamSpecs).find((spec) =>
    !goBoundPreviewState.levels.some((item) =>
      normalizeScheduleName(item.levelName || item.name) === normalizeScheduleName(spec.levelName),
    ),
  );
  if (missingLevel) {
    messages.textContent = `Level ${missingLevel.levelName} is missing from the catalog; no records were created.`;
    return;
  }

  const proposedTeamCount = selections.reduce((count, selection) => count + selection.teamSpecs.length, 0);
  if (!window.confirm(`Create or reuse ${selections.length} opponent Organizations and create up to ${proposedTeamCount} current-season Teams? Games will not be imported.`)) return;

  button.disabled = true;
  messages.textContent = "Creating the reviewed opponent records...";
  const resolved = [];
  let createdOrganizationCount = 0;
  let createdTeamCount = 0;
  let existingTeamCount = 0;
  let failedMessage = "";

  try {
    for (const selection of selections) {
      let organization = selection.existingOrganization;
      if (!organization) {
        const response = await authFetch("/organizations", {
          method: "POST",
          body: JSON.stringify({
            name: selection.newName,
            leagueId: selection.newLeagueId,
            organizationType: "External",
            isActive: true,
          }),
        });
        if (!response.ok) {
          let error = {};
          try { error = JSON.parse(await response.text()); } catch {}
          if (response.status === 409 && error.existingOrganizationId) {
            const existingResponse = await authFetch(`/organizations/${error.existingOrganizationId}`);
            if (!existingResponse.ok) throw new Error(error.message || "A matching Organization exists but could not be loaded.");
            organization = await existingResponse.json();
          } else {
            throw new Error(error.message || `Could not create ${selection.newName}.`);
          }
        } else {
          const data = await response.json();
          const organizationId = data.organizationId || data.OrganizationId;
          organization = {
            organizationId,
            name: selection.newName,
            leagueId: selection.newLeagueId,
            organizationType: "External",
            mascot: "",
          };
          createdOrganizationCount++;
        }
      }
      if (!organization?.organizationId) throw new Error(`Could not resolve an Organization for ${selection.proposal.opponent}.`);
      resolved.push({ selection, organization });
    }

    const participationResponse = await authFetch(`/seasons/${season.seasonId}/organizations`, { cache: "no-store" });
    if (!participationResponse.ok) throw new Error("Could not load active Season participation.");
    const seasonOrganizations = await participationResponse.json();
    const selectedIds = new Set(resolved.map(({ organization }) => String(organization.organizationId)));
    const participation = seasonOrganizations.map((item) => {
      const selected = selectedIds.has(String(item.organizationId));
      return {
        organizationId: item.organizationId,
        isParticipating: selected || Boolean(item.isParticipating),
        participationType: selected
          ? (item.organizationType || "External")
          : (item.participationType || "NotParticipating"),
      };
    });
    for (const { organization } of resolved) {
      if (!participation.some((item) => String(item.organizationId) === String(organization.organizationId))) {
        participation.push({
          organizationId: organization.organizationId,
          isParticipating: true,
          participationType: organization.organizationType || "External",
        });
      }
    }

    const saveParticipation = await authFetch(`/seasons/${season.seasonId}/organizations`, {
      method: "PUT",
      body: JSON.stringify({ organizations: participation }),
    });
    if (!saveParticipation.ok) throw new Error(await goBoundResponseError(saveParticipation, "Could not add Organizations to the active Season."));

    for (const { selection, organization } of resolved) {
      for (const spec of selection.teamSpecs) {
        const existingTeam = goBoundPreviewState.teams.find((team) =>
          String(team.organizationId) === String(organization.organizationId) &&
          normalizeScheduleName(team.name) === normalizeScheduleName(spec.name) &&
          normalizeScheduleName(team.teamType) === normalizeScheduleName(spec.teamType) &&
          normalizeScheduleName(team.levelName) === normalizeScheduleName(spec.levelName),
        );
        if (existingTeam) {
          existingTeamCount++;
          continue;
        }

        const level = goBoundPreviewState.levels.find((item) =>
          normalizeScheduleName(item.levelName || item.name) === normalizeScheduleName(spec.levelName),
        );

        const teamResponse = await authFetch("/teams", {
          method: "POST",
          body: JSON.stringify({
            organizationId: organization.organizationId,
            levelId: level.levelId || level.LevelId,
            seasonId: season.seasonId,
            name: spec.name,
            teamType: spec.teamType,
            gender: spec.teamType,
            teamMascot: organization.mascot || null,
            isExternal: String(organization.organizationType || "External").toLowerCase() === "external",
            isActive: true,
            conferenceDistrictId: null,
            sectionRegionId: null,
          }),
        });
        if (!teamResponse.ok) throw new Error(await goBoundResponseError(teamResponse, `Could not create ${spec.teamType} ${spec.levelName} for ${selection.proposal.opponent}.`));
        createdTeamCount++;
      }
    }

    failedMessage = `Opponent setup complete: ${createdOrganizationCount} Organizations created, ${createdTeamCount} Teams created, and ${existingTeamCount} Teams reused. No Games were imported.`;
  } catch (error) {
    failedMessage = `Setup stopped: ${error.message || "Unknown error"}. Some approved records may already exist; refreshing the preview will identify remaining items.`;
  }

  try {
    goBoundPreviewState.teams = [];
    goBoundPreviewState.gameTypes = [];
    goBoundPreviewState.organizations = [];
    goBoundPreviewState.leagues = [];
    goBoundPreviewState.levels = [];
    goBoundPreviewState.activeSeason = null;
    if (goBoundPreviewState.previewFile) await previewGoBoundCsv(goBoundPreviewState.previewFile);
  } catch (refreshError) {
    if (!failedMessage) failedMessage = `Records were created, but the preview refresh failed: ${refreshError.message || "Unknown error"}.`;
  }

  if (failedMessage) {
    const scheduleMessages = document.getElementById("scheduleImportMessages");
    if (failedMessage.startsWith("Opponent setup complete:") && scheduleMessages) {
      scheduleMessages.textContent = failedMessage;
    } else {
      messages.textContent = failedMessage;
    }
  }
  updateExternalSetupButton();
}

async function goBoundResponseError(response, fallback) {
  const text = await response.text();
  if (!text) return fallback;
  try {
    const payload = JSON.parse(text);
    return payload?.message || payload?.error || fallback;
  } catch {
    return text;
  }
}

function goBoundDateValue(value) {
  const text = String(value || "").trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let year;
  let month;
  let day;
  if (match) {
    [, year, month, day] = match;
  } else {
    match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!match) return "";
    [, month, day, year] = match;
  }
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() + 1 !== Number(month) || parsed.getUTCDate() !== Number(day)) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function goBoundTimeValue(value) {
  const text = String(value || "").trim();
  let match = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  let hour;
  let minute;
  if (match) {
    hour = Number(match[1]);
    minute = Number(match[2]);
    if (hour < 1 || hour > 12 || minute > 59) return "";
    hour = (hour % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0);
  } else {
    match = text.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return "";
    hour = Number(match[1]);
    minute = Number(match[2]);
    if (hour > 23 || minute > 59) return "";
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function goBoundGameDateTimeKey(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  if (match) return match[1];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}T${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
}

function buildGoBoundGameImportPlan() {
  const entries = [];
  const problems = [];
  const seen = new Set();
  goBoundPreviewState.previewRows.forEach((row, index) => {
    if (!isGoBoundTeamIncluded(row.opponent, row.teamType, row.levelName)) return;
    if (!row.ready) {
      problems.push(`Row ${index + 1}: ${row.problems.join("; ")}`);
      return;
    }

    const opponentTeamId = row.opponentMappingDetails?.teamId;
    const homeTeamId = row.homeAway === "Home" ? row.winonaTeamId : opponentTeamId;
    const awayTeamId = row.homeAway === "Home" ? opponentTeamId : row.winonaTeamId;
    const date = goBoundDateValue(row.date);
    const time = goBoundTimeValue(row.time);
    const gameType = goBoundPreviewState.gameTypes.find((item) =>
      normalizeScheduleName(item.name) === normalizeScheduleName(row.gameType),
    );
    const venue = goBoundPreviewState.venueMappings.get(getGoBoundVenueKey(row.venue)) || { mode: "external" };
    let rowProblem = "";
    if (!homeTeamId || !awayTeamId || homeTeamId === awayTeamId) rowProblem = "Team mapping is incomplete.";
    else if (!date || !time) rowProblem = "Date or time format is not recognized.";
    else if (!gameType || !Number.isInteger(Number(gameType.gameTypeId))) rowProblem = "Game Type is unavailable.";
    else if (venue.mode === "new" || venue.mode === "new-rink" || venue.mode === "external-new") rowProblem = "Create the selected Arena/Rink in Arena Manager before importing Games.";
    else if (venue.mode === "managed" && (!venue.arenaId || !venue.rinkId)) rowProblem = "Managed Arena/Rink selection is incomplete.";
    if (rowProblem) {
      problems.push(`Row ${index + 1}: ${rowProblem}`);
      return;
    }

    const gameDateTime = `${date}T${time}:00`;
    const key = `${homeTeamId}|${awayTeamId}|${gameDateTime.slice(0, 16)}`;
    if (seen.has(key)) {
      problems.push(`Row ${index + 1}: This Team pairing and game time appears more than once in the CSV.`);
      return;
    }
    seen.add(key);
    entries.push({
      row,
      key,
      payload: {
        homeTeamId,
        awayTeamId,
        gameDateTime,
        arenaId: venue.mode === "managed" ? venue.arenaId : null,
        rinkId: venue.mode === "managed" ? venue.rinkId : null,
        arenaName: venue.mode === "managed" ? "" : row.venue,
        rinkName: "",
        venueAddress: null,
        gameTypeId: Number(gameType.gameTypeId),
        gameRoundId: null,
        periodLengthMinutes: null,
        referee1OfficialId: null,
        referee2OfficialId: null,
        linesman1OfficialId: null,
        linesman2OfficialId: null,
        notes: null,
        status: "Scheduled",
      },
    });
  });
  return { entries, problems };
}

function updateGoBoundGameImportButton() {
  const button = document.getElementById("importReviewedGoBoundGames");
  const messages = document.getElementById("scheduleGameImportMessages");
  if (!button || !messages) return;
  const plan = buildGoBoundGameImportPlan();
  const canImport = Auth.hasRole(window.ROLES.SuperAdmin, window.ROLES.OrgAdmin, window.ROLES.OrgOwner);
  button.disabled = !canImport || !plan.entries.length || plan.problems.length > 0 || goBoundPreviewState.gamesImported;
  if (!canImport) messages.textContent = "A SuperAdmin, OrgAdmin, or OrgOwner is required to import Games.";
  else if (plan.problems.length) messages.textContent = `Resolve ${plan.problems.length} schedule or venue issue${plan.problems.length === 1 ? "" : "s"} before importing Games.`;
  else if (goBoundPreviewState.gamesImported) messages.textContent = "This CSV import completed. Matching Games will be skipped if you reload and retry.";
  else if (plan.entries.length) messages.textContent = `${plan.entries.length} reviewed Games are ready. Existing matching Games will be skipped.`;
  else messages.textContent = "Preview a GoBound CSV to prepare Games for import.";
}

async function importReviewedGoBoundGames() {
  const button = document.getElementById("importReviewedGoBoundGames");
  const messages = document.getElementById("scheduleGameImportMessages");
  if (!button || !messages) return;
  const plan = buildGoBoundGameImportPlan();
  if (!Auth.hasRole(window.ROLES.SuperAdmin, window.ROLES.OrgAdmin, window.ROLES.OrgOwner)) {
    messages.textContent = "A SuperAdmin, OrgAdmin, or OrgOwner is required to import Games.";
    return;
  }
  if (!plan.entries.length || plan.problems.length) {
    updateGoBoundGameImportButton();
    return;
  }

  button.disabled = true;
  messages.textContent = "Checking for Games already in this Season...";
  let existingGames;
  try {
    const response = await authFetch("/games", { cache: "no-store" });
    if (!response.ok) throw new Error(await goBoundResponseError(response, "Could not check existing Games."));
    existingGames = await response.json();
    if (!Array.isArray(existingGames)) throw new Error("The Games endpoint returned an invalid list.");
  } catch (error) {
    messages.textContent = `Import stopped before creating Games: ${error.message || "Could not load existing Games."}`;
    updateGoBoundGameImportButton();
    return;
  }

  const activeTeamIds = new Set(goBoundPreviewState.teams.map((team) => String(team.teamId || team.id || "")));
  const existingKeys = new Set(existingGames.filter((game) =>
    activeTeamIds.has(String(game.homeTeamId)) || activeTeamIds.has(String(game.awayTeamId)),
  ).map((game) => {
    const dateTime = goBoundGameDateTimeKey(game.gameDateTime);
    return dateTime ? `${game.homeTeamId}|${game.awayTeamId}|${dateTime}` : "";
  }));
  const toCreate = plan.entries.filter((entry) => !existingKeys.has(entry.key));
  const skippedCount = plan.entries.length - toCreate.length;
  if (!window.confirm(`Import ${toCreate.length} Games and skip ${skippedCount} matching Games already present? This creates Games only; it will not create or change Organizations, Teams, or venues.`)) {
    updateGoBoundGameImportButton();
    return;
  }

  let createdCount = 0;
  let resultMessage = "";
  try {
    for (const entry of toCreate) {
      const response = await authFetch("/games", {
        method: "POST",
        body: JSON.stringify(entry.payload),
      });
      if (!response.ok) {
        const detail = await goBoundResponseError(response, `Could not create ${entry.row.sourceEvent}.`);
        throw new Error(`Stopped after ${createdCount} Games: ${detail}`);
      }
      createdCount++;
    }
    goBoundPreviewState.gamesImported = true;
    if (typeof loadGames === "function") await loadGames();
    resultMessage = `Schedule import complete: ${createdCount} Games created and ${skippedCount} matching Games skipped.`;
  } catch (error) {
    resultMessage = `${error.message || "Game import failed."} Retry is safe; matching Games will be skipped.`;
  }
  updateGoBoundGameImportButton();
  messages.textContent = resultMessage;
}

function summaryMessage(message) {
  const summary = document.getElementById("scheduleImportSummary");
  if (summary) summary.textContent = "";
  const messages = document.getElementById("scheduleImportMessages");
  if (messages) messages.textContent = message;
}

function initScheduleImportPreview() {
  const panel = document.getElementById("scheduleImportPreview");
  if (!panel || window.__scheduleImportPreviewInitialized) return;
  window.__scheduleImportPreviewInitialized = true;

  const openButton = document.getElementById("btnPreviewGoBoundSchedule");
  const closeButton = document.getElementById("closeScheduleImportPreview");
  const fileInput = document.getElementById("scheduleImportCsvFile");
  const createButton = document.getElementById("createReviewedExternalRecords");
  const createVenueButton = document.getElementById("createReviewedManagedVenues");
  const importGamesButton = document.getElementById("importReviewedGoBoundGames");
  openButton?.addEventListener("click", () => {
    panel.classList.remove("hidden");
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    fileInput?.click();
  });
  closeButton?.addEventListener("click", () => panel.classList.add("hidden"));
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) previewGoBoundCsv(file);
  });
  createButton?.addEventListener("click", createReviewedExternalRecords);
  createVenueButton?.addEventListener("click", createReviewedManagedVenues);
  importGamesButton?.addEventListener("click", importReviewedGoBoundGames);
}

document.addEventListener("layoutLoaded", initScheduleImportPreview);
if (document.getElementById("scheduleImportPreview")) initScheduleImportPreview();