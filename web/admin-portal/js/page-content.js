// =========================================================
// PAGE CONTENT REGISTRY
// (Static pages + generated pages)
// =========================================================

window.PageContentRegistry = window.PageContentRegistry || {};

//=================================================================
// TEAMS PAGE CONTENT
//=================================================================
window.PageContentRegistry.teams = () => `
  <div class="page-header-block">
    <div class="page-header-row">
      <div class="page-header-text">
        <h1 class="page-header">Teams</h1>
        <p class="page-subtext">Manage all teams across the TipIn platform</p>
      </div>
      <button id="btnAddTeam" class="nf-btn nf-btn-primary">
        <i class="fa fa-plus"></i> Add Team
      </button>
    </div>
  </div>

  <!-- ========================================================= -->
  <!-- TEAMS FILTER BAR COMPONENT                               -->
  <!-- ========================================================= -->
  <div class="nf-card">
    <div class="nf-filter-bar" id="teams-filter-bar-component">

      <!-- Search -->
      <input
        id="teams-search-bar"
        class="nf-search"
        type="text"
        placeholder="🔍  Search teams…"
      />

      <!-- Organization Filter -->
      <select id="filter-org" class="nf-select">
        <option value="">Organization: All</option>
      </select>

      <!-- Level Filter -->
      <select id="filter-level" class="nf-select">
        <option value="">Level: All</option>
      </select>

      <select id="filter-team-type" class="nf-select">
        <option value="">Type: All</option>
      </select>

      <!-- Conference Filter -->
      <select id="filter-team-conference" class="nf-select">
        <option value="">Conference: All</option>
      </select>

      <!-- Section Filter -->
      <select id="filter-team-section" class="nf-select">
        <option value="">Section: All</option>
      </select>

      <!-- Status Filter -->
      <select id="filter-status" class="nf-select">
        <option value="">Status: All</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
    </div>
  </div>

  <div class="nf-card mt-4">
    <div class="teams-group-header">
      <label class="teams-org-external-toggle" for="teams-show-external">
        <span class="teams-external-switch">
          <input id="teams-show-external" type="checkbox" aria-label="Display External Teams" />
          <span class="teams-external-slider"></span>
        </span>
        <span>Display External Teams</span>
      </label>
    </div>
    <div id="teamsGroupedList" class="nf-grouped-list"></div>
  </div>
`;

//=================================================================
// TEAMS MODALS (MATCH USERS MODAL STYLING)
//=================================================================
window.PageContentRegistry.teamsModals = () => `
  <!-- TEAM MODAL -->
  <div id="teamModalOverlay" class="nf-modal-overlay hidden">
    <div id="teamModal" class="nf-modal medium">

      <!-- HEADER -->
      <div class="nf-modal-header">
        <h2 id="teamModalTitle">Add Team</h2>
        <button class="modal-close" onclick="AdminPage.closeModal()">×</button>
      </div>

      <!-- BODY -->
      <div class="nf-modal-body">

        <!-- TEAM INFORMATION -->
        <div class="full-width-section">
          <h3 class="section-header">Team Information</h3>

          <div class="two-col">
            <div>
              <label>Team Name</label>
              <input id="team-name" type="text" class="nf-input" />
            </div>

            <div>
              <label>Abbreviation</label>
              <input id="team-abbreviation" type="text" class="nf-input" readonly />
            </div>

            <div>
              <label>Organization</label>
              <select id="team-org" class="nf-input"></select>
            </div>

            <div>
              <label>Level</label>
              <select id="team-level" class="nf-input"></select>
            </div>

            <div>
              <label>Team Type</label>
              <select id="team-type" class="nf-input">
                <option value="">Select Type</option>
                <option value="Boys">Boys</option>
                <option value="Girls">Girls</option>
                <option value="Co-Ed">Co-Ed</option>
                <option value="Men">Men</option>
                <option value="Women">Women</option>
              </select>
            </div>

            <div>
              <label>Conference</label>
              <select id="team-conference-district" class="nf-input">
                <option value="">Select Conference</option>
              </select>
            </div>

            <div>
              <label>Season</label>
              <div id="team-season-display" class="season-display"></div>
            </div>

            <div>
              <label>Section</label>
              <select id="team-section-region" class="nf-input">
                <option value="">Select Section</option>
              </select>
            </div>

            <div class="full-width">
              <label>Notes</label>
              <textarea id="team-notes" class="nf-input" rows="2"></textarea>
            </div>

            <div class="full-width">
              <label>Team Mascot</label>
              <input id="team-mascot" type="text" class="nf-input" placeholder="Mascot" />
            </div>
          </div>
        </div>

        <!-- SEPARATOR -->
        <hr class="section-divider full-width-section" />

        <!-- COACHING STAFF -->
        <div class="full-width-section">
          <h3 class="section-header">Coaching Staff</h3>

          <!-- HEAD COACH -->
          <div class="two-col">
            <div>
              <label>Head Coach Name</label>
              <input id="team-head-coach" type="text" class="nf-input" />
            </div>

            <div>
              <label>Head Coach Email</label>
              <input id="team-head-coach-email" type="email" class="nf-input" />
            </div>
          </div>

          <!-- ASSISTANT COACHES -->
          ${[1, 2, 3, 4]
            .map(
              (i) => `
            <div class="two-col">
              <div>
                <label>Assistant Coach ${i} Name</label>
                <input id="team-asst${i}" type="text" class="nf-input" />
              </div>

              <div>
                <label>Assistant Coach ${i} Email</label>
                <input id="team-asst${i}-email" type="email" class="nf-input" />
              </div>

              <div class="full-width">
                <label class="checkbox-inline">
                  <input type="checkbox" id="team-asst${i}-has-login" disabled />
                  Create Login
                </label>
              </div>
            </div>
          `,
            )
            .join("")}
        </div>

        <!-- SEPARATOR -->
        <hr class="section-divider full-width-section" />

        <!-- ACCESS CODES -->
        <div class="full-width-section">
          <h3 class="section-header">Access Codes</h3>

          <div class="two-col">
            <div>
              <label>Game Manager Code</label>
              <input id="team-score-code" type="text" class="nf-input" readonly />
            </div>

            <div>
              <label>Stat Manager Code</label>
              <input id="team-stat-code" type="text" class="nf-input" readonly />
            </div>

            <div class="full-width">
              <button id="btnGenerateCodes" class="nf-btn nf-btn-primary">
                Generate Access Codes
              </button>
            </div>
          </div>
        </div>

        <!-- SEPARATOR -->
        <hr class="section-divider full-width-section" />

        <!-- ARENAS & RINKS -->
        <div id="org-facilities-section" class="full-width-section hidden">
          <div class="org-facilities-heading">
            <h3 class="section-header">Arenas &amp; Rinks</h3>
            <div class="org-facilities-actions">
              <a id="org-add-arena" class="nf-btn nf-btn-primary" href="facilities.html">Add Arena</a>
              <a id="org-manage-facilities" class="nf-btn nf-btn-secondary" href="facilities.html">Open Arena Manager</a>
            </div>
          </div>
          <div id="org-facilities-list" class="org-facilities-list"></div>
        </div>

        <hr id="org-facilities-divider" class="section-divider full-width-section hidden" />

        <!-- SETTINGS -->
        <div class="full-width-section">
          <h3 class="section-header">Settings</h3>

          <div class="two-col">
            <div>
              <label>Active</label>
              <label class="switch">
                <input type="checkbox" id="team-active" />
                <span class="slider round"></span>
              </label>
            </div>
          </div>
        </div>

      </div>

      <!-- FOOTER -->
      <div class="nf-modal-footer">
        <button id="btnCancelTeam" class="nf-btn nf-btn-secondary">Cancel</button>
        <button id="btnSaveTeam" class="nf-btn nf-btn-primary">Save</button>
      </div>
    </div>
  </div>

  <!-- DELETE TEAM MODAL -->
  <div id="teamDeleteModalOverlay" class="nf-modal-overlay hidden">
    <div id="teamDeleteModal" class="nf-modal small">
      <div class="nf-modal-header">
        <h2>Delete Team</h2>
      </div>

      <div class="nf-modal-body full">
        <p>Are you sure you want to delete this team?</p>
      </div>

      <div class="nf-modal-footer">
        <button id="btnCancelTeamDelete" class="nf-btn nf-btn-secondary">Cancel</button>
        <button id="btnConfirmTeamDelete" class="nf-btn nf-btn-danger">Delete</button>
      </div>
    </div>
  </div>
`;

