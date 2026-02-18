import { supabase } from "./supabaseClient.js";
import { startRouter, navigate, STAFF_ROLES, SUPER_ADMIN_ROLES } from "./router.js";

const appEl = document.getElementById("app");
const navEl = document.getElementById("nav");
const whoamiEmailEl = document.getElementById("whoamiEmail");
const whoamiRoleEl = document.getElementById("whoamiRole");
const logoutBtn = document.getElementById("logoutBtn");
const PRIMARY_NAV_HREFS = new Set(["#/dashboard", "#/tracker", "#/accounts", "#/activities"]);

let navOutsideCloseBound = false;

function roleLabel(role) {
  const map = {
    super_admin: "Super Admin",
    admin: "Admin",
    accountant: "Accountant",
    lawyer: "Lawyer",
    staff_encoder: "Staff Encoder",
  };
  return map[role] || role;
}

async function getContextOrRedirect() {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) {
    window.location.href = "./index.html";
    return null;
  }

  const user = session.user;
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,role")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    await supabase.auth.signOut();
    window.location.href = "./index.html";
    return null;
  }

  whoamiEmailEl.textContent = profile.email || "";
  whoamiRoleEl.textContent = roleLabel(profile.role);
  return { user, profile };
}

function syncActiveNav() {
  const current = location.hash || "#/dashboard";
  navEl.querySelectorAll("a.navlink[href]").forEach((a) => {
    const href = a.getAttribute("href");
    if (href === current) a.classList.add("active");
    else a.classList.remove("active");
  });

  const more = navEl.querySelector(".nav-more");
  if (more) {
    const hasActiveInMore = !!more.querySelector(".navmore-menu a.navlink.active");
    more.classList.toggle("active", hasActiveInMore);
  }
}

function closeNavDropdown() {
  const more = navEl.querySelector(".nav-more");
  if (more) more.open = false;
}

function bindNavOutsideClose() {
  if (navOutsideCloseBound) return;
  document.addEventListener("click", (e) => {
    const more = navEl.querySelector(".nav-more");
    if (!more || !more.open) return;
    if (!more.contains(e.target)) {
      more.open = false;
    }
  });
  navOutsideCloseBound = true;
}

function renderNav(ctx) {
  const role = ctx.profile.role;
  const links = [
    { href: "#/dashboard", label: "Today", roles: STAFF_ROLES },
    { href: "#/tracker", label: "Tracker", roles: STAFF_ROLES },
    { href: "#/accounts", label: "Accounts", roles: STAFF_ROLES },
    { href: "#/activities", label: "Activities", roles: STAFF_ROLES },
    { href: "#/reports", label: "Reports", roles: STAFF_ROLES },
    { href: "#/contracts", label: "Contracts", roles: STAFF_ROLES },
    { href: "#/approvals", label: "Approvals", roles: ["accountant", ...SUPER_ADMIN_ROLES] },
    { href: "#/admin/users", label: "Admin Users", roles: SUPER_ADMIN_ROLES },
    { href: "#/admin/rates", label: "Admin Rates", roles: SUPER_ADMIN_ROLES },
  ];

  const allowedLinks = links.filter((l) => l.roles.includes(role));
  const primaryLinks = allowedLinks.filter((l) => PRIMARY_NAV_HREFS.has(l.href));
  const moreLinks = allowedLinks.filter((l) => !PRIMARY_NAV_HREFS.has(l.href));

  navEl.innerHTML = `
    <div class="nav-main">
      ${primaryLinks.map((l) => `<a class="navlink" href="${l.href}">${l.label}</a>`).join("")}
    </div>
    ${moreLinks.length ? `
      <details class="nav-more">
        <summary class="navlink navmore-toggle" aria-haspopup="menu" aria-expanded="false">More</summary>
        <div class="navmore-menu">
          ${moreLinks.map((l) => `<a class="navlink" href="${l.href}">${l.label}</a>`).join("")}
        </div>
      </details>
    ` : ""}
  `;

  const more = navEl.querySelector(".nav-more");
  if (more) {
    const toggle = more.querySelector(".navmore-toggle");
    more.querySelectorAll(".navmore-menu a.navlink").forEach((a) => {
      a.addEventListener("click", () => { more.open = false; });
    });
    more.addEventListener("toggle", () => {
      if (toggle) toggle.setAttribute("aria-expanded", more.open ? "true" : "false");
    });
  }

  bindNavOutsideClose();

  if (!location.hash) {
    navigate("#/tracker");
  }
  syncActiveNav();
}

logoutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.href = "./index.html";
});

window.addEventListener("hashchange", () => {
  closeNavDropdown();
  syncActiveNav();
});

const ctx = await getContextOrRedirect();
if (ctx) {
  renderNav(ctx);
  startRouter({ ctx, appEl });
}
