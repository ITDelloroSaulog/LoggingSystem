import { supabase } from "../supabaseClient.js";
import { escapeHtml } from "../ui/escapeHtml.js";
import { EntryClass, TASK_TO_EXPENSE_TYPE, TASK_DISPLAY_LABEL } from "../domainTypes.js";
import { uiAlert, uiConfirm } from "../ui/modal.js";

// Excel-like, less confusing "Activities" entry.
// Each filled row becomes a row in public.activities (draft/pending/etc).

const RECEIPTS_BUCKET = "receipts";
const ACTIVITY_PREFILL_KEY = "lfp.activity_prefill";
const DEFAULT_ROWS = 1;
const MAX_ROWS = 20;
const HANDLING_LAWYER_ROLES = ["lawyer"];

// Core categories requested (organized UI only; keep underlying fee codes).
// Receipt required by default for OPE expense categories (except man hour).
const CATEGORIES = [
  { value: "appearance_fee", label: "Appearance", fee_code: "AF", needs_receipt: false, group: "activity", line_kind: "activity" },
  { value: "pleading_major", label: "Pleading", fee_code: "PF", needs_receipt: false, group: "activity", line_kind: "activity" },
  { value: "meeting", label: "Meeting", fee_code: null, needs_receipt: false, group: "activity", line_kind: "activity" },
  { value: "miscellaneous", label: "Miscellaneous", fee_code: null, needs_receipt: false, group: "activity", line_kind: "activity" },
  { value: "notary_fee", label: "Notary", fee_code: "NF", needs_receipt: true, group: "ope", line_kind: "cost" },
  { value: "ope_printing", label: "Printing", fee_code: "OPE", needs_receipt: true, group: "ope", line_kind: "cost" },
  { value: "ope_envelope", label: "Envelope", fee_code: "OPE", needs_receipt: true, group: "ope", line_kind: "cost" },
  { value: "ope_lbc", label: "Courier", fee_code: "OPE", needs_receipt: true, group: "ope", line_kind: "cost" },
  { value: "ope_transpo", label: "Transpo", fee_code: "OPE", needs_receipt: true, group: "ope", line_kind: "cost" },
  { value: "ope_manhours", label: "Man Hour", fee_code: "OPE", needs_receipt: false, group: "ope", line_kind: "cost" },
];

const TEMPLATE_BUNDLES = [
  { key: "", label: "Add from Template..." },
  { key: "notary_print_env", label: "Notary + Printing + Envelope", rows: ["notary_fee", "ope_printing", "ope_envelope"] },
  { key: "delivery", label: "Delivery bundle (Courier + Transpo)", rows: ["ope_lbc", "ope_transpo"] },
  { key: "court_appearance", label: "Court appearance (Appearance + Transpo + Printing)", rows: ["appearance_fee", "ope_transpo", "ope_printing"] },
];

function peso(n) {
  const x = Number(n || 0);
  return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function nowTimeLabel() {
  const d = new Date();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function toLocalDateInputValue(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localDateInputToIsoNoon(dateYmd) {
  const raw = String(dateYmd || "").trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  // Store at local noon so the selected date remains stable across time zones.
  return new Date(y, mo - 1, d, 12, 0, 0, 0).toISOString();
}

function normalizeAccountCategory(rawValue) {
  const raw = String(rawValue || "").trim().toLowerCase();
  if (!raw) return "";
  const normalized = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.includes("special")) return "special_project";
  if (normalized.includes("litig")) return "litigation";
  if (normalized.includes("retainer")) return "retainer";
  return normalized.replace(/\s+/g, "_");
}

function accountCategoryLabel(rawValue) {
  const normalized = normalizeAccountCategory(rawValue);
  if (normalized === "retainer") return "Retainer";
  if (normalized === "litigation") return "Litigation";
  if (normalized === "special_project") return "Special Project";
  const fallback = String(rawValue || "").trim().replace(/[_-]+/g, " ");
  return fallback ? fallback.replace(/\b\w/g, (c) => c.toUpperCase()) : "";
}

function formatAccountPickerLabel(a) {
  const archivedSuffix = a?.is_archived ? " | archived" : "";
  const kind = cleanText(a?.account_kind);
  return `${cleanText(a?.title) || "(untitled)"} (${accountCategoryLabel(a?.category) || "-"}${kind ? ` | ${kind}` : ""}${archivedSuffix})`;
}

function consumeActivityPrefill() {
  try {
    const raw = localStorage.getItem(ACTIVITY_PREFILL_KEY);
    if (!raw) return null;
    localStorage.removeItem(ACTIVITY_PREFILL_KEY);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      account_id: String(parsed.account_id || "").trim(),
      matter_id: String(parsed.matter_id || "").trim(),
    };
  } catch {
    return null;
  }
}

function safeUuid() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function parseAmount(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return n;
}

function buildCategoryOptions() {
  const opts = [`<option value="">Select...</option>`];
  const groups = [
    { key: "activity", label: "Activity / Service" },
    { key: "ope", label: "Cost / OPE" },
  ];
  for (const group of groups) {
    const rows = CATEGORIES.filter((c) => c.group === group.key);
    if (!rows.length) continue;
    opts.push(`<optgroup label="${escapeHtml(group.label)}">`);
    for (const c of rows) opts.push(`<option value="${c.value}">${escapeHtml(c.label)}</option>`);
    opts.push("</optgroup>");
  }
  return opts.join("");
}

function getCategoryMeta(value) {
  return CATEGORIES.find((c) => c.value === value) || null;
}

function displayCategoryLabel(taskCategory) {
  const key = String(taskCategory || "").trim().toLowerCase();
  const mapped = TASK_DISPLAY_LABEL[key];
  if (mapped) return mapped;
  const meta = getCategoryMeta(taskCategory);
  return meta?.label || taskCategory || "-";
}

function rowKindMeta(taskCategory) {
  const meta = getCategoryMeta(taskCategory);
  if (!meta) return null;
  const isCost = String(meta.line_kind || "").toLowerCase() === "cost";
  return {
    kind: isCost ? "cost" : "activity",
    label: isCost ? "Cost/OPE row" : "Activity row",
    pillClass: isCost ? "row-kind-pill cost" : "row-kind-pill activity",
  };
}

function entryClassForTask(taskCategory) {
  const key = String(taskCategory || "").trim().toLowerCase();
  if (key === "meeting") return EntryClass.MEETING;
  if (key === "miscellaneous") return EntryClass.MISC;
  if (key === "notary_fee" || key.startsWith("ope_")) return EntryClass.OPEX;
  return EntryClass.SERVICE;
}

function expenseTypeForTask(taskCategory) {
  const key = String(taskCategory || "").trim().toLowerCase();
  return TASK_TO_EXPENSE_TYPE[key] || null;
}

function toActivityType(taskCategory) {
  const key = String(taskCategory || "").trim().toLowerCase();
  if (key === "appearance_fee") return "appearance";
  if (key === "pleading_major") return "pleading_major";
  if (key === "pleading_minor") return "pleading_minor";
  return "communication";
}

function cleanText(v) {
  return String(v || "").trim();
}

function parseDescriptionMap(description) {
  const map = {};
  const parts = String(description || "")
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);
  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
    map[key] = value;
  }
  return map;
}

function extractLogNoteFromDescription(description, accountCategory) {
  const raw = cleanText(description);
  if (!raw) return "";

  const map = parseDescriptionMap(raw);
  const rawLower = raw.toLowerCase();

  if (accountCategory === "litigation") {
    const structured = map["venue"] !== undefined || map["case type"] !== undefined || map["tracker status"] !== undefined;
    return structured ? cleanText(map["notes"]) : raw;
  }

  if (accountCategory === "special_project") {
    const structured = rawLower.includes("special project tracker") || map["remarks"] !== undefined || map["update"] !== undefined;
    if (!structured) return raw;
    const remarks = cleanText(map["remarks"]);
    if (remarks && remarks !== "-") return remarks;
    const update = cleanText(map["update"]);
    return update === "-" ? "" : update;
  }

  if (accountCategory === "retainer") {
    const structured =
      rawLower.includes("retainer ope")
      || rawLower.includes("retainer activity")
      || map["invoice"] !== undefined
      || map["assignee"] !== undefined;
    if (!structured) return raw;
    const notes = cleanText(map["notes"]);
    return notes === "-" ? "" : notes;
  }

  return raw;
}

function buildTrackerConnectedDescription({ accountCategory, note, fallbackLabel, entryClass, selectedMatter }) {
  const text = cleanText(note);
  const fallback = cleanText(fallbackLabel) || "Activity";
  const matterCaseType = cleanText(selectedMatter?.case_type);
  const matterVenue = cleanText(selectedMatter?.venue);
  const matterStatusRaw = cleanText(selectedMatter?.status).toLowerCase();
  const litigationStatus =
    matterStatusRaw === "active" ? "In progress"
      : matterStatusRaw === "closed" ? "Closed"
        : (cleanText(selectedMatter?.status) || "-");
  const officialCaseNo = cleanText(selectedMatter?.official_case_no);
  const retainerRef = cleanText(selectedMatter?.retainer_contract_ref);
  const retainerPeriod = cleanText(selectedMatter?.retainer_period_yyyymm);

  if (accountCategory === "litigation") {
    const parts = [
      `Venue: ${matterVenue || "-"}`,
      `Case Type: ${matterCaseType || "-"}`,
      `Tracker Status: ${litigationStatus}`,
    ];
    if (officialCaseNo) parts.push(`Official Case No: ${officialCaseNo}`);
    if (text) parts.push(`Notes: ${text}`);
    parts.push("Source: activity_log");
    return parts.join(" | ");
  }

  if (accountCategory === "special_project") {
    const parts = [
      "Special Project Tracker",
      "Link: -",
      "Handling: -",
      `Update: ${text || "-"}`,
      "Tracker: -",
      `Remarks: ${text || "-"}`,
      "Source: activity_log",
    ];
    return parts.join(" | ");
  }

  if (accountCategory === "retainer") {
    const isOpexLike = entryClass === EntryClass.OPEX;
    const parts = [
      `${isOpexLike ? "Retainer OPE" : "Retainer Activity"} | Invoice: -`,
      "Assignee: -",
      "Location: -",
      "Handling: -",
    ];
    if (retainerRef) parts.push(`Contract Ref: ${retainerRef}`);
    if (retainerPeriod) parts.push(`Period: ${retainerPeriod}`);
    if (text) parts.push(`Notes: ${text}`);
    parts.push("Source: activity_log");
    return parts.join(" | ");
  }

  return text || fallback;
}

function recentStatusPillClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "approved") return "status-pill approved";
  if (s === "pending") return "status-pill pending";
  if (s === "billed" || s === "completed") return "status-pill completed";
  if (s === "rejected") return "status-pill rejected";
  return "status-pill";
}

