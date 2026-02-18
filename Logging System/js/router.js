export const SUPER_ADMIN_ROLES = ["super_admin", "admin"];
export const STAFF_ROLES = ["lawyer", "accountant", "staff_encoder", ...SUPER_ADMIN_ROLES];

const routes = [
  { path: "#/dashboard", roles: STAFF_ROLES, modulePath: "./pages/dashboard.js", exportName: "renderDashboard" },
  { path: "#/tracker", roles: STAFF_ROLES, modulePath: "./pages/trackerHub.js", exportName: "renderTrackerHub" },
  { path: "#/activities", roles: STAFF_ROLES, modulePath: "./pages/logActivity.js", exportName: "renderLogActivity" },
  { path: "#/accounts", roles: STAFF_ROLES, modulePath: "./pages/accounts.js", exportName: "renderAccounts" },
  { path: "#/reports", roles: STAFF_ROLES, modulePath: "./pages/reports.js", exportName: "renderReports" },
  { path: "#/contracts", roles: STAFF_ROLES, modulePath: "./pages/contracts.js", exportName: "renderContracts" },
  { path: "#/approvals", roles: ["accountant", ...SUPER_ADMIN_ROLES], modulePath: "./pages/approvals.js", exportName: "renderApprovals" },
  { path: "#/admin/users", roles: SUPER_ADMIN_ROLES, modulePath: "./pages/adminUsers.js", exportName: "renderAdminUsers" },
  { path: "#/admin/rates", roles: SUPER_ADMIN_ROLES, modulePath: "./pages/adminRates.js", exportName: "renderAdminRates" },
];

const moduleCache = new Map();

export function navigate(hash) {
  location.hash = hash;
}

function matchRoute(hash) {
  if (hash.startsWith("#/accounts/")) {
    return { type: "accountDetail", id: hash.split("#/accounts/")[1] };
  }
  return { type: "static", hash };
}

function deny(appEl) {
  appEl.innerHTML = `
    <div class="card">
      <h2>Access denied</h2>
      <p class="muted">You do not have permission to view this page.</p>
    </div>
  `;
}

function renderLoadError(appEl, error) {
  appEl.innerHTML = `
    <div class="card">
      <h2>Page failed to load</h2>
      <p class="muted">${error?.message || "Unknown module error."}</p>
    </div>
  `;
}

async function loadRenderFunction(modulePath, exportName) {
  if (!moduleCache.has(modulePath)) {
    moduleCache.set(modulePath, import(modulePath));
  }

  const mod = await moduleCache.get(modulePath);
  const render = mod?.[exportName];
  if (typeof render !== "function") {
    throw new Error(`Missing export "${exportName}" from ${modulePath}`);
  }

  return render;
}

export function startRouter({ ctx, appEl }) {
  async function render() {
    const role = ctx.profile.role;
    const m = matchRoute(location.hash || "#/dashboard");

    try {
      if (m.type === "accountDetail") {
        if (!STAFF_ROLES.includes(role)) return deny(appEl);
        const renderAccountDetail = await loadRenderFunction("./pages/accountDetail.js", "renderAccountDetail");
        return renderAccountDetail(appEl, ctx, m.id, navigate);
      }

      const route = routes.find(x => x.path === m.hash);
      if (!route) return navigate("#/dashboard");
      if (!route.roles.includes(role)) return deny(appEl);

      const renderRoute = await loadRenderFunction(route.modulePath, route.exportName);
      await renderRoute(appEl, ctx, navigate);
    } catch (error) {
      console.error("Router render error:", error);
      renderLoadError(appEl, error);
    }
  }

  window.addEventListener("hashchange", render);
  render();
}