//=================================================================
// STATS PAGE CONTENT
//=================================================================
window.PageContentRegistry.stats = () => `
  <div class="page-header-block">
    <div class="page-header-row">
      <div class="page-header-text">
        <h1 class="page-header">Stats Dashboard</h1>
        <p class="page-subtext">V1: Team, Player, Game, Season, and League Leaders</p>
      </div>
      <button id="stats-refresh" class="nf-btn nf-btn-primary">Refresh Stats</button>
    </div>
  </div>

  <div class="nf-card">
    <div class="nf-filter-bar" id="stats-filter-bar-component">
      <select id="stats-filter-season" class="nf-select">
        <option value="">Season: All</option>
      </select>

      <select id="stats-filter-level" class="nf-select">
        <option value="">Level: All</option>
      </select>

      <select id="stats-filter-team-type" class="nf-select">
        <option value="">Type: All</option>
      </select>

      <select id="stats-filter-team" class="nf-select">
        <option value="">Team: All</option>
      </select>
    </div>
  </div>

  <div class="nf-card mt-4">
    <h3 class="section-header">Team Stats</h3>
    <div class="table-wrapper">
      <table id="stats-team-table" class="data-table stats-sortable-table">
        <thead>
          <tr>
            <th class="stats-sortable" data-field="teamName">Team</th>
            <th class="stats-sortable" data-field="seasonName">Season</th>
            <th class="stats-sortable" data-field="gp">GP</th>
            <th class="stats-sortable" data-field="gf">GF</th>
            <th class="stats-sortable" data-field="ga">GA</th>
            <th class="stats-sortable" data-field="goalDiff">Diff</th>
            <th class="stats-sortable" data-field="shotsFor">SF</th>
            <th class="stats-sortable" data-field="shotsAgainst">SA</th>
            <th class="stats-sortable" data-field="shootingPct">Sh%</th>
            <th class="stats-sortable" data-field="pim">PIM</th>
            <th class="stats-sortable" data-field="ppGoals">PP G</th>
            <th class="stats-sortable" data-field="shGoals">SH G</th>
          </tr>
        </thead>
        <tbody id="stats-team-body"></tbody>
      </table>
    </div>
  </div>

  <div class="nf-card mt-4">
    <h3 class="section-header">Player Stats</h3>
    <div class="table-wrapper">
      <table id="stats-player-table" class="data-table stats-sortable-table">
        <thead>
          <tr>
            <th class="stats-sortable" data-field="fullName">Player</th>
            <th class="stats-sortable" data-field="position">Pos</th>
            <th class="stats-sortable" data-field="gp">GP</th>
            <th class="stats-sortable" data-field="g">G</th>
            <th class="stats-sortable" data-field="a">A</th>
            <th class="stats-sortable" data-field="pts">Pts</th>
            <th class="stats-sortable" data-field="pim">PIM</th>
            <th class="stats-sortable" data-field="estShotsAgainst">Est SA</th>
            <th class="stats-sortable" data-field="estSaves">Est SV</th>
            <th class="stats-sortable" data-field="estSavePct">Est SV%</th>
            <th class="stats-sortable" data-field="estGAA">Est GAA</th>
          </tr>
        </thead>
        <tbody id="stats-player-body"></tbody>
      </table>
    </div>
  </div>

  <div class="nf-card mt-4">
    <h3 class="section-header">Game Stats</h3>
    <div class="table-wrapper">
      <table id="stats-game-table" class="data-table stats-sortable-table">
        <thead>
          <tr>
            <th class="stats-sortable" data-field="gameDateTime">Date</th>
            <th class="stats-sortable" data-field="seasonName">Season</th>
            <th class="stats-sortable" data-field="homeTeamName">Home</th>
            <th class="stats-sortable" data-field="awayTeamName">Away</th>
            <th class="stats-sortable" data-field="homeGoals">Home G</th>
            <th class="stats-sortable" data-field="awayGoals">Away G</th>
            <th class="stats-sortable" data-field="homeShots">Home S</th>
            <th class="stats-sortable" data-field="awayShots">Away S</th>
            <th class="stats-sortable" data-field="homePIM">Home PIM</th>
            <th class="stats-sortable" data-field="awayPIM">Away PIM</th>
          </tr>
        </thead>
        <tbody id="stats-game-body"></tbody>
      </table>
    </div>
  </div>

  <div class="nf-card mt-4">
    <h3 class="section-header">Season Stats</h3>
    <div class="table-wrapper">
      <table id="stats-season-table" class="data-table stats-sortable-table">
        <thead>
          <tr>
            <th class="stats-sortable" data-field="seasonName">Season</th>
            <th class="stats-sortable" data-field="gamesFinal">Final Games</th>
            <th class="stats-sortable" data-field="goals">Goals</th>
            <th class="stats-sortable" data-field="shots">Shots</th>
            <th class="stats-sortable" data-field="penalties">Penalties</th>
            <th class="stats-sortable" data-field="pim">PIM</th>
            <th class="stats-sortable" data-field="avgGoalsPerGame">Avg Goals/Game</th>
            <th class="stats-sortable" data-field="avgShotsPerGame">Avg Shots/Game</th>
          </tr>
        </thead>
        <tbody id="stats-season-body"></tbody>
      </table>
    </div>
  </div>

  <div class="nf-card mt-4">
    <h3 class="section-header">League Leaders</h3>
    <div class="leaders-grid">
      <div>
        <h4>Top Points</h4>
        <table class="data-table compact-table">
          <thead><tr><th>Player</th><th>Pts</th></tr></thead>
          <tbody id="leaders-points-body"></tbody>
        </table>
      </div>
      <div>
        <h4>Top Goals</h4>
        <table class="data-table compact-table">
          <thead><tr><th>Player</th><th>G</th></tr></thead>
          <tbody id="leaders-goals-body"></tbody>
        </table>
      </div>
      <div>
        <h4>Top Assists</h4>
        <table class="data-table compact-table">
          <thead><tr><th>Player</th><th>A</th></tr></thead>
          <tbody id="leaders-assists-body"></tbody>
        </table>
      </div>
      <div>
        <h4>Top PIM</h4>
        <table class="data-table compact-table">
          <thead><tr><th>Player</th><th>PIM</th></tr></thead>
          <tbody id="leaders-pim-body"></tbody>
        </table>
      </div>
    </div>
  </div>
`;

//=================================================================
// SETTINGS PAGE CONTENT
//=================================================================
window.PageContentRegistry.settings = () => `
  <div class="page-header-block">
    <div class="page-header-row">
      <div class="page-header-text">
        <h1 class="page-header">Settings</h1>
        <p class="page-subtext">System configuration and outbound email delivery</p>
      </div>
    </div>
  </div>

  <div class="nf-card settings-card">
    <h3 class="section-header">Email Server</h3>
    <p class="settings-helper-text">
      Configure SMTP for mobile finalize/send and admin test emails. For MailHog use host
      <strong>localhost</strong> and port <strong>1025</strong>.
    </p>

    <div class="settings-grid">
      <label class="settings-field">
        <span>SMTP Host</span>
        <input id="smtp-host" class="nf-input" type="text" placeholder="localhost" />
      </label>

      <label class="settings-field">
        <span>SMTP Port</span>
        <input id="smtp-port" class="nf-input" type="number" min="1" step="1" placeholder="1025" />
      </label>

      <label class="settings-field">
        <span>Username (optional)</span>
        <input id="smtp-username" class="nf-input" type="text" placeholder="Leave blank for MailHog" />
      </label>

      <label class="settings-field">
        <span>Password (optional)</span>
        <input id="smtp-password" class="nf-input" type="password" placeholder="Enter to update stored password" />
      </label>

      <label class="settings-field">
        <span>From Address</span>
        <input id="smtp-from-address" class="nf-input" type="email" placeholder="no-reply@TipIn.local" />
      </label>

      <label class="settings-field">
        <span>From Name</span>
        <input id="smtp-from-name" class="nf-input" type="text" placeholder="TipIn" />
      </label>
    </div>

    <div class="settings-toggle-row">
      <label class="settings-toggle">
        <input id="smtp-enabled" type="checkbox" />
        <span>Email Enabled</span>
      </label>
      <label class="settings-toggle">
        <input id="smtp-use-ssl" type="checkbox" />
        <span>Use SSL/TLS</span>
      </label>
      <span id="smtp-password-status" class="settings-password-status"></span>
    </div>

    <div class="settings-actions mt-3">
      <button id="settings-save-email" class="nf-btn nf-btn-primary" type="button">Save Email Server Settings</button>
    </div>
    <div id="settings-email-save-status" class="settings-save-status" aria-live="polite"></div>
  </div>

  <div class="nf-card settings-card mt-4">
    <h3 class="section-header">Media Outlet Recipients</h3>
    <p class="settings-helper-text">
      Add media contacts that should appear in the Game Manager Send Scoresheet recipient list.
    </p>

    <div class="settings-grid settings-grid-media-input">
      <label class="settings-field">
        <span>Outlet Name</span>
        <input id="media-outlet-name" class="nf-input" type="text" placeholder="Local Sports Network" />
      </label>

      <label class="settings-field">
        <span>Outlet Email</span>
        <input id="media-outlet-email" class="nf-input" type="email" placeholder="sportsdesk@example.com" />
      </label>

      <div class="settings-media-add-wrap">
        <button id="media-outlet-add" class="nf-btn nf-btn-secondary" type="button">Add Outlet</button>
      </div>
    </div>

    <div id="media-outlet-list" class="settings-media-list mt-3"></div>

    <div class="settings-actions mt-3">
      <button id="settings-save-media" class="nf-btn nf-btn-primary" type="button">Save Media Recipients</button>
    </div>
    <div id="settings-media-save-status" class="settings-save-status" aria-live="polite"></div>
  </div>

  <div class="nf-card settings-card mt-4">
    <h3 class="section-header">Send Test Email</h3>
    <div class="settings-grid settings-grid-test">
      <label class="settings-field">
        <span>To</span>
        <input id="email-test-to" class="nf-input" type="email" placeholder="test@local.dev" />
      </label>

      <label class="settings-field">
        <span>Subject</span>
        <input id="email-test-subject" class="nf-input" type="text" placeholder="TipIn test" />
      </label>
    </div>

    <label class="settings-field mt-3">
      <span>Message</span>
      <textarea id="email-test-body" class="nf-textarea" rows="4" placeholder="This is a test email from TipIn settings."></textarea>
    </label>

    <div class="settings-actions mt-3">
      <button id="settings-test-send" class="nf-btn nf-btn-secondary">Send Test Email</button>
    </div>
  </div>
`;

