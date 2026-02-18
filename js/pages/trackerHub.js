import { supabase } from "../supabaseClient.js";
import { escapeHtml } from "../ui/escapeHtml.js";

const TAB_LITIGATION = "litigation";
const TAB_SPECIAL = "special_project";
const TAB_RETAINER = "retainer";
const CONTRACT_TASK_CATEGORY = "contract_agreement";
const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 0];

const STATUS_OPTIONS = ["draft", "pending", "approved", "rejected", "billed", "completed"];
const CASE_TYPE_OPTIONS = ["Civil Case", "Criminal Case", "Admin Case", "Preliminary Investigation", "Other"];
const DEFAULT_STORAGE_BUCKET = "receipts";
const UPLOAD_BUCKET_CANDIDATES = ["engagements", "contracts", "receipts"];

function clean(v) {
  return String(v || "").trim();
}

function normalizeAccountCategory(rawValue) {
  const raw = clean(rawValue).toLowerCase();
  if (!raw) return "";
  const normalized = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.includes("litig")) return TAB_LITIGATION;
  if (normalized.includes("special")) return TAB_SPECIAL;
  if (normalized.includes("retainer")) return TAB_RETAINER;
  return normalized.replace(/\s+/g, "_");
}

function resolveAccountTab(account) {
  const category = normalizeAccountCategory(account?.category);
  if (category === TAB_LITIGATION || category === TAB_SPECIAL || category === TAB_RETAINER) return category;
  return "";
}

