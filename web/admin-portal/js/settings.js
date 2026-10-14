let mediaOutletsState = [];
let leaguesState = [];
let gameTypesState = [];
let levelsState = [];
let conferencesState = [];
let sectionsState = [];
let settingsPageInitialized = false;

(function checkPermission() {
  if (!Auth.hasRole(window.ROLES.SuperAdmin, window.ROLES.OrgAdmin)) {
    window.location.href = "./not-authorized.html";
  }
})();

function notifySettings(message, type = "info") {
  if (typeof window.showMessage === "function") {
    window.showMessage(message, type);
    return;
  }
  console[type === "error" ? "error" : "warn"](`[${type}] ${message}`);
}

async function initSettingsPage() {
  if (settingsPageInitialized) return;
  settingsPageInitialized = true;

  wireSettingsEvents();
  const loads = [];
  if (document.getElementById("smtp-host")) loads.push(loadEmailSettings());
  if (document.getElementById("settings-leagues-list")) loads.push(loadLeagueCatalog());
  if (document.getElementById("settings-game-types-list")) loads.push(loadGameTypeCatalog());
  if (document.getElementById("settings-levels-list")) loads.push(loadLevelCatalog());
  if (document.getElementById("settings-conferences-list")) {
    loads.push(loadLeagueCatalog(), loadConferenceCatalog());
  }
  if (document.getElementById("settings-sections-list")) {
    loads.push(loadLeagueCatalog(), loadSectionCatalog());
  }
  await Promise.all(loads);
}

function wireSettingsEvents() {
  const saveEmailBtn = document.getElementById("settings-save-email");
  const saveMediaBtn = document.getElementById("settings-save-media");
  const testBtn = document.getElementById("settings-test-send");
  const addMediaBtn = document.getElementById("media-outlet-add");
  const addLeagueBtn = document.getElementById("settings-add-league");
  const addGameTypeBtn = document.getElementById("settings-add-game-type");
  const addLevelBtn = document.getElementById("settings-add-level");
  const addConferenceBtn = document.getElementById("settings-add-conference");
  const addSectionBtn = document.getElementById("settings-add-section");

  if (saveEmailBtn) {
    saveEmailBtn.onclick = async () => {
      await saveEmailServerSettings();
    };
  }

  if (saveMediaBtn) {
    saveMediaBtn.onclick = async () => {
      await saveMediaOutletsSettings();
    };
  }

  if (testBtn) {
    testBtn.onclick = async () => {
      await sendTestEmail();
    };
  }

  if (addMediaBtn) {
    addMediaBtn.onclick = () => {
      addMediaOutlet();
    };
  }

  if (addLeagueBtn) addLeagueBtn.onclick = addLeague;
  if (addGameTypeBtn) addGameTypeBtn.onclick = addGameType;
  if (addLevelBtn) addLevelBtn.onclick = addLevel;
  if (addConferenceBtn) addConferenceBtn.onclick = addConference;
  if (addSectionBtn) addSectionBtn.onclick = addSection;
}

function setCatalogStatus(catalog, message = "", state = "idle") {
  const el = document.getElementById(`settings-${catalog}-status`);
  if (!el) return;
  el.textContent = message;
  el.classList.remove("is-success", "is-error", "is-working");
  if (state === "success") el.classList.add("is-success");
  if (state === "error") el.classList.add("is-error");
  if (state === "working") el.classList.add("is-working");
}

async function responseError(response, fallback) {
  try {
    return (await response.text()) || fallback;
  } catch {
    return fallback;
  }
}

async function loadLeagueCatalog() {
  const list = document.getElementById("settings-leagues-list");
  try {
    const response = await authFetch("/leagues");
    if (!response?.ok) throw new Error(await responseError(response, "Failed to load leagues."));
    leaguesState = await response.json();
    if (list) renderLeagueCatalog();
    populateLeagueOptions("settings-conference-league");
    populateLeagueOptions("settings-section-league");
  } catch (error) {
    if (list) list.innerHTML = `<div class="settings-helper-text">${escapeHtml(error.message || "Failed to load leagues.")}</div>`;
    setCatalogStatus("conferences", error.message || "Failed to load leagues.", "error");
    setCatalogStatus("sections", error.message || "Failed to load leagues.", "error");
  }
}