//=================================================================
// ORGANIZATIONS PAGE CONTENT
//=================================================================
window.PageContentRegistry.organizations = () => `
  <div class="page-header-block">
    <div class="page-header-row">
      <div class="page-header-text">
        <h1 class="page-header">Organizations</h1>
        <p class="page-subtext">Manage schools, clubs, and associations</p>
      </div>

      <div class="page-header-actions">
        <button id="btnAddOrganization" class="nf-btn nf-btn-primary">
          <i class="fa fa-plus"></i> Add Organization
        </button>
      </div>
    </div>
  </div>

  <!-- ========================================================= -->
  <!-- ORGANIZATIONS FILTER BAR COMPONENT                       -->
  <!-- ========================================================= -->
  <div class="nf-card">
    <div class="nf-filter-bar" id="org-filter-bar-component">

      <!-- Search -->
      <input
        id="org-search-bar"
        class="nf-search"
        type="text"
        placeholder="🔍  Search organizations…"
      />

      <!-- League Filter -->
      <select id="filter-league" class="nf-select">
        <option value="">League: All</option>
      </select>

      <select id="filter-organization-type" class="nf-select">
        <option value="">Type: All</option>
        <option value="Managed">Managed Organizations</option>
        <option value="External">External Organizations</option>
      </select>

      <!-- Status Filter -->
      <select id="filter-status" class="nf-select">
        <option value="">Status: All</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>

    </div>
  </div>

  <div class="nf-card mt-4">
    <div id="orgGroupedList" class="nf-grouped-list"></div>
  </div>
`;

//=================================================================
// ORGANIZATIONS MODALS (OVERLAY-BASED) — OPTION A
//=================================================================
window.PageContentRegistry.organizationsModals = () => `
  <!-- ADD / EDIT ORGANIZATION MODAL -->
  <div id="orgModalOverlay" class="nf-modal-overlay hidden">
    <div id="orgModal" class="nf-modal medium">

      <!-- HEADER -->
      <div class="nf-modal-header">
        <h2 id="orgModalTitle"></h2>
        <button class="modal-close" onclick="AdminPage.closeModal()">×</button>
      </div>

      <!-- BODY -->
      <div class="nf-modal-body">

        <!-- ORGANIZATION INFORMATION -->
        <div class="full-width-section">
          <h3 class="section-header">Organization Information</h3>

          <div class="two-col">
            <div>
              <label>Organization Name</label>
              <input id="org-name" class="nf-input" />
            </div>

            <div>
              <label>Abbreviation</label>
              <input id="org-abbrev" class="nf-input" />
            </div>

            <div>
              <label>Mascot</label>
              <input id="org-mascot" class="nf-input" />
            </div>

            <div>
              <label>League</label>
              <select id="org-league" class="nf-input">
                <option value="">None</option>
              </select>
            </div>

            <div class="full-width">
              <label>Organization Type</label>
              <div class="organization-type-control" role="radiogroup" aria-label="Organization Type">
                <label>
                  <input type="radio" name="organization-type" id="org-type-managed" value="Managed" checked />
                  <span>Managed Organization</span>
                  <small>TipIn customer with portal, team management, and access-code capabilities.</small>
                </label>
                <label>
                  <input type="radio" name="organization-type" id="org-type-external" value="External" />
                  <span>External Organization</span>
                  <small>Non-customer organization maintained for schedules and competition records.</small>
                </label>
              </div>
            </div>

          </div>
        </div>

        <hr class="section-divider full-width-section" />

        <!-- ADDRESS -->
        <div class="full-width-section">
          <h3 class="section-header">Address</h3>

          <div class="two-col">
            <div>
              <label>Street Address</label>
              <input id="org-street" class="nf-input" />
            </div>

            <div>
              <label>City</label>
              <input id="org-city" class="nf-input" />
            </div>

            <div>
              <label>State</label>
              <input id="org-state" class="nf-input" />
            </div>

            <div>
              <label>Zip Code</label>
              <input id="org-zip" class="nf-input" />
            </div>

            <div>
              <label>Country</label>
              <input id="org-country" class="nf-input" />
            </div>
          </div>
        </div>

        <hr class="section-divider full-width-section" />

        <!-- PRIMARY CONTACT -->
        <div class="full-width-section">
          <h3 class="section-header">Primary Contact</h3>

          <div class="two-col">
            <div>
              <label>First Name</label>
              <input id="org-contact-first" class="nf-input" />
            </div>

            <div>
              <label>Last Name</label>
              <input id="org-contact-last" class="nf-input" />
            </div>

            <div class="full-width">
              <label>Email</label>
              <input id="org-contact-email" class="nf-input" />
            </div>
          </div>
        </div>

        <hr class="section-divider full-width-section" />

        <!-- BILLING INFORMATION -->
        <div class="full-width-section">
          <h3 class="section-header">Billing Information</h3>

          <div class="two-col">
            <div>
              <label>Billing Street</label>
              <input id="billing-street" class="nf-input" />
            </div>

            <div>
              <label>Billing City</label>
              <input id="billing-city" class="nf-input" />
            </div>

            <div>
              <label>Billing State</label>
              <input id="billing-state" class="nf-input" />
            </div>

            <div>
              <label>Billing Zip Code</label>
              <input id="billing-zip" class="nf-input" />
            </div>

            <div>
              <label>Billing Contact Name</label>
              <input id="billing-contact-name" class="nf-input" />
            </div>

            <div>
              <label>Billing Contact Email</label>
              <input id="billing-contact-email" class="nf-input" />
            </div>
          </div>
        </div>

        <hr class="section-divider full-width-section" />

        <!-- SETTINGS -->
        <div class="full-width-section">
          <h3 class="section-header">Settings</h3>

          <div class="two-col">
            <div>
              <label>Active Organization</label>
              <label class="switch">
                <input type="checkbox" id="org-active" />
                <span class="slider round"></span>
              </label>
            </div>
          </div>
        </div>

      </div>

      <div class="nf-modal-footer">
        <button id="orgCancel" class="nf-btn nf-btn-secondary">Cancel</button>
        <button id="orgSave" class="nf-btn nf-btn-primary">Save</button>
      </div>

    </div>
  </div>

  <!-- DELETE ORGANIZATION MODAL -->
  <div id="orgDeleteModalOverlay" class="nf-modal-overlay hidden">
    <div id="orgDeleteModal" class="nf-modal small">

      <div class="nf-modal-header">
        <h2>Confirm Delete</h2>
      </div>

      <div class="nf-modal-body full">
        Are you sure you want to delete this organization?
      </div>

      <div class="nf-modal-footer">
        <button id="orgDeleteCancel" class="nf-btn nf-btn-secondary">Cancel</button>
        <button id="orgDeleteConfirm" class="nf-btn nf-btn-danger">Delete</button>
      </div>

    </div>
  </div>
`;

//=================================================================
// ROSTERS PAGE CONTENT + MODALS (FULL ROSTER MANAGER SYSTEM)
//=================================================================
window.PageContentRegistry.rosters = () => `
  <div class="page-header-block">
    <div class="page-header-row">
      <div class="page-header-text">
        <h1 class="page-header">Team Rosters</h1>
        <p class="page-subtext">View and manage rosters across all teams</p>
      </div>
    </div>
  </div>

  <!-- ROSTERS FILTER BAR COMPONENT -->
  <div class="nf-card">
    <div class="nf-filter-bar" id="rosters-filter-bar-component">

      <!-- Search -->
      <input
        id="rosters-search-bar"
        class="nf-search"
        type="text"
        placeholder="🔍  Search rosters…"
      />

      <!-- Organization Filter -->
      <select id="filter-organization" class="nf-select">
        <option value="">Organization: All</option>
      </select>

      <!-- Team Filter -->
      <select id="filter-team" class="nf-select">
        <option value="">Team: All</option>
      </select>

      <!-- Level Filter -->
      <select id="filter-level" class="nf-select">
        <option value="">Level: All</option>
      </select>

      <!-- Status Filter -->
      <select id="filter-status" class="nf-select">
        <option value="">Status: All</option>
        <option value="Active">Active</option>
        <option value="Inactive">Inactive</option>
      </select>

    </div>
  </div>
  <div class="nf-card mt-4">
    <div class="rosters-group-header">
      <label class="org-external-toggle" for="rosters-show-external">
        <span class="switch external-switch">
          <input id="rosters-show-external" type="checkbox" aria-label="Display External Teams" />
          <span class="slider"></span>
        </span>
        <span>Display External Teams</span>
      </label>
    </div>
    <div id="teamsRosterGroupedList" class="nf-grouped-list"></div>
  </div>
`;

