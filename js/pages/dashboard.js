import { supabase } from "../supabaseClient.js";
import { escapeHtml } from "../ui/escapeHtml.js";

function asPeso(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function statusPillClass(status) {
  if (status === "approved") return "status-pill approved";
  if (status === "pending") return "status-pill pending";
  if (status === "billed" || status === "completed") return "status-pill completed";
  if (status === "rejected") return "status-pill rejected";
  return "status-pill";
}

function startOfWeekIso(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = utc.getUTCDay();
  const diffToMonday = day === 0 ? -6 : (1 - day);
  utc.setUTCDate(utc.getUTCDate() + diffToMonday);
  return utc.toISOString().slice(0, 10);
}

function addUtcDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtShortDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function isOpexActivity(row) {
  const task = String(row?.task_category || "").trim().toLowerCase();
  const entry = String(row?.entry_class || "").trim().toLowerCase();
  return entry === "opex"
    || ["notary_fee", "ope_printing", "ope_envelope", "ope_lbc", "ope_transpo", "ope_manhours"].includes(task);
}

function buildWeeklyDeck(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const occurredAt = row?.occurred_at || row?.created_at;
    const weekStart = startOfWeekIso(occurredAt);
    if (!weekStart) continue;
    if (!grouped.has(weekStart)) {
      grouped.set(weekStart, {
        week_start: weekStart,
        week_end: addUtcDays(weekStart, 6),
        entries: 0,
        pending: 0,
        draft: 0,
        total_amount: 0,
        opex_total: 0,
      });
    }
    const bucket = grouped.get(weekStart);
    bucket.entries += 1;
    const status = String(row?.status || "").trim().toLowerCase();
    if (status === "pending") bucket.pending += 1;
    if (status === "draft") bucket.draft += 1;
    bucket.total_amount += Number(row?.amount || 0);
    if (isOpexActivity(row)) bucket.opex_total += Number(row?.amount || 0);
  }
  return Array.from(grouped.values())
    .sort((a, b) => String(b.week_start).localeCompare(String(a.week_start)))
    .slice(0, 8);
}

function extractRetainerAssignee(taskCategory, description) {
  const task = String(taskCategory || "").toLowerCase();
  if (!task.startsWith("retainer_")) return "";
  const match = String(description || "").match(/Assignee:\s*([^|]+)/i);
  const value = String(match?.[1] || "").trim();
  if (!value || /^(-|n\/a|na)$/i.test(value)) return "";
  return value;
}

