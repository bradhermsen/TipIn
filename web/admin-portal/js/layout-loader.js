// =========================================================
// SHARED LAYOUT LOADER
// =========================================================

window.loadLayout = async function (pageKey) {
  try {
    const faviconHref = new URL("../assets/favicon.ico", window.location.href).href;
    let faviconEl = document.querySelector('head link[rel="icon"]');
    if (!faviconEl) {
      faviconEl = document.createElement("link");
      faviconEl.setAttribute("rel", "icon");
      faviconEl.setAttribute("type", "image/x-icon");
      document.head.appendChild(faviconEl);
    }
    faviconEl.setAttribute("href", faviconHref);

    // =====================================================
    // 🔐 AUTH CHECK — BLOCK ALL PAGES EXCEPT LOGIN
    // =====================================================
    const currentPage = window.location.pathname.split("/").pop();

    if (currentPage !== "login.html") {
      if (!window.Auth || !window.Auth.isAuthenticated()) {
        console.warn("⛔ Not authenticated — redirecting to login");
        window.location.href = "login.html";
        return;
      }
    }

    // =====================================================
    // 1) Load layout shell
    // =====================================================
    const layoutHtml = await fetch("../components/layout.html").then((r) =>
      r.text(),
    );
    document.getElementById("layoutContainer").innerHTML = layoutHtml;

    // 2) Load sidebar + footer
    const [sidebarHtml, footerHtml] = await Promise.all([
      fetch("../components/sidebar.html").then((r) => r.text()),
      fetch("../components/footer.html").then((r) => r.text()),
    ]);

    document.getElementById("sidebarContainer").innerHTML = sidebarHtml;
    document.getElementById("footerContainer").innerHTML = footerHtml;

    // Highlight active link
    document.querySelectorAll(".sidebar-link").forEach((link) => {
      const href = link.getAttribute("href") || "";
      const isSettingsChild =
        currentPage.startsWith("settings-") && href === "settings.html";
      if (href.includes(currentPage) || isSettingsChild) {
        link.classList.add("active");
      }
    });

    // =====================================================
    // 3) Inject page-specific modals FIRST
    // =====================================================
    if (
      window.PageContentRegistry &&
      window.PageContentRegistry[pageKey + "Modals"]
    ) {
      // Remove any existing modals for this page
      const existingOverlays = document.querySelectorAll(
        `.nf-modal-overlay[data-page="${pageKey}"]`,
      );
      existingOverlays.forEach((el) => el.remove());

      // Generate modal HTML
      const modalsHtml = window.PageContentRegistry[pageKey + "Modals"]();
      const temp = document.createElement("div");
      temp.innerHTML = modalsHtml;

      // Append each overlay to <body>
      const overlays = temp.querySelectorAll(".nf-modal-overlay");
      overlays.forEach((overlay) => {
        overlay.setAttribute("data-page", pageKey);
        document.body.appendChild(overlay);
      });
    }

    // =====================================================
    // 3b) Inject page content SECOND
    // =====================================================
    if (window.PageContentRegistry && window.PageContentRegistry[pageKey]) {
      const pageContent = document.getElementById("pageContent");
      pageContent.innerHTML = window.PageContentRegistry[pageKey]();

      window.AdminPage = window.AdminPage || {};
      window.AdminPage.currentPage = pageKey;
    }

    // 4) Fire page-ready events
    document.dispatchEvent(new Event("layoutLoaded"));
    document.dispatchEvent(new Event("nf-page-ready"));
  } catch (err) {
    console.error("Layout loader failed:", err);
  }
};
// =====================================================
// LOGOUT HANDLER (works even with dynamic sidebar load)
// =====================================================
document.addEventListener("click", (e) => {
  const logoutLink = e.target.closest("#sidebar-logout");
  if (logoutLink) {
    e.preventDefault();
logout();
  }
});