//=================================================================
// ROSTERS MODALS (ROSTER MANAGER + CRUD)
//=================================================================
window.PageContentRegistry.rostersModals = () => `
  <!-- ============================= -->
  <!-- ROSTER MANAGER (LARGE MODAL) -->
  <!-- ============================= -->
  <div id="rosterManagerOverlay" class="nf-modal-overlay">
    <div id="rosterManagerModal" class="nf-modal large">

      <div class="nf-modal-header">
        <h2 id="rosterManagerTitle">Manager Roster</h2>
        <button class="modal-close rm-close">×</button>
      </div>

      <!-- FULL-WIDTH BODY -->
      <div class="nf-modal-body" style="display:block; width:100%;">

        <div class="clean-team-grid" style="width:100%;">

          <!-- SECTION HEADER -->
          <h3 class="section-header">
            Manager Roster - <span id="rm-current-team" class="accent-text"></span>
            <span id="rm-team-totals" class="accent-text" style="margin-left:12px; font-weight:500; font-size:0.92em;"></span>
          </h3>

          <!-- ACTION BAR -->
          <div class="table-actions-row"
              style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; width:100%;">

            <input id="rm-search" class="nf-input"
                  placeholder="Search players…"
                  style="flex:1; min-width:180px;" />

            <select id="rm-filter-position" class="nf-input" style="flex:0 0 160px;">
              <option value="">Position: All</option>
              <option value="F">Forward</option>
              <option value="D">Defense</option>
              <option value="G">Goalie</option>
            </select>

            <select id="rm-filter-shoots" class="nf-input" style="flex:0 0 160px;">
              <option value="">Shoots: All</option>
              <option value="L">Left</option>
              <option value="R">Right</option>
            </select>

            <select id="rm-filter-status" class="nf-input" style="flex:0 0 160px;">
              <option value="">Status: All</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>

            <button id="rm-add-player" class="nf-btn nf-btn-primary" style="margin-left:auto;">
              + Add Player
            </button>

            <button id="rm-upload-roster" class="nf-btn nf-btn-secondary">
              Upload Roster CSV
            </button>

            <button id="rm-download-sample" class="nf-btn nf-btn-secondary">
              Download Sample CSV
            </button>

            <button id="rm-refresh-jerseys" class="nf-btn nf-btn-secondary">
              Refresh Jersey Numbers
            </button>

            <input id="rm-upload-input" type="file" accept=".csv,text/csv" style="display:none;" />
          </div>

          <!-- ROSTER TABLE -->
          <div class="table-wrapper full-width" style="width:100%;">
            <table class="data-table" id="rm-roster-table">
              <thead>
                <tr>
                  <th class="sortable" data-field="fullName">Player</th>
                  <th class="sortable" data-field="position">Pos</th>
                  <th class="sortable" data-field="shoots">Shoots</th>
                  <th class="sortable" data-field="jerseyNumber">#</th>
                  <th class="sortable" data-field="grade">Grade</th>
                  <th class="sortable" data-field="status">Status</th>
                  <th class="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody id="rm-roster-body"></tbody>
            </table>
          </div>

        </div>
      </div>

      <div class="nf-modal-footer">
        <button class="nf-btn nf-btn-secondary rm-close">Close</button>
      </div>

    </div>
  </div>


  <!-- ============================= -->
  <!-- ADD / EDIT ROSTER ENTRY MODAL -->
  <!-- ============================= -->
  <div id="rosterModalOverlay" class="nf-modal-overlay">
    <div id="rosterModal" class="nf-modal small">

      <div class="nf-modal-header">
        <h2 id="rosterModalTitle">Edit Roster Entry</h2>
        <button class="modal-close rm-close">×</button>
      </div>

      <div class="nf-modal-body" style="display:block;">

        <!-- PLAYER NAME (read-only) -->
        <div class="form-group full-width">
          <label>Player</label>
          <div id="editPlayerName" class="nf-input" style="background:#1a1f2e; padding:8px 10px;">
          </div>
        </div>

        <!-- POSITION -->
        <div class="form-group">
          <label for="editPosition">Position</label>
          <select id="editPosition" class="nf-input">
            <option value="F">Forward</option>
            <option value="D">Defense</option>
            <option value="G">Goalie</option>
          </select>
        </div>

        <!-- JERSEY NUMBER -->
        <div class="form-group">
          <label for="editJersey">Jersey #</label>
          <input id="editJersey" type="number" class="nf-input" min="0" max="99">
        </div>

        <!-- GAME DAY STATUS -->
        <div class="form-group">
          <label>Game Day Status</label>
          <label class="switch">
            <input id="editStatus" type="checkbox">
            <span class="slider"></span>
          </label>
        </div>

      </div>

      <div class="nf-modal-footer">
        <button class="nf-btn nf-btn-secondary rm-close">Cancel</button>
        <button id="rosterSave" class="nf-btn nf-btn-primary">Save</button>
      </div>

    </div>
  </div>


  <!-- ============================= -->
  <!-- DELETE ROSTER ENTRY MODAL -->
  <!-- ============================= -->
  <div id="rosterDeleteModalOverlay" class="nf-modal-overlay">
    <div id="rosterDeleteModal" class="nf-modal small">

      <div class="nf-modal-header">
        <h2>Delete Roster Entry</h2>
        <button class="modal-close rm-close">×</button>
      </div>

      <div class="nf-modal-body" style="display:block;">
        Are you sure you want to delete this roster entry?
      </div>

      <div class="nf-modal-footer">
        <button id="rosterDeleteCancel" class="nf-btn nf-btn-secondary rm-close">Cancel</button>
        <button id="rosterDeleteConfirm" class="nf-btn nf-btn-danger">Delete</button>
      </div>

    </div>
  </div>

  <!-- ============================= -->
  <!-- ADD PLAYER TO ROSTER MODAL -->
  <!-- ============================= -->
  <div id="addPlayerModalOverlay" class="nf-modal-overlay">
    <div id="addPlayerModal" class="nf-modal medium">

      <div class="nf-modal-header">
        <h2>Add Players to Roster</h2>
        <button class="modal-close rm-close">×</button>
      </div>

      <div class="nf-modal-body" style="display:block;">

        <!-- PLAYERS LIST WITH CHECKBOXES -->
        <div id="addPlayersList" style="max-height: 400px; overflow-y: auto; border: 1px solid #333; border-radius: 4px; padding: 10px;">
          <!-- Will be populated dynamically -->
          <p style="color: #999; text-align: center;">Loading players...</p>
        </div>

      </div>

      <div class="nf-modal-footer">
        <button class="nf-btn nf-btn-secondary rm-close">Cancel</button>
        <button id="addPlayersSave" class="nf-btn nf-btn-primary">Add Selected Players</button>
      </div>

    </div>
  </div>

`;

//=================================================================
// OFFICIALS PAGE CONTENT
//=================================================================
window.PageContentRegistry.officials = () => `
  <div class="page-header-block">
    <div class="page-header-row">
      <div class="page-header-text">
        <h1 class="page-header">Officials</h1>
        <p class="page-subtext">Manage referee and linesman assignments used in schedules</p>
      </div>

      <div class="page-header-actions">
        <button id="btnAddOfficial" class="nf-btn nf-btn-primary">
          <i class="fa fa-plus"></i> Add Official
        </button>
      </div>
    </div>
  </div>

  <div class="nf-card">
    <div class="nf-filter-bar" id="officials-filter-bar-component">

      <input
        id="officials-search-bar"
        class="nf-search"
        type="text"
        placeholder="🔍  Search officials…"
      />

      <select id="filter-official-role" class="nf-select">
        <option value="">Role: All</option>
        <option value="Referee">Referee</option>
        <option value="Linesman">Linesman</option>
        <option value="Both">Both</option>
      </select>

      <select id="filter-official-status" class="nf-select">
        <option value="">Status: All</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
    </div>
  </div>

  <div class="nf-card mt-4">
    <div id="officialsGroupedList" class="nf-grouped-list"></div>
  </div>
`;

//=================================================================
// OFFICIALS MODALS
//=================================================================
window.PageContentRegistry.officialsModals = () => `
  <div id="officialModalOverlay" class="nf-modal-overlay hidden">
    <div id="officialModal" class="nf-modal medium">

      <div class="nf-modal-header">
        <h2 id="officialModalTitle">Add Official</h2>
        <button class="modal-close" onclick="AdminPage.closeModal()">×</button>
      </div>

      <div class="nf-modal-body">
        <div class="full-width-section">
          <h3 class="section-header">Official Information</h3>

          <div class="two-col">
            <div>
              <label>First Name</label>
              <input id="official-first-name" class="nf-input" />
            </div>

            <div>
              <label>Last Name</label>
              <input id="official-last-name" class="nf-input" />
            </div>

            <div>
              <label>Email</label>
              <input id="official-email" class="nf-input" type="email" placeholder="name@example.com" />
            </div>

            <div>
              <label>Roles</label>
              <div class="official-role-toggles">
                <div class="official-role-toggle-item">
                  <span>Referee</span>
                  <label class="switch">
                    <input type="checkbox" id="official-role-referee" checked />
                    <span class="slider"></span>
                  </label>
                </div>
                <div class="official-role-toggle-item">
                  <span>Linesman</span>
                  <label class="switch">
                    <input type="checkbox" id="official-role-linesman" />
                    <span class="slider"></span>
                  </label>
                </div>
              </div>
            </div>

            <div>
              <label>Active</label>
              <label class="switch">
                <input type="checkbox" id="official-active" checked />
                <span class="slider"></span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div class="nf-modal-footer">
        <button id="officialCancel" class="nf-btn nf-btn-secondary">Cancel</button>
        <button id="officialSave" class="nf-btn nf-btn-primary">Save</button>
      </div>
    </div>
  </div>

  <div id="officialDeleteModalOverlay" class="nf-modal-overlay hidden">
    <div id="officialDeleteModal" class="nf-modal small">
      <div class="nf-modal-header">
        <h2>Delete Official</h2>
      </div>

      <div class="nf-modal-body full">
        <p>Are you sure you want to delete this official?</p>
      </div>

      <div class="nf-modal-footer">
        <button id="officialDeleteCancel" class="nf-btn nf-btn-secondary">Cancel</button>
        <button id="officialDeleteConfirm" class="nf-btn nf-btn-danger">Delete</button>
      </div>
    </div>
  </div>
`;

