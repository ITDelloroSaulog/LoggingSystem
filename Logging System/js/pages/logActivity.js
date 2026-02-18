import { supabase } from "../supabaseClient.js";
import { escapeHtml } from "../ui/escapeHtml.js";

// Excel-like, less confusing "Activities" entry.
// Each filled row becomes a row in public.activities (draft/pending/etc).

const RECEIPTS_BUCKET = "receipts";
const DEFAULT_ROWS = 1;
const MAX_ROWS = 20;
const HANDLING_LAWYER_ROLES = ["lawyer"];

// Core categories requested (organized UI only; keep underlying fee codes).
// Receipt required by default for OPE expense categories (except man hour).
const CATEGORIES = [
  { value: "appearance_fee", label: "Appearance", fee_code: "AF", needs_receipt: false },
  { value: "pleading_major", label: "Pleading", fee_code: "PF", needs_receipt: false },
  { value: "notary_fee", label: "Notary", fee_code: "NF", needs_receipt: true },
  { value: "ope_printing", label: "Printing", fee_code: "OPE", needs_receipt: true },
  { value: "ope_envelope", label: "Envelope", fee_code: "OPE", needs_receipt: true },
  { value: "ope_lbc", label: "LBC", fee_code: "OPE", needs_receipt: true },
  { value: "ope_transpo", label: "Transpo", fee_code: "OPE", needs_receipt: true },
  { value: "ope_manhours", label: "Man Hour", fee_code: "OPE", needs_receipt: false },
];

const TEMPLATE_BUNDLES = [
  { key: "", label: "Add from Template..." },
  { key: "notary_print_env", label: "Notary + Printing + Envelope", rows: ["notary_fee", "ope_printing", "ope_envelope"] },
  { key: "delivery", label: "Delivery bundle (LBC + Transpo)", rows: ["ope_lbc", "ope_transpo"] },
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
  for (const c of CATEGORIES) opts.push(`<option value="${c.value}">${escapeHtml(c.label)}</option>`);
  return opts.join("");
}

function getCategoryMeta(value) {
  return CATEGORIES.find((c) => c.value === value) || null;
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
    const structured = rawLower.includes("retainer ope") || map["invoice"] !== undefined || map["assignee"] !== undefined;
    if (!structured) return raw;
    const notes = cleanText(map["notes"]);
    return notes === "-" ? "" : notes;
  }

  return raw;
}

