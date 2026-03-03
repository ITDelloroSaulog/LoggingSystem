import { supabase } from "../supabaseClient.js";
import { escapeHtml } from "../ui/escapeHtml.js";
import { SUPER_ADMIN_ROLES } from "../router.js";
import { navigate } from "../router.js";

export async function renderAccountDetail(appEl, ctx, accountId) {
  appEl.innerHTML = `
    <section class="page-head">
      <div>
        <h1 class="page-title">Account Detail</h1>
        <p class="page-sub">View account information, matters, and recent activities.</p>
      </div>
      <button id="backBtn" class="btn">&larr; Back to Accounts</button>
    </section>

    <section class="card" style="margin-bottom:12px">
      <div id="info"></div>
      <div id="adminAssign"></div>
    </section>

    <section class="card" style="margin-bottom:12px">
      <h3 style="margin-top:2px">Matters</h3>
      <div id="matters"></div>
    </section>

    <section class="card" style="margin-bottom:12px">
      <h3 style="margin-top:2px">Recent Activities</h3>
      <div id="acts"></div>
    </section>

    <p id="msg" class="msg"></p>
  `;

  const $ = (sel) => appEl.querySelector(sel);
  const info = $("#info");
  const adminAssign = $("#adminAssign");
  const mattersEl = $("#matters");
  const acts = $("#acts");
  const msg = $("#msg");
  const backBtn = $("#backBtn");

  backBtn.addEventListener("click", () => navigate("#/accounts"));

  // Load account
  const { data: account, error: aErr } = await supabase
    .from("accounts")
    .select("id,title,category,account_kind,is_archived,status,created_at")
    .eq("id", accountId)
    .single();

  if (aErr || !account) {
    info.innerHTML = `<p class="msg">Account not found or no access.</p>`;
    return;
  }

  const createdDate = account.created_at
    ? new Date(account.created_at).toLocaleDateString()
    : "-";

  info.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px">
      <h2 style="margin:0">${escapeHtml(account.title)}</h2>
      <span class="status-pill ${account.is_archived ? "rejected" : "approved"}">${escapeHtml(account.is_archived ? "Archived" : account.status || "Active")}</span>
    </div>
    <div class="kpi-grid" style="margin-bottom:12px">
      <article class="kpi-card">
        <div class="kpi-label">Category</div>
        <div class="kpi-value" style="font-size:18px">${escapeHtml(account.category || "-")}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Account Kind</div>
        <div class="kpi-value" style="font-size:18px">${escapeHtml(account.account_kind || "-")}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Created</div>
        <div class="kpi-value" style="font-size:18px">${escapeHtml(createdDate)}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">ID</div>
        <div class="kpi-value" style="font-size:12px;word-break:break-all">${escapeHtml(account.id)}</div>
      </article>
    </div>
  `;

  // Admin-only member assignment (by email search)
  if (SUPER_ADMIN_ROLES.includes(ctx.profile.role)) {
    adminAssign.innerHTML = `
      <hr/>
      <h3>Assign Member (Admin only)</h3>
      <form id="assignForm" class="stack">
        <label>Search staff email</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="searchEmail" placeholder="e.g., lawyer@firm.com" style="flex:1" />
          <button type="button" id="searchBtn" class="btn">Search</button>
        </div>
        <div id="results"></div>
      </form>
    `;

    const searchBtn = adminAssign.querySelector("#searchBtn");
    const searchEmail = adminAssign.querySelector("#searchEmail");
    const results = adminAssign.querySelector("#results");

    searchBtn.addEventListener("click", async () => {
      results.innerHTML = "Searching...";

      const q = searchEmail.value.trim();
      const { data, error } = await supabase
        .from("profiles")
        .select("id,email,full_name,role")
        .ilike("email", `%${q}%`)
        .limit(10);

      if (error) {
        results.innerHTML = `<p class="msg">Error: ${error.message}</p>`;
        return;
      }

      if (!data?.length) {
        results.innerHTML = `<p class="muted">No results.</p>`;
        return;
      }

      results.innerHTML = data
        .map(
          (p) => `
          <div class="row">
            <div>
              <div><strong>${escapeHtml(p.full_name ?? p.email)}</strong></div>
              <div class="muted">${escapeHtml(p.email)} - ${escapeHtml(p.role)}</div>
            </div>
            <button class="btn" data-id="${p.id}">Assign</button>
          </div>`
        )
        .join("");

      results.querySelectorAll("button[data-id]").forEach((b) => {
        b.addEventListener("click", async () => {
          msg.textContent = "Assigning...";
          const user_id = b.dataset.id;

          const { error: insErr } = await supabase.from("account_members").insert({
            account_id: accountId,
            user_id,
          });

          msg.textContent = insErr ? `Error: ${insErr.message}` : "Assigned.";
        });
      });
    });
  }

  // Load matters for this account
  mattersEl.innerHTML = `<p class="muted">Loading matters...</p>`;
  const { data: mattersData, error: matErr } = await supabase
    .from("matters")
    .select("id,title,matter_type,status,handling_lawyer_id,created_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (matErr) {
    mattersEl.innerHTML = `<p class="msg">Error loading matters: ${matErr.message}</p>`;
  } else if (!mattersData?.length) {
    mattersEl.innerHTML = `<p class="muted">No matters found for this account.</p>`;
  } else {
    mattersEl.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            ${mattersData.map((m) => `
              <tr>
                <td><strong>${escapeHtml(m.title || "-")}</strong></td>
                <td>${escapeHtml(m.matter_type || "-")}</td>
                <td><span class="status-pill">${escapeHtml(m.status || "-")}</span></td>
                <td>${m.created_at ? new Date(m.created_at).toLocaleDateString() : "-"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  // Load activities
  msg.textContent = "Loading activities...";
  const { data: activities, error: actErr } = await supabase
    .from("activities")
    .select("id,fee_code,task_category,description,amount,minutes,status,occurred_at,created_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (actErr) {
    msg.textContent = `Error: ${actErr.message}`;
    return;
  }

  msg.textContent = "";
  if (!activities?.length) {
    acts.innerHTML = `<p class="muted">No activities yet.</p>`;
    return;
  }

  // Calculate activity stats
  const totalAmount = activities.reduce((s, x) => s + Number(x.amount || 0), 0);
  const totalMinutes = activities.reduce((s, x) => s + Number(x.minutes || 0), 0);
  const approvedCount = activities.filter((x) => ["approved", "billed", "completed"].includes(x.status)).length;

  acts.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:12px">
      <article class="kpi-card">
        <div class="kpi-label">Activities</div>
        <div class="kpi-value">${activities.length}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Total Value</div>
        <div class="kpi-value">P${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Total Time</div>
        <div class="kpi-value">${(totalMinutes / 60).toFixed(1)}h</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Approved+</div>
        <div class="kpi-value" style="color:#118a4a">${approvedCount}</div>
      </article>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Fee Code</th>
            <th>Category</th>
            <th>Description</th>
            <th>Status</th>
            <th>Amount</th>
            <th>Time</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          ${activities.map((x) => `
            <tr>
              <td><strong>${escapeHtml(x.fee_code || "-")}</strong></td>
              <td>${escapeHtml(x.task_category || "-")}</td>
              <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(x.description || "")}">${escapeHtml(x.description || "-")}</td>
              <td><span class="status-pill">${escapeHtml(x.status || "-")}</span></td>
              <td>P${Number(x.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
              <td>${x.minutes ? `${x.minutes}m` : "-"}</td>
              <td>${x.occurred_at ? new Date(x.occurred_at).toLocaleDateString() : "-"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}