//=================================================================
// SEASONS PAGE CONTENT
//=================================================================
window.PageContentRegistry.seasons = () => `
  <div class="page-header-block">
    <div class="page-header-row">
      <div class="page-header-text">
        <h1 class="page-header">Seasons</h1>
        <p class="page-subtext">Manage season dates and select the active season used for new teams.</p>
      </div>
      <button id="btnAddSeason" class="nf-btn nf-btn-primary">
        <i class="fa fa-plus"></i> Add Season
      </button>
    </div>
  </div>

  <div class="nf-card">
    <div class="nf-filter-bar">
      <input id="seasons-search" class="nf-search" type="text" placeholder="Search seasons" />
    </div>
  </div>

  <div class="nf-card mt-4">
    <div id="seasonsList"></div>
  </div>
`;

window.PageContentRegistry.seasonsModals = () => `
  <div id="seasonModalOverlay" class="nf-modal-overlay hidden">
    <div class="nf-modal medium">
      <div class="nf-modal-header">
        <h2 id="seasonModalTitle">Add Season</h2>
        <button class="modal-close" type="button">×</button>
      </div>

      <div class="nf-modal-body">
        <div class="full-width-section">
          <div class="two-col">
            <div class="full-width">
              <label>Season Name</label>
              <input id="season-name" class="nf-input" placeholder="2026-2027" />
            </div>
            <div>
              <label>Start Date</label>
              <input id="season-start-date" class="nf-input" type="date" />
            </div>
            <div>
              <label>End Date</label>
              <input id="season-end-date" class="nf-input" type="date" />
            </div>
            <div class="full-width">
              <label class="checkbox-inline">
                <input id="season-active" type="checkbox" />
                Active Season
              </label>
              <p id="season-activation-warning" class="season-activation-warning hidden">
                Activating this season will deactivate the currently active season.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="nf-modal-footer">
        <button id="seasonCancel" class="nf-btn nf-btn-secondary" type="button">Cancel</button>
        <button id="seasonSave" class="nf-btn nf-btn-primary" type="button">Save Season</button>
      </div>
    </div>
  </div>

  <div id="seasonOrganizationsOverlay" class="nf-modal-overlay hidden">
    <div class="nf-modal large">
      <div class="nf-modal-header">
        <h2 id="seasonOrganizationsTitle">Season Organization Setup</h2>
        <button class="modal-close" type="button">×</button>
      </div>

      <div class="nf-modal-body full">
        <p class="season-setup-intro">
          Choose whether each Managed or External Organization participates in this season. Organization type is managed on the Organizations page.
        </p>
        <div class="season-setup-toolbar">
          <input id="season-organizations-search" class="nf-search" type="text" placeholder="Search organizations" />
          <button id="seasonOrganizationsAllManaged" class="nf-btn nf-btn-secondary" type="button">Set All Participating</button>
          <button id="seasonOrganizationsAllNone" class="nf-btn nf-btn-secondary" type="button">Set All Not Participating</button>
        </div>
        <p id="seasonOrganizationsCount" class="season-setup-count"></p>
        <div id="seasonOrganizationsList" class="season-organizations-list"></div>
      </div>

      <div class="nf-modal-footer">
        <button id="seasonOrganizationsCancel" class="nf-btn nf-btn-secondary" type="button">Cancel</button>
        <button id="seasonOrganizationsSave" class="nf-btn nf-btn-primary" type="button">Save Organization Setup</button>
      </div>
    </div>
  </div>

  <div id="seasonOrganizationImportOverlay" class="nf-modal-overlay hidden">
    <div class="nf-modal large">
      <div class="nf-modal-header">
        <h2 id="seasonOrganizationImportTitle">Import Organizations</h2>
        <button class="modal-close" type="button">×</button>
      </div>

      <div class="nf-modal-body full">
        <p class="season-setup-intro">
          Import season participation only. Permanent organization records, organization types, and historical teams are not duplicated or changed.
        </p>
        <div class="season-team-import-source-row">
          <label for="season-org-import-source">Source Season</label>
          <select id="season-org-import-source" class="nf-select"></select>
        </div>
        <div class="season-setup-toolbar">
          <input id="season-org-import-search" class="nf-search" type="text" placeholder="Search organizations" />
          <select id="season-org-import-prior-type" class="nf-select">
            <option value="">Organization Type: All</option>
            <option value="Managed">Managed</option>
            <option value="External">External</option>
          </select>
        </div>
        <div class="season-team-import-actions">
          <p id="seasonOrganizationImportCount" class="season-setup-count"></p>
          <button id="seasonOrganizationImportSelectVisible" class="nf-btn nf-btn-secondary" type="button">Select Visible</button>
          <button id="seasonOrganizationImportClearVisible" class="nf-btn nf-btn-secondary" type="button">Clear Visible</button>
        </div>
        <div class="season-organization-import-heading" aria-hidden="true">
          <span></span>
          <span>Organization</span>
          <span>Previous Type</span>
          <span>Current Type</span>
        </div>
        <div id="seasonOrganizationImportList" class="season-organization-import-list"></div>
      </div>

      <div class="nf-modal-footer">
        <button id="seasonOrganizationImportCancel" class="nf-btn nf-btn-secondary" type="button">Cancel</button>
        <button id="seasonOrganizationImportSave" class="nf-btn nf-btn-primary" type="button">Import Selected Organizations</button>
      </div>
    </div>
  </div>

  <div id="seasonTeamImportOverlay" class="nf-modal-overlay hidden">
    <div class="nf-modal large">
      <div class="nf-modal-header">
        <h2 id="seasonTeamImportTitle">Import Teams</h2>
        <button class="modal-close" type="button">×</button>
      </div>

      <div class="nf-modal-body full">
        <p class="season-setup-intro">
          Import selected team structures only. Rosters, coaches, schedules, games, statistics, and prior access codes are not copied.
        </p>

        <div class="season-team-import-source-row">
          <label for="season-team-import-source">Source Season</label>
          <select id="season-team-import-source" class="nf-select"></select>
        </div>

        <div class="season-setup-toolbar">
          <input id="season-team-import-search" class="nf-search" type="text" placeholder="Search team name, level, type, or organization" />
          <select id="season-team-import-level" class="nf-select">
            <option value="">Level: All</option>
          </select>
          <select id="season-team-import-type" class="nf-select">
            <option value="">Type: All</option>
          </select>
        </div>

        <div class="season-team-import-actions">
          <p id="seasonTeamImportCount" class="season-setup-count"></p>
          <button id="seasonTeamImportSelectVisible" class="nf-btn nf-btn-secondary" type="button">Select Visible</button>
          <button id="seasonTeamImportClearVisible" class="nf-btn nf-btn-secondary" type="button">Clear Visible</button>
        </div>

        <div class="season-team-import-heading" aria-hidden="true">
          <span></span>
          <span>Team Name</span>
          <span>Level</span>
          <span>Type</span>
          <span>Organization</span>
          <span>Status</span>
        </div>
        <div id="seasonTeamImportList" class="season-team-import-list"></div>
      </div>

      <div class="nf-modal-footer">
        <button id="seasonTeamImportCancel" class="nf-btn nf-btn-secondary" type="button">Cancel</button>
        <button id="seasonTeamImportSave" class="nf-btn nf-btn-primary" type="button">Import Selected Teams</button>
      </div>
    </div>
  </div>
`;