function populateLeagueOptions(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const selectedValue = select.value;
  select.innerHTML = '<option value="">Select League</option>';
  [...leaguesState]
    .sort((a, b) => (a.leagueName || "").localeCompare(b.leagueName || ""))
    .forEach((league) => {
      const option = document.createElement("option");
      option.value = league.leagueId;
      option.textContent = league.leagueName;
      select.appendChild(option);
    });
  if ([...select.options].some((option) => option.value === selectedValue)) {
    select.value = selectedValue;
  }
}

function renderLeagueCatalog() {
  const list = document.getElementById("settings-leagues-list");
  if (!list) return;

  if (!leaguesState.length) {
    list.innerHTML = '<div class="settings-helper-text">No leagues configured.</div>';
    return;
  }

  list.innerHTML = leaguesState.map((league) => {
    const organizationCount = Number(league.organizationCount || 0);
    const conferenceCount = Number(league.conferenceCount || 0);
    const sectionCount = Number(league.sectionCount || 0);
    const inUse = organizationCount + conferenceCount + sectionCount > 0;
    return `
      <div class="settings-media-row">
        <div class="settings-media-meta">
          <span class="settings-media-name">${escapeHtml(league.leagueName)}</span>
          <span class="settings-helper-text">${organizationCount} organizations · ${conferenceCount} conferences · ${sectionCount} sections</span>
        </div>
        <button class="nf-btn nf-btn-danger" type="button" data-delete-league="${escapeHtml(league.leagueId)}" ${inUse ? "disabled title=\"Remove or reassign linked organizations, conferences, and sections first\"" : ""}>Remove</button>
      </div>
    `;
  }).join("");

  list.querySelectorAll("[data-delete-league]").forEach((button) => {
    button.addEventListener("click", () => removeLeague(button.dataset.deleteLeague));
  });
}

async function addLeague() {
  const input = document.getElementById("settings-league-name");
  const leagueName = input?.value?.trim() || "";
  if (!leagueName) {
    setCatalogStatus("leagues", "League name is required.", "error");
    return;
  }

  setCatalogStatus("leagues", "Adding league...", "working");
  try {
    const response = await authFetch("/leagues", {
      method: "POST",
      body: JSON.stringify({ leagueName, isActive: true }),
    });
    if (!response?.ok) throw new Error(await responseError(response, "Failed to add league."));
    input.value = "";
    await loadLeagueCatalog();
    setCatalogStatus("leagues", "League added.", "success");
  } catch (error) {
    setCatalogStatus("leagues", error.message || "Failed to add league.", "error");
  }
}

async function removeLeague(leagueId) {
  if (!leagueId || !window.confirm("Remove this league?")) return;
  setCatalogStatus("leagues", "Removing league...", "working");
  try {
    const response = await authFetch(`/leagues/${encodeURIComponent(leagueId)}`, {
      method: "DELETE",
    });
    if (!response?.ok) throw new Error(await responseError(response, "Failed to remove league."));
    await loadLeagueCatalog();
    setCatalogStatus("leagues", "League removed.", "success");
  } catch (error) {
    setCatalogStatus("leagues", error.message || "Failed to remove league.", "error");
  }
}

async function loadGameTypeCatalog() {
  const list = document.getElementById("settings-game-types-list");
  if (!list) return;

  try {
    const response = await authFetch("/gametypes");
    if (!response?.ok) throw new Error(await responseError(response, "Failed to load game types."));
    gameTypesState = await response.json();
    renderGameTypeCatalog();
  } catch (error) {
    list.innerHTML = `<div class="settings-helper-text">${escapeHtml(error.message || "Failed to load game types.")}</div>`;
  }
}

function renderGameTypeCatalog() {
  const list = document.getElementById("settings-game-types-list");
  if (!list) return;

  if (!gameTypesState.length) {
    list.innerHTML = '<div class="settings-helper-text">No game types configured.</div>';
    return;
  }

  list.innerHTML = gameTypesState.map((gameType) => {
    const gameCount = Number(gameType.gameCount || 0);
    return `
      <div class="settings-media-row">
        <div class="settings-media-meta">
          <span class="settings-media-name">${escapeHtml(gameType.name)}</span>
          <span class="settings-helper-text">${gameCount} game${gameCount === 1 ? "" : "s"}</span>
        </div>
        <button class="nf-btn nf-btn-danger" type="button" data-delete-game-type="${escapeHtml(gameType.gameTypeId)}" ${gameCount ? "disabled title=\"This type is used by games\"" : ""}>Remove</button>
      </div>
    `;
  }).join("");

  list.querySelectorAll("[data-delete-game-type]").forEach((button) => {
    button.addEventListener("click", () => removeGameType(button.dataset.deleteGameType));
  });
}

