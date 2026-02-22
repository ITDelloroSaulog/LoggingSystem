import { supabase } from "../supabaseClient.js";
import { escapeHtml } from "../ui/escapeHtml.js";
import { ProspectStage } from "../domainTypes.js";
import { uiPrompt } from "../ui/modal.js";

const RECEIPTS_BUCKET = "receipts";
const STAGES = [
  ProspectStage.LEAD,
  ProspectStage.TOUCHPOINTS,
  ProspectStage.PROPOSAL,
  ProspectStage.SIGNED,
  ProspectStage.ACQUIRED,
  ProspectStage.LOST,
];

function clean(v) {
  return String(v || "").trim();
}

function fmtPeso(n) {
  return Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString();
}

function fmtDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toIsoDateOnly(raw) {
  const value = clean(raw);
  if (!value) return null;
  const parts = value.split("-");
  if (parts.length !== 3) return null;
  return `${parts[0]}-${parts[1]}-${parts[2]}`;
}

function statusPill(stage) {
  const key = clean(stage).toLowerCase();
  if (key === ProspectStage.ACQUIRED) return "status-pill completed";
  if (key === ProspectStage.LOST) return "status-pill rejected";
  if (key === ProspectStage.SIGNED || key === ProspectStage.PROPOSAL) return "status-pill approved";
  if (key === ProspectStage.TOUCHPOINTS) return "status-pill pending";
  return "status-pill";
}

function safeFileName(name) {
  return String(name || "signed-engagement.pdf")
    .replace(/[^\w.\-() ]+/g, "_")
    .slice(0, 90);
}

async function uploadProspectAttachment({ userId, prospectId, file, folder }) {
  const fileName = safeFileName(file?.name || "attachment.pdf");
  const path = `prospects/${userId}/${prospectId}/${folder}/${Date.now()}-${fileName}`;
  const { error } = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, file, {
    upsert: false,
    cacheControl: "3600",
    contentType: file?.type || "application/octet-stream",
  });
  if (error) throw error;
  return path;
}

async function openStoredFile(path) {
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, 60 * 30);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("Unable to open file.");
  window.open(data.signedUrl, "_blank", "noopener");
}

function touchpointCount(touchpoints, upToDate = null) {
  if (!Array.isArray(touchpoints)) return 0;
  if (!upToDate) return touchpoints.length;
  const max = new Date(upToDate).getTime();
  if (Number.isNaN(max)) return touchpoints.length;
  return touchpoints.filter((t) => {
    const ts = new Date(t.occurred_at).getTime();
    return Number.isFinite(ts) && ts <= max;
  }).length;
}

function acquisitionCost(costs, acquiredAt = null) {
  if (!Array.isArray(costs)) return 0;
  if (!acquiredAt) return costs.reduce((s, x) => s + Number(x.amount || 0), 0);
  const max = new Date(acquiredAt).getTime();
  if (Number.isNaN(max)) return costs.reduce((s, x) => s + Number(x.amount || 0), 0);
  return costs
    .filter((c) => {
      const ts = new Date(c.occurred_at).getTime();
      return Number.isFinite(ts) && ts <= max;
    })
    .reduce((s, x) => s + Number(x.amount || 0), 0);
}