//=================================================================
// GAME SCHEDULES PAGE CONTENT (FULL CRUD)
//=================================================================
window.PageContentRegistry.schedules = () => `
  <div class="page-header-block">
    <div class="page-header-row">
      <div class="page-header-text">
        <h1 class="page-header">Game Schedules</h1>
        <p class="page-subtext">Manage season and team game schedules</p>
      </div>

      <div class="page-header-actions">
        <button id="btnAddGame" class="nf-btn nf-btn-primary">
          <i class="fa fa-plus"></i> Add Game
        </button>
      </div>
    </div>
  </div>

  <!-- GAME SCHEDULES FILTER BAR COMPONENT -->
  <div class="nf-card">
    <div class="nf-filter-bar" id="games-filter-bar-component">

      <!-- Search -->
      <input
        id="games-search-bar"
        class="nf-search"
        type="text"
        placeholder="🔍  Search games…"
      />

      <!-- Organization Filter -->
      <select id="filter-game-org" class="nf-select">
        <option value="">Organization: All</option>
      </select>

      <!-- Team Filter -->
      <select id="filter-game-team" class="nf-select">
        <option value="">Team: All</option>
      </select>

      <!-- Level Filter -->
      <select id="filter-game-level" class="nf-select">
        <option value="">Level: All</option>
      </select>

      <!-- Team Type Filter -->
      <select id="filter-game-team-type" class="nf-select">
        <option value="">Team Type: All</option>
      </select>

      <!-- Type Filter -->
      <select id="filter-game-type" class="nf-select">
        <option value="">Type: All</option>
      </select>

      <!-- Status Filter -->
      <select id="filter-game-status" class="nf-select">
        <option value="">Status: All</option>
        <option value="Scheduled">Scheduled</option>
        <option value="Final">Final</option>
        <option value="Cancelled">Cancelled</option>
        <option value="Postponed">Postponed</option>
      </select>

    </div>
  </div>

  <div class="nf-card mt-4">
    <div id="gamesGroupedList" class="games-grouped-list"></div>
  </div>
`;

//=================================================================
// GAME SCHEDULES MODALS (MODERNIZED TO MATCH USERS + TEAMS)
//=================================================================
window.PageContentRegistry.schedulesModals = () => `
  <!-- ADD / EDIT GAME MODAL -->
  <div id="gameModalOverlay" class="nf-modal-overlay">
    <div id="gameModal" class="nf-modal large">

      <!-- HEADER -->
      <div class="nf-modal-header">
        <h2 id="gameModalTitle">Add Game</h2>
        <button class="modal-close" onclick="closeGameModal()">×</button>
      </div>

      <!-- BODY -->
      <div class="nf-modal-body">

        <!-- TEAMS -->
        <div class="full-width-section">
          <h3 class="section-header">Teams</h3>

          <div class="two-col">
            <div>
              <label>Organization</label>
              <select id="game-organization" class="nf-input"></select>
            </div>

            <div>
              <label>Organization Team Is</label>
              <select id="game-organization-team-side" class="nf-input">
                <option value="home">Home Team</option>
                <option value="away">Away Team</option>
              </select>
            </div>

            <div>
              <label>Opponent Organization</label>
              <select id="game-opponent-organization" class="nf-input"></select>
            </div>
          </div>

          <div class="two-col">
            <div>
              <label>Home Team</label>
              <select id="game-home-team" class="nf-input"></select>
            </div>

            <div>
              <label>Away Team</label>
              <select id="game-away-team" class="nf-input"></select>
            </div>
          </div>
        </div>

        <hr class="section-divider full-width-section" />

        <!-- DATE & TIME -->
        <div class="full-width-section">
          <h3 class="section-header">Date & Time</h3>

          <div class="two-col">
            <div>
              <label>Date</label>
              <input id="game-date" type="text" class="nf-input" placeholder="Select date" autocomplete="off" />
            </div>

            <div>
              <label>Time</label>
              <input id="game-time" type="text" class="nf-input" placeholder="Select time" autocomplete="off" />
            </div>
          </div>
        </div>

        <hr class="section-divider full-width-section" />

        <!-- LOCATION -->
        <div class="full-width-section">
          <h3 class="section-header">Location</h3>

          <div class="venue-mode-control" role="group" aria-label="Venue type">
            <button id="game-venue-managed" type="button" class="venue-mode-button">Arena Manager</button>
            <button id="game-venue-external" type="button" class="venue-mode-button active">Other / One-time Arena</button>
          </div>

          <div id="game-managed-venue-fields" class="two-col hidden">
            <div><label>Arena Organization</label><select id="game-arena-organization-filter" class="nf-input"><option value="">All Arenas</option></select></div>
            <div><label>Search Arenas</label><input id="game-arena-search" class="nf-input" type="search" placeholder="Search name, city, or Organization" autocomplete="off" /></div>
            <div><label>Arena</label><select id="game-arena-id" class="nf-input"><option value="">Select Arena</option></select></div>
            <div><label>Rink</label><select id="game-rink-id" class="nf-input"><option value="">Select Rink</option></select></div>
            <div class="full-width-section"><label>Arena address</label><input id="game-managed-arena-address" class="nf-input" type="text" readonly placeholder="No address configured" /></div>
            <div class="full-width-section"><span id="game-gateway-status" class="venue-gateway-status">Select a rink to view scoreboard mode.</span></div>
          </div>

          <div id="game-external-venue-fields" class="two-col">
            <div><label>Arena</label><input id="game-arena-custom" type="text" class="nf-input" placeholder="Arena name" /></div>
            <div><label>Rink</label><input id="game-rink-custom" type="text" class="nf-input" placeholder="Optional rink name" /></div>
            <div class="full-width-section"><label>Arena address</label><input id="game-venue-address" type="text" class="nf-input" placeholder="Optional address" /></div>
          </div>

          <div class="venue-manager-actions">
            <button id="game-add-arena" class="nf-btn nf-btn-secondary" type="button">Add Arena</button>
            <button id="game-add-rink" class="nf-btn nf-btn-secondary" type="button">Add Rink</button>
          </div>
        </div>

        <hr class="section-divider full-width-section" />

        <!-- CLASSIFICATION -->
        <div class="full-width-section">
          <h3 class="section-header">Classification</h3>

          <div class="two-col">
            <div>
              <label>Game Type</label>
              <select id="game-type" class="nf-input"></select>
            </div>

            <div>
              <label>Game Round</label>
              <select id="game-round" class="nf-input"></select>
            </div>

            <div>
              <label>Period Length (minutes)</label>
              <select id="game-period-length" class="nf-input">
                <option value="12">12</option>
                <option value="15">15</option>
                <option value="17">17</option>
                <option value="20">20</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            <div id="game-period-length-custom-wrap" style="display:none;">
              <label>Custom Period Length</label>
              <input id="game-period-length-custom" type="number" min="1" step="1" class="nf-input" placeholder="Enter minutes" />
            </div>
          </div>
        </div>

        <hr class="section-divider full-width-section" />

        <!-- OFFICIALS -->
        <div class="full-width-section">
          <h3 class="section-header">Officials</h3>

          <div class="two-col officials-grid">
            <div>
              <label>Referee 1</label>
              <select id="game-referee-1" class="nf-input">
                <option value="">Select Referee 1</option>
              </select>
            </div>

            <div>
              <label>Referee 2</label>
              <select id="game-referee-2" class="nf-input">
                <option value="">Select Referee 2</option>
              </select>
            </div>

            <div>
              <label>Linesman 1</label>
              <select id="game-linesman-1" class="nf-input">
                <option value="">Select Linesman 1</option>
              </select>
            </div>

            <div>
              <label>Linesman 2</label>
              <select id="game-linesman-2" class="nf-input">
                <option value="">Select Linesman 2</option>
              </select>
            </div>
          </div>
        </div>

        <hr class="section-divider full-width-section" />

        <!-- NOTES & STATUS -->
        <div class="full-width-section">
          <h3 class="section-header">Notes & Status</h3>

          <div class="two-col">
            <div class="full-width">
              <label>Notes</label>
              <textarea id="game-notes" class="nf-input"></textarea>
            </div>

            <div>
              <label>Status</label>
              <select id="game-status" class="nf-input">
                <option value="Scheduled">Scheduled</option>
                <option value="Final">Final</option>
                <option value="Cancelled">Cancelled</option>
                <option value="Postponed">Postponed</option>
              </select>
            </div>
          </div>
        </div>

      </div>

      <!-- FOOTER -->
      <div class="nf-modal-footer">
        <button id="gameCancel" class="nf-btn nf-btn-secondary">Cancel</button>
        <button id="gameSave" class="nf-btn nf-btn-primary">Save</button>
      </div>

    </div>
  </div>

  <div id="scheduleArenaModalOverlay" class="nf-modal-overlay schedule-nested-modal">
    <div class="nf-modal medium">
      <div class="nf-modal-header">
        <h2>Add Arena</h2>
        <button id="scheduleArenaClose" class="modal-close" type="button">×</button>
      </div>
      <div class="nf-modal-body">
        <div class="full-width-section"><div class="two-col">
          <div><label>Arena name</label><input id="schedule-arena-name" class="nf-input" /></div>
          <div><label>Street address</label><input id="schedule-arena-street" class="nf-input" /></div>
          <div><label>City</label><input id="schedule-arena-city" class="nf-input" /></div>
          <div><label>State</label><input id="schedule-arena-state" class="nf-input" /></div>
          <div><label>Postal code</label><input id="schedule-arena-postal" class="nf-input" /></div>
          <div><label class="facility-inline-check"><input id="schedule-arena-primary" type="checkbox" /> Primary arena</label></div>
        </div></div>
      </div>
      <div class="nf-modal-footer">
        <button id="scheduleArenaCancel" class="nf-btn nf-btn-secondary" type="button">Cancel</button>
        <button id="scheduleArenaSave" class="nf-btn nf-btn-primary" type="button">Save Arena</button>
      </div>
    </div>
  </div>

  <div id="scheduleRinkModalOverlay" class="nf-modal-overlay schedule-nested-modal">
    <div class="nf-modal small">
      <div class="nf-modal-header">
        <h2>Add Rink</h2>
        <button id="scheduleRinkClose" class="modal-close" type="button">×</button>
      </div>
      <div class="nf-modal-body full">
        <label>Rink name</label><input id="schedule-rink-name" class="nf-input" />
        <label>Display order</label><input id="schedule-rink-order" class="nf-input" type="number" min="0" value="0" />
      </div>
      <div class="nf-modal-footer">
        <button id="scheduleRinkCancel" class="nf-btn nf-btn-secondary" type="button">Cancel</button>
        <button id="scheduleRinkSave" class="nf-btn nf-btn-primary" type="button">Save Rink</button>
      </div>
    </div>
  </div>

  <!-- DELETE GAME MODAL -->
  <div id="gameDeleteModalOverlay" class="nf-modal-overlay hidden">
    <div id="gameDeleteModal" class="nf-modal small">
      <div class="nf-modal-header">
        <h2>Confirm Delete</h2>
      </div>

      <div class="nf-modal-body full">
        Are you sure you want to delete this game?
      </div>

      <div class="nf-modal-footer">
        <button id="gameDeleteCancel" class="nf-btn nf-btn-secondary">Cancel</button>
        <button id="gameDeleteConfirm" class="nf-btn nf-btn-danger">Delete</button>
      </div>
    </div>
  </div>
`;