async function addGameType() {
  const input = document.getElementById("settings-game-type-name");
  const name = input?.value?.trim() || "";
  if (!name) {
    setCatalogStatus("game-types", "Game type name is required.", "error");
    return;
  }

  setCatalogStatus("game-types", "Adding game type...", "working");
  try {
    const response = await authFetch("/gametypes", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    if (!response?.ok) throw new Error(await responseError(response, "Failed to add game type."));
    input.value = "";
    await loadGameTypeCatalog();
    setCatalogStatus("game-types", "Game type added.", "success");
  } catch (error) {
    setCatalogStatus("game-types", error.message || "Failed to add game type.", "error");
  }
}

async function removeGameType(gameTypeId) {
  if (!gameTypeId || !window.confirm("Remove this game type?")) return;
  setCatalogStatus("game-types", "Removing game type...", "working");
  try {
    const response = await authFetch(`/gametypes/${encodeURIComponent(gameTypeId)}`, {
      method: "DELETE",
    });
    if (!response?.ok) throw new Error(await responseError(response, "Failed to remove game type."));
    await loadGameTypeCatalog();
    setCatalogStatus("game-types", "Game type removed.", "success");
  } catch (error) {
    setCatalogStatus("game-types", error.message || "Failed to remove game type.", "error");
  }
}

async function loadLevelCatalog() {
  const list = document.getElementById("settings-levels-list");
  if (!list) return;
  try {
    const response = await authFetch("/levels");
    if (!response?.ok) throw new Error(await responseError(response, "Failed to load levels."));
    levelsState = await response.json();
    renderLevelCatalog();
  } catch (error) {
    list.innerHTML = `<div class="settings-helper-text">${escapeHtml(error.message || "Failed to load levels.")}</div>`;
  }
}

function renderLevelCatalog() {
  const list = document.getElementById("settings-levels-list");
  if (!list) return;
  if (!levelsState.length) {
    list.innerHTML = '<div class="settings-helper-text">No levels configured.</div>';
    return;
  }
  list.innerHTML = levelsState.map((level) => {
    const teamCount = Number(level.teamCount || 0);
    const inUse = teamCount > 0;
    return `
      <div class="settings-media-row">
        <div class="settings-media-meta">
          <span class="settings-media-name">${escapeHtml(level.levelName)}</span>
          <span class="settings-helper-text">${teamCount} team${teamCount === 1 ? "" : "s"}</span>
        </div>
        <button class="nf-btn nf-btn-danger" type="button" data-delete-level="${escapeHtml(level.levelId)}" ${inUse ? "disabled title=\"Reassign teams and players before removing this level\"" : ""}>Remove</button>
      </div>
    `;
  }).join("");
  list.querySelectorAll("[data-delete-level]").forEach((button) => {
    button.addEventListener("click", () => removeLevel(button.dataset.deleteLevel));
  });
}

async function addLevel() {
  const input = document.getElementById("settings-level-name");
  const levelName = input?.value?.trim() || "";
  if (!levelName) {
    setCatalogStatus("levels", "Level name is required.", "error");
    return;
  }
  setCatalogStatus("levels", "Adding level...", "working");
  try {
    const response = await authFetch("/levels", {
      method: "POST",
      body: JSON.stringify({ levelName, isActive: true }),
    });
    if (!response?.ok) throw new Error(await responseError(response, "Failed to add level."));
    input.value = "";
    await loadLevelCatalog();
    setCatalogStatus("levels", "Level added.", "success");
  } catch (error) {
    setCatalogStatus("levels", error.message || "Failed to add level.", "error");
  }
}

async function removeLevel(levelId) {
  if (!levelId || !window.confirm("Remove this level?")) return;
  setCatalogStatus("levels", "Removing level...", "working");
  try {
    const response = await authFetch(`/levels/${encodeURIComponent(levelId)}`, { method: "DELETE" });
    if (!response?.ok) throw new Error(await responseError(response, "Failed to remove level."));
    await loadLevelCatalog();
    setCatalogStatus("levels", "Level removed.", "success");
  } catch (error) {
    setCatalogStatus("levels", error.message || "Failed to remove level.", "error");
  }
}

async function loadConferenceCatalog() {
  const list = document.getElementById("settings-conferences-list");
  if (!list) return;
  try {
    const response = await authFetch("/conferencedistricts");
    if (!response?.ok) throw new Error(await responseError(response, "Failed to load conferences."));
    conferencesState = await response.json();
    renderLeagueLinkedCatalog("conferences", conferencesState, "Conference");
  } catch (error) {
    list.innerHTML = `<div class="settings-helper-text">${escapeHtml(error.message || "Failed to load conferences.")}</div>`;
  }
}

async function loadSectionCatalog() {
  const list = document.getElementById("settings-sections-list");
  if (!list) return;
  try {
    const response = await authFetch("/sectionregions");
    if (!response?.ok) throw new Error(await responseError(response, "Failed to load sections."));
    sectionsState = await response.json();
    renderLeagueLinkedCatalog("sections", sectionsState, "Section");
  } catch (error) {
    list.innerHTML = `<div class="settings-helper-text">${escapeHtml(error.message || "Failed to load sections.")}</div>`;
  }
}

function renderLeagueLinkedCatalog(catalog, items, label) {
  const list = document.getElementById(`settings-${catalog}-list`);
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div class="settings-helper-text">No ${label.toLowerCase()} options configured.</div>`;
    return;
  }

  const deleteAttribute = catalog === "conferences" ? "data-delete-conference" : "data-delete-section";
  const groups = new Map();
  items.forEach((item) => {
    const groupKey = String(item.leagueId || item.leagueName || "unassigned");
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        name: item.leagueName || "Unassigned League",
        items: [],
      });
    }
    groups.get(groupKey).items.push(item);
  });

  list.innerHTML = [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((group) => `
      <section class="settings-catalog-group">
        <h2 class="settings-catalog-group-title">${escapeHtml(group.name)}</h2>
        ${group.items.map((item) => {
          const teamCount = Number(item.teamCount || 0);
          return `
            <div class="settings-media-row">
              <div class="settings-media-meta">
                <span class="settings-media-name">${escapeHtml(item.name)}</span>
                <span class="settings-helper-text">${teamCount} team${teamCount === 1 ? "" : "s"}</span>
              </div>
              <button class="nf-btn nf-btn-danger" type="button" ${deleteAttribute}="${escapeHtml(item.id)}" ${teamCount ? "disabled title=\"Reassign teams before removing this option\"" : ""}>Remove</button>
            </div>
          `;
        }).join("")}
      </section>
    `).join("");

  list.querySelectorAll(`[${deleteAttribute}]`).forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute(deleteAttribute);
      if (catalog === "conferences") removeConference(id);
      else removeSection(id);
    });
  });
}

async function addConference() {
  await addLeagueLinkedCatalog("conferences", "settings-conference-league", "settings-conference-name", "/conferencedistricts", "Conference");
}

async function addSection() {
  await addLeagueLinkedCatalog("sections", "settings-section-league", "settings-section-name", "/sectionregions", "Section");
}

async function addLeagueLinkedCatalog(catalog, leagueSelectId, nameInputId, route, label) {
  const leagueId = document.getElementById(leagueSelectId)?.value || "";
  const input = document.getElementById(nameInputId);
  const name = input?.value?.trim() || "";
  if (!leagueId || !name) {
    setCatalogStatus(catalog, `League and ${label.toLowerCase()} name are required.`, "error");
    return;
  }
  setCatalogStatus(catalog, `Adding ${label.toLowerCase()}...`, "working");
  try {
    const response = await authFetch(route, {
      method: "POST",
      body: JSON.stringify({ leagueId, name, sortOrder: 0, isActive: true }),
    });
    if (!response?.ok) throw new Error(await responseError(response, `Failed to add ${label.toLowerCase()}.`));
    input.value = "";
    if (catalog === "conferences") await loadConferenceCatalog();
    else await loadSectionCatalog();
    setCatalogStatus(catalog, `${label} added.`, "success");
  } catch (error) {
    setCatalogStatus(catalog, error.message || `Failed to add ${label.toLowerCase()}.`, "error");
  }
}

async function removeConference(id) {
  await removeLeagueLinkedCatalog("conferences", id, "/conferencedistricts", "Conference", loadConferenceCatalog);
}

async function removeSection(id) {
  await removeLeagueLinkedCatalog("sections", id, "/sectionregions", "Section", loadSectionCatalog);
}

async function removeLeagueLinkedCatalog(catalog, id, route, label, reload) {
  if (!id || !window.confirm(`Remove this ${label.toLowerCase()}?`)) return;
  setCatalogStatus(catalog, `Removing ${label.toLowerCase()}...`, "working");
  try {
    const response = await authFetch(`${route}/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response?.ok) throw new Error(await responseError(response, `Failed to remove ${label.toLowerCase()}.`));
    await reload();
    setCatalogStatus(catalog, `${label} removed.`, "success");
  } catch (error) {
    setCatalogStatus(catalog, error.message || `Failed to remove ${label.toLowerCase()}.`, "error");
  }
}