function parsePipeMap(description) {
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

function encodeAttachments(attachments) {
  try {
    return encodeURIComponent(JSON.stringify(Array.isArray(attachments) ? attachments : []));
  } catch {
    return encodeURIComponent("[]");
  }
}

function decodeAttachments(encoded) {
  try {
    const value = JSON.parse(decodeURIComponent(encoded || encodeURIComponent("[]")));
    return Array.isArray(value) ? value.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function buildLitigationDescription(fields) {
  const parts = [
    `Venue: ${clean(fields.venue) || "-"}`,
    `Case Type: ${clean(fields.caseType) || "-"}`,
    `Tracker Status: ${clean(fields.trackerStatus) || "-"}`,
  ];
  if (clean(fields.engagement)) parts.push(`Engagement: ${clean(fields.engagement)}`);
  if (clean(fields.notes)) parts.push(`Notes: ${clean(fields.notes)}`);
  parts.push("Source: tracker_ui");
  return parts.join(" | ");
}

function buildSpecialDescription(fields) {
  const parts = [
    "Special Project Tracker",
    `Link: ${clean(fields.link) || "-"}`,
    `Handling: ${clean(fields.handlingCode) || "-"}`,
    `Update: ${clean(fields.weeklyUpdate) || "-"}`,
    `Tracker: ${clean(fields.trackerLink) || "-"}`,
    `Remarks: ${clean(fields.remarks) || "-"}`,
    "Source: tracker_ui",
  ];
  return parts.join(" | ");
}

function buildRetainerDescription(fields) {
  const parts = [
    `Retainer OPE | Invoice: ${clean(fields.invoice) || "-"}`,
    `Assignee: ${clean(fields.assignee) || "-"}`,
    `Location: ${clean(fields.location) || "-"}`,
    `Handling: ${clean(fields.handlingCode) || "-"}`,
    "Source: tracker_ui",
  ];
  return parts.join(" | ");
}

function statusOptions(selected) {
  const curr = clean(selected).toLowerCase();
  return STATUS_OPTIONS
    .map((x) => `<option value="${x}" ${curr === x ? "selected" : ""}>${escapeHtml(x)}</option>`)
    .join("");
}

function caseTypeOptions(selected) {
  const curr = clean(selected);
  return CASE_TYPE_OPTIONS
    .map((x) => `<option value="${escapeHtml(x)}" ${curr === x ? "selected" : ""}>${escapeHtml(x)}</option>`)
    .join("");
}

function lawyerOptions(lawyers, selectedId) {
  const rows = [`<option value="">(none)</option>`];
  for (const l of lawyers || []) {
    const label = l.full_name || l.email || l.id;
    rows.push(`<option value="${l.id}" ${l.id === selectedId ? "selected" : ""}>${escapeHtml(label)}</option>`);
  }
  return rows.join("");
}

function toDateInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toOccurredAt(dateYmd) {
  if (!dateYmd) return null;
  return `${dateYmd}T09:00:00+08:00`;
}

function safeFileName(name) {
  return String(name || "engagement.pdf")
    .replace(/[^\w.\-() ]+/g, "_")
    .slice(0, 100);
}

function splitBucketAndPath(storedPath) {
  const raw = String(storedPath || "").trim();
  const idx = raw.indexOf(":");
  if (idx > 0 && raw.slice(0, idx).indexOf("/") === -1) {
    return {
      bucket: raw.slice(0, idx),
      path: raw.slice(idx + 1),
    };
  }
  return { bucket: DEFAULT_STORAGE_BUCKET, path: raw };
}

function attachmentLabel(storedPath) {
  const { path } = splitBucketAndPath(storedPath);
  const file = String(path || "").split("/").pop();
  return file || storedPath;
}

function buildAttachmentListHtml(attachments) {
  if (!attachments.length) return `<span class="muted">No PDF</span>`;
  return attachments
    .map((path, idx) => `<div><a href="#" class="doc-link" data-idx="${idx}">${escapeHtml(attachmentLabel(path))}</a></div>`)
    .join("");
}

async function createSignedUrlFromStoredPath(storedPath) {
  const split = splitBucketAndPath(storedPath);
  const candidates = [];
  if (split.bucket) candidates.push(split.bucket);
  for (const b of UPLOAD_BUCKET_CANDIDATES) {
    if (!candidates.includes(b)) candidates.push(b);
  }

  let lastError = null;
  for (const bucket of candidates) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(split.path, 60 * 30);
    if (!error && data?.signedUrl) return data.signedUrl;
    lastError = error || new Error(`Unable to open file in bucket ${bucket}`);
  }
  throw lastError || new Error("Unable to open file.");
}

async function uploadPdf({ activityId, userId, file }) {
  const safe = safeFileName(file?.name || "engagement.pdf");
  const now = Date.now();
  let lastError = null;

  for (const bucket of UPLOAD_BUCKET_CANDIDATES) {
    const path = `engagements/${userId}/activity-${activityId}/${now}-${safe}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      upsert: false,
      cacheControl: "3600",
      contentType: file?.type || "application/pdf",
    });
    if (!error) return `${bucket}:${path}`;
    lastError = error;
  }

  throw lastError || new Error("Upload failed.");
}

async function fetchAllTrackerActivities() {
  const pageSize = 1000;
  const maxRows = 20000;
  const all = [];
  let from = 0;

  while (from < maxRows) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("activities")
      .select("id,account_id,matter,description,status,occurred_at,amount,task_category,handling_lawyer_id,attachment_urls,created_at")
      .order("occurred_at", { ascending: false })
      .range(from, to);
    if (error) throw error;

    const chunk = data || [];
    all.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

function isLitigation(row, account) {
  const taskCategory = clean(row.task_category).toLowerCase();
  if (taskCategory === CONTRACT_TASK_CATEGORY) return false;
  const accountTab = resolveAccountTab(account);
  if (accountTab) return accountTab === TAB_LITIGATION;
  if (taskCategory.startsWith("litigation_")) return true;
  const desc = clean(row.description).toLowerCase();
  return desc.includes("venue:") && desc.includes("case type:") && desc.includes("tracker status:");
}

function isSpecial(row, account) {
  const taskCategory = clean(row.task_category).toLowerCase();
  if (taskCategory === CONTRACT_TASK_CATEGORY) return false;
  const accountTab = resolveAccountTab(account);
  if (accountTab) return accountTab === TAB_SPECIAL;
  if (taskCategory === TAB_SPECIAL) return true;
  return clean(row.description).toLowerCase().includes("special project tracker");
}

function isRetainer(row, account) {
  const taskCategory = clean(row.task_category).toLowerCase();
  if (taskCategory === CONTRACT_TASK_CATEGORY) return false;
  const accountTab = resolveAccountTab(account);
  if (accountTab) return accountTab === TAB_RETAINER;
  if (taskCategory.startsWith("retainer_")) return true;
  return clean(row.description).toLowerCase().includes("retainer ope");
}

export async function renderTrackerHub(appEl, ctx) {
  appEl.innerHTML = `
    <section class="page-head">
      <div>
        <h1 class="page-title">Tracker Workspace</h1>
        <p class="page-sub">Cleaner spreadsheet view with direct PDF upload for engagements and support files.</p>
      </div>
    </section>

    <section class="card tracker-shell">
      <div class="tracker-toolbar">
        <div class="tracker-tabs" id="trackerTabs">
          <button type="button" class="tracker-tab active" data-tab="${TAB_LITIGATION}">Litigation</button>
          <button type="button" class="tracker-tab" data-tab="${TAB_SPECIAL}">Special Project</button>
          <button type="button" class="tracker-tab" data-tab="${TAB_RETAINER}">Retainer OPE</button>
        </div>
        <div class="tracker-filters">
          <input id="trackerSearch" placeholder="Search client, title, venue, remarks..." />
          <select id="trackerAccount">
            <option value="">All clients</option>
          </select>
          <select id="trackerStatus">
            <option value="">All statuses</option>
            ${STATUS_OPTIONS.map((x) => `<option value="${x}">${escapeHtml(x)}</option>`).join("")}
          </select>
          <button id="trackerReload" class="btn">Reload</button>
          <button id="trackerSaveAll" class="btn btn-primary">Save Changes</button>
        </div>
      </div>

      <p class="muted tracker-hint">Editable rows: update fields then click Save per row, or use Save Changes for all modified rows on this page. Use Upload PDF for engagement/support docs.</p>
      <div class="tracker-meta">
        <div id="trackerStats" class="muted"></div>
        <div class="tracker-pager">
          <label for="trackerPageSize" class="muted">Rows</label>
          <select id="trackerPageSize">
            ${PAGE_SIZE_OPTIONS.map((n) => `<option value="${n}" ${n === 50 ? "selected" : ""}>${n === 0 ? "All" : n}</option>`).join("")}
          </select>
          <button type="button" id="trackerPrev" class="btn btn-ghost">Prev</button>
          <span id="trackerPageInfo" class="tracker-page-info muted">Page 1 of 1</span>
          <button type="button" id="trackerNext" class="btn btn-ghost">Next</button>
        </div>
      </div>
      <div class="table-wrap tracker-table-wrap">
        <table class="tracker-table">
          <thead id="trackerHead"></thead>
          <tbody id="trackerBody"></tbody>
        </table>
      </div>
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
  const reloadBtn = $("#trackerReload");
  const saveAllBtn = $("#trackerSaveAll");

  let currentTab = TAB_LITIGATION;
  let rows = [];
  let accountsById = new Map();
  let lawyers = [];
  let page = 1;
  let pageSize = 50;
  let lastTotalPages = 1;

  async function getAuthUserIdForWrite() {
    const { data, error } = await supabase.auth.getUser();
    const userId = clean(data?.user?.id);
    if (error || !userId) {
      throw new Error("Session expired. Please sign in again.");
    }
    return userId;
  }

  function visibleRows() {
    return Array.from(bodyEl.querySelectorAll("tr[data-id]"));
  }

  function dirtyRows() {
    return visibleRows().filter((tr) => tr.classList.contains("is-dirty"));
  }

  function updateSaveAllButton() {
    const n = dirtyRows().length;
    if (!saveAllBtn) return;
    saveAllBtn.disabled = n === 0;
    saveAllBtn.textContent = n ? `Save ${n} Change${n === 1 ? "" : "s"}` : "Save Changes";
  }

  function markRowDirty(tr, dirty = true) {
    if (!tr) return;
    tr.classList.toggle("is-dirty", !!dirty);
    const msg = tr.querySelector(".save-msg");
    if (dirty) {
      if (msg && (!msg.textContent || msg.textContent.startsWith("Saved"))) {
        msg.textContent = "Unsaved changes";
      }
    } else if (msg && msg.textContent === "Unsaved changes") {
      msg.textContent = "";
    }
    updateSaveAllButton();
  }

  function hasUnsavedChanges() {
    return dirtyRows().length > 0;
  }

  function confirmDiscardUnsaved() {
    if (!hasUnsavedChanges()) return true;
    return window.confirm("You have unsaved changes in this page. Continue and discard them?");
  }

  async function loadLawyers() {
    const { data, error } = await supabase.rpc("list_handling_lawyers");
    if (!error && data) return data;

    const fallback = await supabase
      .from("profiles")
      .select("id,full_name,email,role")
      .eq("role", "lawyer")
      .limit(200);
    if (fallback.error) return [];
    return fallback.data || [];
  }

  async function loadData() {
    msgEl.textContent = "Loading tracker rows...";
    bodyEl.innerHTML = `<tr><td class="muted">Loading...</td></tr>`;

    let activities = [];
    try {
      activities = await fetchAllTrackerActivities();
    } catch (error) {
      msgEl.textContent = `Error loading activities: ${error?.message || error}`;
      return;
    }

    rows = activities || [];
    const accountIds = Array.from(new Set(rows.map((x) => x.account_id).filter(Boolean)));
    if (accountIds.length) {
      const { data: accounts, error: accErr } = await supabase
        .from("accounts")
        .select("id,title,category")
        .in("id", accountIds);
      if (accErr) {
        msgEl.textContent = `Error loading accounts: ${accErr.message}`;
        return;
      }
      accountsById = new Map((accounts || []).map((a) => [a.id, a]));
    } else {
      accountsById = new Map();
    }

    lawyers = await loadLawyers();
    msgEl.textContent = "";
    render();
  }

  function rowMatchesTab(row, acc) {
    if (currentTab === TAB_LITIGATION) return isLitigation(row, acc);
    if (currentTab === TAB_SPECIAL) return isSpecial(row, acc);
    return isRetainer(row, acc);
  }

  function populateAccountOptions() {
    const prev = clean(accountEl.value);
    const unique = new Map();
    for (const row of rows) {
      const acc = accountsById.get(row.account_id);
      if (!acc) continue;
      if (!rowMatchesTab(row, acc)) continue;
      if (!unique.has(acc.id)) {
        unique.set(acc.id, acc.title || "(Untitled)");
      }
    }

    const options = Array.from(unique.entries()).sort((a, b) => a[1].localeCompare(b[1]));
    accountEl.innerHTML = [
      `<option value="">All clients</option>`,
      ...options.map(([id, title]) => `<option value="${id}">${escapeHtml(title)}</option>`),
    ].join("");

    if (prev && unique.has(prev)) {
      accountEl.value = prev;
    }
  }

  function getTabRows() {
    const q = clean(searchEl.value).toLowerCase();
    const statusFilter = clean(statusEl.value).toLowerCase();
    const accountFilter = clean(accountEl.value);

    return rows.filter((row) => {
      const acc = accountsById.get(row.account_id);
      if (!rowMatchesTab(row, acc)) return false;
      if (accountFilter && row.account_id !== accountFilter) return false;
      if (statusFilter && clean(row.status).toLowerCase() !== statusFilter) return false;

      if (!q) return true;
      const hay = [acc?.title, row.matter, row.description, row.status, row.task_category]
        .map((x) => clean(x).toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }

  function getPagedRows(allRows) {
    const total = allRows.length;
    if (!total) {
      page = 1;
      lastTotalPages = 1;
      return { rows: [], total, from: 0, to: 0, totalPages: 1 };
    }

    if (pageSize === 0) {
      page = 1;
      lastTotalPages = 1;
      return { rows: allRows, total, from: 1, to: total, totalPages: 1 };
    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (page > totalPages) page = totalPages;
    if (page < 1) page = 1;

    const start = (page - 1) * pageSize;
    const end = Math.min(start + pageSize, total);
    lastTotalPages = totalPages;

    return {
      rows: allRows.slice(start, end),
      total,
      from: start + 1,
      to: end,
      totalPages,
    };
  }

  function renderHead() {
    if (currentTab === TAB_LITIGATION) {
      headEl.innerHTML = `
        <tr>
          <th>Seq</th>
          <th>Client</th>
          <th>Case Title</th>
          <th>Venue</th>
          <th>Type of Case</th>
          <th>Tracker Status</th>
          <th>Handling Lawyer</th>
          <th>Engagement PDF</th>
          <th>Notes</th>
          <th>Row Status</th>
          <th>Date</th>
          <th>Action</th>
        </tr>
      `;
      return;
    }

    if (currentTab === TAB_SPECIAL) {
      headEl.innerHTML = `
        <tr>
          <th>Seq</th>
          <th>Client</th>
          <th>Description of Engagement</th>
          <th>Engagement PDF</th>
          <th>Handling Lawyer</th>
          <th>Date of Engagement</th>
          <th>Lawyers Weekly Update</th>
          <th>Tracker Link</th>
          <th>Remarks</th>
          <th>Row Status</th>
          <th>Action</th>
        </tr>
      `;
      return;
    }

    headEl.innerHTML = `
      <tr>
        <th>Seq</th>
        <th>Date</th>
        <th>Client</th>
        <th>Particular</th>
        <th>Assigned Staff</th>
        <th>Location</th>
        <th>Row Status</th>
        <th>Handling Lawyer</th>
        <th>OPE Subtotal</th>
        <th>Invoice</th>
        <th>PDF</th>
        <th>Action</th>
      </tr>
    `;
  }

  function renderDocsCell(row) {
    const attachments = Array.isArray(row.attachment_urls) ? row.attachment_urls.filter(Boolean) : [];
    return `
      <div class="doc-cell">
        <div class="doc-list">${buildAttachmentListHtml(attachments)}</div>
        <div class="doc-actions">
          <button type="button" class="btn btn-ghost upload-doc">${attachments.length ? "Add PDF" : "Upload PDF"}</button>
          <button type="button" class="btn btn-ghost clear-doc" ${attachments.length ? "" : "disabled"}>Clear</button>
        </div>
        <input type="file" class="doc-file" accept=".pdf,application/pdf" style="display:none" />
      </div>
    `;
  }

  function renderActionCell() {
    return `
      <div class="tracker-row-actions">
        <button class="btn btn-primary save-row">Save</button>
        <button class="btn btn-danger delete-row">Delete</button>
      </div>
      <div class="muted save-msg"></div>
    `;
  }

  function rowOpenTag(row, kind) {
    const attachments = Array.isArray(row.attachment_urls) ? row.attachment_urls.filter(Boolean) : [];
    return `<tr data-id="${row.id}" data-kind="${kind}" data-attachments="${encodeAttachments(attachments)}">`;
  }

  function renderRows(tabRows, seqOffset = 0) {
    const colSpan =
      currentTab === TAB_LITIGATION ? 12 :
      currentTab === TAB_SPECIAL ? 11 :
      12;

    if (!tabRows.length) {
      bodyEl.innerHTML = `<tr><td colspan="${colSpan}" class="muted">No rows found.</td></tr>`;
      return;
    }

    if (currentTab === TAB_LITIGATION) {
      bodyEl.innerHTML = tabRows.map((row, idx) => {
        const map = parsePipeMap(row.description);
        const acc = accountsById.get(row.account_id);
        const hasStructured = clean(map["venue"]) || clean(map["case type"]) || clean(map["tracker status"]);
        const notesValue = clean(map["notes"]) || (!hasStructured ? clean(row.description) : "");
        return `
          ${rowOpenTag(row, TAB_LITIGATION)}
            <td class="tracker-seq">${seqOffset + idx + 1}</td>
            <td>${escapeHtml(acc?.title || "-")}</td>
            <td><input class="f-matter" value="${escapeHtml(clean(row.matter))}" /></td>
            <td><input class="f-venue" value="${escapeHtml(clean(map["venue"]))}" /></td>
            <td><select class="f-case-type">${caseTypeOptions(map["case type"])}</select></td>
            <td><input class="f-tracker-status" value="${escapeHtml(clean(map["tracker status"]))}" /></td>
            <td><select class="f-handling">${lawyerOptions(lawyers, row.handling_lawyer_id)}</select></td>
            <td>${renderDocsCell(row)}</td>
            <td><input class="f-notes" value="${escapeHtml(notesValue)}" /></td>
            <td><select class="f-status">${statusOptions(row.status)}</select></td>
            <td><input type="date" class="f-date" value="${toDateInputValue(row.occurred_at)}" /></td>
            <td>${renderActionCell()}</td>
          </tr>
        `;
      }).join("");
      return;
    }

    if (currentTab === TAB_SPECIAL) {
      bodyEl.innerHTML = tabRows.map((row, idx) => {
        const map = parsePipeMap(row.description);
        const acc = accountsById.get(row.account_id);
        const hasStructured = clean(map["update"]) || clean(map["tracker"]) || clean(map["remarks"]) || clean(map["link"]);
        const remarksValue = clean(map["remarks"]) || (!hasStructured ? clean(row.description) : "");
        return `
          ${rowOpenTag(row, TAB_SPECIAL)}
            <td class="tracker-seq">${seqOffset + idx + 1}</td>
            <td>${escapeHtml(acc?.title || "-")}</td>
            <td><input class="f-matter" value="${escapeHtml(clean(row.matter))}" /></td>
            <td>${renderDocsCell(row)}</td>
            <td><select class="f-handling">${lawyerOptions(lawyers, row.handling_lawyer_id)}</select></td>
            <td><input type="date" class="f-date" value="${toDateInputValue(row.occurred_at)}" /></td>
            <td><input class="f-weekly" value="${escapeHtml(clean(map["update"]))}" /></td>
            <td><input class="f-tracker-link" value="${escapeHtml(clean(map["tracker"]))}" /></td>
            <td><input class="f-remarks" value="${escapeHtml(remarksValue)}" /></td>
            <td><select class="f-status">${statusOptions(row.status)}</select></td>
            <td>${renderActionCell()}</td>
          </tr>
        `;
      }).join("");
      return;
    }

    bodyEl.innerHTML = tabRows.map((row, idx) => {
      const map = parsePipeMap(row.description);
      const acc = accountsById.get(row.account_id);
      return `
        ${rowOpenTag(row, TAB_RETAINER)}
          <td class="tracker-seq">${seqOffset + idx + 1}</td>
          <td><input type="date" class="f-date" value="${toDateInputValue(row.occurred_at)}" /></td>
          <td>${escapeHtml(acc?.title || "-")}</td>
          <td><input class="f-matter" value="${escapeHtml(clean(row.matter))}" /></td>
          <td><input class="f-assignee" value="${escapeHtml(clean(map["assignee"]))}" /></td>
          <td><input class="f-location" value="${escapeHtml(clean(map["location"]))}" /></td>
          <td><select class="f-status">${statusOptions(row.status)}</select></td>
          <td><select class="f-handling">${lawyerOptions(lawyers, row.handling_lawyer_id)}</select></td>
          <td><input type="number" min="0" step="0.01" class="f-amount" value="${Number(row.amount || 0)}" /></td>
          <td><input class="f-invoice" value="${escapeHtml(clean(map["invoice"]))}" /></td>
          <td>${renderDocsCell(row)}</td>
          <td>${renderActionCell()}</td>
        </tr>
      `;
    }).join("");
  }

  function render() {
    populateAccountOptions();
    renderHead();
    const filteredRows = getTabRows();
    const paged = getPagedRows(filteredRows);
    const tabRows = paged.rows;
    const statusCounts = new Map();
    for (const row of filteredRows) {
      const key = clean(row.status).toLowerCase() || "unknown";
      statusCounts.set(key, (statusCounts.get(key) || 0) + 1);
    }
    const statusSummary = Array.from(statusCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([status, count]) => `${status}: ${count}`)
      .join(" | ");
    statsEl.textContent = statusSummary
      ? `${filteredRows.length} row(s) matched. ${statusSummary}`
      : `${filteredRows.length} row(s) matched.`;
    pageInfoEl.textContent = filteredRows.length
      ? `Page ${page} of ${paged.totalPages} | Showing ${paged.from}-${paged.to} of ${paged.total}`
      : "Page 1 of 1 | 0 rows";
    prevBtn.disabled = page <= 1 || pageSize === 0 || !filteredRows.length;
    nextBtn.disabled = page >= lastTotalPages || pageSize === 0 || !filteredRows.length;
    renderRows(tabRows, Math.max(0, paged.from - 1));
    accountEl.dataset.prevValue = accountEl.value;
    statusEl.dataset.prevValue = statusEl.value;
    pageSizeEl.dataset.prevValue = String(pageSize);
    updateSaveAllButton();
  }

  function updateLocalRow(activityId, patch) {
    const idx = rows.findIndex((x) => x.id === activityId);
    if (idx >= 0) {
      rows[idx] = { ...rows[idx], ...patch };
    }
  }

  function resolveHandlingLabel(handlingId) {
    const record = lawyers.find((x) => x.id === handlingId);
    return clean(record?.full_name || record?.email || "");
  }

  function buildDescriptionFromRow(tr, kind, attachments) {
    const handling = clean(tr.querySelector(".f-handling")?.value) || null;
    const handlingLabel = resolveHandlingLabel(handling);

    if (kind === TAB_LITIGATION) {
      return buildLitigationDescription({
        venue: tr.querySelector(".f-venue")?.value,
        caseType: tr.querySelector(".f-case-type")?.value,
        trackerStatus: tr.querySelector(".f-tracker-status")?.value,
        engagement: attachments.length ? attachmentLabel(attachments[0]) : "",
        notes: tr.querySelector(".f-notes")?.value,
      });
    }

    if (kind === TAB_SPECIAL) {
      return buildSpecialDescription({
        link: attachments.length ? attachmentLabel(attachments[0]) : "",
        handlingCode: handlingLabel,
        weeklyUpdate: tr.querySelector(".f-weekly")?.value,
        trackerLink: tr.querySelector(".f-tracker-link")?.value,
        remarks: tr.querySelector(".f-remarks")?.value,
      });
    }

    return buildRetainerDescription({
      invoice: tr.querySelector(".f-invoice")?.value,
      assignee: tr.querySelector(".f-assignee")?.value,
      location: tr.querySelector(".f-location")?.value,
      handlingCode: handlingLabel,
    });
  }

  function syncDocCellUi(tr, attachments) {
    tr.dataset.attachments = encodeAttachments(attachments);
    const listEl = tr.querySelector(".doc-list");
    if (listEl) listEl.innerHTML = buildAttachmentListHtml(attachments);
    const clearBtn = tr.querySelector(".clear-doc");
    if (clearBtn) clearBtn.disabled = !attachments.length;
    const uploadBtn = tr.querySelector(".upload-doc");
    if (uploadBtn) uploadBtn.textContent = attachments.length ? "Add PDF" : "Upload PDF";
  }

  async function onSaveRow(btn) {
    const tr = btn.closest("tr");
    if (!tr) return false;

    const id = tr.dataset.id;
    const kind = tr.dataset.kind;
    const saveMsg = tr.querySelector(".save-msg");
    const attachments = decodeAttachments(tr.dataset.attachments);
    let writerId = "";
    try {
      writerId = await getAuthUserIdForWrite();
    } catch (err) {
      saveMsg.textContent = `Error: ${err?.message || err}`;
      return false;
    }

    const payload = {};
    const matter = clean(tr.querySelector(".f-matter")?.value);
    const status = clean(tr.querySelector(".f-status")?.value) || "pending";
    const handling = clean(tr.querySelector(".f-handling")?.value) || null;
    const dateYmd = clean(tr.querySelector(".f-date")?.value);

    payload.matter = matter || null;
    payload.status = status;
    payload.created_by = writerId;
    payload.handling_lawyer_id = handling || null;
    payload.attachment_urls = attachments.length ? attachments : null;
    if (dateYmd) payload.occurred_at = toOccurredAt(dateYmd);

    payload.description = buildDescriptionFromRow(tr, kind, attachments);
    if (kind === TAB_RETAINER) {
      const amount = Number(tr.querySelector(".f-amount")?.value || 0);
      payload.amount = Number.isFinite(amount) ? amount : 0;
    }

    btn.disabled = true;
    saveMsg.textContent = "Saving...";
    const { error } = await supabase.from("activities").update(payload).eq("id", id);
    btn.disabled = false;

    if (error) {
      saveMsg.textContent = `Error: ${error.message}`;
      return false;
    }

    updateLocalRow(id, payload);
    saveMsg.textContent = `Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    markRowDirty(tr, false);
    return true;
  }

  async function onUploadDoc(tr, fileInput) {
    const saveMsg = tr.querySelector(".save-msg");
    const id = tr.dataset.id;
    const kind = tr.dataset.kind;
    const files = Array.from(fileInput.files || []);
    if (!files.length) return;
    let writerId = "";
    try {
      writerId = await getAuthUserIdForWrite();
    } catch (err) {
      saveMsg.textContent = `Upload failed: ${err?.message || err}`;
      fileInput.value = "";
      return;
    }

    const file = files[0];
    if (!/\.pdf$/i.test(file.name) && !String(file.type || "").includes("pdf")) {
      saveMsg.textContent = "Only PDF files are allowed.";
      fileInput.value = "";
      return;
    }

    try {
      saveMsg.textContent = "Uploading PDF...";
      const stored = await uploadPdf({
        activityId: id,
        userId: writerId,
        file,
      });

      const current = decodeAttachments(tr.dataset.attachments);
      const next = current.concat([stored]);
      const payload = {
        created_by: writerId,
        attachment_urls: next,
        description: buildDescriptionFromRow(tr, kind, next),
      };
      const { error } = await supabase.from("activities").update(payload).eq("id", id);

      if (error) {
        saveMsg.textContent = `Upload saved failed: ${error.message}`;
        return;
      }

      syncDocCellUi(tr, next);
      updateLocalRow(id, payload);
      saveMsg.textContent = "PDF uploaded.";
    } catch (err) {
      saveMsg.textContent = `Upload failed: ${err?.message || err}`;
    } finally {
      fileInput.value = "";
    }
  }

  async function onClearDocs(tr) {
    const id = tr.dataset.id;
    const kind = tr.dataset.kind;
    const saveMsg = tr.querySelector(".save-msg");
    let writerId = "";
    try {
      writerId = await getAuthUserIdForWrite();
    } catch (err) {
      saveMsg.textContent = `Clear failed: ${err?.message || err}`;
      return;
    }
    const payload = {
      created_by: writerId,
      attachment_urls: null,
      description: buildDescriptionFromRow(tr, kind, []),
    };

    saveMsg.textContent = "Clearing PDFs...";
    const { error } = await supabase.from("activities").update(payload).eq("id", id);
    if (error) {
      saveMsg.textContent = `Clear failed: ${error.message}`;
      return;
    }

    syncDocCellUi(tr, []);
    updateLocalRow(id, payload);
    saveMsg.textContent = "PDF attachments cleared.";
  }

  async function removeStoredAttachments(attachments) {
    const grouped = new Map();
    for (const raw of attachments || []) {
      const split = splitBucketAndPath(raw);
      const bucket = clean(split.bucket) || DEFAULT_STORAGE_BUCKET;
      const path = clean(split.path);
      if (!path) continue;
      if (!grouped.has(bucket)) grouped.set(bucket, new Set());
      grouped.get(bucket).add(path);
    }

    let failures = 0;
    for (const [bucket, pathsSet] of grouped.entries()) {
      const paths = Array.from(pathsSet);
      if (!paths.length) continue;
      const { error } = await supabase.storage.from(bucket).remove(paths);
      if (error) failures += 1;
    }
    return failures;
  }

  async function onDeleteRow(btn) {
    const tr = btn.closest("tr");
    if (!tr) return false;

    const id = tr.dataset.id;
    const saveBtn = tr.querySelector(".save-row");
    const saveMsg = tr.querySelector(".save-msg");
    const attachments = decodeAttachments(tr.dataset.attachments);
    const unsavedNote = tr.classList.contains("is-dirty") ? " Unsaved edits in this row will be lost." : "";
    const ok = window.confirm(`Delete this tracker row? This will remove the activity record.${unsavedNote}`);
    if (!ok) return false;

    btn.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    saveMsg.textContent = "Deleting...";

    try {
      const { error } = await supabase.from("activities").delete().eq("id", id);
      if (error) throw error;

      const cleanupFailures = attachments.length ? await removeStoredAttachments(attachments) : 0;
      rows = rows.filter((x) => x.id !== id);
      render();
      msgEl.textContent = cleanupFailures
        ? "Row deleted. Some attachment files could not be removed due to storage policy."
        : "Row deleted.";
      return true;
    } catch (err) {
      saveMsg.textContent = `Delete failed: ${err?.message || err}`;
      if (saveBtn) saveBtn.disabled = false;
      btn.disabled = false;
      return false;
    }
  }

  tabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".tracker-tab");
    if (!btn) return;
    if (!confirmDiscardUnsaved()) return;
    currentTab = btn.dataset.tab;
    page = 1;
    tabsEl.querySelectorAll(".tracker-tab").forEach((x) => x.classList.toggle("active", x === btn));
    render();
  });

  bodyEl.addEventListener("click", async (e) => {
    const saveBtn = e.target.closest(".save-row");
    if (saveBtn) {
      await onSaveRow(saveBtn);
      return;
    }

    const deleteBtn = e.target.closest(".delete-row");
    if (deleteBtn) {
      await onDeleteRow(deleteBtn);
      return;
    }

    const upBtn = e.target.closest(".upload-doc");
    if (upBtn) {
      const tr = upBtn.closest("tr");
      const fileInput = tr?.querySelector(".doc-file");
      if (fileInput) fileInput.click();
      return;
    }

    const clearBtn = e.target.closest(".clear-doc");
    if (clearBtn) {
      const tr = clearBtn.closest("tr");
      if (tr) await onClearDocs(tr);
      return;
    }

    const link = e.target.closest(".doc-link");
    if (link) {
      e.preventDefault();
      const tr = link.closest("tr");
      const attachments = decodeAttachments(tr?.dataset.attachments);
      const idx = Number(link.dataset.idx || -1);
      const path = attachments[idx];
      if (!path) return;
      try {
        const url = await createSignedUrlFromStoredPath(path);
        window.open(url, "_blank", "noopener");
      } catch (err) {
        const msg = tr?.querySelector(".save-msg");
        if (msg) msg.textContent = `Unable to open PDF: ${err?.message || err}`;
      }
    }
  });

  bodyEl.addEventListener("change", async (e) => {
    const input = e.target.closest(".doc-file");
    if (input) {
      const tr = input.closest("tr");
      if (!tr) return;
      await onUploadDoc(tr, input);
      return;
    }
    const tr = e.target.closest("tr[data-id]");
    if (tr) markRowDirty(tr, true);
  });

  bodyEl.addEventListener("input", (e) => {
    const input = e.target.closest("input,select,textarea");
    if (!input || input.classList.contains("doc-file")) return;
    const tr = input.closest("tr[data-id]");
    if (tr) markRowDirty(tr, true);
  });

  searchEl.addEventListener("input", () => {
    if (hasUnsavedChanges()) {
      msgEl.textContent = "Save or discard changes before filtering.";
      return;
    }
    msgEl.textContent = "";
    page = 1;
    render();
  });
  accountEl.addEventListener("change", () => {
    const prev = accountEl.dataset.prevValue ?? "";
    if (!confirmDiscardUnsaved()) {
      accountEl.value = prev;
      return;
    }
    accountEl.dataset.prevValue = accountEl.value;
    page = 1;
    render();
  });
  statusEl.addEventListener("change", () => {
    const prev = statusEl.dataset.prevValue ?? "";
    if (!confirmDiscardUnsaved()) {
      statusEl.value = prev;
      return;
    }
    statusEl.dataset.prevValue = statusEl.value;
    page = 1;
    render();
  });
  pageSizeEl.addEventListener("change", () => {
    const prev = Number(pageSizeEl.dataset.prevValue || String(pageSize));
    if (!confirmDiscardUnsaved()) {
      pageSizeEl.value = String(prev);
      return;
    }
    const next = Number(pageSizeEl.value);
    pageSize = PAGE_SIZE_OPTIONS.includes(next) ? next : (PAGE_SIZE_OPTIONS.includes(prev) ? prev : 50);
    pageSizeEl.dataset.prevValue = String(pageSize);
    page = 1;
    render();
  });
  prevBtn.addEventListener("click", () => {
    if (!confirmDiscardUnsaved()) return;
    if (page <= 1) return;
    page -= 1;
    render();
  });
  nextBtn.addEventListener("click", () => {
    if (!confirmDiscardUnsaved()) return;
    if (page >= lastTotalPages) return;
    page += 1;
    render();
  });
  reloadBtn.addEventListener("click", async () => {
    if (!confirmDiscardUnsaved()) return;
    page = 1;
    await loadData();
  });
  saveAllBtn.addEventListener("click", async () => {
    const targets = dirtyRows();
    if (!targets.length) {
      msgEl.textContent = "No unsaved changes on this page.";
      updateSaveAllButton();
      return;
    }
    saveAllBtn.disabled = true;
    msgEl.textContent = `Saving ${targets.length} row(s)...`;
    let okCount = 0;
    for (const tr of targets) {
      const btn = tr.querySelector(".save-row");
      if (!btn) continue;
      const ok = await onSaveRow(btn);
      if (ok) okCount += 1;
    }
    const failed = targets.length - okCount;
    msgEl.textContent = failed
      ? `Saved ${okCount}/${targets.length}. Check rows with errors.`
      : `Saved ${okCount} row(s).`;
    updateSaveAllButton();
  });

  await loadData();
}