export async function renderProspects(appEl, ctx) {
  appEl.innerHTML = `
    <section class="page-head">
      <div>
        <h1 class="page-title">Prospects</h1>
        <p class="page-sub">Lead generation, touchpoints, acquisition spend, and conversion tracking.</p>
      </div>
      <button id="newProspectBtn" class="btn btn-primary">+ New Prospect</button>
    </section>

    <section id="prospectKpis" class="kpi-grid"></section>

    <section class="card" style="margin-bottom:12px">
      <div class="toolbar prospect-toolbar">
        <input id="prospectSearch" placeholder="Search prospect..." />
        <select id="prospectStageFilter">
          <option value="">All stages</option>
          ${STAGES.map((s) => `<option value="${s}">${escapeHtml(s)}</option>`).join("")}
        </select>
        <select id="prospectLawyerFilter">
          <option value="">All assigned lawyers</option>
        </select>
        <button id="prospectReloadBtn" class="btn">Reload</button>
      </div>
    </section>

    <section class="layout-2col prospects-layout">
      <section class="card prospect-list-card">
        <h3 style="margin-top:2px">Pipeline List</h3>
        <div id="prospectList" class="list"></div>
      </section>
      <section class="card prospect-detail-card" id="prospectDetail">
        <div class="muted">Select a prospect from the list.</div>
      </section>
    </section>

    <p id="prospectMsg" class="msg"></p>
  `;

  const $ = (sel) => appEl.querySelector(sel);
  const kpisEl = $("#prospectKpis");
  const listEl = $("#prospectList");
  const detailEl = $("#prospectDetail");
  const msgEl = $("#prospectMsg");
  const searchEl = $("#prospectSearch");
  const stageFilterEl = $("#prospectStageFilter");
  const lawyerFilterEl = $("#prospectLawyerFilter");
  const reloadBtn = $("#prospectReloadBtn");
  const newBtn = $("#newProspectBtn");

  let prospects = [];
  let selectedId = "";
  let lawyerById = new Map();
  let accountById = new Map();
  let touchByProspect = new Map();
  let costByProspect = new Map();

  async function loadLawyers() {
    const { data, error } = await supabase.rpc("list_handling_lawyers");
    if (!error && Array.isArray(data)) return data;
    const fallback = await supabase
      .from("profiles")
      .select("id,full_name,email,role")
      .in("role", ["lawyer", "admin", "super_admin"])
      .order("full_name", { ascending: true })
      .limit(400);
    if (fallback.error) return [];
    return fallback.data || [];
  }

  function populateLawyerFilter() {
    const prev = clean(lawyerFilterEl.value);
    const options = Array.from(lawyerById.values())
      .sort((a, b) => clean(a.full_name || a.email).localeCompare(clean(b.full_name || b.email)))
      .map((l) => `<option value="${l.id}">${escapeHtml(clean(l.full_name || l.email || l.id))}</option>`);
    lawyerFilterEl.innerHTML = `<option value="">All assigned lawyers</option>${options.join("")}`;
    if (prev && lawyerById.has(prev)) lawyerFilterEl.value = prev;
  }

  function selectedProspect() {
    return prospects.find((p) => String(p.id) === String(selectedId)) || null;
  }

  function filteredProspects() {
    const q = clean(searchEl.value).toLowerCase();
    const stage = clean(stageFilterEl.value).toLowerCase();
    const lawyerId = clean(lawyerFilterEl.value);
    return prospects.filter((p) => {
      if (stage && clean(p.stage).toLowerCase() !== stage) return false;
      if (lawyerId && clean(p.assigned_lawyer_id) !== lawyerId) return false;
      if (!q) return true;
      const hay = [
        p.prospect_name,
        p.stage,
        p.source_channel,
        lawyerById.get(p.assigned_lawyer_id)?.full_name,
        lawyerById.get(p.assigned_lawyer_id)?.email,
      ]
        .map((x) => clean(x).toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }

  function renderKpisLocal() {
    const rows = prospects;
    const totalLeads = rows.length;
    const convertedRows = rows.filter((x) => clean(x.stage).toLowerCase() === ProspectStage.ACQUIRED);
    const converted = convertedRows.length;
    const conversionRate = totalLeads ? ((converted / totalLeads) * 100).toFixed(2) : "0.00";

    const costs = convertedRows.map((p) => acquisitionCost(costByProspect.get(p.id) || [], p.acquired_at));
    const avgCost = costs.length ? costs.reduce((s, x) => s + x, 0) / costs.length : 0;

    const touchCounts = convertedRows.map((p) => touchpointCount(touchByProspect.get(p.id) || [], p.acquired_at));
    const sortedTouches = touchCounts.slice().sort((a, b) => a - b);
    const medianTouches = sortedTouches.length
      ? (sortedTouches.length % 2
        ? sortedTouches[(sortedTouches.length - 1) / 2]
        : (sortedTouches[sortedTouches.length / 2 - 1] + sortedTouches[sortedTouches.length / 2]) / 2)
      : 0;

    const daysToClose = convertedRows
      .map((p) => {
        const opened = new Date(p.opened_at).getTime();
        const acquired = new Date(p.acquired_at).getTime();
        if (!Number.isFinite(opened) || !Number.isFinite(acquired)) return null;
        return Math.max(0, (acquired - opened) / (1000 * 60 * 60 * 24));
      })
      .filter((x) => x != null);
    const avgDays = daysToClose.length ? (daysToClose.reduce((s, x) => s + x, 0) / daysToClose.length) : 0;

    kpisEl.innerHTML = `
      <article class="kpi-card">
        <div class="kpi-label">Total Leads</div>
        <div class="kpi-value">${totalLeads}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Converted</div>
        <div class="kpi-value">${converted}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Conversion Rate</div>
        <div class="kpi-value">${conversionRate}%</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Avg Acquisition Cost</div>
        <div class="kpi-value">P${fmtPeso(avgCost)}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Median Touchpoints</div>
        <div class="kpi-value">${Number(medianTouches || 0).toFixed(1)}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Avg Days to Close</div>
        <div class="kpi-value">${Number(avgDays || 0).toFixed(1)}</div>
      </article>
    `;
  }

  function renderList() {
    const rows = filteredProspects();
    if (!rows.length) {
      listEl.innerHTML = `<div class="muted">No prospects found.</div>`;
      return;
    }

    listEl.innerHTML = rows.map((p) => {
      const isActive = String(p.id) === String(selectedId);
      const lawyer = lawyerById.get(p.assigned_lawyer_id);
      const costs = acquisitionCost(costByProspect.get(p.id) || [], p.acquired_at);
      return `
        <article class="row clickable ${isActive ? "prospect-row-active" : ""}" data-id="${p.id}">
          <div style="flex:1">
            <div><strong>${escapeHtml(clean(p.prospect_name))}</strong></div>
            <div class="muted" style="font-size:12px">
              ${escapeHtml(clean(lawyer?.full_name || lawyer?.email || "-"))}
              | opened ${escapeHtml(fmtDate(p.opened_at))}
            </div>
            <div style="margin-top:5px">
              <span class="${statusPill(p.stage)}">${escapeHtml(clean(p.stage))}</span>
            </div>
          </div>
          <div style="text-align:right;min-width:120px">
            <div class="muted" style="font-size:12px">Acquisition spend</div>
            <div style="font-weight:700">P${fmtPeso(costs)}</div>
          </div>
        </article>
      `;
    }).join("");

    listEl.querySelectorAll(".row[data-id]").forEach((el) => {
      el.addEventListener("click", () => {
        selectedId = el.dataset.id;
        renderList();
        renderDetail();
      });
    });
  }

  function renderDetail() {
    const p = selectedProspect();
    if (!p) {
      detailEl.innerHTML = `<div class="muted">Select a prospect from the list.</div>`;
      return;
    }

    const touchpoints = touchByProspect.get(p.id) || [];
    const costs = costByProspect.get(p.id) || [];
    const lawyerOptions = Array.from(lawyerById.values())
      .sort((a, b) => clean(a.full_name || a.email).localeCompare(clean(b.full_name || b.email)))
      .map((l) => `<option value="${l.id}" ${String(l.id) === String(p.assigned_lawyer_id) ? "selected" : ""}>${escapeHtml(clean(l.full_name || l.email || l.id))}</option>`)
      .join("");

    const linkedAccount = accountById.get(p.acquired_account_id);
    const signedFiles = Array.isArray(p.signed_attachment_urls) ? p.signed_attachment_urls.filter(Boolean) : [];

    detailEl.innerHTML = `
      <div class="prospect-detail-shell">
      <section class="prospect-section prospect-section-overview">
      <h3 class="prospect-detail-title">${escapeHtml(clean(p.prospect_name))}</h3>
      <div class="grid2 prospect-detail-grid" style="margin-bottom:10px">
        <div>
          <label>Stage</label>
          <select id="prospectStageEdit">
            ${STAGES.map((s) => `<option value="${s}" ${s === p.stage ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Assigned Lawyer</label>
          <select id="prospectLawyerEdit">
            <option value="">(none)</option>
            ${lawyerOptions}
          </select>
        </div>
      </div>

      <div class="grid2 prospect-detail-grid" style="margin-bottom:10px">
        <div>
          <label>Source Channel</label>
          <input id="prospectSourceEdit" value="${escapeHtml(clean(p.source_channel))}" />
        </div>
        <div>
          <label>Touchpoint Target</label>
          <input id="prospectTargetEdit" type="number" min="1" step="1" value="${Number(p.touchpoint_target || 5)}" />
        </div>
      </div>

      <div class="actions prospect-section-actions">
        <button id="saveProspectBtn" class="btn btn-primary">Save Prospect</button>
      </div>
      </section>

      <hr/>

      <section class="prospect-section prospect-section-touchpoints">
      <h4 class="prospect-section-title">Touchpoints</h4>
      <div class="muted prospect-section-sub">
        ${touchpoints.length} logged | target ${Number(p.touchpoint_target || 5)}
      </div>
      <div class="table-wrap prospect-table-wrap" style="margin-bottom:8px">
        <table class="prospect-table prospect-table-touchpoints">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Meeting</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${touchpoints.length ? touchpoints.map((t) => `
              <tr>
                <td>${escapeHtml(fmtDateTime(t.occurred_at))}</td>
                <td>${escapeHtml(clean(t.touchpoint_type))}</td>
                <td>${t.is_meeting ? "Yes" : "No"}</td>
                <td>${escapeHtml(clean(t.notes) || "-")}</td>
              </tr>
            `).join("") : `<tr><td colspan="4" class="muted">No touchpoints yet.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="prospect-form-row prospect-form-row--touchpoint" style="margin-bottom:6px">
        <div>
          <label>Touchpoint Type</label>
          <input id="tpType" placeholder="meeting / call / email" />
        </div>
        <div>
          <label>Date</label>
          <input id="tpDate" type="datetime-local" />
        </div>
        <div>
          <label>Meeting?</label>
          <select id="tpMeeting">
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </div>
        <div class="prospect-form-row-action">
          <button id="addTpBtn" class="btn">+ Add Touchpoint</button>
        </div>
      </div>
      <label>Touchpoint Notes</label>
      <textarea id="tpNotes" rows="2" placeholder="Optional notes"></textarea>
      </section>

      <hr/>

      <section class="prospect-section prospect-section-costs">
      <h4 class="prospect-section-title">Acquisition Costs</h4>
      <div class="muted prospect-section-sub">
        Pre-acquisition spend: <strong>P${fmtPeso(acquisitionCost(costs, p.acquired_at))}</strong>
      </div>
      <div class="table-wrap prospect-table-wrap" style="margin-bottom:8px">
        <table class="prospect-table prospect-table-costs">
          <thead>
            <tr>
              <th>Date</th>
              <th>Cost Type</th>
              <th>Amount</th>
              <th>Receipt</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${costs.length ? costs.map((c) => `
              <tr>
                <td>${escapeHtml(fmtDateTime(c.occurred_at))}</td>
                <td>${escapeHtml(clean(c.cost_type))}</td>
                <td>P${fmtPeso(c.amount)}</td>
                <td>
                  ${Array.isArray(c.attachment_urls) && c.attachment_urls.length
                    ? c.attachment_urls.map((path, idx) => `<a href="#" class="openCostFile" data-idx="${idx}" data-id="${c.id}">File ${idx + 1}</a>`).join("<br/>")
                    : "<span class='muted'>-</span>"}
                </td>
                <td>${escapeHtml(clean(c.notes) || "-")}</td>
              </tr>
            `).join("") : `<tr><td colspan="5" class="muted">No cost entries yet.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="prospect-form-row prospect-form-row--cost" style="margin-bottom:6px">
        <div>
          <label>Cost Type</label>
          <input id="costType" placeholder="meeting expense, transport, courier..." />
        </div>
        <div>
          <label>Amount</label>
          <input id="costAmount" type="number" min="0" step="0.01" />
        </div>
        <div>
          <label>Date</label>
          <input id="costDate" type="datetime-local" />
        </div>
        <div class="prospect-form-row-action">
          <button id="addCostBtn" class="btn">+ Add Cost</button>
        </div>
      </div>
      <div class="prospect-form-row prospect-form-row--cost-secondary">
        <div>
          <label>Cost Notes</label>
          <input id="costNotes" placeholder="Optional notes" />
        </div>
        <div>
          <label>Receipt (required by default)</label>
          <input id="costFile" type="file" />
        </div>
      </div>
      </section>

      <hr/>

      <section class="prospect-section prospect-section-conversion">
      <h4 class="prospect-section-title">Conversion</h4>
      ${p.acquired_account_id ? `
        <div class="panel prospect-conversion-panel">
          <div><strong>Converted</strong> on ${escapeHtml(fmtDate(p.acquired_at))}</div>
          <div class="muted" style="margin-top:6px">
            Account: ${escapeHtml(clean(linkedAccount?.title || p.acquired_account_id))}
          </div>
          <div style="margin-top:8px">
            ${signedFiles.length
              ? signedFiles.map((path, idx) => `<a href="#" class="openSignedFile" data-idx="${idx}">Signed File ${idx + 1}</a>`).join("<br/>")
              : "<span class='muted'>No signed file listed.</span>"}
          </div>
        </div>
      ` : `
        <div class="prospect-form-row prospect-form-row--conversion">
          <div>
            <label>Signed Attachment (required)</label>
            <input id="signedFile" type="file" />
          </div>
          <div>
            <label>Create Account As</label>
            <select id="convertCategory">
              <option value="special_project">Special Project</option>
              <option value="litigation">Litigation</option>
              <option value="retainer">Retainer</option>
            </select>
          </div>
          <div class="prospect-form-row-action">
            <button id="convertBtn" class="btn btn-primary">Convert to Account</button>
          </div>
        </div>
      `}
      </section>
      </div>
    `;

    const saveProspectBtn = detailEl.querySelector("#saveProspectBtn");
    const addTpBtn = detailEl.querySelector("#addTpBtn");
    const addCostBtn = detailEl.querySelector("#addCostBtn");
    const convertBtn = detailEl.querySelector("#convertBtn");

    saveProspectBtn?.addEventListener("click", async () => {
      msgEl.textContent = "Saving prospect...";
      const patch = {
        stage: clean(detailEl.querySelector("#prospectStageEdit")?.value || p.stage),
        assigned_lawyer_id: clean(detailEl.querySelector("#prospectLawyerEdit")?.value) || null,
        source_channel: clean(detailEl.querySelector("#prospectSourceEdit")?.value) || null,
        touchpoint_target: Math.max(1, Number(detailEl.querySelector("#prospectTargetEdit")?.value || p.touchpoint_target || 5)),
      };
      const { error } = await supabase.from("prospects").update(patch).eq("id", p.id);
      if (error) {
        msgEl.textContent = `Save failed: ${error.message}`;
        return;
      }
      msgEl.textContent = "Prospect saved.";
      await loadData();
    });

    addTpBtn?.addEventListener("click", async () => {
      const type = clean(detailEl.querySelector("#tpType")?.value);
      if (!type) {
        msgEl.textContent = "Touchpoint type is required.";
        return;
      }
      const occurredRaw = clean(detailEl.querySelector("#tpDate")?.value);
      const occurredAt = occurredRaw ? new Date(occurredRaw).toISOString() : new Date().toISOString();
      const notes = clean(detailEl.querySelector("#tpNotes")?.value);
      const isMeeting = clean(detailEl.querySelector("#tpMeeting")?.value) === "true";
      msgEl.textContent = "Adding touchpoint...";
      const { error } = await supabase.from("prospect_touchpoints").insert({
        prospect_id: p.id,
        occurred_at: occurredAt,
        touchpoint_type: type,
        notes: notes || null,
        is_meeting: isMeeting,
        created_by: ctx.user.id,
      });
      if (error) {
        msgEl.textContent = `Add touchpoint failed: ${error.message}`;
        return;
      }
      msgEl.textContent = "Touchpoint added.";
      await loadData();
    });

    addCostBtn?.addEventListener("click", async () => {
      const costType = clean(detailEl.querySelector("#costType")?.value);
      const amount = Number(detailEl.querySelector("#costAmount")?.value || 0);
      if (!costType) {
        msgEl.textContent = "Cost type is required.";
        return;
      }
      if (!Number.isFinite(amount) || amount < 0) {
        msgEl.textContent = "Amount must be a valid non-negative number.";
        return;
      }
      const fileInput = detailEl.querySelector("#costFile");
      const file = fileInput?.files?.[0] || null;
      const receiptRequired = true;
      if (receiptRequired && !file) {
        msgEl.textContent = "Receipt file is required for prospect cost entries.";
        return;
      }

      msgEl.textContent = "Adding cost entry...";
      let attachmentUrls = null;
      try {
        if (file) {
          const stored = await uploadProspectAttachment({
            userId: ctx.user.id,
            prospectId: p.id,
            file,
            folder: "costs",
          });
          attachmentUrls = [stored];
        }
      } catch (err) {
        msgEl.textContent = `Receipt upload failed: ${err?.message || err}`;
        return;
      }

      const occurredRaw = clean(detailEl.querySelector("#costDate")?.value);
      const occurredAt = occurredRaw ? new Date(occurredRaw).toISOString() : new Date().toISOString();
      const notes = clean(detailEl.querySelector("#costNotes")?.value);
      const { error } = await supabase.from("prospect_cost_entries").insert({
        prospect_id: p.id,
        occurred_at: occurredAt,
        cost_type: costType,
        amount,
        attachment_urls: attachmentUrls,
        receipt_required: receiptRequired,
        notes: notes || null,
        created_by: ctx.user.id,
      });
      if (error) {
        msgEl.textContent = `Add cost failed: ${error.message}`;
        return;
      }
      msgEl.textContent = "Cost entry added.";
      await loadData();
    });

    detailEl.querySelectorAll(".openCostFile").forEach((a) => {
      a.addEventListener("click", async (e) => {
        e.preventDefault();
        const costId = a.dataset.id;
        const idx = Number(a.dataset.idx || 0);
        const costRow = (costByProspect.get(p.id) || []).find((x) => String(x.id) === String(costId));
        const path = Array.isArray(costRow?.attachment_urls) ? costRow.attachment_urls[idx] : null;
        if (!path) return;
        try {
          await openStoredFile(path);
        } catch (err) {
          msgEl.textContent = `Open file failed: ${err?.message || err}`;
        }
      });
    });

    detailEl.querySelectorAll(".openSignedFile").forEach((a) => {
      a.addEventListener("click", async (e) => {
        e.preventDefault();
        const idx = Number(a.dataset.idx || 0);
        const path = signedFiles[idx];
        if (!path) return;
        try {
          await openStoredFile(path);
        } catch (err) {
          msgEl.textContent = `Open signed file failed: ${err?.message || err}`;
        }
      });
    });

    convertBtn?.addEventListener("click", async () => {
      const signedInput = detailEl.querySelector("#signedFile");
      const file = signedInput?.files?.[0];
      if (!file) {
        msgEl.textContent = "Signed attachment is required before conversion.";
        return;
      }
      const category = clean(detailEl.querySelector("#convertCategory")?.value || "special_project");
      msgEl.textContent = "Uploading signed attachment...";
      let storedPath = "";
      try {
        storedPath = await uploadProspectAttachment({
          userId: ctx.user.id,
          prospectId: p.id,
          file,
          folder: "signed",
        });
      } catch (err) {
        msgEl.textContent = `Upload failed: ${err?.message || err}`;
        return;
      }

      msgEl.textContent = "Converting prospect to account...";
      const { data, error } = await supabase.rpc("convert_prospect_to_account", {
        p_prospect_id: p.id,
        p_signed_attachments: [storedPath],
        p_account_category: category,
      });
      if (error) {
        msgEl.textContent = `Conversion failed: ${error.message}`;
        return;
      }
      msgEl.textContent = `Prospect converted. Account ID: ${data}`;
      await loadData();
    });
  }

  async function loadKpiFromRpc() {
    const { data, error } = await supabase.rpc("get_acquisition_metrics", {
      p_date_from: null,
      p_date_to: null,
      p_lawyer_id: null,
    });
    if (error || !Array.isArray(data) || !data.length) return;
    const r = data[0];
    kpisEl.innerHTML = `
      <article class="kpi-card">
        <div class="kpi-label">Total Leads</div>
        <div class="kpi-value">${Number(r.total_leads || 0)}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Converted</div>
        <div class="kpi-value">${Number(r.converted || 0)}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Conversion Rate</div>
        <div class="kpi-value">${Number(r.conversion_rate || 0).toFixed(2)}%</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Avg Acquisition Cost</div>
        <div class="kpi-value">P${fmtPeso(r.avg_acquisition_cost || 0)}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Median Touchpoints</div>
        <div class="kpi-value">${Number(r.median_touchpoints || 0).toFixed(2)}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Avg Days to Close</div>
        <div class="kpi-value">${Number(r.avg_days_to_close || 0).toFixed(2)}</div>
      </article>
    `;
  }

  async function loadData() {
    msgEl.textContent = "Loading prospects...";
    listEl.innerHTML = `<div class="muted">Loading...</div>`;

    const [prosRes, lawRows] = await Promise.all([
      supabase
        .from("prospects")
        .select("id,prospect_name,prospect_type,source_channel,assigned_lawyer_id,stage,opened_at,acquired_at,acquired_account_id,signed_attachment_urls,touchpoint_target,created_at")
        .order("created_at", { ascending: false })
        .limit(2000),
      loadLawyers(),
    ]);

    if (prosRes.error) {
      msgEl.textContent = `Error loading prospects: ${prosRes.error.message}`;
      return;
    }

    prospects = prosRes.data || [];
    lawyerById = new Map((lawRows || []).map((l) => [l.id, l]));
    populateLawyerFilter();

    const prospectIds = prospects.map((p) => p.id);
    const accountIds = prospects.map((p) => p.acquired_account_id).filter(Boolean);
    const [touchRes, costRes, accRes] = await Promise.all([
      prospectIds.length
        ? supabase
            .from("prospect_touchpoints")
            .select("id,prospect_id,occurred_at,touchpoint_type,notes,is_meeting")
            .in("prospect_id", prospectIds)
            .order("occurred_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      prospectIds.length
        ? supabase
            .from("prospect_cost_entries")
            .select("id,prospect_id,occurred_at,cost_type,amount,attachment_urls,notes,receipt_required")
            .in("prospect_id", prospectIds)
            .order("occurred_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      accountIds.length
        ? supabase.from("accounts").select("id,title,category").in("id", accountIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (touchRes.error) {
      msgEl.textContent = `Error loading touchpoints: ${touchRes.error.message}`;
      return;
    }
    if (costRes.error) {
      msgEl.textContent = `Error loading prospect costs: ${costRes.error.message}`;
      return;
    }
    if (accRes.error) {
      msgEl.textContent = `Error loading linked accounts: ${accRes.error.message}`;
      return;
    }

    touchByProspect = new Map();
    for (const t of touchRes.data || []) {
      if (!touchByProspect.has(t.prospect_id)) touchByProspect.set(t.prospect_id, []);
      touchByProspect.get(t.prospect_id).push(t);
    }

    costByProspect = new Map();
    for (const c of costRes.data || []) {
      if (!costByProspect.has(c.prospect_id)) costByProspect.set(c.prospect_id, []);
      costByProspect.get(c.prospect_id).push(c);
    }

    accountById = new Map((accRes.data || []).map((a) => [a.id, a]));

    if (!selectedId && prospects.length) selectedId = prospects[0].id;
    if (selectedId && !prospects.some((p) => String(p.id) === String(selectedId))) {
      selectedId = prospects[0]?.id || "";
    }

    await loadKpiFromRpc();
    if (!kpisEl.innerHTML.trim()) renderKpisLocal();
    renderList();
    renderDetail();
    msgEl.textContent = "";
  }

  async function createProspect() {
    const prospectName = await uiPrompt({
      title: "New Prospect",
      message: "Enter prospect name.",
      label: "Prospect name",
      required: true,
      confirmText: "Next",
    });
    if (!prospectName || !clean(prospectName)) return;

    const kind = await uiPrompt({
      title: "Prospect Type",
      message: "Type company or personal.",
      label: "Type",
      defaultValue: "company",
      required: true,
      validate: (value) => {
        const normalized = clean(value).toLowerCase();
        if (normalized === "company" || normalized === "personal") return "";
        return "Use company or personal.";
      },
      confirmText: "Create",
    });
    if (!kind) return;
    const prospectType = clean(kind).toLowerCase() === "personal" ? "personal" : "company";
    msgEl.textContent = "Creating prospect...";
    const { data, error } = await supabase
      .from("prospects")
      .insert({
        prospect_name: clean(prospectName),
        prospect_type: prospectType,
        stage: ProspectStage.LEAD,
        opened_at: toIsoDateOnly(new Date().toISOString().slice(0, 10)),
        touchpoint_target: 5,
        created_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (error) {
      msgEl.textContent = `Create failed: ${error.message}`;
      return;
    }
    selectedId = data?.id || "";
    msgEl.textContent = "Prospect created.";
    await loadData();
  }

  searchEl.addEventListener("input", () => {
    renderList();
    renderDetail();
  });
  stageFilterEl.addEventListener("change", () => {
    renderList();
    renderDetail();
  });
  lawyerFilterEl.addEventListener("change", () => {
    renderList();
    renderDetail();
  });
  reloadBtn.addEventListener("click", loadData);
  newBtn.addEventListener("click", createProspect);

  await loadData();
}
