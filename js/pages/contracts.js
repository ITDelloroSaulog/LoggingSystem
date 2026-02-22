import { supabase } from "../supabaseClient.js";
import { escapeHtml } from "../ui/escapeHtml.js";
import { uiConfirm } from "../ui/modal.js";

const CONTRACT_TASK_CATEGORY = "contract_agreement";
const DEFAULT_STORAGE_BUCKET = "receipts";
const UPLOAD_BUCKET_CANDIDATES = ["contracts", "engagements", "receipts"];
const STATUS_OPTIONS = ["draft", "pending", "approved", "completed", "billed", "rejected"];
const CONTRACT_TYPE_OPTIONS = [
  "Engagement Proposal",
  "Engagement Letter",
  "Retainer Agreement",
  "Service Agreement",
  "Contract Review",
  "Other",
];
const INHERITED_TASK_PATTERNS = [/^litigation_/i, /^retainer_/i, /^special_project$/i];

function clean(v) {
  return String(v || "").trim();
}

function isInheritedSourceTask(taskCategory) {
  const value = clean(taskCategory);
  if (!value || value.toLowerCase() === CONTRACT_TASK_CATEGORY) return false;
  return INHERITED_TASK_PATTERNS.some((re) => re.test(value));
}

function defaultContractTypeForTask(taskCategory) {
  const value = clean(taskCategory).toLowerCase();
  if (value.startsWith("litigation_")) return "Engagement Letter";
  if (value === "special_project") return "Engagement Proposal";
  if (value.startsWith("retainer_")) return "Service Agreement";
  return "Other";
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
    map[key] = part.slice(idx + 1).trim();
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

function safeFileName(name) {
  return String(name || "contract.pdf")
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

function statusOptions(selected) {
  const curr = clean(selected).toLowerCase();
  return STATUS_OPTIONS
    .map((x) => `<option value="${x}" ${curr === x ? "selected" : ""}>${escapeHtml(x)}</option>`)
    .join("");
}

function typeOptions(selected) {
  const curr = clean(selected);
  return CONTRACT_TYPE_OPTIONS
    .map((x) => `<option value="${escapeHtml(x)}" ${curr === x ? "selected" : ""}>${escapeHtml(x)}</option>`)
    .join("");
}

function accountLabel(account) {
  const title = clean(account?.title) || "(Untitled)";
  const category = clean(account?.category);
  return category ? `${title} (${category})` : title;
}

function accountOptions(accounts, selectedId) {
  const rows = [];
  for (const account of accounts || []) {
    rows.push(
      `<option value="${account.id}" ${account.id === selectedId ? "selected" : ""}>${escapeHtml(accountLabel(account))}</option>`
    );
  }
  return rows.join("");
}

function lawyerOptions(lawyers, selectedId) {
  const rows = [`<option value="">(none)</option>`];
  for (const l of lawyers || []) {
    const label = l.full_name || l.email || l.id;
    rows.push(`<option value="${l.id}" ${l.id === selectedId ? "selected" : ""}>${escapeHtml(label)}</option>`);
  }
  return rows.join("");
}

function buildContractDescription(fields) {
  const parts = [
    `Contract Type: ${clean(fields.contractType) || "-"}`,
    `Effective Date: ${clean(fields.effectiveDate) || "-"}`,
    `Handling: ${clean(fields.handlingLabel) || "-"}`,
    `Remarks: ${clean(fields.remarks) || "-"}`,
  ];
  if (clean(fields.attachmentName)) {
    parts.push(`Engagement PDF: ${clean(fields.attachmentName)}`);
  }
  parts.push("Source: contracts_ui");
  return parts.join(" | ");
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
  const safe = safeFileName(file?.name || "contract.pdf");
  const now = Date.now();
  let lastError = null;

  for (const bucket of UPLOAD_BUCKET_CANDIDATES) {
    const path = `contracts/${userId}/activity-${activityId}/${now}-${safe}`;
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

export async function renderContracts(appEl, ctx) {
  appEl.innerHTML = `
    <section class="page-head">
      <div>
        <h1 class="page-title">Contracts and Agreements</h1>
        <p class="page-sub">Editable register for engagement letters, proposals, and contract PDFs.</p>
      </div>
      <button id="contractNewBtn" class="btn btn-primary">+ New Contract Row</button>
    </section>

    <section class="card contracts-shell">
      <div class="contracts-toolbar">
        <input id="contractsSearch" placeholder="Search client, matter, remarks..." />
        <select id="contractsAccount">
          <option value="">All clients</option>
        </select>
        <select id="contractsStatus">
          <option value="">All statuses</option>
          ${STATUS_OPTIONS.map((x) => `<option value="${x}">${escapeHtml(x)}</option>`).join("")}
        </select>
        <button id="contractsReload" class="btn">Reload</button>
      </div>

      <section class="kpi-grid contracts-kpis" id="contractsKpis"></section>
      <p class="muted tracker-hint">Includes inherited tracker rows from Litigation/Special/Retainer. Inherited rows are read-only source records. Use "Create Copy" to make an editable contract row.</p>

      <div class="table-wrap">
        <table class="tracker-table contracts-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Seq</th>
              <th>Client</th>
              <th>Contract / Agreement</th>
              <th>Type</th>
              <th>Effective Date</th>
              <th>Handling Lawyer</th>
              <th>Status</th>
              <th>PDF</th>
              <th>Remarks</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="contractsBody"></tbody>
        </table>
      </div>
      <p id="contractsMsg" class="msg"></p>
    </section>
  `;

  const $ = (sel) => appEl.querySelector(sel);
  const bodyEl = $("#contractsBody");
  const msgEl = $("#contractsMsg");
  const kpisEl = $("#contractsKpis");
  const searchEl = $("#contractsSearch");
  const accountEl = $("#contractsAccount");
  const statusEl = $("#contractsStatus");
  const reloadBtn = $("#contractsReload");
  const newBtn = $("#contractNewBtn");

  let rows = [];
  let accounts = [];
  let accountsById = new Map();
  let lawyers = [];

  async function loadLawyers() {
    const { data, error } = await supabase.rpc("list_handling_lawyers");
    if (!error && data) return data;

    const fallback = await supabase
      .from("profiles")
      .select("id,full_name,email,role")
      .eq("role", "lawyer")
      .limit(300);
    if (fallback.error) return [];
    return fallback.data || [];
  }

  function resolveHandlingLabel(handlingId) {
    const rec = lawyers.find((x) => x.id === handlingId);
    return clean(rec?.full_name || rec?.email || "");
  }

  function buildDescriptionFromRow(tr, attachments) {
    const handlingId = clean(tr.querySelector(".f-handling")?.value);
    return buildContractDescription({
      contractType: tr.querySelector(".f-type")?.value,
      effectiveDate: tr.querySelector(".f-date")?.value,
      handlingLabel: resolveHandlingLabel(handlingId),
      remarks: tr.querySelector(".f-remarks")?.value,
      attachmentName: attachments.length ? attachmentLabel(attachments[0]) : "",
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

  function populateAccountFilter() {
    const prev = clean(accountEl.value);
    accountEl.innerHTML = [
      `<option value="">All clients</option>`,
      ...accounts.map((a) => `<option value="${a.id}">${escapeHtml(accountLabel(a))}</option>`),
    ].join("");
    if (prev && accounts.some((a) => a.id === prev)) {
      accountEl.value = prev;
    }
  }

  function getFilteredRows() {
    const q = clean(searchEl.value).toLowerCase();
    const accountFilter = clean(accountEl.value);
    const statusFilter = clean(statusEl.value).toLowerCase();

    return rows.filter((row) => {
      if (accountFilter && row.account_id !== accountFilter) return false;
      if (statusFilter && clean(row.status).toLowerCase() !== statusFilter) return false;
      if (!q) return true;
      const map = parsePipeMap(row.description);
      const account = accountsById.get(row.account_id);
      const hay = [
        account?.title,
        account?.category,
        row.matter,
        row.status,
        row.task_category,
        map["remarks"],
        map["contract type"],
      ]
        .map((x) => clean(x).toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }

  function renderKpis(sourceRows) {
    const total = sourceRows.length;
    const inherited = sourceRows.filter((r) => r.mode === "inherited").length;
    const directContracts = total - inherited;
    const withPdf = sourceRows.filter((r) => Array.isArray(r.attachment_urls) && r.attachment_urls.length).length;
    const draftPending = sourceRows.filter((r) => ["draft", "pending"].includes(clean(r.status).toLowerCase())).length;
    const done = sourceRows.filter((r) => ["approved", "completed", "billed"].includes(clean(r.status).toLowerCase())).length;

    kpisEl.innerHTML = `
      <article class="kpi-card">
        <div class="kpi-label">Total Rows</div>
        <div class="kpi-value">${total}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Contracts</div>
        <div class="kpi-value">${directContracts}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Inherited</div>
        <div class="kpi-value">${inherited}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">With PDF</div>
        <div class="kpi-value">${withPdf}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Draft or Pending</div>
        <div class="kpi-value" style="color:#9a5a00">${draftPending}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Approved/Done</div>
        <div class="kpi-value" style="color:#118a4a">${done}</div>
      </article>
    `;
  }

  function renderRows() {
    const filtered = getFilteredRows();
    renderKpis(filtered);

    if (!filtered.length) {
      bodyEl.innerHTML = `<tr><td colspan="11" class="muted">No contract rows found.</td></tr>`;
      return;
    }

    bodyEl.innerHTML = filtered
      .map((row, idx) => {
        const map = parsePipeMap(row.description);
        const attachments = Array.isArray(row.attachment_urls) ? row.attachment_urls.filter(Boolean) : [];
        const inherited = row.mode === "inherited";
        const lockAttr = inherited ? "disabled" : "";
        const contractType = clean(map["contract type"]) || defaultContractTypeForTask(row.task_category);
        const dateValue = clean(map["effective date"]) || toDateInputValue(row.occurred_at);
        const remarks = clean(map["remarks"]) || clean(map["notes"]);
        const sourceLabel = inherited
          ? `Inherited (${clean(row.task_category) || "tracker"})`
          : "Contract Copy";

        return `
          <tr data-id="${row.id}" data-mode="${row.mode || "contract"}" data-attachments="${encodeAttachments(attachments)}">
            <td><span class="status-pill">${escapeHtml(sourceLabel)}</span></td>
            <td class="tracker-seq">${idx + 1}</td>
            <td><select class="f-account" ${lockAttr}>${accountOptions(accounts, row.account_id)}</select></td>
            <td><input class="f-matter" value="${escapeHtml(clean(row.matter))}" ${lockAttr} /></td>
            <td><select class="f-type" ${lockAttr}>${typeOptions(contractType)}</select></td>
            <td><input type="date" class="f-date" value="${escapeHtml(dateValue)}" ${lockAttr} /></td>
            <td><select class="f-handling" ${lockAttr}>${lawyerOptions(lawyers, row.handling_lawyer_id)}</select></td>
            <td><select class="f-status" ${lockAttr}>${statusOptions(row.status)}</select></td>
            <td>
              <div class="doc-cell">
                <div class="doc-list">${buildAttachmentListHtml(attachments)}</div>
                <div class="doc-actions">
                  <button type="button" class="btn btn-ghost upload-doc" ${inherited ? "disabled" : ""}>${attachments.length ? "Add PDF" : "Upload PDF"}</button>
                  <button type="button" class="btn btn-ghost clear-doc" ${(attachments.length && !inherited) ? "" : "disabled"}>Clear</button>
                </div>
                <input type="file" class="doc-file" accept=".pdf,application/pdf" style="display:none" />
              </div>
            </td>
            <td><input class="f-remarks" value="${escapeHtml(remarks)}" ${lockAttr} /></td>
            <td class="contract-actions">
              ${inherited
                ? `<button class="btn btn-primary create-copy">Create Copy</button><div class="muted" style="font-size:11px">Read-only source row</div>`
                : `<button class="btn btn-primary save-row">Save Copy</button><button class="btn btn-danger delete-row">Delete Copy</button>`
              }
              <div class="muted save-msg"></div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function updateLocalRow(activityId, patch) {
    const idx = rows.findIndex((x) => x.id === activityId);
    if (idx >= 0) {
      rows[idx] = { ...rows[idx], ...patch };
    }
  }

  async function loadData() {
    msgEl.textContent = "Loading contracts...";
    bodyEl.innerHTML = `<tr><td colspan="11" class="muted">Loading...</td></tr>`;

    const [
      { data: contractsData, error: contractsError },
      { data: inheritedData, error: inheritedError },
      { data: accountsData, error: accountsError },
      loadedLawyers,
    ] =
      await Promise.all([
        supabase
          .from("activities")
          .select("id,account_id,matter,description,status,occurred_at,handling_lawyer_id,attachment_urls,created_at,task_category")
          .eq("task_category", CONTRACT_TASK_CATEGORY)
          .order("occurred_at", { ascending: false })
          .limit(2500),
        supabase
          .from("activities")
          .select("id,account_id,matter,description,status,occurred_at,handling_lawyer_id,attachment_urls,created_at,task_category")
          .neq("task_category", CONTRACT_TASK_CATEGORY)
          .or("task_category.like.litigation_%,task_category.eq.special_project,task_category.like.retainer_%")
          .order("occurred_at", { ascending: false })
          .limit(3000),
        supabase
          .from("accounts")
          .select("id,title,category,status")
          .order("title", { ascending: true })
          .limit(4000),
        loadLawyers(),
      ]);

    if (contractsError) {
      msgEl.textContent = `Error loading contracts: ${contractsError.message}`;
      return;
    }
    if (inheritedError) {
      msgEl.textContent = `Error loading inherited rows: ${inheritedError.message}`;
      return;
    }
    if (accountsError) {
      msgEl.textContent = `Error loading accounts: ${accountsError.message}`;
      return;
    }

    const directRows = (contractsData || []).map((r) => ({ ...r, mode: "contract" }));
    const inheritedRows = (inheritedData || [])
      .filter((r) => {
        if (!isInheritedSourceTask(r.task_category)) return false;
        const attachments = Array.isArray(r.attachment_urls) ? r.attachment_urls.filter(Boolean) : [];
        if (attachments.length) return true;
        const map = parsePipeMap(r.description);
        return Boolean(clean(map["engagement"]) || clean(map["link"]) || clean(map["engagement pdf"]));
      })
      .map((r) => ({ ...r, mode: "inherited" }));

    rows = directRows.concat(inheritedRows).sort((a, b) => {
      const aTs = new Date(a.occurred_at || a.created_at || 0).getTime();
      const bTs = new Date(b.occurred_at || b.created_at || 0).getTime();
      return bTs - aTs;
    });
    accounts = (accountsData || []).slice().sort((a, b) => accountLabel(a).localeCompare(accountLabel(b)));
    accountsById = new Map(accounts.map((a) => [a.id, a]));
    lawyers = loadedLawyers || [];

    populateAccountFilter();
    renderRows();
    msgEl.textContent = "";
  }

  async function onCreateRow() {
    if (!accounts.length) {
      msgEl.textContent = "No accounts available. Create accounts first.";
      return;
    }

    const preferredAccountId = clean(accountEl.value) || accounts[0].id;
    const today = new Date();
    const y = today.getUTCFullYear();
    const m = String(today.getUTCMonth() + 1).padStart(2, "0");
    const d = String(today.getUTCDate()).padStart(2, "0");
    const dateYmd = `${y}-${m}-${d}`;

    newBtn.disabled = true;
    msgEl.textContent = "Creating contract row...";
    const payload = {
      account_id: preferredAccountId,
      created_by: ctx.user.id,
      performed_by: ctx.user.id,
      activity_type: "communication",
      description: buildContractDescription({
        contractType: "Engagement Proposal",
        effectiveDate: dateYmd,
        handlingLabel: "-",
        remarks: "",
        attachmentName: "",
      }),
      minutes: 0,
      status: "draft",
      occurred_at: toOccurredAt(dateYmd),
      billable: false,
      billing_status: "non_billable",
      task_category: CONTRACT_TASK_CATEGORY,
      matter: "New Contract / Agreement",
      attachment_urls: null,
      submitted_at: null,
      draft_expires_at: null,
    };

    const { data, error } = await supabase
      .from("activities")
      .insert(payload)
      .select("id,account_id,matter,description,status,occurred_at,handling_lawyer_id,attachment_urls,created_at,task_category")
      .single();

    newBtn.disabled = false;
    if (error) {
      msgEl.textContent = `Create failed: ${error.message}`;
      return;
    }

    rows.unshift({ ...data, mode: "contract" });
    renderRows();
    msgEl.textContent = "New contract copy row created.";
  }

  async function onSaveRow(btn) {
    const tr = btn.closest("tr");
    if (!tr) return;
    if (tr.dataset.mode !== "contract") return;

    const id = tr.dataset.id;
    const saveMsg = tr.querySelector(".save-msg");
    const attachments = decodeAttachments(tr.dataset.attachments);
    const accountId = clean(tr.querySelector(".f-account")?.value);
    const matter = clean(tr.querySelector(".f-matter")?.value);
    const status = clean(tr.querySelector(".f-status")?.value) || "draft";
    const dateYmd = clean(tr.querySelector(".f-date")?.value);
    const handlingId = clean(tr.querySelector(".f-handling")?.value) || null;
    const description = buildDescriptionFromRow(tr, attachments);

    if (!accountId) {
      saveMsg.textContent = "Client is required.";
      return;
    }

    const payload = {
      account_id: accountId,
      matter: matter || null,
      status,
      handling_lawyer_id: handlingId,
      description,
      attachment_urls: attachments.length ? attachments : null,
    };
    if (dateYmd) payload.occurred_at = toOccurredAt(dateYmd);

    btn.disabled = true;
    saveMsg.textContent = "Saving...";
    const { error } = await supabase.from("activities").update(payload).eq("id", id);
    btn.disabled = false;
    if (error) {
      saveMsg.textContent = `Error: ${error.message}`;
      return;
    }

    updateLocalRow(id, payload);
    saveMsg.textContent = `Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  async function onDeleteRow(btn) {
    const tr = btn.closest("tr");
    if (!tr) return;
    if (tr.dataset.mode !== "contract") return;
    const ok = await uiConfirm({
      title: "Delete Contract Copy",
      message: "Delete this contract copy row?",
      confirmText: "Delete",
      danger: true,
    });
    if (!ok) return;

    const id = tr.dataset.id;
    const saveMsg = tr.querySelector(".save-msg");
    saveMsg.textContent = "Deleting...";

    const { error } = await supabase.from("activities").delete().eq("id", id);
    if (error) {
      saveMsg.textContent = `Delete failed: ${error.message}`;
      return;
    }

    rows = rows.filter((r) => r.id !== id);
    renderRows();
    msgEl.textContent = "Contract copy row deleted.";
  }

  async function onUploadDoc(tr, fileInput) {
    const saveMsg = tr.querySelector(".save-msg");
    if (tr.dataset.mode !== "contract") {
      saveMsg.textContent = "Inherited rows are read-only. Create Copy first.";
      fileInput.value = "";
      return;
    }
    const id = tr.dataset.id;
    const files = Array.from(fileInput.files || []);
    if (!files.length) return;

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
        userId: ctx.user.id,
        file,
      });

      const next = decodeAttachments(tr.dataset.attachments).concat([stored]);
      const payload = {
        attachment_urls: next,
        description: buildDescriptionFromRow(tr, next),
      };
      const { error } = await supabase.from("activities").update(payload).eq("id", id);
      if (error) {
        saveMsg.textContent = `Upload save failed: ${error.message}`;
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
    const saveMsg = tr.querySelector(".save-msg");
    if (tr.dataset.mode !== "contract") {
      saveMsg.textContent = "Inherited rows are read-only. Create Copy first.";
      return;
    }
    const payload = {
      attachment_urls: null,
      description: buildDescriptionFromRow(tr, []),
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

  async function onCreateCopy(tr) {
    const sourceId = tr.dataset.id;
    const sourceRow = rows.find((r) => r.id === sourceId && r.mode === "inherited");
    if (!sourceRow) return;

    const saveMsg = tr.querySelector(".save-msg");
    const attachments = decodeAttachments(tr.dataset.attachments);
    const dateYmd = clean(tr.querySelector(".f-date")?.value);
    const handlingId = clean(tr.querySelector(".f-handling")?.value) || null;

    const payload = {
      account_id: clean(tr.querySelector(".f-account")?.value) || sourceRow.account_id,
      created_by: ctx.user.id,
      performed_by: ctx.user.id,
      activity_type: "communication",
      minutes: 0,
      status: "draft",
      billable: false,
      billing_status: "non_billable",
      task_category: CONTRACT_TASK_CATEGORY,
      matter: clean(tr.querySelector(".f-matter")?.value) || sourceRow.matter || "Contract / Agreement",
      attachment_urls: attachments.length ? attachments : null,
      description: buildDescriptionFromRow(tr, attachments),
      submitted_at: null,
      draft_expires_at: null,
      handling_lawyer_id: handlingId,
    };
    if (dateYmd) payload.occurred_at = toOccurredAt(dateYmd);
    else payload.occurred_at = sourceRow.occurred_at || new Date().toISOString();

    saveMsg.textContent = "Creating contract copy...";
    const { data, error } = await supabase
      .from("activities")
      .insert(payload)
      .select("id,account_id,matter,description,status,occurred_at,handling_lawyer_id,attachment_urls,created_at,task_category")
      .single();

    if (error) {
      saveMsg.textContent = `Create failed: ${error.message}`;
      return;
    }

    rows.unshift({ ...data, mode: "contract" });
    renderRows();
    msgEl.textContent = "Editable contract copy created from source row.";
  }

  bodyEl.addEventListener("click", async (e) => {
    const copyBtn = e.target.closest(".create-copy");
    if (copyBtn) {
      const tr = copyBtn.closest("tr");
      if (tr) await onCreateCopy(tr);
      return;
    }

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

    const uploadBtn = e.target.closest(".upload-doc");
    if (uploadBtn) {
      const tr = uploadBtn.closest("tr");
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

    const docLink = e.target.closest(".doc-link");
    if (docLink) {
      e.preventDefault();
      const tr = docLink.closest("tr");
      const attachments = decodeAttachments(tr?.dataset.attachments);
      const idx = Number(docLink.dataset.idx || -1);
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
    if (!input) return;
    const tr = input.closest("tr");
    if (!tr) return;
    await onUploadDoc(tr, input);
  });

  searchEl.addEventListener("input", renderRows);
  accountEl.addEventListener("change", renderRows);
  statusEl.addEventListener("change", renderRows);
  reloadBtn.addEventListener("click", loadData);
  newBtn.addEventListener("click", onCreateRow);

  await loadData();
}