//=================================================================
// PLAYERS PAGE CONTENT (TABLE + FILTER BAR)
//=================================================================
window.PageContentRegistry.players = () => `
  <div class="page-header-block">
    <div class="page-header-row">
      <div class="page-header-text">
        <h1 class="page-header">Players</h1>
        <p class="page-subtext">Manage all players across the TipIn platform</p>
      </div>
      <button id="btnAddPlayer" class="nf-btn nf-btn-primary">
        <i class="fa fa-plus"></i> Add Player
      </button>
    </div>
  </div>

  <!-- FILTER BAR -->
  <div class="nf-card">
    <div class="nf-filter-bar" id="players-filter-bar-component">

      <input
        id="players-search-bar"
        class="nf-search"
        type="text"
        placeholder="🔍  Search players…"
      />

      <select id="filter-player-org" class="nf-select">
        <option value="">Organization: All</option>
      </select>

      <select id="filter-player-team" class="nf-select">
        <option value="">Team: All</option>
      </select>

      <select id="filter-player-level" class="nf-select">
        <option value="">Level: All</option>
      </select>

      <select id="filter-player-grade" class="nf-select">
        <option value="">Grade: All</option>
        <option value="12">12</option>
        <option value="11">11</option>
        <option value="10">10</option>
        <option value="9">9</option>
        <option value="8">8</option>
      </select>

      <select id="filter-player-status" class="nf-select">
        <option value="">Status: All</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>

    </div>
  </div>

  <div class="nf-card mt-4">
    <div id="playersGroupedList" class="nf-grouped-list"></div>
  </div>
`;

//=================================================================
// PLAYERS MODALS (MATCH USERS + TEAMS STYLING + DUAL ROSTER)
//=================================================================
window.PageContentRegistry.playersModals = () => `
  <!-- ADD / EDIT PLAYER MODAL -->
  <div id="playerModalOverlay" class="nf-modal-overlay hidden">
    <div id="playerModal" class="nf-modal medium">

      <!-- HEADER -->
      <div class="nf-modal-header">
        <h2 id="playerModalTitle"></h2>
        <button class="modal-close" onclick="AdminPage.closeModal()">×</button>
      </div>

      <!-- BODY -->
      <div class="nf-modal-body">

        <!-- ============================
            PLAYER INFORMATION
        ============================= -->
        <div class="full-width-section">
          <h3 class="section-header">Player Information</h3>

          <div class="two-col">
            <div>
              <label>First Name</label>
              <input id="player-first-name" class="nf-input" />
            </div>

            <div>
              <label>Last Name</label>
              <input id="player-last-name" class="nf-input" />
            </div>

            <div>
              <label>Birthdate</label>
              <input id="player-birthdate" type="date" class="nf-input" />
            </div>

            <div>
              <label>Grade</label>
              <input id="player-grade" type="number" class="nf-input" />
            </div>

            <div>
              <label>Height (inches)</label>
              <input id="player-height" type="number" class="nf-input" />
            </div>

            <div>
              <label>Weight (lbs)</label>
              <input id="player-weight" type="number" class="nf-input" />
            </div>

            <div>
              <label>Shoots</label>
              <select id="player-shoots" class="nf-input">
                <option value="">Select</option>
                <option value="L">Left</option>
                <option value="R">Right</option>
              </select>
            </div>

            <div>
              <label>Position</label>
              <select id="player-position" class="nf-input">
                <option value="">Select</option>
                <option value="F">Forward</option>
                <option value="D">Defense</option>
                <option value="G">Goalie</option>
              </select>
            </div>

            <div class="full-width">
              <label>Jersey #</label>
              <input id="player-jersey" type="number" class="nf-input" />
            </div>
          </div>
        </div>

        <!-- SEPARATOR -->
        <hr class="section-divider full-width-section" />

        <!-- ============================
            ORGANIZATION & TEAM ASSIGNMENTS
        ============================= -->
        <div class="full-width-section">
          <h3 class="section-header">Organization & Team Assignments</h3>

          <div class="two-col">
            <div>
              <label>Organization</label>
              <select id="player-org" class="nf-input"></select>
            </div>
          </div>

          <div id="player-teams-container" class="teams-toggle-list">
            <!-- JS injects team toggles here -->
          </div>
        </div>

        <!-- SEPARATOR -->
        <hr class="section-divider full-width-section" />

        <!-- ============================
            STATUS
        ============================= -->
        <div class="full-width-section">
          <h3 class="section-header">Status</h3>

          <div class="two-col">
            <div>
              <label>Active Player</label>
              <label class="switch">
                <input type="checkbox" id="player-active" />
                <span class="slider"></span>
              </label>
            </div>
          </div>
        </div>

      </div>

      <!-- FOOTER -->
      <div class="nf-modal-footer">
        <button id="playerCancel" class="nf-btn nf-btn-secondary">Cancel</button>
        <button id="playerSave" class="nf-btn nf-btn-primary">Save</button>
      </div>

    </div>
  </div>

  <!-- DELETE PLAYER MODAL -->
  <div id="playerDeleteModalOverlay" class="nf-modal-overlay hidden">
    <div id="playerDeleteModal" class="nf-modal small">

      <div class="nf-modal-header">
        <h2>Delete Player</h2>
      </div>

      <div class="nf-modal-body full">
        <p>Are you sure you want to delete this player?</p>
      </div>

      <div class="nf-modal-footer">
        <button id="playerDeleteCancel" class="nf-btn nf-btn-secondary">Cancel</button>
        <button id="playerDeleteConfirm" class="nf-btn nf-btn-danger">Delete</button>
      </div>

    </div>
  </div>
`;

//=================================================================
// DASHBOARD PAGE CONTENT
//=================================================================
window.PageContentRegistry.dashboard = () => `
  <div class="page-header-block">
    <div class="page-header-row">
      <div class="page-header-text">
        <h1 class="page-header">Dashboard</h1>
        <p class="page-subtext">TipIn Game Manager - Organizations, Teams, Players, and Game Schedules</p>
      </div>
    </div>
  </div>

  <!-- Dashboard content injected by dashboard.js -->
  <div id="sandboxContent"></div>
`;

