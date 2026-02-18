import { escapeHtml } from "../ui/escapeHtml.js";
import { supabase } from "../supabaseClient.js";

const SUPER_ADMIN_ROLES = ["super_admin", "admin"];
const GROUP_CODE_RE = /^[A-Z0-9_]{2,12}$/;
const RATE_CODE_RE = /^[A-Z0-9_]{3,40}$/;
const DEFAULT_UNITS = ["flat", "hour"];

function peso(n) {
  const x = Number(n || 0);
  return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "_");
}

function clean(v) {
  return String(v || "").trim();
}

function toInt(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : fallback;
}

function toNum(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function validatePayload(payload) {
  if (!GROUP_CODE_RE.test(payload.group_code)) {
    return "Group Code must be 2-12 chars: A-Z, 0-9, underscore.";
  }
  if (!RATE_CODE_RE.test(payload.code)) {
    return "Code must be 3-40 chars: A-Z, 0-9, underscore.";
  }
  if (!payload.label || payload.label.length < 3 || payload.label.length > 120) {
    return "Label must be 3-120 characters.";
  }
  if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
    return "Amount must be greater than 0.";
  }
  if (!Number.isInteger(payload.sort) || payload.sort < 0 || payload.sort > 999) {
    return "Sort must be an integer from 0 to 999.";
  }
  return null;
}

function unitOptions(selected) {
  const values = new Set(DEFAULT_UNITS);
  const curr = clean(selected).toLowerCase();
  if (curr) values.add(curr);
  return Array.from(values)
    .map((x) => `<option value="${escapeHtml(x)}" ${x === curr ? "selected" : ""}>${escapeHtml(x)}</option>`)
    .join("");
}

