import { supabase } from "../supabaseClient.js";
import { escapeHtml } from "../ui/escapeHtml.js";
import { MatterType, normalizeMatterType } from "../domainTypes.js";
import { navigate } from "../router.js";
import { uiConfirm, uiPrompt } from "../ui/modal.js";

const TAB_LITIGATION = MatterType.LITIGATION;
const TAB_SPECIAL = MatterType.SPECIAL_PROJECT;
const TAB_RETAINER = MatterType.RETAINER;
const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 0];
const MATTER_STATUS_OPTIONS = ["active", "on_hold", "closed", "archived"];
const CASE_TYPE_OPTIONS = ["Civil Case", "Criminal Case", "Admin Case", "Preliminary Investigation", "Other"];
const RECEIPTS_BUCKET = "receipts";
const ACTIVITY_PREFILL_KEY = "lfp.activity_prefill";
const TRACKER_QUICK_CATEGORIES = [
  { value: "appearance_fee", label: "Appearance", activity_type: "appearance", fee_code: "AF", entry_class: "meeting", expense_type: null, is_meeting: true },
  { value: "pleading_major", label: "Major Pleading", activity_type: "pleading_major", fee_code: "PF", entry_class: "service", expense_type: null, is_meeting: false },
  { value: "pleading_minor", label: "Minor Pleading", activity_type: "pleading_minor", fee_code: "PF", entry_class: "service", expense_type: null, is_meeting: false },
  { value: "communication", label: "Communication", activity_type: "communication", fee_code: null, entry_class: "service", expense_type: null, is_meeting: false },
  { value: "special_project", label: "Special Project Service", activity_type: "communication", fee_code: null, entry_class: "service", expense_type: null, is_meeting: false },
  { value: "miscellaneous", label: "Miscellaneous", activity_type: "communication", fee_code: null, entry_class: "misc", expense_type: null, is_meeting: false },
  { value: "ope_transpo", label: "OPE Transport", activity_type: "communication", fee_code: "OPE", entry_class: "opex", expense_type: "transport", is_meeting: false },
  { value: "ope_lbc", label: "OPE Courier", activity_type: "communication", fee_code: "OPE", entry_class: "opex", expense_type: "courier", is_meeting: false },
  { value: "ope_printing", label: "OPE Printing", activity_type: "communication", fee_code: "OPE", entry_class: "opex", expense_type: "printing", is_meeting: false },
  { value: "ope_envelope", label: "OPE Envelope", activity_type: "communication", fee_code: "OPE", entry_class: "opex", expense_type: "envelope", is_meeting: false },
  { value: "notary_fee", label: "OPE Notary", activity_type: "communication", fee_code: "OPE", entry_class: "opex", expense_type: "notary", is_meeting: false },
  { value: "ope_manhours", label: "OPE Manhours", activity_type: "communication", fee_code: "OPE", entry_class: "opex", expense_type: "manhours", is_meeting: false },
];
const MATTER_COST_RATE_META = [
  { code: "AF", label: "Acceptance Fee", format: "currency" },
  { code: "OPE", label: "OPE", format: "currency" },
  { code: "TECH", label: "Tech/Admin Fee", format: "currency" },
  { code: "PLEADING_MAJOR", label: "Major Pleading", format: "currency" },
  { code: "PLEADING_MINOR", label: "Minor Pleading", format: "currency" },
  { code: "APPEARANCE_PARTNER", label: "Appearance (Partner)", format: "currency" },
  { code: "APPEARANCE_ASSOCIATE", label: "Appearance (Associate)", format: "currency" },
  { code: "SUCCESS_FEE_PERCENT", label: "Success Fee", format: "percent" },
];

function clean(v) { return String(v || "").trim(); }
function fmtDate(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString(); }
function fmtPeso(v) { return Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function normalizeRateCode(v) { return clean(v).toUpperCase(); }
function statusPillClass(status) {
  const key = clean(status).toLowerCase();
  if (key === "active") return "status-pill completed";
  if (key === "on_hold") return "status-pill pending";
  if (key === "closed" || key === "archived") return "status-pill rejected";
  return "status-pill";
}
function parsePipeMap(description) {
  const map = {};
  const parts = String(description || "").split("|").map((x) => x.trim()).filter(Boolean);
  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    map[clean(part.slice(0, idx)).toLowerCase()] = clean(part.slice(idx + 1));
  }
  return map;
}
function quickCategoryMeta(taskCategory) {
  const key = clean(taskCategory).toLowerCase();
  return TRACKER_QUICK_CATEGORIES.find((x) => clean(x.value).toLowerCase() === key)
    || TRACKER_QUICK_CATEGORIES.find((x) => x.value === "communication");
}
function quickCategoryOptions(selected) {
  const curr = clean(selected).toLowerCase();
  return TRACKER_QUICK_CATEGORIES
    .map((x) => `<option value="${escapeHtml(x.value)}" ${curr === clean(x.value).toLowerCase() ? "selected" : ""}>${escapeHtml(x.label)}</option>`)
    .join("");
}
function buildCostItemsFromOverrides(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const code = normalizeRateCode(row?.rate_code);
    if (!code) continue;
    const value = Number(row?.override_amount);
    if (!Number.isFinite(value)) continue;
    map.set(code, {
      code,
      value,
      source: "matter override",
      raw: row,
    });
  }
  const items = [];
  for (const meta of MATTER_COST_RATE_META) {
    const found = map.get(meta.code);
    if (!found) continue;
    items.push({
      code: meta.code,
      label: meta.label,
      format: meta.format,
      value: found.value,
      source: found.source,
    });
    map.delete(meta.code);
  }
  for (const [code, found] of map.entries()) {
    items.push({
      code,
      label: code,
      format: "currency",
      value: found.value,
      source: found.source,
    });
  }
  return items;
}
function formatCostItem(item) {
  if (!item) return "";
  const value = Number(item.value || 0);
  const valueText = item.format === "percent"
    ? `${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`
    : `P${fmtPeso(value)}`;
  return `${item.label}: ${valueText}`;
}
function formatCostValue(item) {
  const value = Number(item?.value || 0);
  return item?.format === "percent"
    ? `${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`
    : `P${fmtPeso(value)}`;
}
function summarizeMatterActivities(rows) {
  const summary = { latest_status: "-", latest_occurred_at: null, pending_count: 0, draft_count: 0, opex_total: 0, total_count: 0 };
  let latestDoc = null;
  for (const a of rows || []) {
    if (!summary.latest_occurred_at) {
      summary.latest_occurred_at = a.occurred_at || a.created_at || null;
      summary.latest_status = a.status || "-";
    }
    summary.total_count += 1;
    if (clean(a.status).toLowerCase() === "pending") summary.pending_count += 1;
    if (clean(a.status).toLowerCase() === "draft") summary.draft_count += 1;
    const task = clean(a.task_category).toLowerCase();
    const isOpex = clean(a.entry_class).toLowerCase() === "opex"
      || ["notary_fee", "ope_printing", "ope_envelope", "ope_lbc", "ope_transpo", "ope_manhours"].includes(task);
    if (isOpex) summary.opex_total += Number(a.amount || 0);
    if (task === "contract_agreement") {
      const currTs = new Date(latestDoc?.occurred_at || latestDoc?.created_at || 0).getTime();
      const nextTs = new Date(a.occurred_at || a.created_at || 0).getTime();
      if (!latestDoc || nextTs >= currTs) latestDoc = a;
    }
  }
  return { summary, latestDoc };
}
function safeFileName(name) { return String(name || "engagement.pdf").replace(/[^\w.\-() ]+/g, "_").slice(0, 100); }
function splitBucketAndPath(rawValue) {
  const raw = clean(rawValue);
  const idx = raw.indexOf(":");
  if (idx > 0 && raw.slice(0, idx).indexOf("/") === -1) return { bucket: raw.slice(0, idx), path: raw.slice(idx + 1) };
  return { bucket: RECEIPTS_BUCKET, path: raw };
}
function attachmentLabel(path) { const split = splitBucketAndPath(path); return clean(split.path).split("/").pop() || path; }
function encodeAttachments(attachments) {
  try { return encodeURIComponent(JSON.stringify(Array.isArray(attachments) ? attachments : [])); }
  catch { return encodeURIComponent("[]"); }
}
function decodeAttachments(encoded) {
  try { const v = JSON.parse(decodeURIComponent(encoded || encodeURIComponent("[]"))); return Array.isArray(v) ? v.filter(Boolean) : []; }
  catch { return []; }
}
function accountDisplay(account) {
  if (!account) return "-";
  const title = clean(account.title) || "(Untitled)";
  const suffix = [clean(account.account_kind), clean(account.category)].filter(Boolean).join(" / ");
  return suffix ? `${title} (${suffix})` : title;
}
function rowCaseTypeOptions(selected) {
  const curr = clean(selected);
  return CASE_TYPE_OPTIONS.map((x) => `<option value="${escapeHtml(x)}" ${curr === x ? "selected" : ""}>${escapeHtml(x)}</option>`).join("");
}
function rowStatusOptions(selected) {
  const curr = clean(selected).toLowerCase();
  return MATTER_STATUS_OPTIONS.map((x) => `<option value="${x}" ${curr === x ? "selected" : ""}>${escapeHtml(x)}</option>`).join("");
}
function lawyerOptions(lawyers, selectedId) {
  const rows = [`<option value="">(none)</option>`];
  for (const l of lawyers || []) {
    const label = clean(l.full_name || l.email || l.id);
    rows.push(`<option value="${l.id}" ${String(l.id) === String(selectedId) ? "selected" : ""}>${escapeHtml(label)}</option>`);
  }
  return rows.join("");
}
function buildDocListHtml(attachments) {
  if (!attachments.length) return `<span class="muted">No PDF</span>`;
  return attachments.map((path, idx) => `<div><a href="#" class="doc-link" data-idx="${idx}">${escapeHtml(attachmentLabel(path))}</a></div>`).join("");
}
function legacyTab(row, account) {
  const task = clean(row.task_category).toLowerCase();
  const desc = clean(row.description).toLowerCase();
  const accountType = normalizeMatterType(account?.category);
  if (accountType === TAB_LITIGATION || accountType === TAB_SPECIAL || accountType === TAB_RETAINER) return accountType;
  if (task.startsWith("retainer_") || desc.includes("retainer ope")) return TAB_RETAINER;
  if (task === "special_project" || desc.includes("special project tracker")) return TAB_SPECIAL;
  return TAB_LITIGATION;
}
function legacyIdentifierPreview(row, tab) {
  const map = parsePipeMap(row.description);
  if (tab === TAB_LITIGATION) return clean((row.matter || "").match(/([A-Z]{1,5}-LIT-[A-Z0-9-]+)/i)?.[1] || map["official case no"] || map["case no"]);
  if (tab === TAB_SPECIAL) return clean((row.matter || "").match(/(EP[-_ /]?[A-Z0-9][A-Z0-9/_-]*)/i)?.[1] || map["special engagement code"] || map["engagement code"] || map["tracker link"]);
  return clean((row.matter || "").match(/(RS-[A-Z0-9-]+)/i)?.[1] || map["contract ref"] || map["reference"]);
}
function openMatterInActivities(matter) {
  if (!matter?.id || !matter?.account_id) return;
  try {
    localStorage.setItem(
      ACTIVITY_PREFILL_KEY,
      JSON.stringify({
        account_id: matter.account_id,
        matter_id: matter.id,
      })
    );
  } catch {
    // Ignore localStorage failures and still navigate.
  }
  navigate("#/activities");
}

