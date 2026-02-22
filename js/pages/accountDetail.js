import { supabase } from "../supabaseClient.js";
import { escapeHtml } from "../ui/escapeHtml.js";

const SUPER_ADMIN_ROLES = ["super_admin", "admin"];


export async function renderAccountDetail(appEl, ctx, accountId) {
  appEl.innerHTML = `
    <div class="card">
      <h2>Account</h2>
      <div id="info"></div>
      <div id="adminAssign"></div>
      <hr/>
      <h3>Recent Activities</h3>
      <div id="acts"></div>
      <p id="msg" class="msg"></p>
    </div>
  `;

  const info = appEl.querySelector("#info");
  const adminAssign = appEl.querySelector("#adminAssign");
  const acts = appEl.querySelector("#acts");
  const msg = appEl.querySelector("#msg");

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

  info.innerHTML = `
    <p><strong>${escapeHtml(account.title)}</strong></p>
    <p class="muted">${escapeHtml(account.category)} | ${escapeHtml(account.account_kind || "-")} - ${escapeHtml(account.is_archived ? "archived" : account.status)}</p>
    <p class="muted">ID: ${escapeHtml(account.id)}</p>
  `;

  // Admin-only member assignment (by email search)
  if (SUPER_ADMIN_ROLES.includes(ctx.profile.role)) {
    adminAssign.innerHTML = `
      <h3>Assign Member (Admin only)</h3>
      <form id="assignForm" class="stack">
        <label>Search staff email</label>
        <input id="searchEmail" placeholder="e.g., lawyer@firm.com" />
        <button type="button" id="searchBtn">Search</button>

        <div id="results"></div>
      </form>
      <hr/>
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

  // Load activities
  msg.textContent = "Loading activities...";
  const { data: activities, error: actErr } = await supabase
    .from("activities")
    .select("id,fee_code,task_category,description,amount,minutes,status,occurred_at,created_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(25);

  if (actErr) {
    msg.textContent = `Error: ${actErr.message}`;
    return;
  }

  msg.textContent = "";
  if (!activities?.length) {
    acts.innerHTML = `<p class="muted">No activities yet.</p>`;
    return;
  }

  acts.innerHTML = activities
    .map(
      (x) => `
      <div class="row">
        <div>
          <div><strong>${escapeHtml(x.fee_code || "")}</strong> <span class="muted">- ${escapeHtml(x.task_category || "")} - ${escapeHtml(x.status || "")}</span></div>
          <div>${escapeHtml(x.description || "")}</div>
          <div class="muted">${x.minutes ? `${x.minutes} min - ` : ""}${x.occurred_at ? new Date(x.occurred_at).toLocaleString() : ""}${x.amount != null ? ` - P${Number(x.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : ""}</div>
        </div>
      </div>`
    )
    .join("");
}
