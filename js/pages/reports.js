import { supabase } from "../supabaseClient.js";
import { escapeHtml } from "../ui/escapeHtml.js";

const STATUS_OPTIONS = ["all", "draft", "pending", "approved", "rejected", "billed", "completed"];
const LAWYER_BASIS_OPTIONS = [
  { value: "handling", label: "Handling Lawyer" },
  { value: "performed", label: "Performed By" },
  { value: "entered", label: "Entered By" },
];
const UNASSIGNED_FILTER = "__UNASSIGNED__";

function asPeso(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function toCsvCell(value) {
  const raw = String(value ?? "");
  return `"${raw.replaceAll('"', '""')}"`;
}

function toIsoStart(dateValue) {
  return new Date(`${dateValue}T00:00:00`).toISOString();
}

function toIsoEnd(dateValue) {
  return new Date(`${dateValue}T23:59:59.999`).toISOString();
}

function normalizeChart(value, max) {
  if (!max) return 14;
  return Math.max(14, Math.round((value / max) * 180));
}

function clean(v) {
  return String(v || "").trim();
}

function extractRetainerAssignee(taskCategory, description) {
  const task = clean(taskCategory).toLowerCase();
  if (!task.startsWith("retainer_")) return "";
  const match = String(description || "").match(/Assignee:\s*([^|]+)/i);
  const value = clean(match?.[1] || "");
  if (!value || /^(-|n\/a|na)$/i.test(value)) return "";
  return value;
}

function assigneeKey(name) {
  return `assignee:${clean(name).toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

function lawyerBasisLabelForValue(value) {
  return LAWYER_BASIS_OPTIONS.find((x) => x.value === value)?.label || "Lawyer";
}

function actorIdForBasis(row, basis) {
  if (basis === "entered") return row.entered_by_id || "";
  if (basis === "performed") return row.performed_by_id || "";
  return row.handling_lawyer_id || "";
}

function actorLabelForBasis(row, basis) {
  if (basis === "entered") return row.entered_by_name || "Unassigned";
  if (basis === "performed") return row.performed_by_name || "Unassigned";
  return row.handling_lawyer_name || "Unassigned";
}

function matterIdentifierLabel(matter) {
  if (!matter) return "";
  const type = clean(matter.matter_type).toLowerCase();
  if (type === "litigation") return clean(matter.official_case_no);
  if (type === "special_project") return clean(matter.special_engagement_code);
  if (type === "retainer") {
    const ref = clean(matter.retainer_contract_ref);
    const period = clean(matter.retainer_period_yyyymm);
    return ref && period ? `${ref}-${period}` : ref;
  }
  return "";
}

function buildCsv(rows, basis) {
  const basisLabel = lawyerBasisLabelForValue(basis);
  const headers = [
    "Occurred On",
    "Status",
    "Account",
    "Matter Type",
    "Identifier",
    "Matter",
    "Task Category",
    "Fee Code",
    "Description",
    "Amount",
    "Billable",
    "Minutes",
    "Entered By",
    "Performed By",
    "Handling Lawyer",
    basisLabel,
  ];

  const body = rows.map((r) => [
    r.occurred_on,
    r.status,
    r.account_title,
    r.matter_type,
    r.matter_identifier,
    r.matter,
    r.task_category,
    r.fee_code,
    r.description,
    r.amount,
    r.billable ? "yes" : "no",
    r.minutes ?? "",
    r.entered_by_name,
    r.performed_by_name,
    r.handling_lawyer_name,
    actorLabelForBasis(r, basis),
  ]);

  return [headers, ...body].map((row) => row.map(toCsvCell).join(",")).join("\n");
}

export async function renderReports(appEl) {
  appEl.innerHTML = `
    <section class="page-head">
      <div>
        <h1 class="page-title">Reports</h1>
        <p class="page-sub">Activity and revenue insights</p>
      </div>
      <div class="actions">
        <button id="csvBtn" class="btn">Export CSV</button>
        <button id="printBtn" class="btn">Print Summary</button>
      </div>
    </section>

    <section class="card" style="margin-bottom:12px">
      <div class="toolbar">
        <input id="from" type="date" />
        <input id="to" type="date" />
        <select id="status">
          ${STATUS_OPTIONS.map((s) => `<option value="${s}">${s}</option>`).join("")}
        </select>
        <button id="runBtn" class="btn btn-primary" type="button">Run Report</button>
      </div>
      <div class="toolbar" style="margin-top:10px">
        <select id="matterTypeFilter">
          <option value="">All Matter Types</option>
          <option value="litigation">Litigation</option>
          <option value="special_project">Special Project</option>
          <option value="retainer">Retainer</option>
        </select>
        <input id="identifierFilter" placeholder="Filter by identifier..." />
        <select id="lawyerBasis">
          ${LAWYER_BASIS_OPTIONS.map((x) => `<option value="${x.value}">${x.label}</option>`).join("")}
        </select>
        <select id="lawyerFilter">
          <option value="">All Lawyers</option>
        </select>
        <input id="textFilter" placeholder="Search client, matter, category..." />
        <button id="clearFiltersBtn" class="btn" type="button">Clear Filters</button>
      </div>
    </section>

    <p id="msg" class="msg"></p>

    <section id="summaryCards" class="kpi-grid"></section>

    <section class="grid2" style="margin-bottom:12px">
      <article class="card">
        <h3 id="lawyerChartTitle" style="margin:2px 0 10px">Revenue by Handling Lawyer</h3>
        <div id="lawyerChart" class="chart-box"></div>
      </article>
      <article class="card">
        <h3 style="margin:2px 0 10px">Revenue by Activity Type</h3>
        <div id="typePie" class="pie"></div>
        <div id="typeLegend" class="muted" style="font-size:13px"></div>
      </article>
    </section>

    <section class="grid2" style="margin-bottom:12px">
      <section class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Count</th>
              <th>Total Value</th>
            </tr>
          </thead>
          <tbody id="statusBreakdown"></tbody>
        </table>
      </section>
      <section class="table-wrap">
        <table>
          <thead>
            <tr>
              <th id="lawyerBreakdownHead">Handling Lawyer</th>
              <th>Activities</th>
              <th>Total Value</th>
              <th>Hours</th>
              <th>Approved Value</th>
            </tr>
          </thead>
          <tbody id="lawyerBreakdown"></tbody>
        </table>
      </section>
    </section>

    <section class="card" style="margin-bottom:12px">
      <h3 style="margin:2px 0 10px">Acquisition Metrics (Prospects)</h3>
      <div id="acqKpis" class="kpi-grid"></div>
      <div class="grid2" style="margin-top:10px">
        <section class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Prospect</th>
                <th>Stage</th>
                <th>Assigned Lawyer</th>
                <th>Pre-Acquisition Spend</th>
              </tr>
            </thead>
            <tbody id="acqProspectTable"></tbody>
          </table>
        </section>
        <section class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lawyer</th>
                <th>Prospects</th>
                <th>Total Spend</th>
              </tr>
            </thead>
            <tbody id="acqLawyerTable"></tbody>
          </table>
        </section>
      </div>
    </section>
  `;

  const $ = (s) => appEl.querySelector(s);
  const fromInput = $("#from");
  const toInput = $("#to");
  const statusSel = $("#status");
  const matterTypeFilterSel = $("#matterTypeFilter");
  const identifierFilterInput = $("#identifierFilter");
  const lawyerBasisSel = $("#lawyerBasis");
  const lawyerFilterSel = $("#lawyerFilter");
  const textFilterInput = $("#textFilter");
  const clearFiltersBtn = $("#clearFiltersBtn");
  const runBtn = $("#runBtn");
  const csvBtn = $("#csvBtn");
  const printBtn = $("#printBtn");
  const msg = $("#msg");
  const summaryCards = $("#summaryCards");
  const lawyerChartTitle = $("#lawyerChartTitle");
  const lawyerChart = $("#lawyerChart");
  const typeLegend = $("#typeLegend");
  const statusBreakdown = $("#statusBreakdown");
  const lawyerBreakdownHead = $("#lawyerBreakdownHead");
  const lawyerBreakdown = $("#lawyerBreakdown");
  const acqKpis = $("#acqKpis");
  const acqProspectTable = $("#acqProspectTable");
  const acqLawyerTable = $("#acqLawyerTable");

  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  fromInput.value = firstDay.toISOString().slice(0, 10);
  toInput.value = now.toISOString().slice(0, 10);
  statusSel.value = "all";
  lawyerBasisSel.value = "handling";

  let reportRows = [];
  let visibleRows = [];

  function renderSummaries(rows, basis) {
    const totalRevenue = rows.reduce((sum, x) => sum + Number(x.amount || 0), 0);
    const approvedRevenue = rows
      .filter((x) => x.status === "approved" || x.status === "billed" || x.status === "completed")
      .reduce((sum, x) => sum + Number(x.amount || 0), 0);
    const totalHours = rows.reduce((sum, x) => sum + Number(x.minutes || 0), 0) / 60;
    const activeLawyers = new Set(rows.map((x) => actorIdForBasis(x, basis)).filter(Boolean)).size;
    const basisLabel = lawyerBasisLabelForValue(basis);

    summaryCards.innerHTML = `
      <article class="kpi-card">
        <div class="kpi-label">Total Revenue</div>
        <div class="kpi-value">P${asPeso(totalRevenue)}</div>
        <div class="kpi-note">All activities in current filters</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Approved Revenue</div>
        <div class="kpi-value" style="color:#4d7093">P${asPeso(approvedRevenue)}</div>
        <div class="kpi-note">${rows.length ? Math.round((approvedRevenue / (totalRevenue || 1)) * 100) : 0}% of total</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Total Hours</div>
        <div class="kpi-value">${totalHours.toFixed(1)}</div>
        <div class="kpi-note">Time logged</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Active ${escapeHtml(basisLabel)}</div>
        <div class="kpi-value">${activeLawyers}</div>
        <div class="kpi-note">Distinct people in selected basis</div>
      </article>
    `;
  }

  function renderLawyerChart(rows, basis) {
    const basisLabel = lawyerBasisLabelForValue(basis);
    lawyerChartTitle.textContent = `Revenue by ${basisLabel}`;
    lawyerBreakdownHead.textContent = basisLabel;

    const sums = new Map();
    rows.forEach((r) => {
      const key = actorLabelForBasis(r, basis) || "Unassigned";
      sums.set(key, (sums.get(key) || 0) + Number(r.amount || 0));
    });

    const entries = Array.from(sums.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const max = entries.length ? entries[0][1] : 0;
    if (!entries.length) {
      lawyerChart.innerHTML = `<span class="muted">No data for chart.</span>`;
      return;
    }

    lawyerChart.innerHTML = entries.map(([name, value]) => `
      <div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:6px">
        <div class="bar" style="height:${normalizeChart(value, max)}px"></div>
        <div class="muted" style="font-size:12px;text-align:center">${escapeHtml(name)}</div>
      </div>
    `).join("");
  }

  function renderTypeLegend(rows) {
    const typeMap = new Map();
    rows.forEach((r) => {
      const key = r.task_category || "Other";
      typeMap.set(key, (typeMap.get(key) || 0) + Number(r.amount || 0));
    });
    const items = Array.from(typeMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

    if (!items.length) {
      typeLegend.innerHTML = "No activity type data.";
      return;
    }

    typeLegend.innerHTML = items
      .map(([name, value]) => `<div>${escapeHtml(name)}: <strong>P${asPeso(value)}</strong></div>`)
      .join("");
  }

  function renderStatusBreakdown(rows) {
    const statusMap = new Map();
    rows.forEach((r) => {
      const key = r.status || "draft";
      if (!statusMap.has(key)) statusMap.set(key, { count: 0, amount: 0 });
      const curr = statusMap.get(key);
      curr.count += 1;
      curr.amount += Number(r.amount || 0);
    });

    const entries = Array.from(statusMap.entries()).sort((a, b) => b[1].amount - a[1].amount);
    if (!entries.length) {
      statusBreakdown.innerHTML = `<tr><td colspan="3" class="muted">No rows found.</td></tr>`;
      return;
    }

    statusBreakdown.innerHTML = entries.map(([status, stat]) => `
      <tr>
        <td><span class="status-pill">${escapeHtml(status)}</span></td>
        <td>${stat.count}</td>
        <td><strong>P${asPeso(stat.amount)}</strong></td>
      </tr>
    `).join("");
  }

  function renderLawyerBreakdown(rows, basis) {
    const byLawyer = new Map();
    rows.forEach((r) => {
      const id = actorIdForBasis(r, basis);
      const label = actorLabelForBasis(r, basis) || "Unassigned";
      const key = id || `${UNASSIGNED_FILTER}:${label}`;
      if (!byLawyer.has(key)) {
        byLawyer.set(key, {
          label,
          count: 0,
          amount: 0,
          minutes: 0,
          approvedAmount: 0,
        });
      }
      const curr = byLawyer.get(key);
      curr.count += 1;
      curr.amount += Number(r.amount || 0);
      curr.minutes += Number(r.minutes || 0);
      if (["approved", "billed", "completed"].includes(clean(r.status).toLowerCase())) {
        curr.approvedAmount += Number(r.amount || 0);
      }
    });

    const entries = Array.from(byLawyer.values()).sort((a, b) => b.amount - a.amount);
    if (!entries.length) {
      lawyerBreakdown.innerHTML = `<tr><td colspan="5" class="muted">No rows found.</td></tr>`;
      return;
    }

    lawyerBreakdown.innerHTML = entries.map((x) => `
      <tr>
        <td>${escapeHtml(x.label)}</td>
        <td>${x.count}</td>
        <td><strong>P${asPeso(x.amount)}</strong></td>
        <td>${(x.minutes / 60).toFixed(1)}</td>
        <td>P${asPeso(x.approvedAmount)}</td>
      </tr>
    `).join("");
  }

  function populateLawyerFilter(rows, basis, preserveSelection = true) {
    const basisLabel = lawyerBasisLabelForValue(basis);
    const current = preserveSelection ? lawyerFilterSel.value : "";
    const map = new Map();
    let hasUnassigned = false;

    for (const row of rows) {
      const id = actorIdForBasis(row, basis);
      const label = actorLabelForBasis(row, basis) || "Unassigned";
      if (!id) {
        hasUnassigned = true;
        continue;
      }
      if (!map.has(id)) map.set(id, label);
    }

    const options = Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, label]) => `<option value="${id}">${escapeHtml(label)}</option>`);

    lawyerFilterSel.innerHTML = [
      `<option value="">All ${escapeHtml(basisLabel)}</option>`,
      hasUnassigned ? `<option value="${UNASSIGNED_FILTER}">Unassigned</option>` : "",
      ...options,
    ].join("");

    const keepCurrent =
      !!current &&
      ((current === UNASSIGNED_FILTER && hasUnassigned) || map.has(current));

    lawyerFilterSel.value = keepCurrent ? current : "";
  }

  function getFilteredRows() {
    const basis = lawyerBasisSel.value;
    const actorFilter = lawyerFilterSel.value;
    const matterType = clean(matterTypeFilterSel.value).toLowerCase();
    const identifierText = clean(identifierFilterInput.value).toLowerCase();
    const q = clean(textFilterInput.value).toLowerCase();

    return reportRows.filter((r) => {
      const actorId = actorIdForBasis(r, basis);

      if (actorFilter === UNASSIGNED_FILTER && actorId) return false;
      if (actorFilter && actorFilter !== UNASSIGNED_FILTER && actorId !== actorFilter) return false;
      if (matterType && clean(r.matter_type).toLowerCase() !== matterType) return false;
      if (identifierText && !clean(r.matter_identifier).toLowerCase().includes(identifierText)) return false;

      if (!q) return true;
      const hay = [
        r.account_title,
        r.matter,
        r.matter_type,
        r.matter_identifier,
        r.description,
        r.task_category,
        r.fee_code,
        r.entered_by_name,
        r.performed_by_name,
        r.handling_lawyer_name,
        actorLabelForBasis(r, basis),
        r.status,
      ]
        .map((x) => clean(x).toLowerCase())
        .join(" ");

      return hay.includes(q);
    });
  }

  function renderCurrentView() {
    const basis = lawyerBasisSel.value;
    visibleRows = getFilteredRows();
    renderSummaries(visibleRows, basis);
    renderLawyerChart(visibleRows, basis);
    renderTypeLegend(visibleRows);
    renderStatusBreakdown(visibleRows);
    renderLawyerBreakdown(visibleRows, basis);
  }

  async function loadAcquisitionReport() {
    const from = fromInput.value;
    const to = toInput.value;
    const fromIso = from || null;
    const toIso = to || null;

    const [{ data: metricRows, error: metricErr }, prosRes] = await Promise.all([
      supabase.rpc("get_acquisition_metrics", {
        p_date_from: fromIso,
        p_date_to: toIso,
        p_lawyer_id: null,
      }),
      supabase
        .from("prospects")
        .select("id,prospect_name,stage,assigned_lawyer_id,opened_at,acquired_at")
        .order("opened_at", { ascending: false })
        .limit(3000),
    ]);

    if (metricErr) {
      acqKpis.innerHTML = `<article class="kpi-card"><div class="kpi-label">Acquisition Metrics</div><div class="kpi-note">${escapeHtml(metricErr.message)}</div></article>`;
      acqProspectTable.innerHTML = `<tr><td colspan="4" class="muted">Unable to load acquisition rows.</td></tr>`;
      acqLawyerTable.innerHTML = `<tr><td colspan="3" class="muted">Unable to load acquisition rows.</td></tr>`;
      return;
    }
    if (prosRes.error) {
      acqProspectTable.innerHTML = `<tr><td colspan="4" class="muted">${escapeHtml(prosRes.error.message)}</td></tr>`;
      acqLawyerTable.innerHTML = `<tr><td colspan="3" class="muted">${escapeHtml(prosRes.error.message)}</td></tr>`;
      return;
    }

    const metric = Array.isArray(metricRows) && metricRows.length ? metricRows[0] : {
      total_leads: 0,
      converted: 0,
      conversion_rate: 0,
      avg_acquisition_cost: 0,
      median_touchpoints: 0,
      avg_days_to_close: 0,
    };

    acqKpis.innerHTML = `
      <article class="kpi-card">
        <div class="kpi-label">Total Leads</div>
        <div class="kpi-value">${Number(metric.total_leads || 0)}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Converted</div>
        <div class="kpi-value">${Number(metric.converted || 0)}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Conversion Rate</div>
        <div class="kpi-value">${Number(metric.conversion_rate || 0).toFixed(2)}%</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Avg Acquisition Cost</div>
        <div class="kpi-value">P${asPeso(metric.avg_acquisition_cost || 0)}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Median Touchpoints</div>
        <div class="kpi-value">${Number(metric.median_touchpoints || 0).toFixed(2)}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Avg Days to Close</div>
        <div class="kpi-value">${Number(metric.avg_days_to_close || 0).toFixed(2)}</div>
      </article>
    `;

    const prospects = prosRes.data || [];
    const prospectIds = prospects.map((p) => p.id);
    const lawyerIds = Array.from(new Set(prospects.map((p) => p.assigned_lawyer_id).filter(Boolean)));

    const [costRes, lawyerRes] = await Promise.all([
      prospectIds.length
        ? supabase
            .from("prospect_cost_entries")
            .select("prospect_id,occurred_at,amount")
            .in("prospect_id", prospectIds)
        : Promise.resolve({ data: [], error: null }),
      lawyerIds.length
        ? supabase.from("profiles").select("id,full_name,email").in("id", lawyerIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (costRes.error || lawyerRes.error) {
      const text = costRes.error?.message || lawyerRes.error?.message || "Acquisition detail load failed.";
      acqProspectTable.innerHTML = `<tr><td colspan="4" class="muted">${escapeHtml(text)}</td></tr>`;
      acqLawyerTable.innerHTML = `<tr><td colspan="3" class="muted">${escapeHtml(text)}</td></tr>`;
      return;
    }

    const lawyerById = new Map((lawyerRes.data || []).map((x) => [x.id, x]));
    const costsByProspect = new Map();
    for (const c of costRes.data || []) {
      if (!costsByProspect.has(c.prospect_id)) costsByProspect.set(c.prospect_id, []);
      costsByProspect.get(c.prospect_id).push(c);
    }

    const detailed = prospects.map((p) => {
      const costRows = costsByProspect.get(p.id) || [];
      const cutoff = p.acquired_at ? new Date(p.acquired_at).getTime() : Number.POSITIVE_INFINITY;
      const spend = costRows
        .filter((c) => {
          const ts = new Date(c.occurred_at).getTime();
          return Number.isFinite(ts) && ts <= cutoff;
        })
        .reduce((s, c) => s + Number(c.amount || 0), 0);
      return { ...p, spend };
    });

    acqProspectTable.innerHTML = detailed.length
      ? detailed
          .slice(0, 50)
          .map((p) => {
            const lawyer = lawyerById.get(p.assigned_lawyer_id);
            const lawyerName = lawyer ? (lawyer.full_name || lawyer.email || lawyer.id) : "Unassigned";
            return `
              <tr>
                <td>${escapeHtml(p.prospect_name || "-")}</td>
                <td>${escapeHtml(p.stage || "-")}</td>
                <td>${escapeHtml(lawyerName)}</td>
                <td><strong>P${asPeso(p.spend)}</strong></td>
              </tr>
            `;
          })
          .join("")
      : `<tr><td colspan="4" class="muted">No prospect rows found.</td></tr>`;

    const byLawyer = new Map();
    for (const p of detailed) {
      const key = p.assigned_lawyer_id || UNASSIGNED_FILTER;
      const label = p.assigned_lawyer_id
        ? (lawyerById.get(p.assigned_lawyer_id)?.full_name || lawyerById.get(p.assigned_lawyer_id)?.email || p.assigned_lawyer_id)
        : "Unassigned";
      if (!byLawyer.has(key)) byLawyer.set(key, { label, prospects: 0, spend: 0 });
      const row = byLawyer.get(key);
      row.prospects += 1;
      row.spend += Number(p.spend || 0);
    }

    const lawyerRows = Array.from(byLawyer.values()).sort((a, b) => b.spend - a.spend);
    acqLawyerTable.innerHTML = lawyerRows.length
      ? lawyerRows.map((r) => `
          <tr>
            <td>${escapeHtml(r.label)}</td>
            <td>${r.prospects}</td>
            <td><strong>P${asPeso(r.spend)}</strong></td>
          </tr>
        `).join("")
      : `<tr><td colspan="3" class="muted">No acquisition spend rows found.</td></tr>`;
  }

  async function runReport() {
    msg.textContent = "";
    const from = fromInput.value;
    const to = toInput.value;
    const status = statusSel.value;

    if (!from || !to) {
      msg.textContent = "Please provide both date values.";
      return;
    }
    if (from > to) {
      msg.textContent = "From date must not be later than To date.";
      return;
    }

    let query = supabase
      .from("activities")
      .select("id,account_id,matter,matter_id,task_category,fee_code,description,amount,billable,minutes,status,created_by,performed_by,handling_lawyer_id,occurred_at")
      .gte("occurred_at", toIsoStart(from))
      .lte("occurred_at", toIsoEnd(to))
      .order("occurred_at", { ascending: false })
      .limit(4000);

    if (status !== "all") query = query.eq("status", status);

    const { data, error } = await query;
    if (error) {
      msg.textContent = `Error: ${error.message}`;
      return;
    }

    const userIds = Array.from(
      new Set((data || []).flatMap((r) => [r.created_by, r.performed_by, r.handling_lawyer_id]).filter(Boolean))
    );
    const accountIds = Array.from(new Set((data || []).map((r) => r.account_id).filter(Boolean)));
    const matterIds = Array.from(new Set((data || []).map((r) => r.matter_id).filter(Boolean)));

    const [usersRes, accountsRes, mattersRes] = await Promise.all([
      userIds.length
        ? supabase.from("profiles").select("id,full_name,email").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
      accountIds.length
        ? supabase.from("accounts").select("id,title").in("id", accountIds)
        : Promise.resolve({ data: [], error: null }),
      matterIds.length
        ? supabase
            .from("matters")
            .select("id,matter_type,official_case_no,special_engagement_code,retainer_contract_ref,retainer_period_yyyymm")
            .in("id", matterIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (usersRes.error) {
      msg.textContent = `Error: ${usersRes.error.message}`;
      return;
    }
    if (accountsRes.error) {
      msg.textContent = `Error: ${accountsRes.error.message}`;
      return;
    }
    if (mattersRes.error) {
      msg.textContent = `Error: ${mattersRes.error.message}`;
      return;
    }

    const userById = new Map((usersRes.data || []).map((u) => [u.id, u]));
    const accountById = new Map((accountsRes.data || []).map((a) => [a.id, a]));
    const matterById = new Map((mattersRes.data || []).map((m) => [m.id, m]));

    reportRows = (data || []).map((r) => {
      const enteredBy = userById.get(r.created_by);
      const performedBy = userById.get(r.performed_by);
      const handlingLawyer = userById.get(r.handling_lawyer_id);
      const assignee = extractRetainerAssignee(r.task_category, r.description);
      const performedLabelFromProfile = performedBy ? (performedBy.full_name || performedBy.email || "") : "";
      const matter = matterById.get(r.matter_id);
      return {
        id: r.id,
        occurred_on: r.occurred_at ? new Date(r.occurred_at).toLocaleDateString() : "",
        status: r.status || "",
        account_title: accountById.get(r.account_id)?.title || "Account",
        matter: r.matter || "",
        matter_id: r.matter_id || "",
        matter_type: clean(matter?.matter_type || ""),
        matter_identifier: matterIdentifierLabel(matter),
        task_category: r.task_category || "",
        fee_code: r.fee_code || "",
        description: r.description || "",
        amount: Number(r.amount || 0),
        billable: !!r.billable,
        minutes: r.minutes ?? null,
        entered_by_id: r.created_by || "",
        entered_by_name: enteredBy ? (enteredBy.full_name || enteredBy.email || "") : "",
        performed_by_id: assignee ? assigneeKey(assignee) : (r.performed_by || ""),
        performed_by_name: assignee || performedLabelFromProfile,
        handling_lawyer_id: r.handling_lawyer_id || "",
        handling_lawyer_name: handlingLawyer ? (handlingLawyer.full_name || handlingLawyer.email || "") : "",
      };
    });

    populateLawyerFilter(reportRows, lawyerBasisSel.value, true);
    renderCurrentView();
    await loadAcquisitionReport();
    msg.textContent = `${visibleRows.length} row(s) shown.`;
  }

  function exportCsv() {
    if (!visibleRows.length) {
      msg.textContent = "Run a report first before exporting.";
      return;
    }
    const csv = buildCsv(visibleRows, lawyerBasisSel.value);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dslaw-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function printSummary() {
    window.print();
  }

  function clearFilters() {
    matterTypeFilterSel.value = "";
    identifierFilterInput.value = "";
    lawyerFilterSel.value = "";
    textFilterInput.value = "";
    renderCurrentView();
    msg.textContent = `${visibleRows.length} row(s) shown.`;
  }

  runBtn.addEventListener("click", runReport);
  csvBtn.addEventListener("click", exportCsv);
  printBtn.addEventListener("click", printSummary);
  clearFiltersBtn.addEventListener("click", clearFilters);
  lawyerBasisSel.addEventListener("change", () => {
    populateLawyerFilter(reportRows, lawyerBasisSel.value, false);
    renderCurrentView();
    msg.textContent = `${visibleRows.length} row(s) shown.`;
  });
  matterTypeFilterSel.addEventListener("change", () => {
    renderCurrentView();
    msg.textContent = `${visibleRows.length} row(s) shown.`;
  });
  identifierFilterInput.addEventListener("input", () => {
    renderCurrentView();
    msg.textContent = `${visibleRows.length} row(s) shown.`;
  });
  lawyerFilterSel.addEventListener("change", () => {
    renderCurrentView();
    msg.textContent = `${visibleRows.length} row(s) shown.`;
  });
  textFilterInput.addEventListener("input", () => {
    renderCurrentView();
    msg.textContent = `${visibleRows.length} row(s) shown.`;
  });

  await runReport();
}