function ensureSelectHasValue(sel, preferred = "") {
  const opts = Array.from(sel?.options || []);
  const preferredText = String(preferred || "");
  const hasPreferred = opts.some((o) => String(o.value || "") === preferredText);
  if (hasPreferred) {
    sel.value = preferredText;
    return;
  }
  const firstNonEmpty = opts.find((o) => String(o.value || "") !== "");
  if (firstNonEmpty) {
    sel.value = String(firstNonEmpty.value || "");
    return;
  }
  sel.value = "";
}

async function uploadReceipts({ batchId, lineNo, userId, files }) {
  const uploaded = [];
  for (const file of files) {
    const safeName = String(file.name || "receipt").replace(/[^\w.\-() ]+/g, "_").slice(0, 80);
    const path = `activities/${userId}/${batchId}/line-${lineNo}/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, file, {
      upsert: false,
      cacheControl: "3600",
      contentType: file.type || "application/octet-stream",
    });
    if (error) throw error;
    uploaded.push(path);
  }
  return uploaded;
}

async function getReceiptUrl(path) {
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, 60 * 30);
  if (error) throw error;
  return data?.signedUrl || "";
}

function splitBucketAndPath(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return { bucket: RECEIPTS_BUCKET, path: "" };
  const idx = raw.indexOf(":");
  if (idx > 0 && raw.slice(0, idx).indexOf("/") === -1) {
    return { bucket: raw.slice(0, idx), path: raw.slice(idx + 1) };
  }
  return { bucket: RECEIPTS_BUCKET, path: raw };
}

export async function renderLogActivity(appEl, ctx, navigate) {
  const selfLabel = ctx.profile?.full_name || ctx.profile?.email || ctx.user?.email || "Me";

  appEl.innerHTML = `
    <div class="card activity-receipt-shell">
      <div class="activity-receipt-head">
        <div>
          <span class="activity-receipt-kicker">Office Work Receipt</span>
          <h2 class="activity-receipt-title">Activities</h2>
          <div class="activity-receipt-sub">Receipt-style entry. Filled lines become activity entries.</div>
        </div>
        <div class="activity-meta-grid">
          <div class="activity-meta-box">
            <span class="activity-meta-label">Batch</span>
            <strong id="batchIdLabel" class="activity-meta-value">-</strong>
          </div>
          <div class="activity-meta-box">
            <span class="activity-meta-label">Autosave</span>
            <strong id="autosaveLabel" class="activity-meta-value">Not saved yet</strong>
          </div>
        </div>
      </div>

      <hr/>

      <div class="layout-activities activity-receipt-layout">
        <form id="form" class="stack activity-form">
          <div class="stepper" aria-label="Activity flow">
            <div class="step" data-step="1"><span class="step-num">1</span><span class="step-label">Details</span></div>
            <div class="step" data-step="2"><span class="step-num">2</span><span class="step-label">Entries</span></div>
            <div class="step" data-step="3"><span class="step-num">3</span><span class="step-label">Review</span></div>
          </div>

          <section class="step-card receipt-step" id="step1" data-step="1">
            <div class="step-head">
              <h3 class="step-title">Step 1: Details</h3>
              <div class="step-sub">Who, where, and what this receipt belongs to.</div>
            </div>

            <div class="grid2" style="grid-template-columns: minmax(220px,1.4fr) minmax(170px,.8fr) minmax(170px,.8fr)">
              <div>
                <label>Client/Account</label>
                <div style="display:flex;gap:8px;align-items:flex-start">
                  <div style="position:relative;flex:1">
                    <input
                      id="accountSearch"
                      autocomplete="off"
                      placeholder="Type to search and select an account..."
                      style="width:100%"
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded="false"
                      aria-controls="accountSearchMenu"
                    />
                    <div
                      id="accountSearchMenu"
                      role="listbox"
                      style="display:none;position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:30;max-height:280px;overflow:auto;background:var(--panel,#fff);border:1px solid var(--line,#d9e2ef);border-radius:10px;box-shadow:0 12px 28px rgba(15,23,42,.12);padding:6px"
                    ></div>
                  </div>
                </div>
              </div>
              <div>
                <label>Category</label>
                <select id="accountCategoryFilter">
                  <option value="">All Categories</option>
                  <option value="litigation">Litigation</option>
                  <option value="special_project">Special Project</option>
                  <option value="retainer">Retainer</option>
                </select>
              </div>
              <div>
                <label>Date</label>
                <input id="occurred_on" type="date" required />
                <div class="field-error" data-for="occurred_on"></div>
              </div>
            </div>

            <select id="account_id" required style="display:none" aria-hidden="true" tabindex="-1"></select>
            <div class="field-error" data-for="account_id"></div>
            <div style="margin-top:8px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:8px;font-weight:500;margin:0">
                <input id="showArchivedAccounts" type="checkbox" style="width:auto;margin:0" />
                Show archived accounts
              </label>
              <button id="manageAccountsBtn" type="button" class="btn btn-ghost" style="width:auto">Manage Accounts</button>
            </div>
            <div id="noAccounts" class="items-help" style="display:none;margin-top:10px"></div>

            <div class="grid2">
              <div>
                <label>Matter / Identifier (recommended)</label>
                <select id="matter_id">
                  <option value="">(none)</option>
                </select>
                <div class="field-error" data-for="matter_id"></div>
                <div id="matterHint" class="muted" style="font-size:12px;margin-top:6px">Select a structured matter for strict identifiers.</div>
                <input id="matter" placeholder="Fallback title if no matter is selected" />
                <div id="matterIdentifierChips" class="muted" style="font-size:12px;margin-top:6px"></div>
              </div>
              <div>
                <label>Billing Status (optional)</label>
                <select id="billing_status">
                  <option value="">(leave blank)</option>
                  <option value="billable">Billable</option>
                  <option value="non_billable">Non-billable</option>
                  <option value="billed">Billed</option>
                </select>
              </div>
            </div>

            <div class="grid2">
              <div>
                <label>Handling Lawyer</label>
                <select id="handling_lawyer_id" required></select>
                <div class="field-error" data-for="handling_lawyer_id"></div>
                <div id="memberLoadNote" class="muted" style="font-size:12px;margin-top:6px;display:none"></div>
              </div>
              <div>
                <label>Performed By</label>
                <div class="panel" style="padding:10px 12px;border-radius:10px">
                  <div><strong id="performedByLabel"></strong></div>
                  <div class="muted" style="font-size:12px;margin-top:4px">Performed By is automatically set to you when submitting.</div>
                </div>
              </div>
            </div>

            <label>General Notes (optional)</label>
            <textarea id="general_notes" rows="2" placeholder="Optional context that applies to all entries..."></textarea>
          </section>

          <section class="step-card receipt-step" id="step2" data-step="2">
            <div class="step-head">
              <h3 class="step-title">Step 2: Activity / Cost Lines</h3>
              <div class="step-sub">Each line is one activity/expense item.</div>
            </div>

            <div class="items-help">
              Each row creates one activity log entry. OPE/Notary rows are cost/expense-type activity entries and require receipts. Man Hour is treated like a normal amount (no timekeeping).
            </div>

            <div class="table-wrap">
              <table class="entries-table">
                <thead>
                  <tr>
                    <th style="width:190px">Activity / Cost</th>
                    <th style="width:140px">Amount (PHP)</th>
                    <th>Notes</th>
                    <th style="width:210px">Receipt</th>
                    <th style="width:110px">Row</th>
                  </tr>
                </thead>
                <tbody id="entriesBody"></tbody>
              </table>
            </div>
            <div class="field-error" data-for="entries"></div>

            <div class="activity-entry-actions">
              <button id="addRowBtn" type="button" class="btn btn-primary">+ Add Row</button>
              <select id="templateSel" class="btn" style="width:auto"></select>
              <button id="continueBtn" type="button" class="btn">Continue to Review</button>
              <button id="saveDraftBtn" type="button" class="btn btn-ghost">Save Draft</button>
            </div>

            <p id="msg2" class="msg"></p>
          </section>

          <section class="step-card receipt-step" id="step3" data-step="3" style="display:none">
            <div class="step-head">
              <h3 class="step-title">Step 3: Review and Submit</h3>
              <div class="step-sub">Final activity/cost line preview before submission.</div>
            </div>

            <div id="reviewBox" class="panel"></div>
            <div class="actions-bar">
              <button id="backBtn" type="button" class="btn btn-ghost">Back</button>
              <button id="finalSaveDraftBtn" type="button" class="btn">Save Draft</button>
              <button id="submitBtn" type="button" class="btn btn-primary">Submit (Pending)</button>
              <button id="clearBtn" type="button" class="btn btn-ghost">Clear</button>
            </div>
            <div id="readyHint" class="ready-hint"></div>
            <p id="msg3" class="msg"></p>
          </section>

          <p id="msg" class="msg"></p>
        </form>

        <aside class="panel summary-panel receipt-summary-panel">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <h3 style="margin:0">Summary</h3>
            <span class="status-pill" id="summaryStatus">Draft</span>
          </div>
          <div id="summaryTotals" style="margin-top:10px"></div>
          <hr/>
          <div id="summaryWarnings" class="muted" style="font-size:13px"></div>
          <hr/>
          <div class="muted" style="font-size:12px">
            Saved: <span id="savedAt">-</span>
          </div>
        </aside>
      </div>

      <hr/>

      <h3 style="margin:0 0 10px">My Drafts</h3>
      <div id="drafts"></div>

      <hr/>

      <h3 style="margin:0 0 10px">Recent Activity (Visible to you)</h3>
      <div id="recent"></div>
    </div>
  `;

  const $ = (sel) => appEl.querySelector(sel);

  // DOM refs (more are added in later patches).
  const batchIdLabel = $("#batchIdLabel");
  const autosaveLabel = $("#autosaveLabel");
  const savedAtEl = $("#savedAt");
  const summaryStatus = $("#summaryStatus");
  const summaryTotals = $("#summaryTotals");
  const summaryWarnings = $("#summaryWarnings");

  const form = $("#form");
  const accountSearch = $("#accountSearch");
  const accountSearchMenu = $("#accountSearchMenu");
  const accountCategoryFilter = $("#accountCategoryFilter");
  const accountSel = $("#account_id");
  const showArchivedAccounts = $("#showArchivedAccounts");
  const manageAccountsBtn = $("#manageAccountsBtn");
  const noAccounts = $("#noAccounts");
  const dateInput = $("#occurred_on");
  const matterSel = $("#matter_id");
  const matterHint = $("#matterHint");
  const matterInput = $("#matter");
  const matterIdentifierChips = $("#matterIdentifierChips");
  const billingStatusSel = $("#billing_status");
  const handlingSel = $("#handling_lawyer_id");
  const performedByLabel = $("#performedByLabel");
  const memberLoadNote = $("#memberLoadNote");
  const generalNotes = $("#general_notes");
  const entriesBody = $("#entriesBody");
  const addRowBtn = $("#addRowBtn");
  const templateSel = $("#templateSel");
  const continueBtn = $("#continueBtn");
  const saveDraftBtn = $("#saveDraftBtn");
  const step2Msg = $("#msg2");
  const step3 = $("#step3");
  const reviewBox = $("#reviewBox");
  const backBtn = $("#backBtn");
  const finalSaveDraftBtn = $("#finalSaveDraftBtn");
  const submitBtn = $("#submitBtn");
  const clearBtn = $("#clearBtn");
  const readyHint = $("#readyHint");
  const step3Msg = $("#msg3");
  const msg = $("#msg");
  const draftsEl = $("#drafts");
  const recentEl = $("#recent");

  // State
  let isBusy = false;
  let batchId = safeUuid();
  let autosaveTimer = null;
  let lastSavedLabel = null;
  let rowCount = 0;
  let accountRows = [];
  let matterRows = [];
  let matterById = new Map();
  let currentDraftKey = "";
  let accountPickerRows = [];
  let accountPickerActiveIndex = -1;
  let accountPickerMouseDown = false;

  function syncAccountSearchFromSelected() {
    if (!accountSearch) return;
    const selected = (accountRows || []).find((a) => String(a.id || "") === String(accountSel?.value || ""));
    if (!selected) return;
    const label = formatAccountPickerLabel(selected);
    if (String(accountSearch.value || "") !== label) accountSearch.value = label;
  }

  function setAccountPickerMenuOpen(open) {
    if (!accountSearchMenu) return;
    const next = !!open && !isBusy;
    accountSearchMenu.style.display = next ? "block" : "none";
    accountSearch.setAttribute("aria-expanded", next ? "true" : "false");
    if (!next) accountPickerActiveIndex = -1;
  }

  function renderAccountPickerMenu(rows, { query = "" } = {}) {
    if (!accountSearchMenu) return;
    const trimmedQuery = String(query || "").trim();
    const maxShown = 12;
    const visible = (rows || []).slice(0, maxShown);
    accountPickerRows = visible;

    if (accountPickerActiveIndex >= visible.length) accountPickerActiveIndex = visible.length - 1;
    if (visible.length === 0) accountPickerActiveIndex = -1;

    if (!visible.length) {
      if (trimmedQuery) {
        accountSearchMenu.innerHTML = `<div class="muted" style="padding:10px 12px;font-size:13px">No matching accounts.</div>`;
      } else {
        accountSearchMenu.innerHTML = `<div class="muted" style="padding:10px 12px;font-size:13px">Type to search accounts.</div>`;
      }
      return;
    }

    const selectedId = String(accountSel.value || "");
    const rowsHtml = visible.map((a, idx) => {
      const isActive = idx === accountPickerActiveIndex;
      const isSelected = String(a.id || "") === selectedId;
      const optionStyle = [
        "display:block",
        "width:100%",
        "text-align:left",
        "border:0",
        "border-radius:8px",
        "padding:8px 10px",
        "background:" + (isActive ? "rgba(37,99,235,.10)" : (isSelected ? "rgba(37,99,235,.06)" : "transparent")),
        "cursor:pointer",
      ].join(";");
      const title = cleanText(a.title) || "(untitled)";
      const meta = `${accountCategoryLabel(a.category) || "-"}${cleanText(a.account_kind) ? ` | ${cleanText(a.account_kind)}` : ""}${a.is_archived ? " | archived" : ""}`;
      return `
        <button
          type="button"
          data-account-picker-id="${a.id}"
          data-account-picker-index="${idx}"
          role="option"
          aria-selected="${isSelected ? "true" : "false"}"
          style="${optionStyle}"
        >
          <div style="font-weight:${isSelected ? "700" : "600"};font-size:13px;line-height:1.2">${escapeHtml(title)}</div>
          <div class="muted" style="font-size:12px;margin-top:2px">${escapeHtml(meta)}</div>
        </button>
      `;
    }).join("");

    const moreCount = (rows || []).length - visible.length;
    const footer = moreCount > 0
      ? `<div class="muted" style="padding:6px 10px 2px 10px;font-size:12px">Showing ${visible.length} of ${(rows || []).length} matches. Keep typing to narrow.</div>`
      : "";
    accountSearchMenu.innerHTML = rowsHtml + footer;
  }

  async function commitAccountPickerSelection(accountId) {
    const prev = String(accountSel.value || "");
    accountSel.value = String(accountId || "");
    syncAccountSearchFromSelected();
    setFieldError("account_id", "");
    renderAccountOptions({ preserveSelection: true });
    renderMatterOptions({ preserveSelection: false });
    if (String(accountSel.value || "") !== prev) {
      await loadMembersForAccount(accountSel.value);
    }
    setAccountPickerMenuOpen(false);
    scheduleAutosave();
    updateUi();
  }

  function renderBatchLabel() {
    if (!batchIdLabel) return;
    const key = String(batchId || "").trim();
    batchIdLabel.textContent = key ? key.split("-")[0].toUpperCase() : "-";
  }

  async function applyActivityPrefillIfAny() {
    const prefill = consumeActivityPrefill();
    if (!prefill) return false;

    let applied = false;
    if (prefill.account_id && accountRows.some((a) => String(a.id || "") === prefill.account_id)) {
      accountSel.value = prefill.account_id;
      accountSearch.value = "";
      renderAccountOptions({ preserveSelection: true });
      syncAccountSearchFromSelected();
      applied = true;
    }

    renderMatterOptions({ preserveSelection: false });

    if (prefill.matter_id && matterById.has(prefill.matter_id)) {
      const matter = matterById.get(prefill.matter_id);
      if (matter?.account_id) {
        accountSel.value = String(matter.account_id);
        accountSearch.value = "";
        renderAccountOptions({ preserveSelection: true });
        syncAccountSearchFromSelected();
      }
      renderMatterOptions({ preserveSelection: true });
      matterSel.value = prefill.matter_id;
      renderMatterIdentifierChips(matter);
      if (!cleanText(matterInput.value)) matterInput.value = cleanText(matter.title || "");
      if (matterHint) matterHint.textContent = `Linked from tracker: ${accountCategoryLabel(matter.matter_type)} matter.`;
      applied = true;
    }

    if (applied) {
      await loadMembersForAccount(accountSel.value);
    }

    return applied;
  }

  function setBusy(busy, label) {
    isBusy = !!busy;
    if (typeof label === "string") msg.textContent = label;
    if (isBusy) setAccountPickerMenuOpen(false);
    [accountSearch, accountCategoryFilter, accountSel, showArchivedAccounts, matterSel, dateInput, matterInput, billingStatusSel, handlingSel, generalNotes].forEach((el) => el && (el.disabled = isBusy));
    [addRowBtn, continueBtn, saveDraftBtn, templateSel, backBtn, finalSaveDraftBtn, submitBtn, clearBtn, manageAccountsBtn].forEach((el) => el && (el.disabled = isBusy));
    entriesBody.querySelectorAll("input,select,textarea,button").forEach((el) => (el.disabled = isBusy));
  }

  function setFieldError(forId, text) {
    const el = appEl.querySelector(`.field-error[data-for="${forId}"]`);
    if (!el) return;
    el.textContent = text || "";
    el.style.display = text ? "block" : "none";
  }

  function clearErrors() {
    ["account_id", "matter_id", "occurred_on", "handling_lawyer_id", "entries"].forEach((k) => setFieldError(k, ""));
    entriesBody.querySelectorAll("tr").forEach((tr) => tr.classList.remove("invalid-row"));
  }

  function setStep(step) {
    step3.style.display = step === 3 ? "block" : "none";
    appEl.querySelectorAll(".step").forEach((s) => {
      const n = Number(s.dataset.step);
      s.classList.toggle("active", n === step);
      s.classList.toggle("done", n < step);
    });
  }

  function buildRow(lineNo, opts = {}) {
    const categoryOptions = buildCategoryOptions();
    return `
      <tr data-line-no="${lineNo}">
        <td>
          <select class="cat">${categoryOptions}</select>
          <div class="row-cues"></div>
          <div class="row-error"></div>
        </td>
        <td>
          <input class="amt" type="number" min="0" step="0.01" placeholder="0.00" />
        </td>
        <td>
          <input class="notes" placeholder="Optional (recommended)" />
        </td>
        <td>
          <div class="receiptCell">
            <button type="button" class="btn btn-ghost uploadBtn">Upload</button>
            <span class="receiptOptional muted" style="font-size:12px;display:none">
              Optional <a href="#" class="addOptional">Add</a>
            </span>
            <input class="file" type="file" style="display:none" multiple accept=".pdf,image/*" />
            <div class="receiptList muted" style="font-size:12px;margin-top:6px"></div>
          </div>
        </td>
        <td style="text-align:right">
          <button type="button" class="btn btn-ghost clearRow">Clear</button>
          ${opts.removable ? `<button type="button" class="btn btn-ghost removeRow">Remove</button>` : ""}
        </td>
      </tr>
    `;
  }

  function ensureRows(n) {
    const current = entriesBody.querySelectorAll("tr").length;
    const target = Math.max(1, Math.min(MAX_ROWS, n));
    for (let i = current + 1; i <= target; i++) addRow({ removable: false, focus: false });
  }

  function applyReceiptVisibility(tr) {
    const meta = getCategoryMeta(tr.querySelector(".cat").value);
    const cell = tr.querySelector(".receiptCell");
    const uploadBtn = tr.querySelector(".uploadBtn");
    const optional = tr.querySelector(".receiptOptional");

    if (!meta) {
      cell.style.opacity = "0.6";
      uploadBtn.style.display = "inline-block";
      uploadBtn.textContent = "Upload";
      optional.style.display = "none";
      renderRowCues(tr);
      return;
    }
    const hasReceipts = getReceipts(tr).length > 0;

    if (meta.needs_receipt) {
      cell.style.opacity = "1";
      uploadBtn.style.display = "inline-block";
      uploadBtn.textContent = hasReceipts ? "Add more" : "Upload";
      optional.style.display = "none";
      renderRowCues(tr);
      return;
    }

    cell.style.opacity = "0.9";
    if (hasReceipts) {
      uploadBtn.style.display = "inline-block";
      uploadBtn.textContent = "Add more";
      optional.style.display = "none";
    } else {
      uploadBtn.style.display = "none";
      optional.style.display = "inline";
    }
    renderRowCues(tr);
  }

  function renderRowCues(tr) {
    const cueEl = tr.querySelector(".row-cues");
    if (!cueEl) return;
    const taskCategory = tr.querySelector(".cat")?.value || "";
    const meta = getCategoryMeta(taskCategory);
    const kind = rowKindMeta(taskCategory);
    const hasReceipts = getReceipts(tr).length > 0;
    if (!meta || !kind) {
      cueEl.innerHTML = "";
      return;
    }
    const receiptPillClass = meta.needs_receipt
      ? (hasReceipts ? "row-kind-pill receipt-ok" : "row-kind-pill receipt-required")
      : "row-kind-pill receipt-optional";
    const receiptLabel = meta.needs_receipt
      ? (hasReceipts ? "Receipt attached" : "Receipt required")
      : "Receipt optional";
    cueEl.innerHTML = `
      <span class="${kind.pillClass}">${escapeHtml(kind.label)}</span>
      <span class="${receiptPillClass}">${escapeHtml(receiptLabel)}</span>
    `;
  }

  function getReceipts(tr) {
    try {
      return JSON.parse(tr.dataset.receipts || "[]") || [];
    } catch {
      return [];
    }
  }

  function setReceipts(tr, paths) {
    tr.dataset.receipts = JSON.stringify(paths || []);
    const list = tr.querySelector(".receiptList");
    if (!paths?.length) {
      list.innerHTML = "";
      applyReceiptVisibility(tr);
      return;
    }
    list.innerHTML =
      paths
        .slice(0, 3)
        .map((p, idx) => `<div><a href="#" class="receiptLink" data-idx="${idx}">${escapeHtml(p.split("/").slice(-1)[0])}</a></div>`)
        .join("") + (paths.length > 3 ? `<div class="muted">+ ${paths.length - 3} more</div>` : "");

    list.querySelectorAll(".receiptLink").forEach((a) => {
      a.addEventListener("click", async (e) => {
        e.preventDefault();
        const i = Number(a.dataset.idx || 0);
        const path = paths[i];
        if (!path) return;
        try {
          const url = await getReceiptUrl(path);
          window.open(url, "_blank", "noopener,noreferrer");
        } catch (err) {
          await uiAlert({
            title: "Receipt",
            message: `Unable to open receipt: ${err?.message || err}`,
          });
        }
      });
    });

    applyReceiptVisibility(tr);
  }

  function addRow({ removable = true, focus = true } = {}) {
    rowCount += 1;
    const lineNo = rowCount;
    entriesBody.insertAdjacentHTML("beforeend", buildRow(lineNo, { removable }));
    const tr = entriesBody.querySelector(`tr[data-line-no="${lineNo}"]`);
    wireRow(tr);
    if (focus) tr.querySelector(".cat")?.focus();
    updateUi();
  }

  function clearRow(tr) {
    tr.querySelector(".cat").value = "";
    tr.querySelector(".amt").value = "";
    tr.querySelector(".notes").value = "";
    tr.dataset.receipts = "[]";
    tr.querySelector(".receiptList").innerHTML = "";
    tr.classList.remove("invalid-row");
    tr.querySelector(".row-error").textContent = "";
    tr.querySelector(".row-cues").innerHTML = "";
    applyReceiptVisibility(tr);
    updateUi();
  }

  function removeRow(tr) {
    tr.remove();
    updateUi();
  }

  function wireRow(tr) {
    const catSel = tr.querySelector(".cat");
    const amt = tr.querySelector(".amt");
    const notes = tr.querySelector(".notes");
    const uploadBtn = tr.querySelector(".uploadBtn");
    const addOptional = tr.querySelector(".addOptional");
    const file = tr.querySelector(".file");
    const clearBtn = tr.querySelector(".clearRow");
    const removeBtn = tr.querySelector(".removeRow");

    tr.dataset.receipts = "[]";

    catSel.addEventListener("change", () => {
      applyReceiptVisibility(tr);
      scheduleAutosave();
      updateUi();
    });

    [amt, notes].forEach((el) =>
      el.addEventListener("input", () => {
        scheduleAutosave();
        updateUi();
      })
    );

    uploadBtn.addEventListener("click", () => file.click());
    if (addOptional) addOptional.addEventListener("click", (e) => { e.preventDefault(); file.click(); });

    file.addEventListener("change", async () => {
      if (!file.files || file.files.length === 0) return;
      if (isBusy) return;

      const lineNo = Number(tr.dataset.lineNo || 0);
      const files = Array.from(file.files);
      file.value = "";

      try {
        setBusy(true, "Uploading receipts...");
        const uploaded = await uploadReceipts({ batchId, lineNo, userId: ctx.user.id, files });
        const existing = getReceipts(tr);
        setReceipts(tr, existing.concat(uploaded));
        lastSavedLabel = null;
        scheduleAutosave(true);
      } catch (e) {
        const detail = e?.message || String(e);
        msg.textContent = `Receipt upload failed: ${detail}. If this repeats, check Supabase storage policies for bucket "${RECEIPTS_BUCKET}".`;
      } finally {
        setBusy(false);
        updateUi();
      }
    });

    clearBtn.addEventListener("click", () => {
      clearRow(tr);
      scheduleAutosave();
    });

    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        removeRow(tr);
        scheduleAutosave();
      });
    }

    applyReceiptVisibility(tr);
  }

  function collectEntries() {
    const rows = Array.from(entriesBody.querySelectorAll("tr"));
    return rows.map((tr) => {
      const line_no = Number(tr.dataset.lineNo || 0);
      const task_category = tr.querySelector(".cat").value;
      const amountRaw = tr.querySelector(".amt").value;
      const amount = parseAmount(amountRaw);
      const notes = (tr.querySelector(".notes").value || "").trim();
      const receipts = getReceipts(tr);
      return { tr, line_no, task_category, amount, amountRaw, notes, receipts };
    });
  }

  function isBlankEntry(e) {
    return (
      !e.task_category
      && !String(e.amountRaw || "").trim()
      && !String(e.notes || "").trim()
      && (!e.receipts || e.receipts.length === 0)
    );
  }

  function computeTotalsByCategory(entries) {
    const map = new Map();
    for (const e of entries) {
      if (!e.task_category) continue;
      if (!Number.isFinite(e.amount) || e.amount == null) continue;
      const key = displayCategoryLabel(e.task_category);
      map.set(key, (map.get(key) || 0) + Number(e.amount || 0));
    }
    return map;
  }

  function validateDraft({ showErrors = false } = {}) {
    if (showErrors) clearErrors();
    let ok = true;

    if (!accountSel.value) { if (showErrors) setFieldError("account_id", "Select an account."); ok = false; }
    const selectedAccount = (accountRows || []).find((a) => String(a.id || "") === String(accountSel.value || ""));
    if (selectedAccount?.is_archived) {
      if (showErrors) setFieldError("account_id", "Archived accounts cannot receive new activities. Unarchive first.");
      ok = false;
    }

    const selectedMatter = matterById.get(String(matterSel.value || ""));
    if (selectedMatter && String(selectedMatter.account_id || "") !== String(accountSel.value || "")) {
      if (showErrors) setFieldError("matter_id", "Selected matter does not belong to this account.");
      ok = false;
    }
    if (!dateInput.value) { if (showErrors) setFieldError("occurred_on", "Select a date."); ok = false; }

    const entries = collectEntries();
    const filled = entries.filter((e) => !isBlankEntry(e));
    const complete = filled.filter((e) => e.task_category && e.amount != null);

    if (complete.length === 0) {
      if (showErrors) setFieldError("entries", "Add at least one entry row (category + amount).");
      ok = false;
    }

    if (showErrors) {
      for (const e of filled) {
        e.tr.classList.remove("invalid-row");
        e.tr.querySelector(".row-error").textContent = "";

        if (e.task_category && e.amount == null) {
          e.tr.classList.add("invalid-row");
          e.tr.querySelector(".row-error").textContent = "Amount required.";
          ok = false;
        } else if (e.amountRaw && (!Number.isFinite(e.amount) || e.amount < 0)) {
          e.tr.classList.add("invalid-row");
          e.tr.querySelector(".row-error").textContent = "Amount must be a valid number.";
          ok = false;
        } else if (!e.task_category && (String(e.amountRaw || "").trim() || String(e.notes || "").trim() || (e.receipts || []).length)) {
          e.tr.classList.add("invalid-row");
          e.tr.querySelector(".row-error").textContent = "Pick a category or clear the row.";
          ok = false;
        }
      }
    }

    return { ok, entries: complete };
  }

  function validateSubmit({ showErrors = false } = {}) {
    const draft = validateDraft({ showErrors });
    let ok = draft.ok;

    if (!handlingSel.value) { if (showErrors) setFieldError("handling_lawyer_id", "Handling Lawyer is required to submit."); ok = false; }

    if (showErrors) {
      for (const e of draft.entries) {
        const meta = getCategoryMeta(e.task_category);
        if (meta?.needs_receipt && (!e.receipts || e.receipts.length === 0)) {
          e.tr.classList.add("invalid-row");
          e.tr.querySelector(".row-error").textContent = "Receipt required.";
          ok = false;
        }
      }
    } else {
      for (const e of draft.entries) {
        const meta = getCategoryMeta(e.task_category);
        if (meta?.needs_receipt && (!e.receipts || e.receipts.length === 0)) ok = false;
      }
      if (!handlingSel.value) ok = false;
    }

    return { ok, entries: draft.entries };
  }

  function billingToBillableBoolean(v) {
    if (v === "billable") return true;
    if (v === "billed") return true;
    if (v === "non_billable") return false;
    return false;
  }

  function buildPayloads(entries, status) {
    const occurred_at = localDateInputToIsoNoon(dateInput.value) || new Date().toISOString();
    const billing_status = billingStatusSel.value || null;
    const billable = billingToBillableBoolean(billing_status);
    const selectedMatter = matterById.get(String(matterSel.value || ""));
    const matter = (matterInput.value || "").trim() || cleanText(selectedMatter?.title) || null;
    const baseNotes = (generalNotes.value || "").trim();
    const selectedAccount = (accountRows || []).find((a) => String(a.id || "") === String(accountSel.value || ""));
    const accountCategory = normalizeAccountCategory(selectedAccount?.category);
    const performed_by = ctx.user.id;
    const handling_lawyer_id = handlingSel.value || null;
    const submitted_at = status === "pending" ? new Date().toISOString() : null;
    const draft_expires_at = status === "draft" ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null;

    return entries.map((e) => {
      const meta = getCategoryMeta(e.task_category);
      const entry_class = entryClassForTask(e.task_category);
      const expense_type = expenseTypeForTask(e.task_category);
      const is_meeting_touchpoint = entry_class === EntryClass.MEETING;
      const consumes_retainer_quota = is_meeting_touchpoint && accountCategory === "retainer";

      let legacyIdentifier = null;
      if (selectedMatter) {
        if (normalizeAccountCategory(selectedMatter.matter_type) === "litigation") {
          legacyIdentifier = cleanText(selectedMatter.official_case_no) || null;
        } else if (normalizeAccountCategory(selectedMatter.matter_type) === "special_project") {
          legacyIdentifier = cleanText(selectedMatter.special_engagement_code) || null;
        } else if (normalizeAccountCategory(selectedMatter.matter_type) === "retainer") {
          const ref = cleanText(selectedMatter.retainer_contract_ref);
          const period = cleanText(selectedMatter.retainer_period_yyyymm);
          legacyIdentifier = ref && period ? `${ref}-${period}` : (ref || null);
        }
      }

      const desc = buildTrackerConnectedDescription({
        accountCategory,
        note: e.notes || baseNotes,
        fallbackLabel: meta?.label || "Activity",
        entryClass: entry_class,
        selectedMatter,
      });
      return {
        batch_id: batchId,
        line_no: e.line_no,

        account_id: accountSel.value,
        matter_id: selectedMatter?.id || null,
        matter,
        billing_status,
        billable,

        created_by: ctx.user.id,
        performed_by,
        handling_lawyer_id,

        status,
        activity_type: toActivityType(e.task_category),
        entry_class,
        expense_type,
        is_meeting_touchpoint,
        consumes_retainer_quota,
        fee_code: meta?.fee_code || null,
        task_category: e.task_category,
        legacy_identifier_text: legacyIdentifier,
        amount: Number(e.amount || 0),
        minutes: 0,
        description: desc,
        occurred_at,
        attachment_urls: e.receipts && e.receipts.length ? e.receipts : null,

        submitted_at,
        draft_expires_at,
      };
    });
  }

  async function saveDraft({ quiet = false } = {}) {
    if (isBusy) return;
    const v = validateDraft({ showErrors: !quiet });
    if (!v.ok) {
      if (!quiet) msg.textContent = "Fix the highlighted fields first.";
      updateUi();
      return;
    }

    try {
      setBusy(true, quiet ? "" : "Saving draft...");
      autosaveLabel.textContent = "Saving...";
      const payloads = buildPayloads(v.entries, "draft");
      const { error } = await supabase.from("activities").upsert(payloads, { onConflict: "batch_id,line_no" });
      if (error) throw error;

      const label = nowTimeLabel();
      lastSavedLabel = label;
      autosaveLabel.textContent = `Saved ${label}`;
      savedAtEl.textContent = label;
      summaryStatus.textContent = "Draft";
      if (!quiet) msg.textContent = "Draft saved.";
    } catch (e) {
      msg.textContent = `Draft save failed: ${e?.message || e}`;
      autosaveLabel.textContent = "Save failed";
    } finally {
      setBusy(false);
      updateUi();
    }
  }

  async function submitPending() {
    if (isBusy) return;
    const v = validateSubmit({ showErrors: true });
    if (!v.ok) {
      step3Msg.textContent = "Fix the highlighted rows (especially receipts) before submitting.";
      updateUi();
      return;
    }

    const ok = await uiConfirm({
      title: "Submit Entries",
      message: "Submit these entries for approval? This will create Pending activities.",
      confirmText: "Submit",
    });
    if (!ok) return;

    try {
      setBusy(true, "Submitting...");
      const payloads = buildPayloads(v.entries, "pending");
      const { error } = await supabase.from("activities").upsert(payloads, { onConflict: "batch_id,line_no" });
      if (error) throw error;

      msg.textContent = `Submitted (pending approval) for ${dateInput.value || "selected date"}.`;
      summaryStatus.textContent = "Pending";
      resetAll();
      await Promise.all([loadDraftBatches(), loadRecent()]);
    } catch (e) {
      step3Msg.textContent = `Submit failed: ${e?.message || e}`;
    } finally {
      setBusy(false);
      updateUi();
    }
  }

  function scheduleAutosave(immediate = false) {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      const v = validateDraft({ showErrors: false });
      if (!v.ok) {
        autosaveLabel.textContent = lastSavedLabel ? `Saved ${lastSavedLabel}` : "Not saved yet";
        return;
      }
      saveDraft({ quiet: true });
    }, immediate ? 200 : 1100);
  }

  function renderReview(entries) {
    if (!entries.length) {
      reviewBox.innerHTML = `<div class="muted">No activity/cost lines yet.</div>`;
      return;
    }

    const totals = computeTotalsByCategory(entries);
    const totalValue = Array.from(totals.values()).reduce((s, x) => s + x, 0);
    const accountLabel = accountSel.options[accountSel.selectedIndex]?.text || "-";
    const receiptDate = dateInput.value || "-";

    reviewBox.innerHTML = `
      <div class="review-receipt">
        <div class="review-receipt-head">
          <div>
            <div class="review-receipt-kicker">Draft Activity / Cost Lines Preview</div>
            <div class="review-receipt-meta">Account: <strong>${escapeHtml(accountLabel)}</strong></div>
          </div>
          <div class="review-receipt-meta">Date: <strong>${escapeHtml(receiptDate)}</strong></div>
        </div>
        <div class="table-wrap" style="margin-top:10px">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Notes</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              ${entries.map((e) => {
                const meta = getCategoryMeta(e.task_category);
                const kind = rowKindMeta(e.task_category);
                const needs = meta?.needs_receipt;
                const has = e.receipts && e.receipts.length > 0;
                return `
                  <tr>
                    <td><strong>${escapeHtml(displayCategoryLabel(e.task_category))}</strong></td>
                    <td>${kind ? `<span class="${kind.pillClass}">${escapeHtml(kind.label)}</span>` : `<span class="muted">-</span>`}</td>
                    <td>P${peso(e.amount)}</td>
                    <td>${escapeHtml(e.notes || "")}</td>
                    <td>${needs ? (has ? `<span class="status-pill completed">ok</span>` : `<span class="status-pill rejected">missing</span>`) : `<span class="muted">optional</span>`}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
        <div class="review-receipt-foot">
          <div class="review-receipt-total-label">Total</div>
          <div class="review-receipt-total-value">P${peso(totalValue)}</div>
        </div>
      </div>
    `;
  }

  function updateSummary() {
    const all = collectEntries();
    const filled = all.filter((e) => !isBlankEntry(e) && e.task_category && Number.isFinite(e.amount) && e.amount != null);
    const totals = computeTotalsByCategory(filled);
    const totalValue = Array.from(totals.values()).reduce((s, x) => s + x, 0);

    if (!totals.size) {
      summaryTotals.innerHTML = `<div class="muted">No line totals yet.</div>`;
    } else {
      summaryTotals.innerHTML = Array.from(totals.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `<div class="receipt-total-row"><span>${escapeHtml(k)}</span><strong>P${peso(v)}</strong></div>`)
        .join("") + `<div class="receipt-total-divider"></div><div class="receipt-total-row grand"><span>Total</span><strong>P${peso(totalValue)}</strong></div><div class="receipt-total-note">Totals combine activity and cost/OPE lines.</div>`;
    }

    const missingReceipts = filled.filter((e) => {
      const meta = getCategoryMeta(e.task_category);
      return meta?.needs_receipt && (!e.receipts || e.receipts.length === 0);
    }).length;

    const warnings = [];
    if (missingReceipts) warnings.push(`${missingReceipts} row(s) missing receipts`);
    if (!accountSel.value) warnings.push("Account not selected");
    if (!handlingSel.value) warnings.push("Handling Lawyer missing (required to submit)");
    if (entriesBody.querySelectorAll("tr").length < MAX_ROWS) warnings.push("Tip: click + Add Row when you need another entry.");

    summaryWarnings.innerHTML = warnings.length
      ? `<div class="receipt-warning-list">${warnings.map((w) => `<div class="receipt-warning-item">${escapeHtml(w)}</div>`).join("")}</div>`
      : `<div>No warnings.</div>`;
  }

  function updateUi() {
    const canContinue = validateDraft({ showErrors: false }).ok;
    continueBtn.disabled = isBusy || !canContinue;
    saveDraftBtn.disabled = isBusy || !canContinue;
    finalSaveDraftBtn.disabled = isBusy || !canContinue;

    const canSubmit = validateSubmit({ showErrors: false }).ok;
    submitBtn.disabled = isBusy || !canSubmit;

    if (readyHint) {
      let hint = "";
      if (!accountSel.value) hint = "Next: choose a Client/Account.";
      else if (!dateInput.value) hint = "Next: choose a Date.";
      else if (!validateDraft({ showErrors: false }).ok) hint = "Next: fill at least one entry row (category + amount).";
      else if (!handlingSel.value) hint = "To submit: select Handling Lawyer.";
      else if (!validateSubmit({ showErrors: false }).ok) hint = "To submit: upload missing receipts on required rows.";
      else hint = "Ready: you can submit now.";
      readyHint.textContent = hint;
    }

    updateSummary();
  }

  function resetAll() {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    batchId = safeUuid();
    renderBatchLabel();
    currentDraftKey = "";
    lastSavedLabel = null;
    autosaveLabel.textContent = "Not saved yet";
    savedAtEl.textContent = "-";
    summaryStatus.textContent = "Draft";

    accountSearch.value = "";
    accountCategoryFilter.value = "";
    if (showArchivedAccounts) showArchivedAccounts.checked = false;
    accountSel.value = "";
    matterSel.value = "";
    matterInput.value = "";
    billingStatusSel.value = "";
    ensureSelectHasValue(handlingSel, String(ctx.user.id || ""));
    generalNotes.value = "";
    renderMatterIdentifierChips(null);
    renderAccountOptions({ preserveSelection: false });
    renderMatterOptions({ preserveSelection: false });

    entriesBody.innerHTML = "";
    rowCount = 0;
    ensureRows(DEFAULT_ROWS);

    step2Msg.textContent = "";
    step3Msg.textContent = "";
    msg.textContent = "";
    setStep(2);
    clearErrors();
    updateUi();
  }

  function renderAccountOptions({ preserveSelection = true } = {}) {
    const prev = preserveSelection ? String(accountSel.value || "") : "";
    const q = String(accountSearch.value || "").trim().toLowerCase();
    const categoryFilter = normalizeAccountCategory(accountCategoryFilter.value);
    const includeArchived = !!showArchivedAccounts?.checked;
    const prevRow = (accountRows || []).find((a) => String(a.id || "") === prev) || null;
    const prevLabelNorm = prevRow ? formatAccountPickerLabel(prevRow).toLowerCase() : "";
    const queryIsCurrentSelectionLabel = !!q && !!prevLabelNorm && q === prevLabelNorm;
    const filterQuery = queryIsCurrentSelectionLabel ? "" : q;
    const allowPreservePrev = !!prev && (!q || prevLabelNorm === q);

    const filtered = (accountRows || [])
      .filter((a) => {
        if (!includeArchived && !!a.is_archived) return false;
        const categoryNorm = normalizeAccountCategory(a.category);
        if (categoryFilter && categoryNorm !== categoryFilter) return false;
        if (!filterQuery) return true;
        const hay = [
          String(a.title || ""),
          String(a.category || ""),
          String(a.account_kind || ""),
          accountCategoryLabel(a.category),
          formatAccountPickerLabel(a),
        ].join(" ").toLowerCase();
        return hay.includes(filterQuery);
      })
      .sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));

    const exactMatch = q
      ? filtered.find((a) => formatAccountPickerLabel(a).toLowerCase() === q)
      : null;

    if (!filtered.length) {
      accountSel.innerHTML = `<option value="">No matching accounts</option>`;
      renderAccountPickerMenu([], { query: filterQuery || q });
      return { rows: filtered };
    }

    accountSel.innerHTML =
      `<option value="">Select an account...</option>` +
      filtered
        .map((a) => {
          return `<option value="${a.id}">${escapeHtml(formatAccountPickerLabel(a))}</option>`;
        })
        .join("");

    if (exactMatch) {
      accountSel.value = exactMatch.id;
      syncAccountSearchFromSelected();
    } else if (allowPreservePrev && filtered.some((a) => String(a.id) === prev)) {
      accountSel.value = prev;
    } else if (q) {
      accountSel.value = "";
    }

    renderAccountPickerMenu(filtered, { query: filterQuery });

    return { rows: filtered };
  }

  function renderMatterIdentifierChips(matter) {
    if (!matterIdentifierChips) return;
    if (!matter) {
      matterIdentifierChips.innerHTML = `<span>No structured identifier selected.</span>`;
      return;
    }

    const chips = [];
    const type = normalizeAccountCategory(matter.matter_type);
    if (type === "litigation") {
      chips.push(`Official: ${cleanText(matter.official_case_no) || "-"}`);
      if (cleanText(matter.internal_case_code)) chips.push(`Internal: ${cleanText(matter.internal_case_code)}`);
    } else if (type === "special_project") {
      chips.push(`Code: ${cleanText(matter.special_engagement_code) || "-"}`);
    } else if (type === "retainer") {
      chips.push(`Ref: ${cleanText(matter.retainer_contract_ref) || "-"}`);
      chips.push(`Period: ${cleanText(matter.retainer_period_yyyymm) || "-"}`);
    }

    matterIdentifierChips.innerHTML = chips.length
      ? chips.map((x) => `<span class="status-pill" style="margin-right:6px">${escapeHtml(x)}</span>`).join("")
      : `<span>No identifier data.</span>`;
  }

  function renderMatterOptions({ preserveSelection = true } = {}) {
    const prev = preserveSelection ? String(matterSel.value || "") : "";
    const accountId = String(accountSel.value || "");
    const normalizedCategoryFilter = normalizeAccountCategory(accountCategoryFilter.value);

    const rows = (matterRows || [])
      .filter((m) => {
        if (accountId && String(m.account_id || "") !== accountId) return false;
        if (!normalizedCategoryFilter) return true;
        return normalizeAccountCategory(m.matter_type) === normalizedCategoryFilter;
      })
      .sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));

    matterSel.innerHTML =
      `<option value="">(none)</option>` +
      rows.map((m) => {
        const typeLabel = accountCategoryLabel(m.matter_type) || "Matter";
        const status = cleanText(m.status) || "active";
        return `<option value="${m.id}">${escapeHtml(cleanText(m.title) || "(untitled)")} [${escapeHtml(typeLabel)} | ${escapeHtml(status)}]</option>`;
      }).join("");

    if (prev && rows.some((m) => String(m.id) === prev)) {
      matterSel.value = prev;
    }

    const selected = rows.find((m) => String(m.id) === String(matterSel.value || "")) || null;
    if (selected) {
      if (matterHint) matterHint.textContent = `Linked to ${accountCategoryLabel(selected.matter_type)} matter.`;
      if (!cleanText(matterInput.value)) matterInput.value = cleanText(selected.title || "");
    } else if (matterHint) {
      matterHint.textContent = "Select a structured matter for strict identifiers.";
    }
    renderMatterIdentifierChips(selected);

    return { rows, selected };
  }

  async function loadMatters() {
    const { data, error } = await supabase
      .from("matters")
      .select("id,account_id,matter_type,title,status,official_case_no,internal_case_code,special_engagement_code,retainer_contract_ref,retainer_period_yyyymm,handling_lawyer_id")
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw error;

    matterRows = data || [];
    matterById = new Map(matterRows.map((m) => [String(m.id), m]));
    renderMatterOptions();
    return { rows: matterRows };
  }

  async function loadAccounts() {
    const { data, error } = await supabase
      .from("accounts")
      .select("id,title,category,account_kind,status,is_archived,created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;

    const rows = data || [];
    accountRows = rows;
    if (!rows.length) {
      accountSel.innerHTML = `<option value="">No accounts assigned</option>`;
      renderAccountPickerMenu([], { query: String(accountSearch.value || "") });
      setAccountPickerMenuOpen(false);
      noAccounts.style.display = "block";

      const isAdmin = ["super_admin", "admin"].includes(String(ctx.profile.role || ""));
      noAccounts.innerHTML = `
        <strong>No accounts assigned</strong>
        <div class="muted" style="margin-top:6px">
          Click Manage Accounts to view Accounts. ${isAdmin ? "Or create one here:" : "Ask an admin to assign your account."}
        </div>
        ${isAdmin ? `
          <hr/>
          <div id="quickCreate" class="stack" style="margin-top:8px">
            <label>New Account Title</label>
            <input id="qcTitle" required placeholder="Client / Matter title" />
            <label>Category</label>
            <select id="qcCategory">
              <option value="retainer">Retainer</option>
              <option value="litigation">Litigation</option>
              <option value="special_project">Special Project</option>
            </select>
            <button id="qcCreateBtn" type="button" class="btn btn-primary">Create Account</button>
            <div id="qcMsg" class="msg"></div>
          </div>
        ` : ``}
      `;

      if (isAdmin) {
        const qc = noAccounts.querySelector("#quickCreate");
        const qcMsg = noAccounts.querySelector("#qcMsg");
        const qcTitle = noAccounts.querySelector("#qcTitle");
        const qcCategory = noAccounts.querySelector("#qcCategory");
        const qcCreateBtn = noAccounts.querySelector("#qcCreateBtn");
        if (!qc || !qcMsg || !qcTitle || !qcCategory || !qcCreateBtn) {
          throw new Error("Quick create UI failed to initialize.");
        }

        const runQuickCreate = async () => {
          qcMsg.textContent = "Creating...";
          const title = qcTitle.value.trim();
          const category = qcCategory.value;
          if (!title) {
            qcMsg.textContent = "Error: Title is required.";
            return;
          }
          const account_kind = category === "retainer" ? "company" : "personal";
          const { error: cErr } = await supabase
            .from("accounts")
            .insert({ title, category, account_kind, created_by: ctx.user.id, is_archived: false });
          qcMsg.textContent = cErr ? `Error: ${cErr.message}` : "Created. Reloading...";
          if (!cErr) {
            accountSearch.value = "";
            accountCategoryFilter.value = category;
            const { rows: reloaded } = await loadAccounts();
            await loadMatters();
            const newest = reloaded?.[0];
            if (newest?.id) {
              accountSel.value = newest.id;
              syncAccountSearchFromSelected();
              renderMatterOptions({ preserveSelection: false });
              await loadMembersForAccount(newest.id);
            }
            updateUi();
            qcMsg.textContent = "Ready.";
          }
        };

        qcCreateBtn.addEventListener("click", runQuickCreate);
        qcTitle.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          runQuickCreate();
        });
      }

      return { rows: [] };
    }

    noAccounts.style.display = "none";
    renderAccountOptions();
    renderMatterOptions();
    return { rows };
  }

  async function loadMembersForAccount(accountId) {
    const actorId = String(ctx.user.id || "");
    const selfOpt = actorId
      ? `<option value="${actorId}">${escapeHtml(selfLabel)} - ${escapeHtml(ctx.profile.role || "")}</option>`
      : "";
    handlingSel.innerHTML = `<option value="">Select lawyer...</option>` + selfOpt;
    ensureSelectHasValue(handlingSel, actorId);
    if (memberLoadNote) memberLoadNote.style.display = "none";

    // New behavior: firm-wide Handling Lawyer list (lawyers only), independent of account membership.
    // This makes the dropdown work for all authenticated users under strict RLS setups.
    try {
      const { data: lawyers, error: lErr } = await supabase.rpc("list_handling_lawyers");
      if (lErr) throw lErr;

      const rows = (lawyers || []).filter((x) => x?.id);
      if (!rows.length) throw new Error("No lawyers returned (profiles may be missing/empty).");

      const options = rows.map((p) => {
        const label = p.full_name || p.email || p.id;
        const role = p.role ? ` - ${p.role}` : "";
        return `<option value="${p.id}">${escapeHtml(label)}${escapeHtml(role)}</option>`;
      }).join("");

      handlingSel.innerHTML = `<option value="">Select lawyer...</option>` + options;

      const actorRole = String(ctx.profile.role || "").toLowerCase();
      const isLawyerish = HANDLING_LAWYER_ROLES.includes(actorRole);
      const actorInList = rows.some((x) => String(x.id || "") === actorId);
      const fallbackId = String(rows[0].id || "");
      const preferred = isLawyerish && actorInList ? actorId : fallbackId;
      ensureSelectHasValue(handlingSel, preferred);

      if (memberLoadNote) {
        if (isLawyerish && !actorInList) {
          memberLoadNote.style.display = "block";
          memberLoadNote.textContent = "Your account role is lawyer, but your profile is not in the lawyer list. Defaulted to first available lawyer. Ask admin to verify your profile role in DB.";
        } else {
          memberLoadNote.style.display = "none";
        }
      }

      return;
    } catch (e) {
      // Fall back to account_members -> profiles, if available (older behavior).
      console.warn("Firm-wide lawyer list RPC failed; falling back to account-based member load.", e);
      if (memberLoadNote) {
        memberLoadNote.style.display = "block";
        memberLoadNote.textContent = `Lawyer list RPC unavailable: ${e?.message || e}`;
      }
    }

    if (!accountId) {
      if (Array.from(handlingSel.options).length <= 1) {
        handlingSel.innerHTML = `<option value="">No lawyers available</option>` + selfOpt;
        ensureSelectHasValue(handlingSel, actorId);
      }
      return;
    }

    try {
      const { data: mem, error: memErr } = await supabase
        .from("account_members")
        .select("user_id")
        .eq("account_id", accountId);
      if (memErr) throw memErr;

      const ids = Array.from(new Set((mem || []).map((x) => x.user_id).concat([ctx.user.id])));
      if (!ids.length) return;

      const { data: profs, error: pErr } = await supabase
        .from("profiles")
        .select("id,email,full_name,role")
        .in("id", ids);
      if (pErr) throw pErr;

      const byId = new Map((profs || []).map((p) => [p.id, p]));
      const options = ids.map((id) => {
        const p = byId.get(id);
        const label = p ? (p.full_name || p.email || p.id) : id;
        const role = p?.role ? ` - ${p.role}` : "";
        return `<option value="${id}">${escapeHtml(label)}${escapeHtml(role)}</option>`;
      }).join("");

      // Handling Lawyer should prefer users with allowed handling-lawyer roles.
      const lawyerIds = ids.filter((id) => {
        const r = String(byId.get(id)?.role || "").toLowerCase();
        return HANDLING_LAWYER_ROLES.includes(r);
      });

      const orderedIds = lawyerIds.length ? lawyerIds : ids;
      const optionsOrdered = orderedIds.map((id) => {
        const p = byId.get(id);
        const label = p ? (p.full_name || p.email || p.id) : id;
        const role = p?.role ? ` - ${p.role}` : "";
        return `<option value="${id}">${escapeHtml(label)}${escapeHtml(role)}</option>`;
      }).join("");

      handlingSel.innerHTML = `<option value="">Select lawyer...</option>` + optionsOrdered;

      const actorRole = String(ctx.profile.role || "").toLowerCase();
      const actorInList = orderedIds.some((id) => String(id || "") === actorId);
      const preferred = HANDLING_LAWYER_ROLES.includes(actorRole) && actorInList
        ? actorId
        : String(orderedIds[0] || "");
      ensureSelectHasValue(handlingSel, preferred);
    } catch (e) {
      console.warn("Member load failed; using self only.", e);
      handlingSel.innerHTML = `<option value="">Select lawyer...</option>` + selfOpt;
      ensureSelectHasValue(handlingSel, actorId);
      if (memberLoadNote) {
        memberLoadNote.style.display = "block";
        memberLoadNote.textContent = "Unable to load lawyers. Ask admin to verify public.list_handling_lawyers() and grant EXECUTE to authenticated.";
      }
    }
  }

  async function loadDraftBatches() {
    draftsEl.innerHTML = `<p class="muted">Loading...</p>`;

    const { data, error } = await supabase
      .from("activities")
      .select("id,batch_id,line_no,account_id,amount,status,created_at,occurred_at")
      .eq("created_by", ctx.user.id)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(150);

    if (error) {
      draftsEl.innerHTML = `<p class="msg">Error: ${escapeHtml(error.message)}</p>`;
      return;
    }

    const rows = data || [];
    if (!rows.length) {
      draftsEl.innerHTML = `<p class="muted">No drafts.</p>`;
      return;
    }

    const groups = new Map();
    for (const r of rows) {
      const key = r.batch_id || r.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }

    const batches = Array.from(groups.entries()).map(([key, items]) => {
      const total = items.reduce((s, x) => s + Number(x.amount || 0), 0);
      return {
        key,
        total,
        count: items.length,
        createdAt: items[0]?.created_at,
        occurredAt: items[0]?.occurred_at,
        account_id: items[0]?.account_id,
      };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 12);

    const accountIds = Array.from(new Set(batches.map((b) => b.account_id).filter(Boolean)));
    const accRes = accountIds.length
      ? await supabase.from("accounts").select("id,title,category").in("id", accountIds)
      : { data: [] };
    const accById = new Map((accRes.data || []).map((a) => [a.id, a]));

    draftsEl.innerHTML = batches.map((b) => {
      const acc = accById.get(b.account_id);
      const title = acc ? `${acc.title} (${acc.category || "-"})` : "Account";
      const when = b.occurredAt ? new Date(b.occurredAt).toLocaleDateString() : "";
      return `
        <div class="row" style="align-items:flex-start">
          <div style="flex:1">
            <div><strong>${escapeHtml(title)}</strong></div>
            <div class="muted" style="font-size:12px">${escapeHtml(when)} - ${b.count} row(s)</div>
            <div style="margin-top:6px"><strong>P${peso(b.total)}</strong></div>
          </div>
          <div class="actions">
            <button class="btn openDraft" data-batch="${escapeHtml(b.key)}">Open</button>
            <button class="btn btn-danger deleteDraft" data-batch="${escapeHtml(b.key)}">Delete</button>
          </div>
        </div>
      `;
    }).join("");

    draftsEl.querySelectorAll(".openDraft").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await openDraftBatch(btn.dataset.batch);
      });
    });

    draftsEl.querySelectorAll(".deleteDraft").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await deleteDraftBatch(btn.dataset.batch);
      });
    });
  }

  async function deleteDraftBatch(key) {
    if (!key || isBusy) return;
    const ok = await uiConfirm({
      title: "Delete Draft Batch",
      message: "Delete this draft batch? Uploaded receipts linked to this draft will also be deleted when allowed.",
      confirmText: "Delete",
      danger: true,
    });
    if (!ok) return;

    try {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
      }
      setBusy(true, "Deleting draft...");

      let { data: rows, error } = await supabase
        .from("activities")
        .select("id,batch_id,attachment_urls")
        .eq("created_by", ctx.user.id)
        .eq("status", "draft")
        .eq("batch_id", key)
        .limit(300);
      if (error) throw error;

      if (!rows?.length) {
        const fallback = await supabase
          .from("activities")
          .select("id,batch_id,attachment_urls")
          .eq("created_by", ctx.user.id)
          .eq("status", "draft")
          .eq("id", key)
          .limit(1);
        if (fallback.error) throw fallback.error;
        rows = fallback.data || [];
      }

      if (!rows.length) {
        msg.textContent = "Draft not found or already removed.";
        return;
      }

      const ids = rows.map((r) => r.id).filter(Boolean);
      const rowById = new Map(rows.map((r) => [String(r.id || ""), r]));

      const { data: deletedRows, error: delErr } = await supabase
        .from("activities")
        .delete()
        .in("id", ids)
        .eq("created_by", ctx.user.id)
        .eq("status", "draft")
        .select("id");
      if (delErr) throw delErr;

      const deletedCount = Array.isArray(deletedRows) ? deletedRows.length : 0;
      if (deletedCount === 0) {
        throw new Error("No draft rows were deleted (activities DELETE may be blocked by RLS policy).");
      }

      const deletedIds = new Set((deletedRows || []).map((r) => String(r.id || "")));
      const remainingIds = ids.filter((id) => !deletedIds.has(String(id)));
      if (remainingIds.length) {
        msg.textContent = `Draft partially deleted (${deletedCount}/${ids.length}). Check activities DELETE RLS policy.`;
      }

      const filesByBucket = new Map();
      for (const id of deletedIds) {
        const deleted = rowById.get(id);
        if (!deleted) continue;
        const urls = Array.isArray(deleted.attachment_urls)
          ? deleted.attachment_urls
          : (deleted.attachment_urls ? [String(deleted.attachment_urls)] : []);
        for (const raw of urls) {
          const split = splitBucketAndPath(raw);
          if (!split.path) continue;
          if (!filesByBucket.has(split.bucket)) filesByBucket.set(split.bucket, []);
          filesByBucket.get(split.bucket).push(split.path);
        }
      }

      let fileCleanupErrors = 0;
      for (const [bucket, paths] of filesByBucket.entries()) {
        if (!paths.length) continue;
        const uniquePaths = Array.from(new Set(paths));
        const { error: rmErr } = await supabase.storage.from(bucket).remove(uniquePaths);
        if (rmErr) fileCleanupErrors += 1;
      }

      if (String(currentDraftKey || "") === String(key) || String(batchId || "") === String(key)) {
        resetAll();
      }

      await Promise.all([loadDraftBatches(), loadRecent()]);
      if (!remainingIds.length) {
        msg.textContent = fileCleanupErrors
          ? "Draft deleted. Some uploaded files could not be removed due to storage policy."
          : "Draft deleted.";
      }
    } catch (e) {
      msg.textContent = `Delete draft failed: ${e?.message || e}`;
    } finally {
      setBusy(false);
      updateUi();
    }
  }

  async function openDraftBatch(key) {
    if (!key) return;
    if (isBusy) return;

    try {
      setBusy(true, "Loading draft...");
      const { data, error } = await supabase
        .from("activities")
        .select("batch_id,line_no,account_id,matter,matter_id,billing_status,handling_lawyer_id,occurred_at,description,task_category,amount,attachment_urls")
        .eq("created_by", ctx.user.id)
        .eq("status", "draft")
        .eq("batch_id", key)
        .order("line_no", { ascending: true })
        .limit(200);

      if (error) throw error;
      let rows = data || [];
      if (!rows.length) {
        const fallback = await supabase
          .from("activities")
          .select("batch_id,line_no,account_id,matter,matter_id,billing_status,handling_lawyer_id,occurred_at,description,task_category,amount,attachment_urls")
          .eq("created_by", ctx.user.id)
          .eq("status", "draft")
          .eq("id", key)
          .limit(1);
        if (fallback.error) throw fallback.error;
        rows = fallback.data || [];
      }
      if (!rows.length) throw new Error("Draft batch not found (it may have expired).");

      const first = rows[0];
      batchId = first.batch_id || key || safeUuid();
      renderBatchLabel();
      currentDraftKey = key;
      const openedAccount = (accountRows || []).find((a) => String(a.id || "") === String(first.account_id || ""));
      const openedCategory = normalizeAccountCategory(openedAccount?.category);

      accountSel.value = first.account_id || "";
      syncAccountSearchFromSelected();
      renderMatterOptions({ preserveSelection: false });
      matterSel.value = first.matter_id || "";
      const draftMatter = matterById.get(String(first.matter_id || ""));
      renderMatterIdentifierChips(draftMatter || null);
      matterInput.value = first.matter || cleanText(draftMatter?.title) || "";
      billingStatusSel.value = first.billing_status || "";

      dateInput.value = toLocalDateInputValue(first.occurred_at || new Date());

      await loadMembersForAccount(first.account_id);
      ensureSelectHasValue(handlingSel, String(first.handling_lawyer_id || ""));

      generalNotes.value = "";

      entriesBody.innerHTML = "";
      rowCount = 0;
      for (const r of rows) {
        const lineNo = Number(r.line_no || 0) || 1;
        rowCount = Math.max(rowCount, lineNo);
        entriesBody.insertAdjacentHTML("beforeend", buildRow(lineNo, { removable: true }));
        const tr = entriesBody.querySelector(`tr[data-line-no="${lineNo}"]`);
        wireRow(tr);
        tr.querySelector(".cat").value = r.task_category || "";
        tr.querySelector(".amt").value = r.amount != null ? String(r.amount) : "";
        tr.querySelector(".notes").value = extractLogNoteFromDescription(r.description, openedCategory);

        const receipts = Array.isArray(r.attachment_urls)
          ? r.attachment_urls
          : (r.attachment_urls ? [String(r.attachment_urls)] : []);
        setReceipts(tr, receipts.filter(Boolean));
        applyReceiptVisibility(tr);
      }
      ensureRows(Math.max(DEFAULT_ROWS, entriesBody.querySelectorAll("tr").length));

      lastSavedLabel = nowTimeLabel();
      autosaveLabel.textContent = `Saved ${lastSavedLabel}`;
      savedAtEl.textContent = lastSavedLabel;

      setStep(2);
      clearErrors();
      updateUi();
      msg.textContent = "Draft loaded.";
    } catch (e) {
      msg.textContent = `Error loading draft: ${e?.message || e}`;
    } finally {
      setBusy(false);
    }
  }

  async function loadRecent() {
    recentEl.innerHTML = `<p class="muted">Loading...</p>`;

    const { data, error } = await supabase
      .from("activities")
      .select("id,account_id,task_category,description,amount,status,occurred_at,created_at")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      recentEl.innerHTML = `<p class="msg">Error: ${escapeHtml(error.message)}</p>`;
      return;
    }

    const rows = data || [];
    if (!rows.length) {
      recentEl.innerHTML = `<p class="muted">No activity yet.</p>`;
      return;
    }

    const accountIds = Array.from(new Set(rows.map((r) => r.account_id).filter(Boolean)));
    const accRes = accountIds.length
      ? await supabase.from("accounts").select("id,title,category").in("id", accountIds)
      : { data: [] };
    const accById = new Map((accRes.data || []).map((a) => [a.id, a]));

    recentEl.innerHTML = `
      <div class="table-wrap recent-activities-wrap">
        <table class="recent-activities-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Client</th>
              <th>Category</th>
              <th>Description</th>
              <th>Status</th>
              <th style="text-align:right">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((x) => {
              const acc = accById.get(x.account_id);
              const title = acc ? `${acc.title} (${acc.category || "-"})` : "Account";
              const categoryLabel = displayCategoryLabel(x.task_category);
              const when = x.occurred_at
                ? new Date(x.occurred_at).toLocaleString([], { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                : "-";
              const status = String(x.status || "draft").toLowerCase();
              const desc = String(x.description || "").trim() || "-";
              return `
                <tr>
                  <td class="recent-when">${escapeHtml(when)}</td>
                  <td class="recent-client">${escapeHtml(title)}</td>
                  <td>${escapeHtml(categoryLabel)}</td>
                  <td class="recent-desc" title="${escapeHtml(desc)}">${escapeHtml(desc)}</td>
                  <td><span class="${recentStatusPillClass(status)}">${escapeHtml(status)}</span></td>
                  <td style="text-align:right;font-weight:700">P${peso(x.amount)}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  // Init wiring
  dateInput.value = toLocalDateInputValue(new Date());
  templateSel.innerHTML = TEMPLATE_BUNDLES.map((t) => `<option value="${t.key}">${escapeHtml(t.label)}</option>`).join("");
  ensureRows(DEFAULT_ROWS);
  renderBatchLabel();
  setStep(2);
  if (performedByLabel) performedByLabel.textContent = `${selfLabel} - ${String(ctx.profile.role || "")}`;

  try {
    msg.textContent = "Loading...";
    await loadAccounts();
    await loadMatters();
    const prefillApplied = await applyActivityPrefillIfAny();
    if (!prefillApplied) {
      await loadMembersForAccount(accountSel.value);
    }
    msg.textContent = "";
    await Promise.all([loadDraftBatches(), loadRecent()]);
  } catch (e) {
    msg.textContent = `Error: ${e?.message || e}`;
  }

  updateUi();

  // Events
  form.addEventListener("submit", (e) => e.preventDefault());
  manageAccountsBtn.addEventListener("click", () => navigate("#/accounts"));

  function moveAccountPickerActive(delta) {
    if (!accountPickerRows.length) return;
    const len = accountPickerRows.length;
    const current = Number.isInteger(accountPickerActiveIndex) ? accountPickerActiveIndex : -1;
    const next = current < 0
      ? (delta > 0 ? 0 : len - 1)
      : (current + delta + len) % len;
    accountPickerActiveIndex = next;
    renderAccountOptions();
    setAccountPickerMenuOpen(true);
    const activeBtn = accountSearchMenu?.querySelector(`[data-account-picker-index="${next}"]`);
    activeBtn?.scrollIntoView({ block: "nearest" });
  }

  accountSearch.addEventListener("input", async () => {
    const prev = accountSel.value;
    renderAccountOptions();
    setAccountPickerMenuOpen(true);
    const accountChanged = String(accountSel.value || "") !== String(prev || "");
    renderMatterOptions({ preserveSelection: !accountChanged });
    if (accountChanged) {
      await loadMembersForAccount(accountSel.value);
      scheduleAutosave();
    }
    updateUi();
  });

  accountSearch.addEventListener("focus", () => {
    renderAccountOptions();
    setAccountPickerMenuOpen(true);
  });

  accountSearch.addEventListener("change", async () => {
    const prev = accountSel.value;
    const rendered = renderAccountOptions();
    if (!accountSel.value && rendered.rows.length === 1) {
      accountSel.value = String(rendered.rows[0].id || "");
      syncAccountSearchFromSelected();
    }
    const accountChanged = String(accountSel.value || "") !== String(prev || "");
    renderMatterOptions({ preserveSelection: !accountChanged });
    if (accountChanged) {
      await loadMembersForAccount(accountSel.value);
      scheduleAutosave();
    }
    setAccountPickerMenuOpen(false);
    updateUi();
  });

  accountSearch.addEventListener("keydown", async (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveAccountPickerActive(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveAccountPickerActive(-1);
      return;
    }
    if (e.key === "Escape") {
      setAccountPickerMenuOpen(false);
      return;
    }
    if (e.key === "Tab") {
      setAccountPickerMenuOpen(false);
      return;
    }
    if (e.key === "Enter" && accountPickerActiveIndex >= 0 && accountPickerRows[accountPickerActiveIndex]) {
      e.preventDefault();
      await commitAccountPickerSelection(accountPickerRows[accountPickerActiveIndex].id);
    }
  });

  accountSearch.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (accountPickerMouseDown) return;
      setAccountPickerMenuOpen(false);
    }, 120);
  });

  accountSearchMenu?.addEventListener("mousedown", () => {
    accountPickerMouseDown = true;
  });

  accountSearchMenu?.addEventListener("click", async (e) => {
    accountPickerMouseDown = false;
    const targetEl = e.target instanceof Element ? e.target : null;
    const btn = targetEl ? targetEl.closest("[data-account-picker-id]") : null;
    if (!btn) return;
    const accountId = String(btn.getAttribute("data-account-picker-id") || "");
    if (!accountId) return;
    await commitAccountPickerSelection(accountId);
  });

  accountCategoryFilter.addEventListener("change", async () => {
    const prev = accountSel.value;
    renderAccountOptions();
    if (document.activeElement === accountSearch) setAccountPickerMenuOpen(true);
    const accountChanged = String(accountSel.value || "") !== String(prev || "");
    renderMatterOptions({ preserveSelection: !accountChanged });
    if (accountChanged) {
      await loadMembersForAccount(accountSel.value);
      scheduleAutosave();
    }
    updateUi();
  });

  showArchivedAccounts?.addEventListener("change", async () => {
    const prev = accountSel.value;
    renderAccountOptions();
    if (document.activeElement === accountSearch) setAccountPickerMenuOpen(true);
    const accountChanged = String(accountSel.value || "") !== String(prev || "");
    renderMatterOptions({ preserveSelection: !accountChanged });
    if (accountChanged) {
      await loadMembersForAccount(accountSel.value);
    }
    scheduleAutosave();
    updateUi();
  });

  accountSel.addEventListener("change", async () => {
    setFieldError("account_id", "");
    syncAccountSearchFromSelected();
    setAccountPickerMenuOpen(false);
    renderMatterOptions({ preserveSelection: false });
    await loadMembersForAccount(accountSel.value);
    scheduleAutosave();
    updateUi();
  });

  matterSel.addEventListener("change", async () => {
    const selectedMatter = matterById.get(String(matterSel.value || ""));
    renderMatterIdentifierChips(selectedMatter || null);
    if (selectedMatter) {
      if (String(accountSel.value || "") !== String(selectedMatter.account_id || "")) {
        accountSel.value = selectedMatter.account_id || "";
        accountSearch.value = "";
        renderAccountOptions({ preserveSelection: true });
        syncAccountSearchFromSelected();
      }
      if (!cleanText(matterInput.value)) matterInput.value = cleanText(selectedMatter.title || "");
      if (matterHint) matterHint.textContent = `Linked to ${accountCategoryLabel(selectedMatter.matter_type)} matter.`;
      await loadMembersForAccount(accountSel.value);
    } else if (matterHint) {
      matterHint.textContent = "Select a structured matter for strict identifiers.";
    }
    setFieldError("matter_id", "");
    scheduleAutosave();
    updateUi();
  });

  [dateInput, matterInput, billingStatusSel, handlingSel, generalNotes].forEach((el) => {
    el.addEventListener("change", () => { scheduleAutosave(); updateUi(); });
    el.addEventListener("input", () => { scheduleAutosave(); updateUi(); });
  });

  addRowBtn.addEventListener("click", () => addRow({ removable: true, focus: true }));

  templateSel.addEventListener("change", () => {
    const key = templateSel.value;
    const tpl = TEMPLATE_BUNDLES.find((t) => t.key === key);
    templateSel.value = "";
    if (!tpl || !tpl.rows?.length) return;

    const all = collectEntries();
    let i = 0;
    for (const c of tpl.rows) {
      let target = all.find((e) => isBlankEntry(e));
      if (!target) {
        addRow({ removable: true, focus: false });
        target = collectEntries().find((e) => isBlankEntry(e));
      }
      if (!target) break;
      target.tr.querySelector(".cat").value = c;
      applyReceiptVisibility(target.tr);
      i++;
    }

    msg.textContent = i ? `Template added: ${tpl.label}` : "Unable to add template.";
    scheduleAutosave();
    updateUi();
  });

  saveDraftBtn.addEventListener("click", () => saveDraft({ quiet: false }));
  finalSaveDraftBtn.addEventListener("click", () => saveDraft({ quiet: false }));
  submitBtn.addEventListener("click", submitPending);
  backBtn.addEventListener("click", () => { step3Msg.textContent = ""; setStep(2); updateUi(); });
  clearBtn.addEventListener("click", async () => {
    const ok = await uiConfirm({
      title: "Clear Sheet",
      message: "Clear the current sheet?",
      confirmText: "Clear",
      danger: true,
    });
    if (ok) resetAll();
  });

  continueBtn.addEventListener("click", () => {
    clearErrors();
    const v = validateSubmit({ showErrors: true });
    if (!v.entries.length) { step2Msg.textContent = "Add at least one entry row first."; return; }
    renderReview(v.entries);
    step2Msg.textContent = "";
    setStep(3);
    updateUi();
  });
}