export async function renderAdminRates(appEl, ctx) {
  if (!SUPER_ADMIN_ROLES.includes(ctx.profile.role)) {
    appEl.innerHTML = `<div class="card"><h2>Access denied</h2></div>`;
    return;
  }

  appEl.innerHTML = `
    <section class="page-head">
      <div>
        <h1 class="page-title">Admin Rates</h1>
        <p class="page-sub">Manage pricing templates with faster filtering and inline edits.</p>
      </div>
    </section>

    <section class="card rates-admin-shell">
      <h3 class="rates-section-title">Create Rate</h3>
      <form id="createRateForm" class="rates-form" autocomplete="off">
        <div class="rates-form-grid">
          <div>
            <label>Group Code</label>
            <input
              id="group_code"
              placeholder="AF / PF / OPE / TECH"
              maxlength="12"
              pattern="[A-Z0-9_]{2,12}"
              title="2-12 chars: A-Z, 0-9, underscore"
              required
            />
          </div>
          <div>
            <label>Code (unique)</label>
            <input
              id="code"
              placeholder="AF_PARTNER_ORIG"
              maxlength="40"
              pattern="[A-Z0-9_]{3,40}"
              title="3-40 chars: A-Z, 0-9, underscore"
              required
            />
          </div>
          <div>
            <label>Label</label>
            <input id="label" maxlength="120" required />
          </div>
          <div>
            <label>Unit</label>
            <select id="unit">
              <option value="flat">flat</option>
              <option value="hour">hour</option>
            </select>
          </div>
          <div>
            <label>Amount</label>
            <input id="amount" type="number" min="0.01" step="0.01" required />
          </div>
          <div>
            <label>Sort</label>
            <input id="sort" type="number" min="0" max="999" step="1" value="0" />
          </div>
          <div>
            <label>Active</label>
            <select id="active">
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </div>
        </div>
        <div class="rates-form-actions">
          <small class="muted">Codes are auto-normalized to uppercase underscore format.</small>
          <button class="btn btn-primary" type="submit">Add Rate</button>
        </div>
      </form>

      <div class="rates-toolbar">
        <input id="ratesSearch" placeholder="Search code, group, label..." />
        <select id="ratesGroupFilter">
          <option value="">All groups</option>
        </select>
        <select id="ratesActiveFilter">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button id="ratesReloadBtn" class="btn" type="button">Reload</button>
      </div>

      <section class="kpi-grid rates-kpis" id="ratesKpis"></section>
      <div class="table-wrap">
        <table class="rates-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Code</th>
              <th>Label</th>
              <th>Unit</th>
              <th>Amount</th>
              <th>Sort</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="ratesBody"></tbody>
        </table>
      </div>
      <p id="msg" class="msg"></p>
    </section>
  `;

  const $ = (s) => appEl.querySelector(s);
  const msg = $("#msg");
  const bodyEl = $("#ratesBody");
  const kpisEl = $("#ratesKpis");
  const createForm = $("#createRateForm");
  const searchEl = $("#ratesSearch");
  const groupFilterEl = $("#ratesGroupFilter");
  const activeFilterEl = $("#ratesActiveFilter");
  const reloadBtn = $("#ratesReloadBtn");

  let rates = [];
  let editingId = null;

  ["#group_code", "#code"].forEach((sel) => {
    $(sel).addEventListener("input", (e) => {
      e.target.value = normalizeCode(e.target.value);
    });
  });

  function parseCreatePayload() {
    return {
      group_code: normalizeCode($("#group_code").value),
      code: normalizeCode($("#code").value),
      label: clean($("#label").value),
      unit: clean($("#unit").value).toLowerCase() || "flat",
      amount: toNum($("#amount").value, 0),
      sort: toInt($("#sort").value, 0),
      is_active: $("#active").value === "true",
    };
  }

  function parseEditPayload(tr) {
    return {
      group_code: normalizeCode(tr.querySelector(".e-group")?.value),
      code: normalizeCode(tr.querySelector(".e-code")?.value),
      label: clean(tr.querySelector(".e-label")?.value),
      unit: clean(tr.querySelector(".e-unit")?.value).toLowerCase() || "flat",
      amount: toNum(tr.querySelector(".e-amount")?.value, 0),
      sort: toInt(tr.querySelector(".e-sort")?.value, 0),
      is_active: tr.querySelector(".e-active")?.value === "true",
    };
  }

  function populateGroupFilter() {
    const previous = clean(groupFilterEl.value);
    const groups = Array.from(new Set(rates.map((r) => clean(r.group_code)).filter(Boolean))).sort();
    groupFilterEl.innerHTML = [
      `<option value="">All groups</option>`,
      ...groups.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`),
    ].join("");
    if (previous && groups.includes(previous)) groupFilterEl.value = previous;
  }

  function getFilteredRows() {
    const q = clean(searchEl.value).toLowerCase();
    const group = clean(groupFilterEl.value);
    const active = clean(activeFilterEl.value);

    return rates.filter((r) => {
      if (group && clean(r.group_code) !== group) return false;
      if (active === "active" && !r.is_active) return false;
      if (active === "inactive" && r.is_active) return false;
      if (!q) return true;
      const hay = [r.group_code, r.code, r.label, r.unit].map((x) => clean(x).toLowerCase()).join(" ");
      return hay.includes(q);
    });
  }

  function renderKpis(filteredRows) {
    const total = rates.length;
    const activeCount = rates.filter((x) => x.is_active).length;
    const groups = new Set(rates.map((x) => clean(x.group_code)).filter(Boolean)).size;
    const avg = filteredRows.length
      ? filteredRows.reduce((sum, x) => sum + Number(x.amount || 0), 0) / filteredRows.length
      : 0;

    kpisEl.innerHTML = `
      <article class="kpi-card">
        <div class="kpi-label">Rates</div>
        <div class="kpi-value">${total}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Active</div>
        <div class="kpi-value" style="color:#118a4a">${activeCount}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Groups</div>
        <div class="kpi-value">${groups}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Filtered Avg</div>
        <div class="kpi-value">P${asPeso(avg)}</div>
      </article>
    `;
  }

  function asPeso(n) {
    return Number(n || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function renderRows() {
    const filtered = getFilteredRows();
    renderKpis(filtered);

    if (!filtered.length) {
      bodyEl.innerHTML = `<tr><td colspan="8" class="muted">No rates found.</td></tr>`;
      return;
    }

    bodyEl.innerHTML = filtered
      .map((r) => {
        const isEditing = editingId === r.id;
        const statusPill = r.is_active
          ? `<span class="status-pill billed">active</span>`
          : `<span class="status-pill rejected">inactive</span>`;

        if (isEditing) {
          return `
            <tr data-id="${r.id}">
              <td><input class="e-group" value="${escapeHtml(clean(r.group_code))}" maxlength="12" /></td>
              <td><input class="e-code" value="${escapeHtml(clean(r.code))}" maxlength="40" /></td>
              <td><input class="e-label" value="${escapeHtml(clean(r.label))}" maxlength="120" /></td>
              <td><select class="e-unit">${unitOptions(r.unit)}</select></td>
              <td><input class="e-amount" type="number" min="0.01" step="0.01" value="${Number(r.amount || 0)}" /></td>
              <td><input class="e-sort" type="number" min="0" max="999" step="1" value="${toInt(r.sort, 0)}" /></td>
              <td>
                <select class="e-active">
                  <option value="true" ${r.is_active ? "selected" : ""}>active</option>
                  <option value="false" ${!r.is_active ? "selected" : ""}>inactive</option>
                </select>
              </td>
              <td class="rates-actions">
                <button class="btn btn-primary save-edit" type="button">Save</button>
                <button class="btn cancel-edit" type="button">Cancel</button>
              </td>
            </tr>
          `;
        }

        return `
          <tr data-id="${r.id}" data-code="${escapeHtml(clean(r.code))}" data-active="${r.is_active ? "1" : "0"}">
            <td><strong>${escapeHtml(clean(r.group_code))}</strong></td>
            <td><code>${escapeHtml(clean(r.code))}</code></td>
            <td>${escapeHtml(clean(r.label))}</td>
            <td>${escapeHtml(clean(r.unit))}</td>
            <td><strong>P${peso(r.amount)}</strong></td>
            <td>${toInt(r.sort, 0)}</td>
            <td>${statusPill}</td>
            <td class="rates-actions">
              <button class="btn edit-row" type="button">Edit</button>
              <button class="btn toggle-row" type="button">${r.is_active ? "Disable" : "Enable"}</button>
              <button class="btn btn-danger delete-row" type="button" ${r.is_active ? "disabled title='Disable first to prevent accidental deletion'" : ""}>Delete</button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  async function load() {
    bodyEl.innerHTML = `<tr><td colspan="8" class="muted">Loading...</td></tr>`;
    const { data, error } = await supabase
      .from("rates")
      .select("id,group_code,code,label,unit,amount,is_active,sort")
      .order("group_code", { ascending: true })
      .order("sort", { ascending: true })
      .order("code", { ascending: true });

    if (error) {
      msg.textContent = `Error: ${error.message}`;
      bodyEl.innerHTML = `<tr><td colspan="8" class="muted">Failed to load rates.</td></tr>`;
      return;
    }

    rates = data || [];
    populateGroupFilter();
    renderRows();
  }

  async function codeExists(code, excludeId = null) {
    let query = supabase.from("rates").select("id").eq("code", code).limit(1);
    if (excludeId) query = query.neq("id", excludeId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return !!data?.length;
  }

  createForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn?.disabled) return;

    const payload = parseCreatePayload();
    const validationError = validatePayload(payload);
    if (validationError) {
      msg.textContent = `Error: ${validationError}`;
      return;
    }

    submitBtn.disabled = true;
    msg.textContent = "Checking...";
    try {
      if (await codeExists(payload.code)) {
        msg.textContent = `Error: Code "${payload.code}" already exists.`;
        return;
      }

      const ok = confirm(`Create rate ${payload.code} for P${peso(payload.amount)} (${payload.unit})?`);
      if (!ok) {
        msg.textContent = "Create cancelled.";
        return;
      }

      msg.textContent = "Saving...";
      const { error } = await supabase.from("rates").insert(payload);
      if (error) {
        msg.textContent = `Error: ${error.message}`;
        return;
      }

      msg.textContent = "Added.";
      createForm.reset();
      $("#active").value = "true";
      $("#sort").value = "0";
      await load();
    } catch (err) {
      msg.textContent = `Error: ${err?.message || err}`;
    } finally {
      submitBtn.disabled = false;
    }
  });

  bodyEl.addEventListener("click", async (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const id = tr.dataset.id;
    if (!id) return;

    const editBtn = e.target.closest(".edit-row");
    if (editBtn) {
      editingId = id;
      renderRows();
      return;
    }

    const cancelBtn = e.target.closest(".cancel-edit");
    if (cancelBtn) {
      editingId = null;
      renderRows();
      return;
    }

    const saveBtn = e.target.closest(".save-edit");
    if (saveBtn) {
      const payload = parseEditPayload(tr);
      const validationError = validatePayload(payload);
      if (validationError) {
        msg.textContent = `Error: ${validationError}`;
        return;
      }

      saveBtn.disabled = true;
      msg.textContent = "Saving...";
      try {
        if (await codeExists(payload.code, id)) {
          msg.textContent = `Error: Code "${payload.code}" already exists.`;
          return;
        }

        const { error } = await supabase.from("rates").update(payload).eq("id", id);
        if (error) {
          msg.textContent = `Error: ${error.message}`;
          return;
        }

        editingId = null;
        msg.textContent = "Updated.";
        await load();
      } catch (err) {
        msg.textContent = `Error: ${err?.message || err}`;
      } finally {
        saveBtn.disabled = false;
      }
      return;
    }

    const toggleBtn = e.target.closest(".toggle-row");
    if (toggleBtn) {
      const currActive = tr.dataset.active === "1";
      const code = clean(tr.dataset.code);
      const next = !currActive;
      if (!next && !confirm(`Disable rate "${code}"?`)) return;
      toggleBtn.disabled = true;
      msg.textContent = "Updating...";
      try {
        const { error } = await supabase.from("rates").update({ is_active: next }).eq("id", id);
        msg.textContent = error ? `Error: ${error.message}` : "Updated.";
        await load();
      } finally {
        toggleBtn.disabled = false;
      }
      return;
    }

    const deleteBtn = e.target.closest(".delete-row");
    if (deleteBtn) {
      if (deleteBtn.disabled) return;
      const currActive = tr.dataset.active === "1";
      const code = clean(tr.dataset.code);
      if (currActive) {
        msg.textContent = `Error: Disable "${code}" before deleting.`;
        return;
      }

      const typed = prompt(`Type ${code} to permanently delete this rate:`, "");
      if (typed !== code) {
        msg.textContent = "Delete cancelled.";
        return;
      }

      deleteBtn.disabled = true;
      msg.textContent = "Deleting...";
      try {
        const { error } = await supabase.from("rates").delete().eq("id", id);
        msg.textContent = error ? `Error: ${error.message}` : "Deleted.";
        await load();
      } finally {
        deleteBtn.disabled = false;
      }
    }
  });

  searchEl.addEventListener("input", renderRows);
  groupFilterEl.addEventListener("change", renderRows);
  activeFilterEl.addEventListener("change", renderRows);
  reloadBtn.addEventListener("click", load);

  await load();
}