function buildTrackerConnectedDescription({ accountCategory, note, fallbackLabel }) {
  const text = cleanText(note);
  const fallback = cleanText(fallbackLabel) || "Activity";

  if (accountCategory === "litigation") {
    const parts = [
      "Venue: -",
      "Case Type: Civil Case",
      "Tracker Status: In progress",
    ];
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
    const parts = [
      "Retainer OPE | Invoice: -",
      "Assignee: -",
      "Location: -",
      "Handling: -",
    ];
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
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <h2 style="margin:0">Activities</h2>
          <div class="muted" style="font-size:12px;margin-top:4px">Step-by-step entry. Filled rows become activity entries.</div>
        </div>
        <div class="muted" style="font-size:12px">Autosave: <span id="autosaveLabel">Not saved yet</span></div>
      </div>

      <hr/>

      <div class="layout-activities">
        <form id="form" class="stack">
          <div class="stepper" aria-label="Activity flow">
            <div class="step" data-step="1"><span class="step-num">1</span><span class="step-label">Details</span></div>
            <div class="step" data-step="2"><span class="step-num">2</span><span class="step-label">Entries</span></div>
            <div class="step" data-step="3"><span class="step-num">3</span><span class="step-label">Review</span></div>
          </div>

          <section class="step-card" id="step1" data-step="1">
            <div class="step-head">
              <h3 class="step-title">Step 1: Details</h3>
              <div class="step-sub">Context first. Keep it simple.</div>
            </div>

            <div class="grid2" style="grid-template-columns: minmax(220px,1.4fr) minmax(170px,.8fr) minmax(170px,.8fr)">
              <div>
                <label>Search Client/Account</label>
                <input id="accountSearch" placeholder="Type to filter accounts..." />
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

            <label>Client/Account</label>
            <div style="display:flex;gap:8px;align-items:center">
              <select id="account_id" required style="flex:1"></select>
              <button id="manageAccountsBtn" type="button" class="btn btn-ghost" style="width:auto">Manage</button>
            </div>
            <div class="field-error" data-for="account_id"></div>
            <div id="noAccounts" class="items-help" style="display:none;margin-top:10px"></div>

            <div class="grid2">
              <div>
                <label>Matter/Engagement (optional)</label>
                <input id="matter" placeholder="Optional" />
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

          <section class="step-card" id="step2" data-step="2">
            <div class="step-head">
              <h3 class="step-title">Step 2: Entries</h3>
              <div class="step-sub">Excel-style rows. Empty rows are ignored on submit.</div>
            </div>

            <div class="items-help">
              Receipt upload is required for OPE expense rows (Notary, Printing, Envelope, LBC, Transpo). Man Hour is treated like a normal amount (no timekeeping).
            </div>

            <div class="table-wrap">
              <table class="entries-table">
                <thead>
                  <tr>
                    <th style="width:190px">Category</th>
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

            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
              <button id="addRowBtn" type="button" class="btn btn-primary">+ Add Row</button>
              <select id="templateSel" class="btn" style="width:auto"></select>
              <button id="continueBtn" type="button" class="btn">Continue to Review</button>
              <button id="saveDraftBtn" type="button" class="btn btn-ghost">Save Draft</button>
            </div>

            <p id="msg2" class="msg"></p>
          </section>

          <section class="step-card" id="step3" data-step="3" style="display:none">
            <div class="step-head">
              <h3 class="step-title">Step 3: Review and Submit</h3>
              <div class="step-sub">Double-check the rows and receipts.</div>
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

        <aside class="panel summary-panel">
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
  const autosaveLabel = $("#autosaveLabel");
  const savedAtEl = $("#savedAt");
  const summaryStatus = $("#summaryStatus");
  const summaryTotals = $("#summaryTotals");
  const summaryWarnings = $("#summaryWarnings");

  const form = $("#form");
  const accountSearch = $("#accountSearch");
  const accountCategoryFilter = $("#accountCategoryFilter");
  const accountSel = $("#account_id");
  const manageAccountsBtn = $("#manageAccountsBtn");
  const noAccounts = $("#noAccounts");
  const dateInput = $("#occurred_on");
  const matterInput = $("#matter");
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
  let currentDraftKey = "";

  function setBusy(busy, label) {
    isBusy = !!busy;
    if (typeof label === "string") msg.textContent = label;
    [accountSearch, accountCategoryFilter, accountSel, dateInput, matterInput, billingStatusSel, handlingSel, generalNotes].forEach((el) => el && (el.disabled = isBusy));
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
    ["account_id", "occurred_on", "handling_lawyer_id", "entries"].forEach((k) => setFieldError(k, ""));
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
      return;
    }
    const hasReceipts = getReceipts(tr).length > 0;

    if (meta.needs_receipt) {
      cell.style.opacity = "1";
      uploadBtn.style.display = "inline-block";
      uploadBtn.textContent = hasReceipts ? "Add more" : "Upload";
      optional.style.display = "none";
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
          alert(`Unable to open receipt: ${err?.message || err}`);
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
      const meta = getCategoryMeta(e.task_category);
      const key = meta?.label || e.task_category;
      map.set(key, (map.get(key) || 0) + Number(e.amount || 0));
    }
    return map;
  }

  function validateDraft({ showErrors = false } = {}) {
    if (showErrors) clearErrors();
    let ok = true;

    if (!accountSel.value) { if (showErrors) setFieldError("account_id", "Select an account."); ok = false; }
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
    const matter = (matterInput.value || "").trim() || null;
    const baseNotes = (generalNotes.value || "").trim();
    const selectedAccount = (accountRows || []).find((a) => String(a.id || "") === String(accountSel.value || ""));
    const accountCategory = normalizeAccountCategory(selectedAccount?.category);
    const performed_by = ctx.user.id;
    const handling_lawyer_id = handlingSel.value || null;
    const submitted_at = status === "pending" ? new Date().toISOString() : null;
    const draft_expires_at = status === "draft" ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null;

    return entries.map((e) => {
      const meta = getCategoryMeta(e.task_category);
      const desc = buildTrackerConnectedDescription({
        accountCategory,
        note: e.notes || baseNotes,
        fallbackLabel: meta?.label || "Activity",
      });
      return {
        batch_id: batchId,
        line_no: e.line_no,

        account_id: accountSel.value,
        matter,
        billing_status,
        billable,

        created_by: ctx.user.id,
        performed_by,
        handling_lawyer_id,

        status,
        activity_type: toActivityType(e.task_category),
        fee_code: meta?.fee_code || null,
        task_category: e.task_category,
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

    const ok = confirm("Submit these entries for approval? This will create Pending activities.");
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
      reviewBox.innerHTML = `<div class="muted">No entries yet.</div>`;
      return;
    }

    const totals = computeTotalsByCategory(entries);
    const totalValue = Array.from(totals.values()).reduce((s, x) => s + x, 0);

    reviewBox.innerHTML = `
      <div class="table-wrap" style="margin-top:6px">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Amount</th>
              <th>Notes</th>
              <th>Receipt</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map((e) => {
              const meta = getCategoryMeta(e.task_category);
              const needs = meta?.needs_receipt;
              const has = e.receipts && e.receipts.length > 0;
              return `
                <tr>
                  <td><strong>${escapeHtml(meta?.label || e.task_category)}</strong></td>
                  <td>P${peso(e.amount)}</td>
                  <td>${escapeHtml(e.notes || "")}</td>
                  <td>${needs ? (has ? `<span class="status-pill completed">ok</span>` : `<span class="status-pill rejected">missing</span>`) : `<span class="muted">optional</span>`}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:10px">
        <div class="muted">Account: <strong>${escapeHtml(accountSel.options[accountSel.selectedIndex]?.text || "-")}</strong></div>
        <div class="muted">Total: <strong>P${peso(totalValue)}</strong></div>
      </div>
    `;
  }

  function updateSummary() {
    const all = collectEntries();
    const filled = all.filter((e) => !isBlankEntry(e) && e.task_category && Number.isFinite(e.amount) && e.amount != null);
    const totals = computeTotalsByCategory(filled);
    const totalValue = Array.from(totals.values()).reduce((s, x) => s + x, 0);

    if (!totals.size) {
      summaryTotals.innerHTML = `<div class="muted">No totals yet.</div>`;
    } else {
      summaryTotals.innerHTML = Array.from(totals.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:10px"><span>${escapeHtml(k)}</span><strong>P${peso(v)}</strong></div>`)
        .join("") + `<hr/><div style="display:flex;justify-content:space-between;gap:10px"><span>Total</span><strong>P${peso(totalValue)}</strong></div>`;
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

    summaryWarnings.innerHTML = warnings.length ? warnings.map((w) => `<div>${escapeHtml(w)}</div>`).join("") : `<div>No warnings.</div>`;
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
    currentDraftKey = "";
    lastSavedLabel = null;
    autosaveLabel.textContent = "Not saved yet";
    savedAtEl.textContent = "-";
    summaryStatus.textContent = "Draft";

    accountSearch.value = "";
    accountCategoryFilter.value = "";
    accountSel.value = "";
    matterInput.value = "";
    billingStatusSel.value = "";
    ensureSelectHasValue(handlingSel, String(ctx.user.id || ""));
    generalNotes.value = "";

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

    const filtered = (accountRows || [])
      .filter((a) => {
        const categoryNorm = normalizeAccountCategory(a.category);
        if (categoryFilter && categoryNorm !== categoryFilter) return false;
        if (!q) return true;
        const hay = [
          String(a.title || ""),
          String(a.category || ""),
          accountCategoryLabel(a.category),
        ].join(" ").toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));

    if (!filtered.length) {
      accountSel.innerHTML = `<option value="">No matching accounts</option>`;
      return { rows: filtered };
    }

    accountSel.innerHTML =
      `<option value="">Select an account...</option>` +
      filtered
        .map((a) => `<option value="${a.id}">${escapeHtml(a.title)} (${escapeHtml(accountCategoryLabel(a.category) || "-")})</option>`)
        .join("");

    if (prev && filtered.some((a) => String(a.id) === prev)) {
      accountSel.value = prev;
    }

    return { rows: filtered };
  }

  async function loadAccounts() {
    const { data, error } = await supabase
      .from("accounts")
      .select("id,title,category,status,created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;

    const rows = data || [];
    accountRows = rows;
    if (!rows.length) {
      accountSel.innerHTML = `<option value="">No accounts assigned</option>`;
      noAccounts.style.display = "block";

      const isAdmin = ["super_admin", "admin"].includes(String(ctx.profile.role || ""));
      noAccounts.innerHTML = `
        <strong>No accounts assigned</strong>
        <div class="muted" style="margin-top:6px">
          Click Manage to view Accounts. ${isAdmin ? "Or create one here:" : "Ask an admin to assign your account."}
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
          const { error: cErr } = await supabase.from("accounts").insert({ title, category, created_by: ctx.user.id });
          qcMsg.textContent = cErr ? `Error: ${cErr.message}` : "Created. Reloading...";
          if (!cErr) {
            accountSearch.value = "";
            accountCategoryFilter.value = category;
            const { rows: reloaded } = await loadAccounts();
            const newest = reloaded?.[0];
            if (newest?.id) {
              accountSel.value = newest.id;
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
    const ok = confirm("Delete this draft batch? Uploaded receipts linked to this draft will also be deleted when allowed.");
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
        .select("batch_id,line_no,account_id,matter,billing_status,handling_lawyer_id,occurred_at,description,task_category,amount,attachment_urls")
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
          .select("batch_id,line_no,account_id,matter,billing_status,handling_lawyer_id,occurred_at,description,task_category,amount,attachment_urls")
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
      currentDraftKey = key;
      const openedAccount = (accountRows || []).find((a) => String(a.id || "") === String(first.account_id || ""));
      const openedCategory = normalizeAccountCategory(openedAccount?.category);

      accountSel.value = first.account_id || "";
      matterInput.value = first.matter || "";
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
              const meta = getCategoryMeta(x.task_category);
              const when = x.occurred_at
                ? new Date(x.occurred_at).toLocaleString([], { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                : "-";
              const status = String(x.status || "draft").toLowerCase();
              const desc = String(x.description || "").trim() || "-";
              return `
                <tr>
                  <td class="recent-when">${escapeHtml(when)}</td>
                  <td class="recent-client">${escapeHtml(title)}</td>
                  <td>${escapeHtml(meta?.label || x.task_category || "-")}</td>
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
  setStep(2);
  if (performedByLabel) performedByLabel.textContent = `${selfLabel} - ${String(ctx.profile.role || "")}`;

  try {
    msg.textContent = "Loading...";
    await loadAccounts();
    await loadMembersForAccount(accountSel.value);
    msg.textContent = "";
    await Promise.all([loadDraftBatches(), loadRecent()]);
  } catch (e) {
    msg.textContent = `Error: ${e?.message || e}`;
  }

  updateUi();

  // Events
  form.addEventListener("submit", (e) => e.preventDefault());
  manageAccountsBtn.addEventListener("click", () => navigate("#/accounts"));

  accountSearch.addEventListener("input", async () => {
    const prev = accountSel.value;
    renderAccountOptions();
    if (accountSel.value !== prev) {
      await loadMembersForAccount(accountSel.value);
      scheduleAutosave();
    }
    updateUi();
  });

  accountCategoryFilter.addEventListener("change", async () => {
    const prev = accountSel.value;
    renderAccountOptions();
    if (accountSel.value !== prev) {
      await loadMembersForAccount(accountSel.value);
      scheduleAutosave();
    }
    updateUi();
  });

  accountSel.addEventListener("change", async () => {
    setFieldError("account_id", "");
    await loadMembersForAccount(accountSel.value);
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
  clearBtn.addEventListener("click", () => { if (confirm("Clear the current sheet?")) resetAll(); });

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