function getInputValue(id) {
  return document.getElementById(id)?.value?.trim() || "";
}

function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value ?? "";
}

function setCheckboxValue(id, checked) {
  const el = document.getElementById(id);
  if (!el) return;
  el.checked = Boolean(checked);
}

function getCheckboxValue(id) {
  return Boolean(document.getElementById(id)?.checked);
}

function setSectionSaveStatus(section, message = "", state = "idle") {
  const id =
    section === "email"
      ? "settings-email-save-status"
      : "settings-media-save-status";

  const el = document.getElementById(id);
  if (!el) return;

  el.textContent = message;
  el.classList.remove("is-success", "is-error", "is-working");

  if (state === "success") el.classList.add("is-success");
  if (state === "error") el.classList.add("is-error");
  if (state === "working") el.classList.add("is-working");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email || "").trim());
}

function normalizeMediaOutlets(outlets) {
  if (!Array.isArray(outlets)) return [];

  const seen = new Set();
  const normalized = [];

  for (const item of outlets) {
    const name = String(item?.name ?? item?.Name ?? "").trim();
    const email = String(item?.email ?? item?.Email ?? "").trim();
    if (!email || !isValidEmail(email)) continue;

    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    normalized.push({
      name: name || "Media Outlet",
      email,
    });
  }

  return normalized;
}

