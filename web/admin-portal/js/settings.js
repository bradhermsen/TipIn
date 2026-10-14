let mediaOutletsState = [];
let leaguesState = [];
let gameTypesState = [];

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
  if (!document.getElementById("smtp-host")) return;

  wireSettingsEvents();
  await Promise.all([
    loadEmailSettings(),
    loadLeagueCatalog(),
    loadGameTypeCatalog(),
  ]);
}

function wireSettingsEvents() {
  const saveEmailBtn = document.getElementById("settings-save-email");
  const saveMediaBtn = document.getElementById("settings-save-media");
  const testBtn = document.getElementById("settings-test-send");
  const addMediaBtn = document.getElementById("media-outlet-add");
  const addLeagueBtn = document.getElementById("settings-add-league");
  const addGameTypeBtn = document.getElementById("settings-add-game-type");

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
  if (!list) return;

  try {
    const response = await authFetch("/leagues");
    if (!response?.ok) throw new Error(await responseError(response, "Failed to load leagues."));
    leaguesState = await response.json();
    renderLeagueCatalog();
  } catch (error) {
    list.innerHTML = `<div class="settings-helper-text">${escapeHtml(error.message || "Failed to load leagues.")}</div>`;
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
    return `
      <div class="settings-media-row">
        <div class="settings-media-meta">
          <span class="settings-media-name">${escapeHtml(league.leagueName)}</span>
          <span class="settings-helper-text">${organizationCount} organization${organizationCount === 1 ? "" : "s"}</span>
        </div>
        <button class="nf-btn nf-btn-danger" type="button" data-delete-league="${escapeHtml(league.leagueId)}" ${organizationCount ? "disabled title=\"Reassign organizations before removing this league\"" : ""}>Remove</button>
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