async function loadLawyers() {
  const { data, error } = await supabase.rpc("list_handling_lawyers");
  if (!error && Array.isArray(data)) return data;
  const fallback = await supabase.from("profiles").select("id,full_name,email,role").eq("role", "lawyer").order("full_name", { ascending: true }).limit(500);
  if (fallback.error) return [];
  return fallback.data || [];
}
async function uploadMatterPdf({ userId, matterId, file }) {
  const path = `matters/${userId}/${matterId}/${Date.now()}-${safeFileName(file?.name || "engagement.pdf")}`;
  const { error } = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, file, { upsert: false, cacheControl: "3600", contentType: file?.type || "application/pdf" });
  if (error) throw error;
  return path;
}
async function createSignedUrl(path) {
  const split = splitBucketAndPath(path);
  const { data, error } = await supabase.storage.from(split.bucket || RECEIPTS_BUCKET).createSignedUrl(split.path, 60 * 30);
  if (error) throw error;
  return data?.signedUrl || "";
}

export async function renderTrackerHub(appEl, ctx) {
  appEl.innerHTML = `
    <section class="page-head">
      <div>
        <h1 class="page-title">Tracker Workspace</h1>
        <p class="page-sub">Matter-first spreadsheet with strict identifiers, engagement files, and legacy fallback.</p>
      </div>
    </section>
    <section class="card tracker-shell">
      <div class="tracker-toolbar">
        <div class="tracker-tabs" id="trackerTabs">
          <button type="button" class="tracker-tab active" data-tab="${TAB_LITIGATION}">Litigation</button>
          <button type="button" class="tracker-tab" data-tab="${TAB_SPECIAL}">Special Project</button>
          <button type="button" class="tracker-tab" data-tab="${TAB_RETAINER}">Retainer</button>
        </div>
        <div class="tracker-filters">
          <input id="trackerSearch" placeholder="Search client, title, identifier, venue..." />
          <select id="trackerAccount"><option value="">All clients</option></select>
          <select id="trackerStatus"><option value="">All statuses</option>${MATTER_STATUS_OPTIONS.map((s) => `<option value="${s}">${escapeHtml(s)}</option>`).join("")}</select>
          <label class="tracker-inline-toggle" title="Include archived accounts">
            <input id="trackerShowArchived" type="checkbox" />
            Show archived
          </label>
          <button id="trackerReload" class="btn">Reload</button>
          <button id="trackerSaveAll" class="btn btn-primary">Save Changes</button>
        </div>
      </div>
      <p class="muted tracker-hint">If no structured rows exist for a tab, legacy activity rows are shown for one-time conversion to structured matters.</p>
      <div class="tracker-meta">
        <div id="trackerStats" class="muted"></div>
        <div class="tracker-pager">
          <label for="trackerPageSize" class="muted">Rows</label>
          <select id="trackerPageSize">${PAGE_SIZE_OPTIONS.map((n) => `<option value="${n}" ${n === 50 ? "selected" : ""}>${n === 0 ? "All" : n}</option>`).join("")}</select>
          <button type="button" id="trackerPrev" class="btn btn-ghost">Prev</button>
          <span id="trackerPageInfo" class="tracker-page-info muted">Page 1 of 1</span>
          <button type="button" id="trackerNext" class="btn btn-ghost">Next</button>
        </div>
      </div>
      <div class="table-wrap tracker-table-wrap"><table class="tracker-table"><thead id="trackerHead"></thead><tbody id="trackerBody"></tbody></table></div>
      <p id="trackerMsg" class="msg"></p>
    </section>
  `;

  const $ = (sel) => appEl.querySelector(sel);
  const tabsEl = $("#trackerTabs");
  const headEl = $("#trackerHead");
  const bodyEl = $("#trackerBody");
  const msgEl = $("#trackerMsg");
  const statsEl = $("#trackerStats");
  const pageSizeEl = $("#trackerPageSize");
  const prevBtn = $("#trackerPrev");
  const nextBtn = $("#trackerNext");
  const pageInfoEl = $("#trackerPageInfo");
  const searchEl = $("#trackerSearch");
  const accountEl = $("#trackerAccount");
  const statusEl = $("#trackerStatus");
  const showArchivedEl = $("#trackerShowArchived");
  const reloadBtn = $("#trackerReload");
  const saveAllBtn = $("#trackerSaveAll");

  let currentTab = TAB_LITIGATION;
  let matters = [];
  let legacyRows = [];
  let lawyers = [];
  let accountsById = new Map();
  let summariesByMatter = new Map();
  let docsByMatter = new Map();
  let quotasByMatter = new Map();
  let quotaLoadsByMatter = new Map();
  let acceptanceByMatter = new Map();
  let page = 1;
  let pageSize = 50;
  let lastTotalPages = 1;
  let renderVersion = 0;

  const visibleMatterRows = () => Array.from(bodyEl.querySelectorAll("tr[data-kind='matter']"));
  const dirtyRows = () => visibleMatterRows().filter((tr) => tr.classList.contains("is-dirty"));
  function markDirty(tr, dirty = true) {
    if (!tr || !tr.classList) return;
    tr.classList.toggle("is-dirty", !!dirty);
    const n = dirtyRows().length;
    saveAllBtn.disabled = n === 0;
    saveAllBtn.textContent = n ? `Save ${n} Change${n > 1 ? "s" : ""}` : "Save Changes";
  }

  async function confirmDiscardUnsaved() {
    if (!dirtyRows().length) return true;
    return uiConfirm({
      title: "Discard Unsaved Changes",
      message: "You have unsaved changes. Continue and discard them?",
      confirmText: "Discard",
      danger: true,
    });
  }

  function matterSummary(matterId) {
    return summariesByMatter.get(matterId) || { latest_status: "-", latest_occurred_at: null, pending_count: 0, draft_count: 0, opex_total: 0, total_count: 0 };
  }

  function renderHead(kind) {
    if (kind === "legacy") {
      headEl.innerHTML = `<tr><th>Seq</th><th>Client</th><th>Legacy Matter</th><th>Status</th><th>Identifier Preview</th><th>Occurred</th><th>Convert</th></tr>`;
      return;
    }
    if (currentTab === TAB_LITIGATION) {
      headEl.innerHTML = `<tr><th>Seq</th><th>Company Name</th><th>Personal / Representative</th><th>Case Number</th><th>Internal Case Code</th><th>Case Title</th><th>Venue</th><th>Case Type</th><th>Status</th><th>Handling Lawyer</th><th>Engagement PDF</th><th>Activity Summary</th><th>Action</th></tr>`;
      return;
    }
    if (currentTab === TAB_SPECIAL) {
      headEl.innerHTML = `<tr><th>Seq</th><th>Company Name</th><th>Personal / Representative</th><th>Special Engagement Code</th><th>Date of Engagement</th><th>Acceptance Fee</th><th>Engagement Description</th><th>Tracker Link</th><th>Status</th><th>Handling Lawyer</th><th>Engagement PDF</th><th>Activity Summary</th><th>Action</th></tr>`;
      return;
    }
    headEl.innerHTML = `<tr><th>Seq</th><th>Company Name</th><th>Personal / Representative</th><th>Contract Ref</th><th>Period YYYYMM</th><th>Title</th><th>Status</th><th>Handling Lawyer</th><th>Meeting Quota</th><th>OPEX Summary</th><th>Engagement PDF</th><th>Action</th></tr>`;
  }

  function renderDocCell(matterId) {
    const doc = docsByMatter.get(matterId);
    const attachments = Array.isArray(doc?.attachment_urls) ? doc.attachment_urls.filter(Boolean) : [];
    return `<div class="doc-cell" data-matter-id="${matterId}" data-attachments="${encodeAttachments(attachments)}"><div class="doc-list">${buildDocListHtml(attachments)}</div><div class="doc-actions"><button type="button" class="btn btn-ghost upload-doc">${attachments.length ? "Add PDF" : "Upload PDF"}</button><button type="button" class="btn btn-ghost clear-doc" ${attachments.length ? "" : "disabled"}>Clear</button></div><input type="file" class="doc-file" accept=".pdf,application/pdf" style="display:none" /></div>`;
  }

  function renderSummaryCell(matterId) {
    const s = matterSummary(matterId);
    const acceptance = acceptanceFeeForMatter(matterId);
    const acceptanceText = acceptance > 0 ? ` | cost AF P${fmtPeso(acceptance)}` : "";
    return `<div><div><span class="${statusPillClass(s.latest_status)}">${escapeHtml(clean(s.latest_status) || "-")}</span></div><div class="muted" style="font-size:12px;margin-top:4px">${s.total_count} entries | pending ${s.pending_count} | draft ${s.draft_count}${escapeHtml(acceptanceText)}</div><div class="muted" style="font-size:12px">Last: ${escapeHtml(fmtDate(s.latest_occurred_at))}</div></div>`;
  }
  function renderRetainerOpexCell(matterId) {
    const s = matterSummary(matterId);
    return `<div><strong>P${fmtPeso(s.opex_total)}</strong><div class="muted" style="font-size:12px">${s.total_count} entries</div></div>`;
  }
  function normalizeRetainerQuota(value) {
    const base = Array.isArray(value) ? value[0] : value;
    return {
      included_meeting_quota: Number(base?.included_meeting_quota || 0),
      used_meeting_quota: Number(base?.used_meeting_quota || 0),
      remaining_meeting_quota: Number(base?.remaining_meeting_quota || 0),
    };
  }
  function renderRetainerQuotaCell(matterId) {
    const q = quotasByMatter.get(matterId);
    const quotaText = q
      ? `${q.used_meeting_quota}/${q.included_meeting_quota} (remaining ${q.remaining_meeting_quota})`
      : "Loading...";
    return `<div class="muted" style="font-size:12px">${escapeHtml(quotaText)}</div>`;
  }
  function acceptanceFeeForMatter(matterId) {
    return Number(acceptanceByMatter.get(matterId)?.amount || 0);
  }

  function renderTrackerLinkCell(matter) {
    const code = clean(matter.special_engagement_code) || "Open";
    return `<span class="tracker-link-badge" title="Tracker code">${escapeHtml(code)}</span>`;
  }

  function renderActionCell(matterId) {
    return `<div class="tracker-row-actions"><button class="btn save-row">Save</button><button class="btn btn-ghost open-matter-entries" data-id="${matterId}">Entries</button><button class="btn btn-danger archive-row">Delete</button></div><div class="muted save-msg"></div>`;
  }

  function tabMatters() {
    const q = clean(searchEl.value).toLowerCase();
    const status = clean(statusEl.value).toLowerCase();
    const account = clean(accountEl.value);
    const includeArchived = !!showArchivedEl?.checked;
    return matters.filter((m) => {
      const acc = accountsById.get(m.account_id);
      if (clean(m.matter_type) !== currentTab) return false;
      if (status && clean(m.status).toLowerCase() !== status) return false;
      if (account && clean(m.account_id) !== account) return false;
      if (!includeArchived && acc?.is_archived) return false;
      if (!q) return true;
      const hay = [acc?.title, m.title, m.official_case_no, m.internal_case_code, m.special_engagement_code, m.retainer_contract_ref, m.retainer_period_yyyymm, m.company_name, m.personal_name, m.case_type, m.venue, m.engagement_description].map((x) => clean(x).toLowerCase()).join(" ");
      return hay.includes(q);
    });
  }

  function tabLegacyRows() {
    const q = clean(searchEl.value).toLowerCase();
    const status = clean(statusEl.value).toLowerCase();
    const account = clean(accountEl.value);
    const includeArchived = !!showArchivedEl?.checked;
    return legacyRows.filter((r) => {
      const acc = accountsById.get(r.account_id);
      if (legacyTab(r, acc) !== currentTab) return false;
      if (status && clean(r.status).toLowerCase() !== status) return false;
      if (account && clean(r.account_id) !== account) return false;
      if (!includeArchived && acc?.is_archived) return false;
      if (!q) return true;
      const hay = [acc?.title, r.matter, r.description, r.task_category].map((x) => clean(x).toLowerCase()).join(" ");
      return hay.includes(q);
    });
  }

  function getPaged(all) {
    const total = all.length;
    if (!total) {
      page = 1;
      lastTotalPages = 1;
      return { rows: [], total, from: 0, to: 0, totalPages: 1 };
    }
    if (pageSize === 0) {
      page = 1;
      lastTotalPages = 1;
      return { rows: all, total, from: 1, to: total, totalPages: 1 };
    }
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    page = Math.max(1, Math.min(page, totalPages));
    const start = (page - 1) * pageSize;
    const end = Math.min(start + pageSize, total);
    lastTotalPages = totalPages;
    return { rows: all.slice(start, end), total, from: start + 1, to: end, totalPages };
  }

  function populateAccountFilter() {
    const prev = clean(accountEl.value);
    const includeArchived = !!showArchivedEl?.checked;
    const options = [];
    const seen = new Set();
    for (const m of matters) {
      if (clean(m.matter_type) !== currentTab) continue;
      const acc = accountsById.get(m.account_id);
      if (!acc || seen.has(acc.id)) continue;
      if (!includeArchived && acc.is_archived) continue;
      seen.add(acc.id); options.push(acc);
    }
    for (const r of legacyRows) {
      const acc = accountsById.get(r.account_id);
      if (!acc || seen.has(acc.id)) continue;
      if (legacyTab(r, acc) !== currentTab) continue;
      if (!includeArchived && acc.is_archived) continue;
      seen.add(acc.id); options.push(acc);
    }
    options.sort((a, b) => clean(a.title).localeCompare(clean(b.title)));
    accountEl.innerHTML = [`<option value="">All clients</option>`, ...options.map((a) => `<option value="${a.id}">${escapeHtml(accountDisplay(a))}</option>`)].join("");
    if (prev && seen.has(prev)) accountEl.value = prev;
  }

  async function ensureRetainerQuotas(rows) {
    if (currentTab !== TAB_RETAINER) return;
    const jobs = [];
    for (const m of rows || []) {
      if (!m?.id) continue;
      if (quotasByMatter.has(m.id)) continue;
      if (!quotaLoadsByMatter.has(m.id)) {
        const p = (async () => {
          try {
            const { data, error } = await supabase.rpc("get_retainer_quota_balance", {
              p_matter_id: m.id,
              p_period_yyyymm: Number(m.retainer_period_yyyymm || 0) || null,
            });
            if (error) throw error;
            quotasByMatter.set(m.id, normalizeRetainerQuota(data));
          } catch {
            quotasByMatter.set(m.id, normalizeRetainerQuota(null));
          } finally {
            quotaLoadsByMatter.delete(m.id);
          }
        })();
        quotaLoadsByMatter.set(m.id, p);
      }
      jobs.push(quotaLoadsByMatter.get(m.id));
    }
    if (jobs.length) await Promise.all(jobs);
  }
  function refreshVisibleRetainerQuotaCells(rows) {
    for (const m of rows || []) {
      const tr = bodyEl.querySelector(`tr[data-kind="matter"][data-id="${m.id}"]`);
      if (!tr) continue;
      const quotaCell = tr.querySelector(".quota-cell");
      if (quotaCell) quotaCell.innerHTML = renderRetainerQuotaCell(m.id);
    }
  }
  function warmRetainerQuotas(rows, version) {
    if (currentTab !== TAB_RETAINER) return;
    ensureRetainerQuotas(rows)
      .then(() => {
        if (version !== renderVersion) return;
        if (currentTab !== TAB_RETAINER) return;
        refreshVisibleRetainerQuotaCells(rows);
      })
      .catch(() => {});
  }
  function renderMatterRows(rows, seqOffset = 0) {
    if (!rows.length) { bodyEl.innerHTML = `<tr><td colspan="13" class="muted">No structured rows found.</td></tr>`; return; }
    if (currentTab === TAB_LITIGATION) {
      bodyEl.innerHTML = rows.map((m, idx) => `<tr data-kind="matter" data-id="${m.id}"><td class="tracker-seq">${seqOffset + idx + 1}</td><td><input class="f-company" value="${escapeHtml(clean(m.company_name))}" /></td><td><input class="f-personal" value="${escapeHtml(clean(m.personal_name))}" /></td><td><input class="f-official" value="${escapeHtml(clean(m.official_case_no))}" /></td><td><input class="f-internal" value="${escapeHtml(clean(m.internal_case_code))}" /></td><td><input class="f-title" value="${escapeHtml(clean(m.title))}" /></td><td><input class="f-venue" value="${escapeHtml(clean(m.venue))}" /></td><td><select class="f-case-type">${rowCaseTypeOptions(m.case_type)}</select></td><td><select class="f-status">${rowStatusOptions(m.status)}</select></td><td><select class="f-lawyer">${lawyerOptions(lawyers, m.handling_lawyer_id)}</select></td><td>${renderDocCell(m.id)}</td><td class="summary-cell">${renderSummaryCell(m.id)}</td><td>${renderActionCell(m.id)}</td></tr>`).join("");
      return;
    }
    if (currentTab === TAB_SPECIAL) {
      bodyEl.innerHTML = rows.map((m, idx) => {
        const acceptance = acceptanceFeeForMatter(m.id);
        return `<tr data-kind="matter" data-id="${m.id}">
          <td class="tracker-seq">${seqOffset + idx + 1}</td>
          <td><input class="f-company" value="${escapeHtml(clean(m.company_name))}" /></td>
          <td><input class="f-personal" value="${escapeHtml(clean(m.personal_name))}" /></td>
          <td><input class="f-special-code" value="${escapeHtml(clean(m.special_engagement_code))}" /></td>
          <td><input class="f-opened-at" type="date" value="${escapeHtml(clean(m.opened_at).slice(0, 10))}" /></td>
          <td><input class="f-acceptance-fee" type="number" min="0" step="0.01" value="${acceptance > 0 ? Number(acceptance).toFixed(2) : ""}" placeholder="0.00" /></td>
          <td><input class="f-engagement-description" value="${escapeHtml(clean(m.engagement_description || m.title))}" /></td>
          <td>${renderTrackerLinkCell(m)}</td>
          <td><select class="f-status">${rowStatusOptions(m.status)}</select></td>
          <td><select class="f-lawyer">${lawyerOptions(lawyers, m.handling_lawyer_id)}</select></td>
          <td>${renderDocCell(m.id)}</td>
          <td class="summary-cell">${renderSummaryCell(m.id)}</td>
          <td>${renderActionCell(m.id)}</td>
        </tr>`;
      }).join("");
      return;
    }
    bodyEl.innerHTML = rows.map((m, idx) => {
      return `<tr data-kind="matter" data-id="${m.id}"><td class="tracker-seq">${seqOffset + idx + 1}</td><td><input class="f-company" value="${escapeHtml(clean(m.company_name))}" /></td><td><input class="f-personal" value="${escapeHtml(clean(m.personal_name))}" /></td><td><input class="f-contract-ref" value="${escapeHtml(clean(m.retainer_contract_ref))}" /></td><td><input class="f-period" type="number" min="190001" max="299912" value="${Number(m.retainer_period_yyyymm || 0) || ""}" /></td><td><input class="f-title" value="${escapeHtml(clean(m.title))}" /></td><td><select class="f-status">${rowStatusOptions(m.status)}</select></td><td><select class="f-lawyer">${lawyerOptions(lawyers, m.handling_lawyer_id)}</select></td><td class="quota-cell">${renderRetainerQuotaCell(m.id)}</td><td class="opex-cell">${renderRetainerOpexCell(m.id)}</td><td>${renderDocCell(m.id)}</td><td>${renderActionCell(m.id)}</td></tr>`;
    }).join("");
  }

  function renderLegacyRows(rows, seqOffset = 0) {
    if (!rows.length) { bodyEl.innerHTML = `<tr><td colspan="7" class="muted">No legacy rows found.</td></tr>`; return; }
    bodyEl.innerHTML = rows.map((r, idx) => {
      const acc = accountsById.get(r.account_id);
      return `<tr data-kind="legacy" data-id="${r.id}"><td class="tracker-seq">${seqOffset + idx + 1}</td><td>${escapeHtml(accountDisplay(acc))}</td><td>${escapeHtml(clean(r.matter) || "-")}</td><td><span class="${statusPillClass(r.status)}">${escapeHtml(clean(r.status) || "-")}</span></td><td>${escapeHtml(legacyIdentifierPreview(r, currentTab) || "(missing identifier)")}</td><td>${escapeHtml(fmtDate(r.occurred_at))}</td><td><button class="btn btn-primary convert-legacy">Convert to Matter</button></td></tr>`;
    }).join("");
  }

  async function render() {
    const thisRenderVersion = ++renderVersion;
    populateAccountFilter();
    const structured = tabMatters();
    const counts = new Map();
    for (const row of structured) counts.set(clean(row.status).toLowerCase() || "unknown", (counts.get(clean(row.status).toLowerCase() || "unknown") || 0) + 1);
    const summary = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k}: ${n}`).join(" | ");
    statsEl.textContent = summary ? `${structured.length} structured row(s) matched. ${summary}` : `${structured.length} structured row(s) matched.`;

    if (structured.length) {
      const paged = getPaged(structured);
      renderHead("matter");
      renderMatterRows(paged.rows, Math.max(0, paged.from - 1));
      if (currentTab === TAB_RETAINER) warmRetainerQuotas(paged.rows, thisRenderVersion);
      pageInfoEl.textContent = `Page ${page} of ${paged.totalPages} | Showing ${paged.from}-${paged.to} of ${paged.total}`;
      prevBtn.disabled = page <= 1 || pageSize === 0;
      nextBtn.disabled = page >= lastTotalPages || pageSize === 0;
      const n = dirtyRows().length;
      saveAllBtn.disabled = n === 0;
      saveAllBtn.textContent = n ? `Save ${n} Change${n > 1 ? "s" : ""}` : "Save Changes";
      return;
    }

    const legacy = tabLegacyRows();
    const pagedLegacy = getPaged(legacy);
    renderHead("legacy");
    renderLegacyRows(pagedLegacy.rows, Math.max(0, pagedLegacy.from - 1));
    statsEl.textContent = legacy.length ? `No structured rows yet. ${legacy.length} legacy row(s) matched.` : "No structured or legacy rows found for this tab.";
    pageInfoEl.textContent = legacy.length ? `Page ${page} of ${pagedLegacy.totalPages} | Showing ${pagedLegacy.from}-${pagedLegacy.to} of ${pagedLegacy.total}` : "Page 1 of 1 | 0 rows";
    prevBtn.disabled = page <= 1 || pageSize === 0 || !legacy.length;
    nextBtn.disabled = page >= lastTotalPages || pageSize === 0 || !legacy.length;
    saveAllBtn.disabled = true;
    saveAllBtn.textContent = "Save Changes";
  }

  function matterPayload(tr, matter) {
    const payload = {
      p_matter_id: matter.id,
      p_account_id: matter.account_id,
      p_matter_type: matter.matter_type,
      p_title: clean(tr.querySelector(".f-title")?.value || matter.title),
      p_handling_lawyer_id: clean(tr.querySelector(".f-lawyer")?.value) || null,
      p_company_name: clean(tr.querySelector(".f-company")?.value) || null,
      p_personal_name: clean(tr.querySelector(".f-personal")?.value) || null,
    };
    if (matter.matter_type === TAB_LITIGATION) {
      payload.p_official_case_no = clean(tr.querySelector(".f-official")?.value);
      payload.p_internal_case_code = clean(tr.querySelector(".f-internal")?.value) || null;
      payload.p_venue = clean(tr.querySelector(".f-venue")?.value) || null;
      payload.p_case_type = clean(tr.querySelector(".f-case-type")?.value) || null;
      if (!payload.p_official_case_no) throw new Error("Case Number is required for litigation.");
    } else if (matter.matter_type === TAB_SPECIAL) {
      payload.p_special_engagement_code = clean(tr.querySelector(".f-special-code")?.value);
      payload.p_engagement_description = clean(tr.querySelector(".f-engagement-description")?.value) || null;
      payload.p_title = payload.p_engagement_description || payload.p_title;
      payload.p_opened_at = clean(tr.querySelector(".f-opened-at")?.value) || null;
      if (!payload.p_special_engagement_code) throw new Error("Special Engagement Code is required.");
    } else {
      payload.p_retainer_contract_ref = clean(tr.querySelector(".f-contract-ref")?.value) || null;
      payload.p_retainer_period_yyyymm = Number(tr.querySelector(".f-period")?.value || 0) || null;
      if (
        payload.p_retainer_period_yyyymm &&
        (!Number.isInteger(payload.p_retainer_period_yyyymm) || payload.p_retainer_period_yyyymm < 190001 || payload.p_retainer_period_yyyymm > 299912)
      ) {
        throw new Error("Period must be YYYYMM (e.g. 202602).");
      }
    }
    return payload;
  }
  async function upsertAcceptanceFee(tr, matter) {
    if (matter?.matter_type !== TAB_SPECIAL) return;
    const inputEl = tr.querySelector(".f-acceptance-fee");
    if (!inputEl) return;
    const raw = clean(inputEl.value);
    if (!raw) return;
    const nextAmount = Number(raw);
    if (!Number.isFinite(nextAmount) || nextAmount < 0) throw new Error("Acceptance Fee must be a non-negative number.");
    let existing = acceptanceByMatter.get(matter.id) || null;
    if (!existing?.override_id) {
      const found = await supabase
        .from("matter_rate_overrides")
        .select("id,matter_id,rate_code,override_amount,updated_at,created_at")
        .eq("matter_id", matter.id)
        .eq("active", true)
        .limit(50);
      if (found.error) throw found.error;
      const best = (found.data || []).find((r) => clean(r.rate_code).toUpperCase() === "AF");
      if (best) {
        existing = {
          override_id: best.id,
          amount: Number(best.override_amount || 0),
          touched_at: best.updated_at || best.created_at || null,
        };
        acceptanceByMatter.set(matter.id, existing);
      }
    }
    const currentAmount = Number(existing?.amount || 0);
    if (Math.abs(nextAmount - currentAmount) < 0.005) return;

    if (existing?.override_id) {
      const { error } = await supabase
        .from("matter_rate_overrides")
        .update({
          override_amount: nextAmount,
          rate_code: "AF",
          active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.override_id);
      if (error) throw error;
      acceptanceByMatter.set(matter.id, { ...existing, amount: nextAmount });
      return;
    }
    const payload = {
      matter_id: matter.id,
      rate_code: "AF",
      override_amount: nextAmount,
      active: true,
      created_by: ctx.user.id,
    };
    const { data, error } = await supabase
      .from("matter_rate_overrides")
      .insert(payload)
      .select("id,override_amount,updated_at,created_at")
      .single();
    if (error) throw error;
    acceptanceByMatter.set(matter.id, {
      override_id: data.id,
      amount: Number(data.override_amount || 0),
      touched_at: data.updated_at || data.created_at || null,
    });
  }

  async function saveMatterRow(tr) {
    const id = tr.dataset.id;
    const matter = matters.find((x) => String(x.id) === String(id));
    if (!matter) return false;
    const saveMsg = tr.querySelector(".save-msg");
    try {
      const payload = matterPayload(tr, matter);
      const rowStatus = clean(tr.querySelector(".f-status")?.value || matter.status);
      saveMsg.textContent = "Saving...";
      const { data, error } = await supabase.rpc("create_or_update_matter", payload);
      if (error) throw error;
      const patch = Array.isArray(data) ? data[0] : data;
      if (patch?.id) {
        const idx = matters.findIndex((x) => String(x.id) === String(patch.id));
        if (idx >= 0) {
          matters[idx] = { ...matters[idx], ...patch };
          Object.assign(matter, matters[idx]);
        }
      }
      if (rowStatus && rowStatus !== clean(matter.status)) {
        const { error: stErr } = await supabase.from("matters").update({ status: rowStatus }).eq("id", matter.id);
        if (stErr) throw stErr;
        matter.status = rowStatus;
      }
      await upsertAcceptanceFee(tr, matter);
      await refreshSingleMatterSummary(matter.id);
      saveMsg.textContent = `Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      markDirty(tr, false);
      return true;
    } catch (err) {
      saveMsg.textContent = `Error: ${err?.message || err}`;
      return false;
    }
  }
  function activityIncidentLabel(a) {
    const map = parsePipeMap(a?.description);
    const fromDesc = clean(map["incident"]);
    if (fromDesc) return fromDesc;
    return quickCategoryMeta(a?.task_category)?.label || clean(a?.task_category) || "-";
  }
  function activityNotePreview(a) {
    const map = parsePipeMap(a?.description);
    const text = clean(map["minutes"] || map["note"] || map["notes"] || a?.description);
    return text.length > 140 ? `${text.slice(0, 140)}...` : text;
  }
  function activityVenuePreview(a) {
    const map = parsePipeMap(a?.description);
    return clean(map["venue"]) || "-";
  }
  function renderCostSetupTableRows(matter, costModel) {
    const opened = clean(matter?.opened_at) ? fmtDate(matter.opened_at) : "-";
    const acceptanceSource = clean(costModel?.acceptanceSource || "") || "matter pricing setup";
    const costItems = Array.isArray(costModel?.costItems) ? costModel.costItems : [];
    if (!costItems.length) {
      return `
        <tr class="tracker-cost-table-row">
          <td class="tracker-seq">COST</td>
          <td>${escapeHtml(opened)}</td>
          <td>Cost Setup</td>
          <td title="This line is pricing configuration, not an activity entry.">No fixed cost setup encoded yet.</td>
          <td>${escapeHtml(acceptanceSource)}</td>
          <td><strong>Not set</strong></td>
          <td><span class="status-pill">pricing</span></td>
        </tr>
      `;
    }
    return costItems.map((item, idx) => `
      <tr class="tracker-cost-table-row">
        <td class="tracker-seq">COST-${idx + 1}</td>
        <td>${escapeHtml(opened)}</td>
        <td>${escapeHtml(item.label)}</td>
        <td title="This line is pricing configuration, not an activity entry.">${escapeHtml(item.code)}</td>
        <td>${escapeHtml(item.source || acceptanceSource)}</td>
        <td><strong>${escapeHtml(formatCostValue(item))}</strong></td>
        <td><span class="status-pill">pricing</span></td>
      </tr>
    `).join("");
  }
  function renderActivityTableRows(rows) {
    return rows.length
      ? rows.map((a, idx) => {
        const amt = Number(a.amount || 0);
        return `<tr><td class="tracker-seq">${idx + 1}</td><td>${escapeHtml(fmtDate(a.occurred_at))}</td><td>${escapeHtml(activityIncidentLabel(a))}</td><td title="${escapeHtml(clean(a.description || ""))}">${escapeHtml(activityNotePreview(a) || "-")}</td><td>${escapeHtml(activityVenuePreview(a))}</td><td>${amt ? `P${escapeHtml(fmtPeso(amt))}` : "-"}</td><td><span class="${statusPillClass(a.status)}">${escapeHtml(clean(a.status) || "-")}</span></td></tr>`;
      }).join("")
      : `<tr><td colspan="7" class="muted">No activity rows yet.</td></tr>`;
  }
  function renderCostSetupLine(matter, costModel) {
    const opened = clean(matter?.opened_at) ? fmtDate(matter.opened_at) : "-";
    const acceptance = Number(costModel?.acceptanceAmount || 0);
    const acceptanceText = acceptance > 0 ? `P${fmtPeso(acceptance)}` : "Not set";
    const acceptanceSource = clean(costModel?.acceptanceSource || "");
    const costItems = Array.isArray(costModel?.costItems) ? costModel.costItems : [];
    const costBreakdown = costItems.length
      ? costItems.map((item) => `<span class="tracker-cost-pill">${escapeHtml(formatCostItem(item))}</span>`).join("")
      : `<span class="tracker-cost-pill">No cost setup encoded yet.</span>`;
    return `
      <div class="tracker-cost-head">
        <div class="tracker-cost-title">Cost Setup (separate from activity rows)</div>
        <div class="tracker-cost-row">
          <span><strong>Date of Engagement:</strong> ${escapeHtml(opened)}</span>
          <span><strong>Acceptance/Professional Fee:</strong> ${escapeHtml(acceptanceText)}</span>
          <span class="muted">${escapeHtml(acceptanceSource ? `Source: ${acceptanceSource}` : "Source: matter pricing setup")}</span>
        </div>
        <div class="tracker-cost-row tracker-cost-pills">
          ${costBreakdown}
        </div>
      </div>
    `;
  }
  function applyDocCellUi(tr, matterId) {
    const doc = docsByMatter.get(matterId);
    const savedAttachments = Array.isArray(doc?.attachment_urls) ? doc.attachment_urls.filter(Boolean) : [];
    const cell = tr?.querySelector(".doc-cell");
    if (!cell) return;
    cell.dataset.attachments = encodeAttachments(savedAttachments);
    const list = cell.querySelector(".doc-list");
    if (list) list.innerHTML = buildDocListHtml(savedAttachments);
    const clearBtn = cell.querySelector(".clear-doc");
    if (clearBtn) clearBtn.disabled = !savedAttachments.length;
    const uploadBtn = cell.querySelector(".upload-doc");
    if (uploadBtn) uploadBtn.textContent = savedAttachments.length ? "Add PDF" : "Upload PDF";
  }
  async function refreshSingleMatterSummary(matterId) {
    const { data, error } = await supabase
      .from("activities")
      .select("id,matter_id,status,occurred_at,created_at,task_category,entry_class,fee_code,amount,attachment_urls")
      .eq("matter_id", matterId)
      .order("occurred_at", { ascending: false })
      .limit(1200);
    if (error) throw error;

    const rows = data || [];
    const { summary, latestDoc } = summarizeMatterActivities(rows);
    summariesByMatter.set(matterId, summary);
    if (latestDoc) docsByMatter.set(matterId, latestDoc);
    else docsByMatter.delete(matterId);

    const tr = bodyEl.querySelector(`tr[data-kind="matter"][data-id="${matterId}"]`);
    if (tr) {
      applyDocCellUi(tr, matterId);
      const summaryCell = tr.querySelector(".summary-cell");
      if (summaryCell) summaryCell.innerHTML = renderSummaryCell(matterId);
      const opexCell = tr.querySelector(".opex-cell");
      if (opexCell) opexCell.innerHTML = renderRetainerOpexCell(matterId);
    }

    if (currentTab === TAB_RETAINER) {
      try {
        const matter = matters.find((x) => String(x.id) === String(matterId));
        const { data: qData, error: qErr } = await supabase.rpc("get_retainer_quota_balance", {
          p_matter_id: matterId,
          p_period_yyyymm: Number(matter?.retainer_period_yyyymm || 0) || null,
        });
        if (!qErr) quotasByMatter.set(matterId, normalizeRetainerQuota(qData));
      } catch {
        // ignore quota refresh failures
      }
      const tr2 = bodyEl.querySelector(`tr[data-kind="matter"][data-id="${matterId}"]`);
      if (tr2) {
        const quotaCell = tr2.querySelector(".quota-cell");
        if (quotaCell) quotaCell.innerHTML = renderRetainerQuotaCell(matterId);
      }
    }
  }
  async function openMatterEntriesModal(matter) {
    if (!matter?.id || !matter?.account_id) return;
    const overlay = document.createElement("div");
    overlay.className = "ui-modal-overlay";
    overlay.innerHTML = `
      <div class="ui-modal tracker-entries-modal" role="dialog" aria-modal="true" aria-label="Tracker Entries">
        <div class="ui-modal-head">
          <h3 class="ui-modal-title">Tracker Entries</h3>
          <div class="muted tracker-entries-sub">${escapeHtml(clean(matter.title) || "(untitled)")} | ${escapeHtml(clean(matter.matter_type))}</div>
        </div>
        <div class="ui-modal-body tracker-entries-body">
          <section class="tracker-cost-setup entries-cost-setup">
            <div class="muted">Loading cost setup...</div>
          </section>
          <div class="table-wrap tracker-cost-table-wrap">
            <table class="tracker-entries-table tracker-cost-table">
              <thead><tr><th>#</th><th>Date</th><th>Cost Item</th><th>Source Code</th><th>Source</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody class="entries-cost-body"><tr><td colspan="7" class="muted">Loading cost lines...</td></tr></tbody>
            </table>
          </div>
          <div class="tracker-entries-section-title">Activity Logs</div>
          <div class="table-wrap tracker-entries-table-wrap">
            <table class="tracker-entries-table">
              <thead><tr><th>#</th><th>Date</th><th>Incident</th><th>Notes / Minutes</th><th>Venue</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody class="entries-activity-body"><tr><td colspan="7" class="muted">Loading activity rows...</td></tr></tbody>
            </table>
          </div>
          <hr/>
          <div class="tracker-entries-form">
            <div><label>Date</label><input type="date" class="entry-date" /></div>
            <div><label>Category</label><select class="entry-category">${quickCategoryOptions("communication")}</select></div>
            <div><label>Status</label><select class="entry-status"><option value="pending">pending</option><option value="draft">draft</option></select></div>
            <div><label>Amount (PHP)</label><input type="number" class="entry-amount" min="0" step="0.01" value="0" /></div>
            <div class="tracker-entries-span2"><label>Minutes / Notes</label><input type="text" class="entry-note" placeholder="What happened?" /></div>
            <div class="tracker-entries-span2"><label>Venue (optional)</label><input type="text" class="entry-venue" placeholder="Location or channel" /></div>
          </div>
          <div class="muted tracker-entries-footnote">OPEX rows are saved as draft until receipt is attached.</div>
          <p class="msg tracker-entries-msg"></p>
        </div>
        <div class="ui-modal-actions">
          <button type="button" class="btn open-full">Open Full Activities</button>
          <button type="button" class="btn btn-primary add-entry">Add Activity</button>
          <button type="button" class="btn close-modal">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const entriesCostBody = overlay.querySelector(".entries-cost-body");
    const entriesActivityBody = overlay.querySelector(".entries-activity-body");
    const msg = overlay.querySelector(".tracker-entries-msg");
    const costSetupEl = overlay.querySelector(".entries-cost-setup");
    const dateInput = overlay.querySelector(".entry-date");
    const categoryInput = overlay.querySelector(".entry-category");
    const statusInput = overlay.querySelector(".entry-status");
    const amountInput = overlay.querySelector(".entry-amount");
    const noteInput = overlay.querySelector(".entry-note");
    const venueInput = overlay.querySelector(".entry-venue");
    const closeBtn = overlay.querySelector(".close-modal");
    const addBtn = overlay.querySelector(".add-entry");
    const openFullBtn = overlay.querySelector(".open-full");

    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    dateInput.value = `${now.getFullYear()}-${mm}-${dd}`;
    noteInput.focus();

    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      window.removeEventListener("keydown", onEsc);
      overlay.remove();
    };
    const onEsc = (evt) => {
      if (evt.key !== "Escape") return;
      evt.preventDefault();
      close();
    };
    window.addEventListener("keydown", onEsc);
    overlay.addEventListener("click", (evt) => {
      if (evt.target === overlay) close();
    });
    closeBtn.addEventListener("click", close);

    const loadEntries = async () => {
      msg.textContent = "Loading entries...";
      if (costSetupEl) costSetupEl.innerHTML = `<div class="muted">Loading cost setup...</div>`;
      const { data, error } = await supabase
        .from("activities")
        .select("id,matter_id,status,occurred_at,created_at,task_category,entry_class,amount,description,attachment_urls")
        .eq("matter_id", matter.id)
        .order("occurred_at", { ascending: false })
        .limit(500);
      if (error) {
        if (entriesCostBody) entriesCostBody.innerHTML = `<tr><td colspan="7" class="muted">Load failed.</td></tr>`;
        if (entriesActivityBody) entriesActivityBody.innerHTML = `<tr><td colspan="7" class="muted">Load failed.</td></tr>`;
        msg.textContent = `Error: ${error.message}`;
        return;
      }
      const rows = data || [];
      let acceptanceAmount = Number(acceptanceByMatter.get(matter.id)?.amount || 0);
      let acceptanceSource = acceptanceAmount > 0 ? "matter override (AF)" : "";
      let costItems = [];
      try {
        const { data: mroRows, error: mroErr } = await supabase
          .from("matter_rate_overrides")
          .select("rate_code,override_amount,active,updated_at,created_at,id")
          .eq("matter_id", matter.id)
          .eq("active", true)
          .limit(50);
        if (!mroErr) {
          costItems = buildCostItemsFromOverrides(mroRows || []);
          const af = (mroRows || []).find((r) => normalizeRateCode(r.rate_code) === "AF");
          if (af) {
            acceptanceAmount = Number(af.override_amount || 0);
            acceptanceSource = "matter override (AF)";
            acceptanceByMatter.set(matter.id, {
              override_id: af.id,
              amount: acceptanceAmount,
              touched_at: af.updated_at || af.created_at || null,
            });
          } else {
            const rpc = await supabase.rpc("resolve_activity_rate", { p_matter_id: matter.id, p_rate_code: "AF" });
            if (!rpc.error && Array.isArray(rpc.data) && rpc.data.length) {
              acceptanceAmount = Number(rpc.data[0].rate_amount || 0);
              acceptanceSource = clean(rpc.data[0].rate_source || "global rate");
              if (acceptanceAmount > 0 && !costItems.some((x) => normalizeRateCode(x.code) === "AF")) {
                costItems.unshift({
                  code: "AF",
                  label: "Acceptance Fee",
                  format: "currency",
                  value: acceptanceAmount,
                  source: acceptanceSource,
                });
              }
            }
          }
        }
      } catch {
        // Keep UI resilient if cost lookup fails.
      }
      const costModel = { acceptanceAmount, acceptanceSource, costItems };
      if (entriesCostBody) entriesCostBody.innerHTML = renderCostSetupTableRows(matter, costModel);
      if (entriesActivityBody) entriesActivityBody.innerHTML = renderActivityTableRows(rows);
      if (costSetupEl) costSetupEl.innerHTML = renderCostSetupLine(matter, costModel);
      const { summary, latestDoc } = summarizeMatterActivities(rows);
      summariesByMatter.set(matter.id, summary);
      if (latestDoc) docsByMatter.set(matter.id, latestDoc);
      else docsByMatter.delete(matter.id);
      try {
        await refreshSingleMatterSummary(matter.id);
      } catch {
        // ignore row refresh failures inside modal
      }
      msg.textContent = `${rows.length} activity row(s) found. Cost lines: ${costItems.length}.`;
    };

    addBtn.addEventListener("click", async () => {
      const dateValue = clean(dateInput.value);
      const category = clean(categoryInput.value).toLowerCase();
      const note = clean(noteInput.value);
      const venue = clean(venueInput.value);
      const amount = Number(amountInput.value || 0);
      const meta = quickCategoryMeta(category);
      if (!dateValue) { msg.textContent = "Date is required."; return; }
      if (!Number.isFinite(amount) || amount < 0) { msg.textContent = "Amount must be zero or positive."; return; }
      if (!note && amount <= 0) { msg.textContent = "Enter notes or amount."; return; }

      const isOpex = clean(meta.entry_class) === "opex";
      const status = isOpex ? "draft" : (clean(statusInput.value).toLowerCase() === "draft" ? "draft" : "pending");
      const occurredAt = new Date(`${dateValue}T09:00:00`);
      const ref = clean(matter.retainer_contract_ref);
      const period = clean(matter.retainer_period_yyyymm);
      const legacyIdentifier = matter.matter_type === TAB_LITIGATION
        ? clean(matter.official_case_no) || null
        : matter.matter_type === TAB_SPECIAL
          ? clean(matter.special_engagement_code) || null
          : (ref && period ? `${ref}-${period}` : (ref || null));

      const payload = {
        account_id: matter.account_id,
        matter_id: matter.id,
        matter: clean(matter.title) || null,
        created_by: ctx.user.id,
        performed_by: ctx.user.id,
        handling_lawyer_id: matter.handling_lawyer_id || null,
        activity_type: meta.activity_type,
        fee_code: meta.fee_code,
        task_category: meta.value,
        entry_class: meta.entry_class,
        expense_type: meta.expense_type,
        description: `Tracker Entry | Incident: ${meta.label} | Minutes: ${note || "-"} | Venue: ${venue || "-"} | Source: tracker_workspace_v2`,
        minutes: 0,
        status,
        occurred_at: occurredAt.toISOString(),
        billable: clean(meta.entry_class) !== "misc",
        billing_status: clean(meta.entry_class) === "misc" ? "non_billable" : "billable",
        amount,
        attachment_urls: null,
        submitted_at: status === "pending" ? new Date().toISOString() : null,
        draft_expires_at: status === "draft" ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null,
        legacy_identifier_text: legacyIdentifier,
      };

      try {
        msg.textContent = "Adding activity...";
        const { error } = await supabase.from("activities").insert(payload);
        if (error) throw error;
        noteInput.value = "";
        venueInput.value = "";
        amountInput.value = "0";
        await loadEntries();
        msg.textContent = `Activity added to ${clean(matter.title) || "matter"}.`;
      } catch (err) {
        msg.textContent = `Add failed: ${err?.message || err}`;
      }
    });

    openFullBtn.addEventListener("click", () => {
      close();
      openMatterInActivities(matter);
    });

    await loadEntries();
  }
  async function ensureDocActivity(matterId) {
    const doc = docsByMatter.get(matterId);
    if (doc?.id) return doc;
    const matter = matters.find((x) => String(x.id) === String(matterId));
    if (!matter) throw new Error("Matter not found.");
    const payload = {
      account_id: matter.account_id,
      matter_id: matter.id,
      matter: matter.title,
      created_by: ctx.user.id,
      performed_by: ctx.user.id,
      handling_lawyer_id: matter.handling_lawyer_id || null,
      activity_type: "communication",
      entry_class: "misc",
      description: "Engagement file | Source: tracker_workspace_v2",
      minutes: 0,
      status: "draft",
      occurred_at: new Date().toISOString(),
      billable: false,
      billing_status: "non_billable",
      task_category: "contract_agreement",
      amount: 0,
      attachment_urls: null,
    };
    const { data, error } = await supabase.from("activities").insert(payload).select("id,matter_id,attachment_urls,occurred_at,created_at").single();
    if (error) throw error;
    docsByMatter.set(matterId, data);
    return data;
  }

  async function uploadDoc(tr, input) {
    const file = input?.files?.[0] || null;
    input.value = "";
    if (!file) return;
    const matterId = tr.dataset.id;
    const saveMsg = tr.querySelector(".save-msg");
    try {
      saveMsg.textContent = "Uploading...";
      const path = await uploadMatterPdf({ userId: ctx.user.id, matterId, file });
      const doc = await ensureDocActivity(matterId);
      const current = Array.isArray(doc.attachment_urls) ? doc.attachment_urls.filter(Boolean) : [];
      const next = current.concat([path]);
      let savedDoc = null;
      const updated = await supabase
        .from("activities")
        .update({ attachment_urls: next, description: "Engagement file | Source: tracker_workspace_v2" })
        .eq("id", doc.id)
        .select("id,matter_id,attachment_urls,occurred_at,created_at")
        .single();

      if (updated.error) {
        const matter = matters.find((x) => String(x.id) === String(matterId));
        const fallbackInsert = await supabase
          .from("activities")
          .insert({
            account_id: matter?.account_id,
            matter_id: matter?.id,
            matter: matter?.title || null,
            created_by: ctx.user.id,
            performed_by: ctx.user.id,
            handling_lawyer_id: matter?.handling_lawyer_id || null,
            activity_type: "communication",
            entry_class: "misc",
            description: "Engagement file | Source: tracker_workspace_v2",
            minutes: 0,
            status: "draft",
            occurred_at: new Date().toISOString(),
            billable: false,
            billing_status: "non_billable",
            task_category: "contract_agreement",
            amount: 0,
            attachment_urls: [path],
          })
          .select("id,matter_id,attachment_urls,occurred_at,created_at")
          .single();
        if (fallbackInsert.error) throw updated.error;
        savedDoc = fallbackInsert.data;
      } else {
        savedDoc = updated.data;
      }

      docsByMatter.set(matterId, savedDoc);
      const cell = tr.querySelector(".doc-cell");
      if (cell) {
        const savedAttachments = Array.isArray(savedDoc?.attachment_urls) ? savedDoc.attachment_urls.filter(Boolean) : [];
        cell.dataset.attachments = encodeAttachments(savedAttachments);
        const list = cell.querySelector(".doc-list");
        if (list) list.innerHTML = buildDocListHtml(savedAttachments);
        const clearBtn = cell.querySelector(".clear-doc");
        if (clearBtn) clearBtn.disabled = !savedAttachments.length;
        const uploadBtn = cell.querySelector(".upload-doc");
        if (uploadBtn) uploadBtn.textContent = savedAttachments.length ? "Add PDF" : "Upload PDF";
      }
      saveMsg.textContent = "PDF uploaded.";
    } catch (err) {
      saveMsg.textContent = `Upload failed: ${err?.message || err}`;
    }
  }

  async function clearDocs(tr) {
    const matterId = tr.dataset.id;
    const saveMsg = tr.querySelector(".save-msg");
    const doc = docsByMatter.get(matterId);
    if (!doc?.id) { saveMsg.textContent = "No file to clear."; return; }
    try {
      saveMsg.textContent = "Clearing...";
      const existingAttachments = Array.isArray(doc.attachment_urls) ? doc.attachment_urls.filter(Boolean) : [];
      let clearedDoc = null;
      const updated = await supabase
        .from("activities")
        .update({ attachment_urls: null, description: "Engagement file | Source: tracker_workspace_v2" })
        .eq("id", doc.id)
        .select("id,matter_id,attachment_urls,occurred_at,created_at")
        .single();

      if (updated.error) {
        const matter = matters.find((x) => String(x.id) === String(matterId));
        const fallbackInsert = await supabase
          .from("activities")
          .insert({
            account_id: matter?.account_id,
            matter_id: matter?.id,
            matter: matter?.title || null,
            created_by: ctx.user.id,
            performed_by: ctx.user.id,
            handling_lawyer_id: matter?.handling_lawyer_id || null,
            activity_type: "communication",
            entry_class: "misc",
            description: "Engagement file | Source: tracker_workspace_v2",
            minutes: 0,
            status: "draft",
            occurred_at: new Date().toISOString(),
            billable: false,
            billing_status: "non_billable",
            task_category: "contract_agreement",
            amount: 0,
            attachment_urls: null,
          })
          .select("id,matter_id,attachment_urls,occurred_at,created_at")
          .single();
        if (fallbackInsert.error) throw updated.error;
        clearedDoc = fallbackInsert.data;
      } else {
        clearedDoc = updated.data;
      }

      for (const path of existingAttachments) {
        const split = splitBucketAndPath(path);
        if (!split.path) continue;
        try {
          await supabase.storage.from(split.bucket || RECEIPTS_BUCKET).remove([split.path]);
        } catch (err) {
          // Ignore storage-delete failures; db marker still controls current UI state.
        }
      }

      docsByMatter.set(matterId, clearedDoc);
      const cell = tr.querySelector(".doc-cell");
      if (cell) {
        cell.dataset.attachments = encodeAttachments([]);
        const list = cell.querySelector(".doc-list");
        if (list) list.innerHTML = buildDocListHtml([]);
        const clearBtn = cell.querySelector(".clear-doc");
        if (clearBtn) clearBtn.disabled = true;
        const uploadBtn = cell.querySelector(".upload-doc");
        if (uploadBtn) uploadBtn.textContent = "Upload PDF";
      }
      saveMsg.textContent = "File cleared.";
    } catch (err) {
      saveMsg.textContent = `Clear failed: ${err?.message || err}`;
    }
  }

  async function addMisc(tr) {
    const matterId = tr.dataset.id;
    const matter = matters.find((x) => String(x.id) === String(matterId));
    const saveMsg = tr.querySelector(".save-msg");
    if (!matter) return;
    const noteInput = await uiPrompt({
      title: "Add Misc Activity",
      message: "Enter a note for this misc tracker entry.",
      label: "Note",
      defaultValue: "Miscellaneous tracker entry",
      confirmText: "Next",
    });
    if (noteInput == null) return;
    const amountInput = await uiPrompt({
      title: "Add Misc Activity",
      message: "Enter amount (PHP).",
      label: "Amount",
      defaultValue: "0",
      required: true,
      validate: (value) => {
        const n = Number(value || 0);
        if (!Number.isFinite(n) || n < 0) return "Amount must be a non-negative number.";
        return "";
      },
      confirmText: "Add",
    });
    if (amountInput == null) return;
    const note = clean(noteInput) || "";
    const amount = Number(amountInput || 0);
    if (!Number.isFinite(amount) || amount < 0) { saveMsg.textContent = "Amount must be non-negative."; return; }
    const payload = {
      account_id: matter.account_id,
      matter_id: matter.id,
      matter: matter.title,
      created_by: ctx.user.id,
      performed_by: ctx.user.id,
      handling_lawyer_id: clean(tr.querySelector(".f-lawyer")?.value) || matter.handling_lawyer_id || null,
      activity_type: "communication",
      entry_class: "misc",
      description: `Misc: ${clean(note) || "-"} | Source: tracker_workspace_v2`,
      minutes: 0,
      status: "pending",
      occurred_at: new Date().toISOString(),
      billable: false,
      billing_status: "non_billable",
      task_category: "miscellaneous",
      amount,
      attachment_urls: null,
    };
    try {
      saveMsg.textContent = "Adding misc...";
      const { error } = await supabase.from("activities").insert(payload);
      if (error) throw error;
      saveMsg.textContent = "Misc activity added.";
      await loadData();
    } catch (err) {
      saveMsg.textContent = `Add misc failed: ${err?.message || err}`;
    }
  }

  async function archiveMatter(tr) {
    const matterId = tr.dataset.id;
    const saveMsg = tr.querySelector(".save-msg");
    const ok = await uiConfirm({
      title: "Archive Tracker Row",
      message: "Delete this tracker row? It will be archived.",
      confirmText: "Archive",
      danger: true,
    });
    if (!ok) return;
    try {
      saveMsg.textContent = "Archiving...";
      const { error } = await supabase.from("matters").update({ status: "archived", closed_at: new Date().toISOString().slice(0, 10) }).eq("id", matterId);
      if (error) throw error;
      const idx = matters.findIndex((m) => String(m.id) === String(matterId));
      if (idx >= 0) matters[idx].status = "archived";
      await render();
    } catch (err) {
      saveMsg.textContent = `Archive failed: ${err?.message || err}`;
    }
  }

  async function convertLegacy(tr) {
    const row = legacyRows.find((x) => String(x.id) === String(tr.dataset.id));
    if (!row) return;
    const acc = accountsById.get(row.account_id);
    if (!acc) { msgEl.textContent = "Legacy row account missing."; return; }
    const map = parsePipeMap(row.description);
    const parsed = legacyIdentifierPreview(row, currentTab);
    let official = null; let special = null; let contract = null; let period = null;
    if (currentTab === TAB_LITIGATION) {
      const input = await uiPrompt({
        title: "Convert Legacy Row",
        message: "Case Number is required for litigation.",
        label: "Case Number",
        defaultValue: parsed || "",
        required: true,
        confirmText: "Convert",
      });
      if (input == null) return;
      official = clean(input);
      if (!official) return;
    } else if (currentTab === TAB_SPECIAL) {
      const input = await uiPrompt({
        title: "Convert Legacy Row",
        message: "Tracker Link Code / Special Engagement Code is required (e.g. ALYN).",
        label: "Special code",
        defaultValue: parsed || "",
        required: true,
        confirmText: "Convert",
      });
      if (input == null) return;
      special = clean(input);
      if (!special) return;
    }
    else {
      const contractInput = await uiPrompt({
        title: "Convert Legacy Row",
        message: "Contract Ref is optional for retainer. Leave blank to auto-generate.",
        label: "Contract Ref",
        defaultValue: parsed || "",
        required: false,
        confirmText: "Convert",
      });
      if (contractInput == null) return;
      contract = clean(contractInput) || null;
      period = Number(new Date(row.occurred_at || Date.now()).toISOString().slice(0, 7).replace("-", "")) || null;
    }
    try {
      msgEl.textContent = "Creating structured matter...";
      const { data, error } = await supabase.rpc("create_or_update_matter", {
        p_matter_id: null,
        p_account_id: row.account_id,
        p_matter_type: currentTab,
        p_title: clean(row.matter) || `Legacy ${currentTab}`,
        p_handling_lawyer_id: row.handling_lawyer_id || null,
        p_opened_at: row.occurred_at ? String(row.occurred_at).slice(0, 10) : null,
        p_official_case_no: official,
        p_internal_case_code: clean(map["internal case code"] || "") || null,
        p_special_engagement_code: special,
        p_retainer_contract_ref: contract,
        p_retainer_period_yyyymm: period,
        p_company_name: clean(acc.account_kind) === "company" ? clean(acc.title) : null,
        p_personal_name: clean(acc.account_kind) === "personal" ? clean(acc.title) : null,
        p_case_type: clean(map["case type"] || "") || null,
        p_venue: clean(map["venue"] || "") || null,
        p_engagement_description: clean(map["remarks"] || map["update"] || row.matter || "") || null,
      });
      if (error) throw error;
      const created = Array.isArray(data) ? data[0] : data;
      if (!created?.id) throw new Error("Matter creation failed.");
      const { error: updErr } = await supabase.from("activities").update({ matter_id: created.id, legacy_identifier_text: parsed || row.matter || null }).eq("id", row.id);
      if (updErr) throw updErr;
      msgEl.textContent = "Legacy row converted.";
      await loadData();
    } catch (err) {
      msgEl.textContent = `Convert failed: ${err?.message || err}`;
    }
  }
  async function saveAllDirty() {
    const targets = dirtyRows();
    if (!targets.length) { msgEl.textContent = "No unsaved changes."; return; }
    saveAllBtn.disabled = true;
    msgEl.textContent = `Saving ${targets.length} row(s)...`;
    let okCount = 0;
    for (const tr of targets) { const ok = await saveMatterRow(tr); if (ok) okCount += 1; }
    msgEl.textContent = okCount === targets.length ? `Saved ${okCount} row(s).` : `Saved ${okCount}/${targets.length}.`;
    const n = dirtyRows().length;
    saveAllBtn.disabled = n === 0;
    saveAllBtn.textContent = n ? `Save ${n} Change${n > 1 ? "s" : ""}` : "Save Changes";
  }

  async function loadData() {
    msgEl.textContent = "Loading...";
    bodyEl.innerHTML = `<tr><td class="muted">Loading...</td></tr>`;
    const [matterRes, lawyersRows, legacyRes] = await Promise.all([
      supabase.from("matters").select("id,account_id,matter_type,title,status,handling_lawyer_id,opened_at,closed_at,created_by,created_at,official_case_no,internal_case_code,special_engagement_code,retainer_contract_ref,retainer_period_yyyymm,company_name,personal_name,case_type,venue,engagement_description").order("created_at", { ascending: false }).limit(5000),
      loadLawyers(),
      supabase.from("activities").select("id,account_id,matter,description,status,occurred_at,task_category,handling_lawyer_id").is("matter_id", null).order("occurred_at", { ascending: false }).limit(4000),
    ]);
    if (matterRes.error) { msgEl.textContent = `Error loading matters: ${matterRes.error.message}`; return; }
    if (legacyRes.error) { msgEl.textContent = `Error loading legacy rows: ${legacyRes.error.message}`; return; }

    matters = matterRes.data || [];
    lawyers = lawyersRows || [];
    legacyRows = legacyRes.data || [];

    const accountIds = Array.from(new Set([...matters.map((m) => m.account_id), ...legacyRows.map((r) => r.account_id)].filter(Boolean)));
    const matterIds = matters.map((m) => m.id);
    const [accRes, actRes, overrideRes] = await Promise.all([
      accountIds.length ? supabase.from("accounts").select("id,title,category,account_kind,is_archived").in("id", accountIds) : Promise.resolve({ data: [], error: null }),
      matterIds.length ? supabase.from("activities").select("id,matter_id,status,occurred_at,created_at,task_category,entry_class,fee_code,amount,attachment_urls").in("matter_id", matterIds).order("occurred_at", { ascending: false }).limit(12000) : Promise.resolve({ data: [], error: null }),
      matterIds.length ? supabase.from("matter_rate_overrides").select("id,matter_id,rate_code,override_amount,active,updated_at,created_at").in("matter_id", matterIds).eq("active", true).limit(10000) : Promise.resolve({ data: [], error: null }),
    ]);
    if (accRes.error) { msgEl.textContent = `Error loading accounts: ${accRes.error.message}`; return; }
    if (actRes.error) { msgEl.textContent = `Error loading activity summaries: ${actRes.error.message}`; return; }
    if (overrideRes.error) { msgEl.textContent = `Error loading rate overrides: ${overrideRes.error.message}`; return; }

    accountsById = new Map((accRes.data || []).map((a) => [a.id, a]));
    summariesByMatter = new Map();
    docsByMatter = new Map();
    quotasByMatter = new Map();
    quotaLoadsByMatter = new Map();
    acceptanceByMatter = new Map();

    for (const r of overrideRes.data || []) {
      if (clean(r.rate_code).toUpperCase() !== "AF") continue;
      const key = r.matter_id;
      if (!key) continue;
      const current = acceptanceByMatter.get(key);
      const currTs = new Date(current?.touched_at || 0).getTime();
      const nextTs = new Date(r.updated_at || r.created_at || 0).getTime();
      if (!current || nextTs >= currTs) {
        acceptanceByMatter.set(key, {
          override_id: r.id,
          amount: Number(r.override_amount || 0),
          touched_at: r.updated_at || r.created_at || null,
        });
      }
    }

    for (const a of actRes.data || []) {
      const key = a.matter_id;
      if (!key) continue;
      if (!summariesByMatter.has(key)) summariesByMatter.set(key, { latest_status: a.status, latest_occurred_at: a.occurred_at || a.created_at, pending_count: 0, draft_count: 0, opex_total: 0, total_count: 0 });
      const s = summariesByMatter.get(key);
      s.total_count += 1;
      if (clean(a.status).toLowerCase() === "pending") s.pending_count += 1;
      if (clean(a.status).toLowerCase() === "draft") s.draft_count += 1;
      const task = clean(a.task_category).toLowerCase();
      const isOpex = clean(a.entry_class).toLowerCase() === "opex" || ["notary_fee", "ope_printing", "ope_envelope", "ope_lbc", "ope_transpo", "ope_manhours"].includes(task);
      if (isOpex) s.opex_total += Number(a.amount || 0);
      const isDocRow = clean(a.task_category).toLowerCase() === "contract_agreement";
      if (isDocRow) {
        const curr = docsByMatter.get(key);
        const currTs = new Date(curr?.occurred_at || curr?.created_at || 0).getTime();
        const nextTs = new Date(a.occurred_at || a.created_at || 0).getTime();
        if (!curr || nextTs >= currTs) docsByMatter.set(key, a);
      }
    }

    page = 1;
    msgEl.textContent = "";
    await render();
  }

  tabsEl.addEventListener("click", async (e) => {
    const btn = e.target.closest(".tracker-tab");
    if (!btn) return;
    if (!(await confirmDiscardUnsaved())) return;
    currentTab = btn.dataset.tab;
    page = 1;
    tabsEl.querySelectorAll(".tracker-tab").forEach((x) => x.classList.toggle("active", x === btn));
    await render();
  });
  bodyEl.addEventListener("input", (e) => { const tr = e.target.closest("tr[data-kind='matter']"); if (tr) markDirty(tr, true); });
  bodyEl.addEventListener("change", async (e) => {
    const tr = e.target.closest("tr[data-kind='matter']");
    if (tr) markDirty(tr, true);
    const fileInput = e.target.closest(".doc-file");
    if (fileInput) { const row = fileInput.closest("tr[data-kind='matter']"); if (row) await uploadDoc(row, fileInput); }
  });
  bodyEl.addEventListener("click", async (e) => {
    const saveBtn = e.target.closest(".save-row");
    if (saveBtn) { const tr = saveBtn.closest("tr[data-kind='matter']"); if (tr) await saveMatterRow(tr); return; }
    const archiveBtn = e.target.closest(".archive-row");
    if (archiveBtn) { const tr = archiveBtn.closest("tr[data-kind='matter']"); if (tr) await archiveMatter(tr); return; }
    const miscBtn = e.target.closest(".add-misc");
    if (miscBtn) { const tr = miscBtn.closest("tr[data-kind='matter']"); if (tr) await addMisc(tr); return; }
    const entriesBtn = e.target.closest(".open-matter-entries");
    if (entriesBtn) {
      const matterId = clean(entriesBtn.dataset.id || entriesBtn.closest("tr[data-kind='matter']")?.dataset.id);
      const matter = matters.find((x) => String(x.id) === String(matterId));
      if (matter) await openMatterEntriesModal(matter);
      return;
    }
    const uploadBtn = e.target.closest(".upload-doc");
    if (uploadBtn) { const tr = uploadBtn.closest("tr[data-kind='matter']"); tr?.querySelector(".doc-file")?.click(); return; }
    const clearBtn = e.target.closest(".clear-doc");
    if (clearBtn) { const tr = clearBtn.closest("tr[data-kind='matter']"); if (tr) await clearDocs(tr); return; }
    const docLink = e.target.closest(".doc-link");
    if (docLink) {
      e.preventDefault();
      try {
        const cell = docLink.closest(".doc-cell");
        const list = decodeAttachments(cell?.dataset.attachments);
        const path = list[Number(docLink.dataset.idx || 0)];
        if (!path) return;
        const url = await createSignedUrl(path);
        if (url) window.open(url, "_blank", "noopener");
      } catch (err) {
        msgEl.textContent = `Open file failed: ${err?.message || err}`;
      }
      return;
    }
    const convertBtn = e.target.closest(".convert-legacy");
    if (convertBtn) { const tr = convertBtn.closest("tr[data-kind='legacy']"); if (tr) await convertLegacy(tr); }
  });

  searchEl.addEventListener("input", async () => { if (!(await confirmDiscardUnsaved())) return; page = 1; await render(); });
  accountEl.addEventListener("change", async () => { if (!(await confirmDiscardUnsaved())) return; page = 1; await render(); });
  statusEl.addEventListener("change", async () => { if (!(await confirmDiscardUnsaved())) return; page = 1; await render(); });
  showArchivedEl?.addEventListener("change", async () => { if (!(await confirmDiscardUnsaved())) return; page = 1; await render(); });
  pageSizeEl.addEventListener("change", async () => { if (!(await confirmDiscardUnsaved())) return; pageSize = PAGE_SIZE_OPTIONS.includes(Number(pageSizeEl.value)) ? Number(pageSizeEl.value) : 50; page = 1; await render(); });
  prevBtn.addEventListener("click", async () => { if (!(await confirmDiscardUnsaved())) return; if (page <= 1) return; page -= 1; await render(); });
  nextBtn.addEventListener("click", async () => { if (!(await confirmDiscardUnsaved())) return; if (page >= lastTotalPages) return; page += 1; await render(); });
  reloadBtn.addEventListener("click", async () => { if (!(await confirmDiscardUnsaved())) return; await loadData(); });
  saveAllBtn.addEventListener("click", saveAllDirty);

  await loadData();
}