function renderMediaOutlets() {
  const container = document.getElementById("media-outlet-list");
  if (!container) return;

  if (!mediaOutletsState.length) {
    container.innerHTML =
      '<div class="settings-helper-text">No media outlet recipients configured.</div>';
    return;
  }

  const rows = mediaOutletsState
    .map(
      (item, index) => `
      <div class="settings-media-row">
        <div class="settings-media-meta">
          <div class="settings-media-line">
            <span class="settings-media-label">Name:</span>
            <span class="settings-media-name">${escapeHtml(item.name)}</span>
          </div>
          <div class="settings-media-line">
            <span class="settings-media-label">Email:</span>
            <span class="settings-media-email">${escapeHtml(item.email)}</span>
          </div>
        </div>
        <button class="nf-btn nf-btn-danger" data-remove-media-index="${index}" type="button">Remove</button>
      </div>
    `,
    )
    .join("");

  container.innerHTML = rows;

  container.querySelectorAll("[data-remove-media-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.getAttribute("data-remove-media-index") || "-1");
      if (index < 0 || index >= mediaOutletsState.length) return;
      mediaOutletsState.splice(index, 1);
      renderMediaOutlets();
    });
  });
}

function addMediaOutlet() {
  const nameInput = document.getElementById("media-outlet-name");
  const emailInput = document.getElementById("media-outlet-email");
  const name = String(nameInput?.value || "").trim();
  const email = String(emailInput?.value || "").trim();

  if (!email) {
    notifySettings("Media outlet email is required", "error");
    return;
  }

  if (!isValidEmail(email)) {
    notifySettings("Enter a valid media outlet email", "error");
    return;
  }

  const normalizedEmail = email.toLowerCase();
  const exists = mediaOutletsState.some(
    (item) => String(item.email || "").toLowerCase() === normalizedEmail,
  );

  if (exists) {
    notifySettings("That media outlet email is already listed", "error");
    return;
  }

  mediaOutletsState.push({
    name: name || "Media Outlet",
    email,
  });

  if (nameInput) nameInput.value = "";
  if (emailInput) emailInput.value = "";

  renderMediaOutlets();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function loadEmailSettings() {
  try {
    const settings = await EmailSettingsApi.getSettings();

    setInputValue("smtp-host", settings.smtpHost || "");
    setInputValue("smtp-port", String(settings.smtpPort || 1025));
    setInputValue("smtp-username", settings.username || "");
    setInputValue("smtp-password", "");
    setInputValue("smtp-from-address", settings.fromAddress || "");
    setInputValue("smtp-from-name", settings.fromName || "");

    setCheckboxValue("smtp-enabled", settings.enabled);
    setCheckboxValue("smtp-use-ssl", settings.useSsl);

    mediaOutletsState = normalizeMediaOutlets(
      settings.mediaOutlets ?? settings.MediaOutlets,
    );
    if (!mediaOutletsState.length) {
      try {
        mediaOutletsState = normalizeMediaOutlets(
          await EmailSettingsApi.getMediaOutlets(),
        );
      } catch (mediaError) {
        console.warn("Failed to load media outlets endpoint", mediaError);
      }
    }
    renderMediaOutlets();

    const passwordStatus = document.getElementById("smtp-password-status");
    if (passwordStatus) {
      passwordStatus.textContent = settings.hasPassword
        ? "Password is saved"
        : "No password saved";
    }

  } catch (error) {
    console.error("Failed to load email settings", error);
    notifySettings("Failed to load email settings", "error");
  }
}

async function saveEmailServerSettings() {
  const smtpHost = getInputValue("smtp-host");
  const smtpPort = Number(getInputValue("smtp-port") || "0");
  const fromAddress = getInputValue("smtp-from-address");
  const fromName = getInputValue("smtp-from-name");

  if (!smtpHost) {
    notifySettings("SMTP host is required", "error");
    return;
  }

  if (!Number.isFinite(smtpPort) || smtpPort <= 0) {
    notifySettings("SMTP port must be a positive number", "error");
    return;
  }

  if (!fromAddress) {
    notifySettings("From address is required", "error");
    return;
  }

  const payload = {
    enabled: getCheckboxValue("smtp-enabled"),
    smtpHost,
    smtpPort,
    useSsl: getCheckboxValue("smtp-use-ssl"),
    username: getInputValue("smtp-username") || null,
    password: getInputValue("smtp-password") || null,
    fromAddress,
    fromName: fromName || "TipIn",
  };

  try {
    setSectionSaveStatus("email", "Saving email server settings...", "working");
    await EmailSettingsApi.saveSettings(payload);
    notifySettings("Email server settings saved", "success");
    setSectionSaveStatus("email", "Email server settings saved.", "success");

    try {
      await loadEmailSettings();
    } catch (reloadError) {
      console.warn("Reload after email save failed", reloadError);
    }
  } catch (error) {
    console.error("Failed to save email settings", error);
    notifySettings("Failed to save email server settings", "error");
    setSectionSaveStatus("email", "Failed to save email server settings.", "error");
  }
}

async function saveMediaOutletsSettings() {
  const outlets = mediaOutletsState.map((item) => ({
    name: item.name,
    email: item.email,
    Name: item.name,
    Email: item.email,
  }));

  const payload = {
    mediaOutlets: outlets,
    MediaOutlets: outlets,
  };

  try {
    setSectionSaveStatus("media", "Saving media recipients...", "working");
    const saved = await EmailSettingsApi.saveMediaOutlets(payload);
    mediaOutletsState = normalizeMediaOutlets(saved);
    renderMediaOutlets();
    notifySettings("Media outlet recipients saved", "success");
    setSectionSaveStatus("media", "Media outlet recipients saved.", "success");

    try {
      await loadEmailSettings();
    } catch (reloadError) {
      console.warn("Reload after media save failed", reloadError);
    }
  } catch (error) {
    console.error("Failed to save media outlets", error);
    notifySettings("Failed to save media outlet recipients", "error");
    setSectionSaveStatus("media", "Failed to save media recipients.", "error");
  }
}

async function sendTestEmail() {
  const to = getInputValue("email-test-to");
  if (!to) {
    notifySettings("Enter a recipient email for test send", "error");
    return;
  }

  const subject = getInputValue("email-test-subject") || "TipIn Email Test";
  const body =
    getInputValue("email-test-body") ||
    "This is a test email from TipIn Admin Settings.";

  try {
    await EmailSettingsApi.sendTestEmail({ to, subject, body });
    notifySettings("Test email sent", "success");
  } catch (error) {
    console.error("Failed to send test email", error);
    notifySettings("Failed to send test email", "error");
  }
}

document.addEventListener("layoutLoaded", initSettingsPage);
if (window.__layoutAlreadyLoaded) initSettingsPage();
