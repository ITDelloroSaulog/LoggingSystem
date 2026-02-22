import { supabase } from "../supabaseClient.js";
import { escapeHtml } from "../ui/escapeHtml.js";

const SUPER_ADMIN_ROLES = ["super_admin", "admin"];

function asPeso(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function normalizeStatus(value, isArchived = false) {
  if (isArchived) return "archived";
  const v = (value || "").toLowerCase();
  if (v === "active") return "active";
  if (v === "inactive") return "inactive";
  if (v === "closed") return "closed";
  return "active";
}

export async function renderAccounts(appEl, ctx, navigate) {
  const isAdmin = SUPER_ADMIN_ROLES.includes(ctx.profile.role);

  appEl.innerHTML = `
    <section class="page-head">
      <div>
        <h1 class="page-title">Accounts</h1>
        <p class="page-sub">Manage case accounts and matters</p>
      </div>
      ${isAdmin ? `<button id="toggleCreate" class="btn btn-primary">+ New Account</button>` : ""}
    </section>

    <section class="kpi-grid" id="kpis">
      <article class="kpi-card"><div class="kpi-label">Total Accounts</div><div class="kpi-value">-</div></article>
      <article class="kpi-card"><div class="kpi-label">Unbilled Amount</div><div class="kpi-value">-</div></article>
      <article class="kpi-card"><div class="kpi-label">Total Logged Value</div><div class="kpi-value">-</div></article>
      <article class="kpi-card"><div class="kpi-label">Active Accounts</div><div class="kpi-value">-</div></article>
    </section>

    ${isAdmin ? `
      <section id="adminCreate" class="card" style="display:none;margin-bottom:12px">
        <h3 style="margin-top:2px">Create Account</h3>
        <form id="createForm" class="stack">
          <div class="grid2" style="grid-template-columns:1.4fr 1fr 1fr">
            <div>
              <label>Title</label>
              <input id="title" required />
            </div>
            <div>
              <label>Category</label>
              <select id="category">
                <option value="retainer">Retainer</option>
                <option value="litigation">Litigation</option>
                <option value="special_project">Special Project</option>
              </select>
            </div>
            <div>
              <label>Account Kind</label>
              <select id="account_kind">
                <option value="company">Company</option>
                <option value="personal">Personal</option>
              </select>
            </div>
          </div>
          <button type="submit" class="btn btn-primary">Create</button>
        </form>
      </section>
    ` : ""}

    <section class="card" style="margin-bottom:12px">
      <div class="grid2" style="grid-template-columns:1.4fr 1fr 1fr 1fr">
        <div>
          <label>Search</label>
          <input id="search" placeholder="Search accounts or category..." />
        </div>
        <div>
          <label>Status</label>
          <select id="statusFilter">
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="closed">Closed</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div>
          <label>Account Kind</label>
          <select id="kindFilter">
            <option value="">All kinds</option>
            <option value="company">Company</option>
            <option value="personal">Personal</option>
          </select>
        </div>
        <div>
          <label style="display:flex;align-items:center;gap:8px;font-weight:600">
            <input id="showArchived" type="checkbox" style="width:auto;margin:0" />
            Show archived
          </label>
        </div>
      </div>
    </section>

    <section class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Account Name</th>
            <th>Kind</th>
            <th>Type</th>
            <th>Status</th>
            <th>Total Billed</th>
            <th>Unbilled</th>
            <th>Last Activity</th>
            ${isAdmin ? "<th>Action</th>" : ""}
          </tr>
        </thead>
        <tbody id="tableBody"></tbody>
      </table>
    </section>
    <p id="msg" class="msg"></p>
  `;

  const msg = appEl.querySelector("#msg");
  const tableBody = appEl.querySelector("#tableBody");
  const kpis = appEl.querySelector("#kpis");
  const searchInput = appEl.querySelector("#search");
  const statusFilter = appEl.querySelector("#statusFilter");
  const kindFilter = appEl.querySelector("#kindFilter");
  const showArchived = appEl.querySelector("#showArchived");

  let accounts = [];
  let accountStats = new Map();

  if (isAdmin) {
    const adminCreate = appEl.querySelector("#adminCreate");
    const toggleCreate = appEl.querySelector("#toggleCreate");
    toggleCreate.addEventListener("click", () => {
      adminCreate.style.display = adminCreate.style.display === "none" ? "block" : "none";
    });

    appEl.querySelector("#createForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.textContent = "Creating...";

      const title = appEl.querySelector("#title").value.trim();
      const category = appEl.querySelector("#category").value;
      const account_kind = appEl.querySelector("#account_kind").value;
      const { error } = await supabase.from("accounts").insert({
        title,
        category,
        account_kind,
        is_archived: false,
        created_by: ctx.user.id,
      });

      msg.textContent = error ? `Error: ${error.message}` : "Account created.";
      if (!error) {
        e.target.reset();
        await load();
      }
    });
  }

  function renderKpis(rows) {
    const totalAccounts = rows.length;
    const activeCount = rows.filter((a) => normalizeStatus(a.status, a.is_archived) === "active").length;
    const archivedCount = rows.filter((a) => !!a.is_archived).length;
    let totalBilled = 0;
    let totalUnbilled = 0;

    rows.forEach((row) => {
      const s = accountStats.get(row.id) || { billed: 0, unbilled: 0 };
      totalBilled += s.billed;
      totalUnbilled += s.unbilled;
    });

    kpis.innerHTML = `
      <article class="kpi-card">
        <div class="kpi-label">Total Accounts</div>
        <div class="kpi-value">${totalAccounts}</div>
        <div class="kpi-note">${activeCount} active | ${archivedCount} archived</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Unbilled Amount</div>
        <div class="kpi-value" style="color:#df7a00">P${asPeso(totalUnbilled)}</div>
        <div class="kpi-note">Across all accounts</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Total Billed</div>
        <div class="kpi-value" style="color:#4d7093">P${asPeso(totalBilled)}</div>
        <div class="kpi-note">Billed/completed activity</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Status Coverage</div>
        <div class="kpi-value">${activeCount}</div>
        <div class="kpi-note">Active matters</div>
      </article>
    `;
  }

  function renderTable() {
    const q = (searchInput.value || "").trim().toLowerCase();
    const status = statusFilter.value;
    const kind = kindFilter.value;
    const includeArchived = !!showArchived?.checked;

    const filtered = accounts.filter((a) => {
      const matchesSearch = !q
        || (a.title || "").toLowerCase().includes(q)
        || (a.category || "").toLowerCase().includes(q)
        || (a.account_kind || "").toLowerCase().includes(q);
      const normalizedStatus = normalizeStatus(a.status, a.is_archived);
      const matchesStatus = !status || normalizedStatus === status;
      const matchesKind = !kind || (a.account_kind || "") === kind;
      const matchesArchive = includeArchived || !a.is_archived;
      return matchesSearch && matchesStatus && matchesKind && matchesArchive;
    });

    renderKpis(filtered);

    if (!filtered.length) {
      tableBody.innerHTML = `<tr><td colspan="${isAdmin ? 8 : 7}" class="muted">No accounts found.</td></tr>`;
      return;
    }

    tableBody.innerHTML = filtered.map((a) => {
      const s = accountStats.get(a.id) || { billed: 0, unbilled: 0, lastActivity: null };
      const st = normalizeStatus(a.status, a.is_archived);
      const last = s.lastActivity ? new Date(s.lastActivity).toLocaleDateString() : "-";
      const actionCell = isAdmin
        ? `<td>${a.is_archived
            ? `<button class="btn toggleArchive" data-id="${a.id}" data-action="unarchive">Unarchive</button>`
            : `<button class="btn btn-danger toggleArchive" data-id="${a.id}" data-action="archive">Archive</button>`
          }</td>`
        : "";
      return `
        <tr data-id="${a.id}" class="clickable">
          <td><strong>${escapeHtml(a.title)}</strong></td>
          <td>${escapeHtml(a.account_kind || "-")}</td>
          <td>${escapeHtml(a.category || "-")}</td>
          <td><span class="status-pill ${st === "active" ? "completed" : st === "archived" ? "rejected" : ""}">${escapeHtml(st)}</span></td>
          <td><strong>P${asPeso(s.billed)}</strong></td>
          <td style="color:#df7a00"><strong>P${asPeso(s.unbilled)}</strong></td>
          <td>${last}</td>
          ${actionCell}
        </tr>
      `;
    }).join("");

    tableBody.querySelectorAll("tr[data-id]").forEach((row) => {
      row.addEventListener("click", (evt) => {
        if (evt.target.closest(".toggleArchive")) return;
        navigate(`#/accounts/${row.dataset.id}`);
      });
    });

    tableBody.querySelectorAll(".toggleArchive").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        msg.textContent = action === "archive" ? "Archiving..." : "Unarchiving...";
        const patch = action === "archive"
          ? { is_archived: true, archived_at: new Date().toISOString(), archived_by: ctx.user.id, status: "closed" }
          : { is_archived: false, archived_at: null, archived_by: null, status: "active" };
        const { error } = await supabase.from("accounts").update(patch).eq("id", id);
        msg.textContent = error ? `Error: ${error.message}` : (action === "archive" ? "Account archived." : "Account unarchived.");
        if (!error) await load();
      });
    });
  }

  async function load() {
    msg.textContent = "Loading...";
    tableBody.innerHTML = `<tr><td colspan="6" class="muted">Loading...</td></tr>`;

    const { data, error } = await supabase
      .from("accounts")
      .select("id,title,category,account_kind,is_archived,status,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      msg.textContent = `Error: ${error.message}`;
      return;
    }

    accounts = data || [];
    const ids = accounts.map((a) => a.id);
    accountStats = new Map();

    if (ids.length) {
      const { data: acts, error: actErr } = await supabase
        .from("activities")
        .select("account_id,amount,status,occurred_at,created_at")
        .in("account_id", ids)
        .limit(5000);

      if (actErr) {
        msg.textContent = `Error loading activity stats: ${actErr.message}`;
      } else {
        (acts || []).forEach((x) => {
          const key = x.account_id;
          if (!accountStats.has(key)) {
            accountStats.set(key, { billed: 0, unbilled: 0, lastActivity: null });
          }
          const curr = accountStats.get(key);
          const amount = Number(x.amount || 0);
          if (x.status === "billed" || x.status === "completed") curr.billed += amount;
          else curr.unbilled += amount;

          const activityWhen = x.occurred_at || x.created_at;
          if (activityWhen && (!curr.lastActivity || new Date(activityWhen) > new Date(curr.lastActivity))) {
            curr.lastActivity = activityWhen;
          }
        });
      }
    }

    msg.textContent = "";
    renderTable();
  }

  searchInput.addEventListener("input", renderTable);
  statusFilter.addEventListener("change", renderTable);
  kindFilter.addEventListener("change", renderTable);
  showArchived?.addEventListener("change", renderTable);
  await load();
}
