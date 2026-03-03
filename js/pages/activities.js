import { supabase } from "../supabaseClient.js";
import { escapeHtml } from "../ui/escapeHtml.js";
import { TASK_DISPLAY_LABEL } from "../domainTypes.js";
import { uiConfirm } from "../ui/modal.js";

function peso(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusPillClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "approved") return "status-pill approved";
  if (s === "pending") return "status-pill pending";
  if (s === "billed" || s === "completed") return "status-pill completed";
  if (s === "rejected") return "status-pill rejected";
  return "status-pill draft";
}

function displayCategoryLabel(taskCategory) {
  const key = String(taskCategory || "").trim().toLowerCase();
  return TASK_DISPLAY_LABEL[key] || taskCategory || "-";
}

export async function renderActivities(appEl, ctx, navigate) {
  const PAGE_SIZE = 50;
  let page = 1;
  let currentTab = "all";
  let statusFilter = "";
  let searchQ = "";
  let activitiesRows = [];
  let accountsById = new Map();
  let usersById = new Map();

  appEl.innerHTML = `
    <section class="page-head">
      <div>
        <h1 class="page-title">Activities</h1>
        <p class="page-sub">View and filter activity logs and expenses.</p>
      </div>
      <div class="page-actions">
        <button id="logActivityBtn" class="btn btn-primary">+ Log Activity</button>
      </div>
    </section>

    <div class="tabs" id="activityTabs">
      <button class="tab active" data-tab="all">All Entries</button>
      <button class="tab" data-tab="activity">Billable Work</button>
      <button class="tab" data-tab="cost">Expenses (OPEX)</button>
    </div>

    <div class="toolbar" style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap">
      <input type="text" id="searchQ" placeholder="Search description or matter..." style="flex:1;min-width:200px" />
      <select id="statusFilter" style="width:160px">
        <option value="">All Statuses</option>
        <option value="draft">Drafts</option>
        <option value="pending">Pending</option>
        <option value="approved">Approved</option>
        <option value="billed">Billed</option>
      </select>
      <button id="reloadBtn" class="btn btn-ghost">Reload</button>
    </div>

    <div id="pgArea" style="margin:16px 0;display:flex;align-items:center;justify-content:space-between">
      <div class="muted" id="countLabel">Loading...</div>
      <div style="display:flex;gap:8px">
        <button id="prevBtn" class="btn btn-ghost" disabled>Prev</button>
        <span id="pageLabel" class="muted" style="align-self:center;font-size:13px"></span>
        <button id="nextBtn" class="btn btn-ghost" disabled>Next</button>
      </div>
    </div>

    <div id="listArea" style="display:flex;flex-direction:column;gap:16px;"></div>
  `;

  const tabsEl = appEl.querySelector("#activityTabs");
  const searchEl = appEl.querySelector("#searchQ");
  const statusEl = appEl.querySelector("#statusFilter");
  const listArea = appEl.querySelector("#listArea");
  const logActivityBtn = appEl.querySelector("#logActivityBtn");
  const prevBtn = appEl.querySelector("#prevBtn");
  const nextBtn = appEl.querySelector("#nextBtn");
  const reloadBtn = appEl.querySelector("#reloadBtn");
  const countLabel = appEl.querySelector("#countLabel");
  const pageLabel = appEl.querySelector("#pageLabel");

  logActivityBtn.addEventListener("click", () => navigate("#/log"));

  tabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    tabsEl.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    currentTab = btn.dataset.tab;
    page = 1;
    loadData();
  });

  searchEl.addEventListener("change", (e) => { searchQ = e.target.value; page = 1; loadData(); });
  statusEl.addEventListener("change", (e) => { statusFilter = e.target.value; page = 1; loadData(); });
  prevBtn.addEventListener("click", () => { if (page > 1) { page--; loadData(); } });
  nextBtn.addEventListener("click", () => { page++; loadData(); });
  reloadBtn.addEventListener("click", () => { page = 1; loadData(); });

  async function loadData() {
    listArea.innerHTML = `<div class="muted">Loading activities...</div>`;
    prevBtn.disabled = true;
    nextBtn.disabled = true;

    try {
      let q = supabase
        .from("activities")
        .select("id,account_id,matter,task_category,description,amount,minutes,status,created_by,performed_by,occurred_at,attachment_urls", { count: "exact" });

      if (statusFilter) q = q.eq("status", statusFilter);
      if (searchQ) q = q.ilike("description", `%${searchQ}%`);

      if (currentTab === "cost") {
        q = q.in("entry_class", ["opex"]);
      } else if (currentTab === "activity") {
        q = q.in("entry_class", ["meeting", "misc"]);
      }

      q = q.order("occurred_at", { ascending: false }).order("created_at", { ascending: false });

      const offset = (page - 1) * PAGE_SIZE;
      q = q.range(offset, offset + PAGE_SIZE - 1);

      const { data, count, error } = await q;
      if (error) throw error;

      activitiesRows = data || [];
      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;

      countLabel.textContent = `${totalCount} activities found (Page ${page} of ${totalPages})`;
      pageLabel.textContent = `Page ${page}`;
      prevBtn.disabled = page <= 1;
      nextBtn.disabled = page >= totalPages;

      if (!activitiesRows.length) {
        listArea.innerHTML = `<div class="card" style="padding:32px;text-align:center"><div class="muted">No activities match your filters.</div></div>`;
        return;
      }

      const accIds = Array.from(new Set(activitiesRows.map((x) => x.account_id).filter(Boolean)));
      const uIds = Array.from(new Set(activitiesRows.map((x) => x.performed_by || x.created_by).filter(Boolean)));

      const [accRes, uRes] = await Promise.all([
        accIds.length ? supabase.from("accounts").select("id,title").in("id", accIds) : Promise.resolve({ data: [] }),
        uIds.length ? supabase.from("profiles").select("id,full_name,email").in("id", uIds) : Promise.resolve({ data: [] }),
      ]);

      if (accRes.data) accRes.data.forEach(a => accountsById.set(a.id, a.title));
      if (uRes.data) uRes.data.forEach(u => usersById.set(u.id, u.full_name || u.email || "-"));

      renderList();
    } catch (e) {
      listArea.innerHTML = `<div class="msg">Error: ${escapeHtml(e.message)}</div>`;
    }
  }

  function renderList() {
    listArea.innerHTML = activitiesRows.map((r) => {
      const accountName = accountsById.get(r.account_id) || "Unknown Account";
      const userName = usersById.get(r.performed_by || r.created_by) || "-";
      const catLabel = displayCategoryLabel(r.task_category);
      const when = r.occurred_at ? new Date(r.occurred_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "-";

      let receiptsHtml = "";
      const urls = Array.isArray(r.attachment_urls) ? r.attachment_urls : (r.attachment_urls ? [String(r.attachment_urls)] : []);
      if (urls.length > 0) {
        receiptsHtml = `<div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap">
          ${urls.map((u, i) => `<span class="status-pill draft" style="font-size:11px">📎 Attachment ${i + 1}</span>`).join("")}
        </div>`;
      }

      return `
        <div class="tracker-card" style="margin-bottom:0px">
          <div class="tracker-card-header">
            <span class="tracker-card-id" style="font-family:monospace">${escapeHtml(String(r.id).split("-")[0].toUpperCase())}</span>
            <span class="${statusPillClass(r.status)}">${escapeHtml(r.status || "draft")}</span>
            <div class="tracker-card-actions" style="font-size:13px;color:#4d7093;font-weight:600">
              P${peso(r.amount)}
            </div>
          </div>
          <div class="tracker-card-body">
            <div class="tracker-card-fields" style="grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))">
              <div class="tracker-field">
                <span class="tracker-field-label">Date</span>
                <div style="font-size:14px;color:#1e293b;font-weight:500">${escapeHtml(when)}</div>
              </div>
              <div class="tracker-field">
                <span class="tracker-field-label">Account</span>
                <div style="font-size:14px;color:#1e293b;font-weight:500">${escapeHtml(accountName)}</div>
              </div>
              <div class="tracker-field">
                <span class="tracker-field-label">Category</span>
                <div style="font-size:14px;color:#1e293b">${escapeHtml(catLabel)}</div>
              </div>
              <div class="tracker-field">
                <span class="tracker-field-label">Performed By</span>
                <div style="font-size:14px;color:#1e293b">${escapeHtml(userName)}</div>
              </div>
              <div class="tracker-field tracker-field-wide">
                <span class="tracker-field-label">Description</span>
                <div style="font-size:14px;color:#334155;line-height:1.5">${escapeHtml(r.description || "-")}</div>
                ${receiptsHtml}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  await loadData();
}
