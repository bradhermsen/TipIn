const goBoundPreviewState = {
  teams: [],
  gameTypes: [],
  organizations: [],
  activeSeason: null,
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
  if (match) return { opponent: match[1].trim(), winonaIsHome: true };
  match = event.match(/^(.+?)\s+vs\s+Winona$/i);
  if (match) return { opponent: match[1].trim(), winonaIsHome: false };
  return { opponent: "", winonaIsHome: null };
}

function goBoundDivision(activity) {
  const value = String(activity || "").toLowerCase();
  if (/\bjv\b/.test(value)) return "JV";
  if (/\bvarsity\b/.test(value)) return "Varsity";
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

function findWinonaTeam(division) {
  return goBoundPreviewState.teams.find((team) =>
    String(team.teamType || "").toLowerCase() === "boys" &&
    String(team.levelName || "").toLowerCase() === division &&
    normalizeScheduleName(`${team.organizationName || ""} ${team.name || ""}`).includes("winona"),
  );
}

function getOpponentMapping(opponentName) {
  const normalizedOpponent = normalizeScheduleName(opponentName);
  const activeTeams = goBoundPreviewState.teams.filter((team) =>
    normalizeScheduleName(team.name) === normalizedOpponent ||
    normalizeScheduleName(team.organizationName) === normalizedOpponent,
  );
  if (activeTeams.length === 1) {
    const team = activeTeams[0];
    return {
      label: `${team.organizationName || "External"} / ${team.name} (${team.levelName || team.teamType || "Team"})`,
      ready: true,
    };
  }
  if (activeTeams.length > 1) {
    return { label: `${activeTeams.length} current-season Team matches; choose one`, ready: false };
  }

  const organizations = goBoundPreviewState.organizations.filter((organization) =>
    organizationNameMatch(organization.name, opponentName),
  );
  if (organizations.length === 1) {
    return {
      label: `${organizations[0].name} exists; current-season Team needed`,
      ready: false,
    };
  }
  if (organizations.length > 1) {
    return { label: `${organizations.length} Organization matches; choose one`, ready: false };
  }

  return { label: "External Organization and Team needed", ready: false };
}

async function loadGoBoundPreviewLookups() {
  if (goBoundPreviewState.teams.length && goBoundPreviewState.gameTypes.length) return;

  const [teamsResponse, gameTypesResponse, organizationsResponse] = await Promise.all([
    authFetch("/teams"),
    authFetch("/gametypes"),
    authFetch("/organizations"),
  ]);
  if (!teamsResponse.ok || !gameTypesResponse.ok || !organizationsResponse.ok) {
    throw new Error("Could not load current Season catalog data.");
  }

  goBoundPreviewState.teams = await SeasonContext.filterTeams(await teamsResponse.json());
  goBoundPreviewState.gameTypes = await gameTypesResponse.json();
  goBoundPreviewState.organizations = await organizationsResponse.json();
  goBoundPreviewState.activeSeason = await SeasonContext.getActiveSeason();
}

function classifyGoBoundRow(row) {
  const event = row.event || "";
  const activity = row.activity || "";
  const direction = goBoundOpponent(event);
  const division = goBoundDivision(activity);
  const winonaTeam = division ? findWinonaTeam(division) : null;
  const classification = (row.cnc || "").trim().toUpperCase();
  const gameTypeName = classification === "C"
    ? "Conference"
    : classification === "NC"
      ? "Non-Conference"
      : "";
  const gameTypeMatches = gameTypeName
    ? goBoundPreviewState.gameTypes.filter((item) => normalizeScheduleName(item.name) === normalizeScheduleName(gameTypeName))
    : [];
  const opponent = direction.opponent ? getOpponentMapping(direction.opponent) : null;
  const problems = [];

  if (!division) problems.push("Unrecognized Varsity/JV activity");
  else if (!winonaTeam) problems.push(`Winona Boys ${division} Team not found in active Season`);
  if (!direction.opponent) problems.push("Could not determine opponent/home-away from Event");
  else if (!opponent?.ready) problems.push(opponent?.label || "Opponent Team needs mapping");
  if (!row.date || !row.time) problems.push("Date or time missing");
  if (!gameTypeName) problems.push("C / NC value missing or unrecognized");
  else if (!gameTypeMatches.length) problems.push(`${gameTypeName} Game Type missing`);
  else if (gameTypeMatches.length > 1) problems.push(`${gameTypeName} has duplicate catalog entries`);

  return {
    sourceEvent: event,
    activity,
    division,
    opponent: direction.opponent,
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

function renderGoBoundPreview(rows, fileRowCount, skippedScrimmages, duplicates) {
  const summary = document.getElementById("scheduleImportSummary");
  const messages = document.getElementById("scheduleImportMessages");
  const body = document.getElementById("scheduleImportRows");
  const readyCount = rows.filter((row) => row.ready).length;
  const reviewCount = rows.length - readyCount;
  const missingNonConference = !goBoundPreviewState.gameTypes.some(
    (item) => normalizeScheduleName(item.name) === "non conference",
  );

  summary.textContent = `${fileRowCount} CSV rows · ${rows.length} games · ${skippedScrimmages} scrimmage rows excluded · ${duplicates} duplicate rows skipped · ${readyCount} ready · ${reviewCount} need mapping`;
  messages.textContent = missingNonConference
    ? "Non-Conference is missing from the current Game Type catalog; add it before import."
    : "Preview only: this page has not created or changed any database records.";

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="8">No eligible non-scrimmage game rows found.</td></tr>';
    return;
  }

  body.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeGoBoundPreview(row.date)}</td>
      <td>${escapeGoBoundPreview(row.time)}</td>
      <td>${escapeGoBoundPreview(row.division ? `Winona Boys ${row.division}` : row.activity)}</td>
      <td>${escapeGoBoundPreview(row.opponent)}</td>
      <td>${escapeGoBoundPreview(row.homeAway)}</td>
      <td>${escapeGoBoundPreview(row.gameType)}</td>
      <td>${escapeGoBoundPreview(row.venue)}</td>
      <td class="${row.ready ? "schedule-import-status-ready" : "schedule-import-status-review"}">${escapeGoBoundPreview(row.ready ? "Ready for review" : row.problems.join("; "))}</td>
    </tr>
  `).join("");
}

async function previewGoBoundCsv(file) {
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
    renderGoBoundPreview(previewRows, sourceRows.length, scrimmages.length, duplicates);
  } catch (error) {
    summaryMessage(`Preview failed: ${error.message || "Unable to read schedule."}`);
    body.innerHTML = '<tr><td colspan="8">Unable to preview this file.</td></tr>';
  }
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
}

document.addEventListener("layoutLoaded", initScheduleImportPreview);
if (document.getElementById("scheduleImportPreview")) initScheduleImportPreview();