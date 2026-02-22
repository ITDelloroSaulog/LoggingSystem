import { supabase } from "../supabaseClient.js";
import { escapeHtml } from "../ui/escapeHtml.js";
import { uiPrompt } from "../ui/modal.js";

const SUPER_ADMIN_ROLES = ["super_admin", "admin"];

function peso(n) {
  const x = Number(n || 0);
  return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function clean(v) {
  return String(v || "").trim();
}

function truncate(text, max = 130) {
  const t = clean(text);
  if (!t) return "-";
  return t.length > max ? `${t.slice(0, max - 1)}...` : t;
}

function statusClass(status) {
  const s = clean(status).toLowerCase();
  if (s.startsWith("pending")) return "pending";
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  if (s === "billed" || s === "completed") return "billed";
  return "";
}

function extractRetainerAssignee(taskCategory, description) {
  const task = clean(taskCategory).toLowerCase();
  if (!task.startsWith("retainer_")) return "";
  const match = String(description || "").match(/Assignee:\s*([^|]+)/i);
  const value = clean(match?.[1] || "");
  if (!value || /^(-|n\/a|na)$/i.test(value)) return "";
  return value;
}

export async function renderApprovals(appEl, ctx) {
  const isAdmin = SUPER_ADMIN_ROLES.includes(ctx.profile.role);
  const isAccountant = ctx.profile.role === "accountant";
  if (!isAdmin && !isAccountant) {
    appEl.innerHTML = `<div class="card"><h2>Access denied</h2></div>`;
    return;
  }

  appEl.innerHTML = `
    <section class="page-head">
      <div>
        <h1 class="page-title">Approvals</h1>
        <p class="page-sub">Shorter review list with quick actions and expandable details.</p>
      </div>
    </section>

    <section class="card approvals-shell">
      <div class="approvals-toolbar">
        <select id="view">
          <option value="pending">Pending + expired drafts</option>
          <option value="approved">Approved (ready to bill)</option>
          <option value="billed">Billed (ready to complete)</option>
        </select>
        <select id="account">
          <option value="">All clients</option>
        </select>
        <input id="q" placeholder="Search client, description, category..." />
        <button id="reloadBtn" class="btn">Reload</button>
      </div>

      <section class="kpi-grid approvals-kpis" id="kpis"></section>

      <div class="table-wrap approvals-table-wrap">
        <table class="approvals-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Matter / Summary</th>
              <th>Status</th>
              <th>Amount</th>
              <th>Entered / Performed</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="list"></tbody>
        </table>
      </div>
      <p id="msg" class="msg"></p>
    </section>
  `;

  const $ = (s) => appEl.querySelector(s);
  const msg = $("#msg");
  const list = $("#list");
  const kpis = $("#kpis");
  const viewSel = $("#view");
  const qInput = $("#q");
  const accountSel = $("#account");
  const reloadBtn = $("#reloadBtn");

  let allRows = [];
  let accById = new Map();
  let profById = new Map();

  function renderKpis(rows) {
    const total = rows.length;
    const pending = rows.filter((r) => {
      const expiredDraft = r.status === "draft" && r.draft_expires_at && new Date(r.draft_expires_at) <= new Date();
      return r.status === "pending" || expiredDraft;
    }).length;
    const approved = rows.filter((r) => clean(r.status).toLowerCase() === "approved").length;
    const billed = rows.filter((r) => clean(r.status).toLowerCase() === "billed").length;

    kpis.innerHTML = `
      <article class="kpi-card">
        <div class="kpi-label">Rows</div>
        <div class="kpi-value">${total}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Pending</div>
        <div class="kpi-value" style="color:#9a5a00">${pending}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Approved</div>
        <div class="kpi-value" style="color:#1e55c8">${approved}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Billed</div>
        <div class="kpi-value" style="color:#0f7a46">${billed}</div>
      </article>
    `;
  }

  function populateAccountOptions() {
    const previous = clean(accountSel.value);
    const unique = new Map();
    for (const row of allRows) {
      const acc = accById.get(row.account_id);
      if (!acc || unique.has(acc.id)) continue;
      unique.set(acc.id, acc);
    }
    const items = Array.from(unique.values()).sort((a, b) => clean(a.title).localeCompare(clean(b.title)));
    accountSel.innerHTML = [
      `<option value="">All clients</option>`,
      ...items.map((a) => `<option value="${a.id}">${escapeHtml(a.title || "(Untitled)")}</option>`),
    ].join("");

    if (previous && unique.has(previous)) {
      accountSel.value = previous;
    }
  }

  function getFilteredRows() {
    const q = clean(qInput.value).toLowerCase();
    const accountId = clean(accountSel.value);

    return allRows.filter((x) => {
      if (accountId && x.account_id !== accountId) return false;
      if (!q) return true;

      const acc = accById.get(x.account_id);
      const entered = profById.get(x.created_by);
      const perf = profById.get(x.performed_by);
      const assignee = extractRetainerAssignee(x.task_category, x.description);
      const hay = [
        acc?.title,
        acc?.category,
        x.matter,
        x.description,
        x.task_category,
        x.fee_code,
        entered?.full_name,
        entered?.email,
        perf?.full_name,
        perf?.email,
        assignee,
      ]
        .map((v) => clean(v).toLowerCase())
        .join(" ");

      return hay.includes(q);
    });
  }

  function renderRows() {
    const rows = getFilteredRows();
    renderKpis(rows);

    if (!rows.length) {
      list.innerHTML = `<tr><td colspan="6" class="muted">No items.</td></tr>`;
      return;
    }

    list.innerHTML = rows
      .map((x) => {
        const acc = accById.get(x.account_id);
        const entered = profById.get(x.created_by);
        const perf = profById.get(x.performed_by);
        const assignee = extractRetainerAssignee(x.task_category, x.description);

        const expiredDraft = x.status === "draft" && x.draft_expires_at && new Date(x.draft_expires_at) <= new Date();
        const effectiveStatus = expiredDraft ? "pending (auto)" : x.status;
        x.effective_status = effectiveStatus;

        const enteredLabel = entered?.full_name || entered?.email || "-";
        const perfLabel = assignee || perf?.full_name || perf?.email || "-";
        const matterLabel = clean(x.matter) || `${clean(x.fee_code)} ${clean(x.task_category)}`.trim() || "-";
        const override = clean(x.override_reason);

        const canComplete = isAdmin && x.status === "billed";
        const canBill = (isAdmin || isAccountant) && x.status === "approved";
        const canApprove = (isAdmin || isAccountant) && (x.status === "pending" || expiredDraft);

        return `
          <tr data-id="${x.id}" data-expired="${expiredDraft ? "1" : "0"}">
            <td>
              <div><strong>${escapeHtml(acc?.title || "Account")}</strong></div>
              <div class="muted">${escapeHtml(acc?.category || "-")}</div>
            </td>
            <td>
              <div><strong>${escapeHtml(matterLabel)}</strong></div>
              <div class="muted approvals-desc" title="${escapeHtml(clean(x.description))}">${escapeHtml(truncate(x.description, 120))}</div>
              <details class="approvals-details">
                <summary>Details</summary>
                <div class="muted">Category: ${escapeHtml(x.task_category || "-")} | Fee: ${escapeHtml(x.fee_code || "-")}</div>
                <div class="muted">Created: ${escapeHtml(x.created_at ? new Date(x.created_at).toLocaleString() : "-")}</div>
                ${override ? `<div class="muted">Override: ${escapeHtml(override)}</div>` : ""}
                <div class="muted">${escapeHtml(clean(x.description) || "-")}</div>
              </details>
            </td>
            <td><span class="status-pill ${statusClass(effectiveStatus)}">${escapeHtml(effectiveStatus || "-")}</span></td>
            <td><strong>P${peso(x.amount)}</strong></td>
            <td>
              <div class="muted">Entered: ${escapeHtml(enteredLabel)}</div>
              <div class="muted">Performed: ${escapeHtml(perfLabel)}</div>
            </td>
            <td>
              <div class="actions approvals-actions">
                ${canApprove ? `<button class="btn approve">Approve</button>` : ""}
                ${canApprove ? `<button class="btn reject">Reject</button>` : ""}
                ${canBill ? `<button class="btn bill">Mark Billed</button>` : ""}
                ${canComplete ? `<button class="btn complete">Complete</button>` : ""}
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    list.querySelectorAll(".approve").forEach((b) => {
      const tr = b.closest("tr");
      b.addEventListener("click", () => approve(tr?.dataset.id, tr?.dataset.expired === "1"));
    });
    list.querySelectorAll(".reject").forEach((b) => {
      const tr = b.closest("tr");
      b.addEventListener("click", () => reject(tr?.dataset.id, tr?.dataset.expired === "1"));
    });
    list.querySelectorAll(".bill").forEach((b) => {
      const tr = b.closest("tr");
      b.addEventListener("click", () => bill(tr?.dataset.id));
    });
    list.querySelectorAll(".complete").forEach((b) => {
      const tr = b.closest("tr");
      b.addEventListener("click", () => complete(tr?.dataset.id));
    });
  }

  async function load() {
    msg.textContent = "Loading...";
    list.innerHTML = `<tr><td colspan="6" class="muted">Loading...</td></tr>`;

    const nowIso = new Date().toISOString();
    let query = supabase
      .from("activities")
      .select("id,account_id,matter,fee_code,task_category,description,amount,minutes,status,created_by,performed_by,created_at,submitted_at,draft_expires_at,override_reason");

    const view = viewSel.value;
    if (view === "pending") {
      query = query.or(`status.eq.pending,and(status.eq.draft,draft_expires_at.lte.${nowIso})`);
    } else if (view === "approved") {
      query = query.eq("status", "approved");
    } else if (view === "billed") {
      query = query.eq("status", "billed");
    }

    query = query.order("created_at", { ascending: false }).limit(200);
    const { data, error } = await query;
    if (error) {
      msg.textContent = `Error: ${error.message}`;
      return;
    }

    allRows = data || [];
    const accountIds = Array.from(new Set(allRows.map((x) => x.account_id).filter(Boolean)));
    const userIds = Array.from(new Set(allRows.flatMap((x) => [x.created_by, x.performed_by]).filter(Boolean)));

    const [accRes, profRes] = await Promise.all([
      accountIds.length
        ? supabase.from("accounts").select("id,title,category").in("id", accountIds)
        : Promise.resolve({ data: [] }),
      userIds.length
        ? supabase.from("profiles").select("id,full_name,email").in("id", userIds)
        : Promise.resolve({ data: [] }),
    ]);

    if (accRes.error) {
      msg.textContent = `Error loading accounts: ${accRes.error.message}`;
      return;
    }
    if (profRes.error) {
      msg.textContent = `Error loading users: ${profRes.error.message}`;
      return;
    }

    accById = new Map((accRes.data || []).map((a) => [a.id, a]));
    profById = new Map((profRes.data || []).map((p) => [p.id, p]));

    populateAccountOptions();
    renderRows();
    msg.textContent = "";
  }

  async function promoteIfExpired(id, wasExpired) {
    if (!id || !wasExpired) return;
    await supabase.from("activities").update({
      status: "pending",
      submitted_at: new Date().toISOString(),
    }).eq("id", id);
  }

  async function approve(id, wasExpired) {
    if (!id) return;
    msg.textContent = "Updating...";
    await promoteIfExpired(id, wasExpired);

    const { error } = await supabase.from("activities").update({
      status: "approved",
      approved_by: ctx.user.id,
      approved_at: new Date().toISOString(),
    }).eq("id", id);

    msg.textContent = error ? `Error: ${error.message}` : "Approved.";
    await load();
  }

  async function reject(id, wasExpired) {
    if (!id) return;
    const reason = await uiPrompt({
      title: "Reject Activity",
      message: "Reject reason is required.",
      label: "Reason",
      required: true,
      confirmText: "Reject",
      danger: true,
    });
    if (!reason || !reason.trim()) return;

    msg.textContent = "Updating...";
    await promoteIfExpired(id, wasExpired);

    const { error } = await supabase.from("activities").update({
      status: "rejected",
      rejected_by: ctx.user.id,
      rejected_at: new Date().toISOString(),
      rejected_reason: reason.trim(),
    }).eq("id", id);

    msg.textContent = error ? `Error: ${error.message}` : "Rejected.";
    await load();
  }

  async function bill(id) {
    if (!id) return;
    msg.textContent = "Updating...";
    const { error } = await supabase.from("activities").update({
      status: "billed",
      billed_by: ctx.user.id,
      billed_at: new Date().toISOString(),
    }).eq("id", id);

    msg.textContent = error ? `Error: ${error.message}` : "Marked billed.";
    await load();
  }

  async function complete(id) {
    if (!isAdmin || !id) return;
    msg.textContent = "Updating...";
    const { error } = await supabase.from("activities").update({
      status: "completed",
      completed_by: ctx.user.id,
      completed_at: new Date().toISOString(),
    }).eq("id", id);

    msg.textContent = error ? `Error: ${error.message}` : "Completed.";
    await load();
  }

  viewSel.addEventListener("change", load);
  reloadBtn.addEventListener("click", load);
  qInput.addEventListener("input", renderRows);
  accountSel.addEventListener("change", renderRows);

  await load();
}