//=================================================================
// USERS PAGE CONTENT
//=================================================================
window.PageContentRegistry.users = () => `
  <div class="page-header-block">
    <div class="page-header-row">
      <div class="page-header-text">
        <h1 class="page-header">Users</h1>
        <p class="page-subtext">Manage admin accounts, roles, teams, and organization access</p>
      </div>

      <div class="page-header-actions">
        <button id="btnAddUser" class="nf-btn nf-btn-primary">
          <i class="fa fa-plus"></i> Add User
        </button>
      </div>
    </div>
  </div>

  <!-- USERS FILTER BAR COMPONENT -->
  <div class="nf-card">
    <div class="nf-filter-bar" id="user-filter-bar-component">

      <!-- Search -->
      <input
        id="user-search-bar"
        class="nf-search"
        type="text"
        placeholder="🔍  Search users…"
      />

      <!-- Role Filter -->
      <select id="filter-role" class="nf-select">
        <option value="">All Roles</option>
        <option value="SuperAdmin">SuperAdmin</option>
        <option value="OrgAdmin">OrgAdmin</option>
        <option value="TeamManager">TeamManager</option>
        <option value="Coach">Coach</option>
        <option value="Viewer">Viewer</option>
      </select>

      <!-- Organization Filter -->
      <select id="filter-org" class="nf-select">
        <option value="">All Organizations</option>
        <!-- JS populates org list -->
      </select>

      <!-- Status Filter -->
      <select id="filter-status" class="nf-select">
        <option value="">All Status</option>
        <option value="Active">Active</option>
        <option value="Inactive">Inactive</option>
      </select>

    </div>
  </div>


  <div class="nf-card mt-4">
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Email</th>
            <th>Role</th>
            <th>Organization</th>
            <th>Teams</th>
            <th>Status</th>
            <th class="actions-col">Actions</th>
          </tr>
        </thead>
        <tbody id="userTableBody"></tbody>
      </table>
    </div>
  </div>

  <!-- ADD / EDIT USER MODAL -->
  <div id="userModalOverlay" class="nf-modal-overlay">
    <div id="userModal" class="nf-modal medium">

      <!-- HEADER -->
      <div class="nf-modal-header">
        <h2 id="userModalTitle"></h2>
        <button class="modal-close" onclick="AdminPage.closeModal()">×</button>
      </div>

      <!-- BODY -->
      <div class="nf-modal-body">

        <!-- ============================
            USER INFORMATION (FULL WIDTH)
        ============================= -->
        <div class="full-width-section">
          <h3 class="section-header">User Information</h3>

          <div class="two-col">
            <div>
              <label>First Name</label>
              <input id="user-first" class="nf-input" />
            </div>

            <div>
              <label>Last Name</label>
              <input id="user-last" class="nf-input" />
            </div>

            <div>
              <label>Email</label>
              <input id="user-email" class="nf-input" />
            </div>

            <div>
              <label>Password</label>
              <div class="password-row">
                <input id="user-password" type="text" class="nf-input" />
                <button type="button" id="btnGeneratePassword" class="nf-btn-icon">
                  <i class="fa-solid fa-key"></i>
                </button>
              </div>
            </div>

            <div>
              <label>Organization</label>
              <select id="user-organization" class="nf-input"></select>
            </div>
          </div>
        </div>

        <!-- WHITE SEPARATOR -->
        <hr class="section-divider full-width-section" />

        <!-- ============================
            ROLE + ACCOUNT STATUS
        ============================= -->
        <div class="full-width-section">
          <h3 class="section-header">Role & Account Status</h3>

          <div class="two-col">
            <div>
              <label>Role</label>
              <select id="user-role" class="nf-input">
                <option value="SuperAdmin">SuperAdmin</option>
                <option value="OrgAdmin">OrgAdmin</option>
                <option value="TeamManager">TeamManager</option>
                <option value="Coach">Coach</option>
                <option value="Viewer">Viewer</option>
              </select>
            </div>

            <div>
              <label>Account Status</label>
              <label class="switch">
                <input type="checkbox" id="user-active" />
                <span class="slider"></span>
              </label>
            </div>
          </div>
        </div>

        <!-- ============================
            TEAM ASSIGNMENTS
        ============================= -->
        <div class="full-width-section">
          <h3 class="section-header">Team Assignments</h3>

          <div id="user-teams-container" class="teams-toggle-list">
            <!-- JS injects toggles here -->
          </div>
        </div>

      </div>

      <!-- FOOTER -->
      <div class="nf-modal-footer">
        <button id="userCancel" class="nf-btn nf-btn-secondary">Cancel</button>
        <button id="userSave" class="nf-btn nf-btn-primary">Save</button>
      </div>

    </div>
  </div>



  <!-- DELETE USER MODAL -->
  <div id="userDeleteModalOverlay" class="nf-modal-overlay hidden">
    <div class="nf-modal">
      <h2>Delete User</h2>
      <p>Are you sure you want to delete this user?</p>

      <div class="nf-modal-footer">
        <button id="userDeleteCancel" class="nf-btn nf-btn-secondary">Cancel</button>
        <button id="userDeleteConfirm" class="nf-btn nf-btn-danger">Delete</button>
      </div>
    </div>
  </div>
`;

//=================================================================
// ARENAS, RINKS & GATEWAYS
//=================================================================
window.PageContentRegistry.facilities = () => `
  <div class="page-header-block">
    <div class="page-header-row">
      <div class="page-header-text">
        <h1 class="page-header">Arena Manager</h1>
        <p class="page-subtext">Manage organization venues, rink surfaces, and optional scoreboard gateways</p>
      </div>
      <div class="page-header-actions facility-header-actions">
        <button id="btnAssociateArena" class="nf-btn nf-btn-secondary">Associate Arena</button>
        <button id="btnAddArena" class="nf-btn nf-btn-primary">Add Arena</button>
      </div>
    </div>
  </div>

  <div class="facility-toolbar">
    <label for="facilityOrganization">Organization</label>
    <select id="facilityOrganization" class="nf-select"></select>
    <label for="facilityNameFilter">Arena name</label>
    <input id="facilityNameFilter" class="nf-search" type="search" placeholder="Search arenas" />
    <span id="facilityStatus" class="facility-status" aria-live="polite"></span>
  </div>

  <div id="facilityList" class="facility-list"></div>
`;

window.PageContentRegistry.facilitiesModals = () => `
  <div id="arenaModalOverlay" class="nf-modal-overlay">
    <div class="nf-modal medium">
      <div class="nf-modal-header"><h2 id="arenaModalTitle">Add Arena</h2><button class="modal-close" data-close-modal="arenaModalOverlay">×</button></div>
      <div class="nf-modal-body">
        <div class="full-width-section"><div class="two-col">
          <div class="full-width"><label>Organization</label><select id="arenaOrganization" class="nf-input"></select></div>
          <div><label>Arena name</label><input id="arenaName" class="nf-input" /></div>
          <div><label>Street address</label><input id="arenaStreet" class="nf-input" /></div>
          <div><label>City</label><input id="arenaCity" class="nf-input" /></div>
          <div><label>State</label><input id="arenaState" class="nf-input" /></div>
          <div><label>Postal code</label><input id="arenaPostalCode" class="nf-input" /></div>
          <div class="facility-checkboxes"><label><input id="arenaPrimary" type="checkbox" /> Primary arena</label><label><input id="arenaActive" type="checkbox" checked /> Active</label></div>
        </div></div>
      </div>
      <div class="nf-modal-footer"><button class="nf-btn nf-btn-secondary" data-close-modal="arenaModalOverlay">Cancel</button><button id="saveArena" class="nf-btn nf-btn-primary">Save Arena</button></div>
    </div>
  </div>

  <div id="associateArenaModalOverlay" class="nf-modal-overlay">
    <div class="nf-modal small">
      <div class="nf-modal-header"><h2>Associate Existing Arena</h2><button class="modal-close" data-close-modal="associateArenaModalOverlay">×</button></div>
      <div class="nf-modal-body full">
        <label>Organization</label><select id="associateOrganizationId" class="nf-input"></select>
        <label>Arena</label><select id="associateArenaId" class="nf-input"></select>
        <label>Organization access</label><select id="associateAccessLevel" class="nf-input"><option value="Use">Use</option><option value="Manage">Manage</option></select>
        <label class="facility-inline-check"><input id="associatePrimary" type="checkbox" /> Primary arena</label>
      </div>
      <div class="nf-modal-footer"><button class="nf-btn nf-btn-secondary" data-close-modal="associateArenaModalOverlay">Cancel</button><button id="saveArenaAssociation" class="nf-btn nf-btn-primary">Associate</button></div>
    </div>
  </div>

  <div id="rinkModalOverlay" class="nf-modal-overlay">
    <div class="nf-modal small">
      <div class="nf-modal-header"><h2 id="rinkModalTitle">Add Rink</h2><button class="modal-close" data-close-modal="rinkModalOverlay">×</button></div>
      <div class="nf-modal-body full">
        <label>Rink name</label><input id="rinkName" class="nf-input" />
        <label>Display order</label><input id="rinkDisplayOrder" class="nf-input" type="number" min="0" value="0" />
        <label class="facility-inline-check"><input id="rinkActive" type="checkbox" checked /> Active</label>
      </div>
      <div class="nf-modal-footer"><button class="nf-btn nf-btn-secondary" data-close-modal="rinkModalOverlay">Cancel</button><button id="saveRink" class="nf-btn nf-btn-primary">Save Rink</button></div>
    </div>
  </div>

  <div id="gatewayModalOverlay" class="nf-modal-overlay">
    <div class="nf-modal medium">
      <div class="nf-modal-header"><h2 id="gatewayModalTitle">Configure Gateway</h2><button class="modal-close" data-close-modal="gatewayModalOverlay">×</button></div>
      <div class="nf-modal-body">
        <div class="full-width-section"><div class="two-col">
          <div><label>Gateway name</label><input id="gatewayName" class="nf-input" /></div>
          <div><label>Device MAC address</label><input id="gatewayMac" class="nf-input" placeholder="AA:BB:CC:DD:EE:FF" /></div>
          <div><label>Host or IP address</label><input id="gatewayHost" class="nf-input" placeholder="192.168.1.150" /></div>
          <div><label>WebSocket port</label><input id="gatewayPort" class="nf-input" type="number" min="1" max="65535" value="80" /></div>
          <div class="full-width-section"><label>Authentication secret</label><input id="gatewaySecret" class="nf-input" type="password" autocomplete="new-password" /><small id="gatewaySecretHint">Required for a new gateway.</small></div>
          <div class="facility-checkboxes"><label><input id="gatewayPrimary" type="checkbox" checked /> Primary gateway</label><label><input id="gatewayActive" type="checkbox" checked /> Active</label></div>
        </div></div>
      </div>
      <div class="nf-modal-footer"><button class="nf-btn nf-btn-secondary" data-close-modal="gatewayModalOverlay">Cancel</button><button id="saveGateway" class="nf-btn nf-btn-primary">Save Gateway</button></div>
    </div>
  </div>
`;