export async function renderDashboard(appEl, ctx, navigate) {
  appEl.innerHTML = `
    <section class="page-head">
      <div>
        <h1 class="page-title">Today Timeline</h1>
        <p class="page-sub">${new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
      </div>
      <div class="page-actions">
        <button id="goActivities" class="btn btn-primary">+ Log Activity</button>
      </div>
    </section>

    <section class="layout-2col">
      <div class="list" id="timelineList"></div>
      <aside class="panel" id="summaryPanel"></aside>
    </section>

    <section class="card today-weekly-shell">
      <div class="today-weekly-head">
        <h3>Weekly Summary Tracker</h3>
        <div class="muted">Integrated from activity entries (latest 8 weeks)</div>
      </div>
      <div id="weeklySummaryDeck" class="today-weekly-grid"></div>
    </section>
  `;

  appEl.querySelector("#goActivities").addEventListener("click", () => navigate("#/activities"));

  const listEl = appEl.querySelector("#timelineList");
  const summaryEl = appEl.querySelector("#summaryPanel");
  const weeklyEl = appEl.querySelector("#weeklySummaryDeck");
  listEl.innerHTML = `<div class="row"><span class="muted">Loading timeline...</span></div>`;
  summaryEl.innerHTML = `<div class="muted">Loading summary...</div>`;
  weeklyEl.innerHTML = `<div class="muted">Loading weekly summary...</div>`;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(todayStart.getDate() + 1);

  const { data: activities, error } = await supabase
    .from("activities")
    .select("id,account_id,task_category,fee_code,description,amount,minutes,status,created_by,performed_by,occurred_at,created_at")
    .gte("occurred_at", todayStart.toISOString())
    .lt("occurred_at", tomorrowStart.toISOString())
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    listEl.innerHTML = `<div class="row"><span class="msg">Error: ${error.message}</span></div>`;
    summaryEl.innerHTML = `<div class="muted">No summary available.</div>`;
    weeklyEl.innerHTML = `<div class="muted">No weekly summary available.</div>`;
    return;
  }

  const accountIds = Array.from(new Set((activities || []).map((x) => x.account_id).filter(Boolean)));
  const userIds = Array.from(new Set((activities || []).flatMap((x) => [x.created_by, x.performed_by]).filter(Boolean)));

  const [accountsRes, usersRes] = await Promise.all([
    accountIds.length
      ? supabase.from("accounts").select("id,title").in("id", accountIds)
      : Promise.resolve({ data: [] }),
    userIds.length
      ? supabase.from("profiles").select("id,full_name,email").in("id", userIds)
      : Promise.resolve({ data: [] }),
  ]);

  const accountById = new Map((accountsRes.data || []).map((a) => [a.id, a]));
  const userById = new Map((usersRes.data || []).map((u) => [u.id, u]));

  const rows = activities || [];
  if (!rows.length) {
    listEl.innerHTML = `<div class="row"><span class="muted">No activity logged yet for today.</span></div>`;
  } else {
    listEl.innerHTML = rows.map((x) => {
      const accountTitle = accountById.get(x.account_id)?.title || "Account";
      const by = userById.get(x.performed_by || x.created_by);
      const assignee = extractRetainerAssignee(x.task_category, x.description);
      const byName = assignee || (by ? (by.full_name || by.email || "-") : "-");
      const mins = x.minutes ? `${x.minutes}m` : "-";
      const when = x.occurred_at ? new Date(x.occurred_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

      return `
        <article class="row">
          <div style="flex:1">
            <div><strong>${escapeHtml(accountTitle)}</strong></div>
            <div class="muted">${escapeHtml(x.task_category || "")}</div>
            <div>${escapeHtml(x.description || "")}</div>
            <div class="muted">${escapeHtml(when)} | ${escapeHtml(mins)} | ${escapeHtml(byName)}</div>
            <div style="margin-top:6px"><span class="${statusPillClass(x.status)}">${escapeHtml(x.status || "draft")}</span></div>
          </div>
          <div style="min-width:110px;text-align:right;font-weight:700;color:#4d7093">P${asPeso(x.amount)}</div>
        </article>
      `;
    }).join("");
  }

  const totalAmount = rows.reduce((sum, x) => sum + Number(x.amount || 0), 0);
  const billableToday = rows.filter((x) => x.status === "approved" || x.status === "billed" || x.status === "completed");
  const unbilledCount = rows.filter((x) => x.status !== "billed" && x.status !== "completed").length;

  summaryEl.innerHTML = `
    <h3 style="margin:2px 0 10px">Value Summary</h3>
    <div class="kpi-label">Activities Today</div>
    <div class="kpi-value">${rows.length}</div>

    <div style="height:8px"></div>
    <div class="kpi-label">Billable Today</div>
    <div class="kpi-value" style="font-size:34px;color:#4d7093">P${asPeso(totalAmount)}</div>

    <div style="height:8px"></div>
    <div class="kpi-label">Approved/Billed Rows</div>
    <div class="kpi-value" style="font-size:30px">${billableToday.length}</div>

    <div style="height:8px"></div>
    <div class="kpi-label">Unbilled Activities</div>
    <div class="kpi-value" style="font-size:30px;color:#df7a00">${unbilledCount}</div>
  `;

  const weekRangeStart = new Date(todayStart);
  weekRangeStart.setDate(weekRangeStart.getDate() - 56);
  const { data: weeklyRows, error: weeklyErr } = await supabase
    .from("activities")
    .select("id,task_category,entry_class,status,amount,occurred_at,created_at")
    .gte("occurred_at", weekRangeStart.toISOString())
    .lt("occurred_at", tomorrowStart.toISOString())
    .order("occurred_at", { ascending: false })
    .limit(10000);

  if (weeklyErr) {
    weeklyEl.innerHTML = `<div class="muted">Failed to load weekly summary.</div>`;
    return;
  }

  const deck = buildWeeklyDeck(weeklyRows || []);
  if (!deck.length) {
    weeklyEl.innerHTML = `<div class="muted">No entries in the last 8 weeks.</div>`;
    return;
  }

  weeklyEl.innerHTML = deck.map((w) => `
    <article class="today-week-card">
      <div class="today-week-range">${escapeHtml(fmtShortDate(w.week_start))} - ${escapeHtml(fmtShortDate(w.week_end))}</div>
      <div class="today-week-meta">
        <span>${w.entries} entries</span>
        <span>pending ${w.pending}</span>
        <span>draft ${w.draft}</span>
      </div>
      <div class="today-week-amount">Total: P${escapeHtml(asPeso(w.total_amount))}</div>
      <div class="today-week-opex">OPEX: P${escapeHtml(asPeso(w.opex_total))}</div>
    </article>
  `).join("");
}
