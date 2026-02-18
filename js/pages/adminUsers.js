import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "../supabaseClient.js";

const SUPER_ADMIN_ROLES = ["super_admin", "admin"];
const ROLE_OPTIONS = ["staff_encoder", "lawyer", "accountant", "admin", "super_admin"];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function renderAdminUsers(appEl, ctx) {
  if (!SUPER_ADMIN_ROLES.includes(ctx.profile.role)) {
    appEl.innerHTML = `<div class="card"><h2>Access denied</h2></div>`;
    return;
  }

  appEl.innerHTML = `
    <div class="card">
      <h2>Admin - Users</h2>

      <div class="grid2">
        <div>
          <label>Search</label>
          <input id="q" placeholder="name or email..." />
        </div>
        <div>
          <label>Role filter</label>
          <select id="roleFilter">
            <option value="">All</option>
            <option value="super_admin">super_admin</option>
            <option value="admin">admin</option>
            <option value="accountant">accountant</option>
            <option value="lawyer">lawyer</option>
            <option value="staff_encoder">staff_encoder</option>
          </select>
        </div>
      </div>

      <hr/>

      <h3>Create New User</h3>
      <div class="muted" style="font-size:12px">Tries secure RPC <code>public.admin_create_user(...)</code> first, then fallback signup + profile upsert if RPC is unavailable.</div>

      <form id="create" class="stack">
        <label>Email</label>
        <input id="email" type="email" required />
        <label>Temporary Password</label>
        <input id="pw" type="text" required placeholder="Give them this temp password" />
        <label>Full Name</label>
        <input id="name" placeholder="optional" />
        <label>Role</label>
        <select id="role" required>
          <option value="staff_encoder">staff_encoder</option>
          <option value="lawyer">lawyer</option>
          <option value="accountant">accountant</option>
          <option value="admin">admin</option>
          <option value="super_admin">super_admin</option>
        </select>
        <button type="submit" class="btn">Create User</button>
      </form>

      <p id="msg" class="msg"></p>

      <hr/>

      <h3>Users</h3>
      <div class="muted" style="font-size:12px">Delete uses 2-step confirmation and calls <code>public.admin_delete_user(uuid)</code>.</div>
      <div id="list"></div>
    </div>
  `;

  const $ = (s) => appEl.querySelector(s);
  const msg = $("#msg");
  const list = $("#list");
  const q = $("#q");
  const roleFilter = $("#roleFilter");

  const noPersist = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  async function upsertProfileViaRpc(payload) {
    return supabase.rpc("admin_upsert_profile", {
      p_email: payload.email,
      p_full_name: payload.full_name || null,
      p_role: payload.role,
      p_user_id: payload.id
    });
  }

  $("#create").addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "Creating...";

    const email = $("#email").value.trim();
    const password = $("#pw").value.trim();
    const full_name = $("#name").value.trim();
    const role = $("#role").value;

    // Preferred path: secure SQL RPC.
    const rpc = await supabase.rpc("admin_create_user", {
      p_email: email,
      p_password: password,
      p_full_name: full_name || null,
      p_role: role
    });

    if (!rpc.error) {
      msg.textContent = `User created. ID: ${rpc.data}`;
      e.target.reset();
      await load();
      return;
    }

    // Fallback path when RPC is unavailable/misconfigured.
    const fallback = await noPersist.auth.signUp({
      email,
      password,
      options: { data: { full_name, must_change_password: true } }
    });

    if (fallback.error) {
      msg.textContent = `Create failed: ${rpc.error.message} | Fallback failed: ${fallback.error.message}`;
      return;
    }

    await new Promise((r) => setTimeout(r, 900));

    const { data: prof, error: pErr } = await supabase
      .from("profiles")
      .select("id,email,full_name,role")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pErr) {
      msg.textContent = `Auth user created via fallback, but profile lookup failed: ${pErr.message}`;
      e.target.reset();
      await load();
      return;
    }

    if (prof?.id) {
      const { error: uErr } = await supabase
        .from("profiles")
        .update({ role, full_name: full_name || prof.full_name })
        .eq("id", prof.id);

      if (!uErr) {
        msg.textContent = `User created via fallback + role set. (RPC failed: ${rpc.error.message})`;
      } else {
        const payload = {
          id: prof.id,
          email,
          full_name: full_name || prof.full_name || email.split("@")[0],
          role
        };
        const { error: rpcUpErr } = await upsertProfileViaRpc(payload);
        msg.textContent = rpcUpErr
          ? `RPC failed (${rpc.error.message}). Profile update failed (${uErr.message}) and RPC upsert failed (${rpcUpErr.message}).`
          : `User created via fallback + profile upserted by RPC. (Original RPC failed: ${rpc.error.message})`;
      }
    } else {
      const fallbackUserId = fallback.data?.user?.id;
      if (!fallbackUserId) {
        msg.textContent = `RPC failed (${rpc.error.message}). Auth user created via fallback, but user ID was missing for profile upsert.`;
        e.target.reset();
        await load();
        return;
      }

      const profilePayload = {
        id: fallbackUserId,
        email,
        full_name: full_name || email.split("@")[0],
        role
      };

      const { error: rpcUpErr } = await upsertProfileViaRpc(profilePayload);
      if (!rpcUpErr) {
        msg.textContent = `User created via fallback + profile upserted by RPC. (Original RPC failed: ${rpc.error.message})`;
      } else {
        const { error: upErr } = await supabase
          .from("profiles")
          .upsert(profilePayload, { onConflict: "id" });

        msg.textContent = upErr
          ? `RPC failed (${rpc.error.message}). RPC profile upsert failed (${rpcUpErr.message}). Direct upsert failed (${upErr.message}). Run SQL setup for admin_upsert_profile.`
          : `User created via fallback + profile inserted via direct upsert. (Original RPC failed: ${rpc.error.message})`;
      }
    }

    e.target.reset();
    await load();
  });

  async function load() {
    list.innerHTML = `<p class="muted">Loading...</p>`;

    const search = (q.value || "").trim();
    let query = supabase
      .from("profiles")
      .select("id,email,full_name,role")
      .order("email", { ascending: true })
      .limit(200);

    if (roleFilter.value) query = query.eq("role", roleFilter.value);
    if (search) query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`);

    const { data, error } = await query;
    if (error) {
      list.innerHTML = `<p class="msg">Error: ${error.message}</p>`;
      return;
    }

    if (!data?.length) {
      list.innerHTML = `<p class="muted">No users found.</p>`;
      return;
    }

    list.innerHTML = data.map((p) => {
      const label = escapeHtml(p.full_name || p.email);
      const email = escapeHtml(p.email || "");
      const role = escapeHtml(p.role || "");
      const isSelf = p.id === ctx.profile.id;

      return `
        <div class="row">
          <div style="flex:1">
            <div><strong>${label}</strong></div>
            <div class="muted">${email} - ${role}</div>
          </div>
          <div class="actions" style="flex-wrap:wrap">
            <select class="roleSel" data-id="${p.id}">
              ${ROLE_OPTIONS.map((r) => `<option value="${r}" ${p.role === r ? "selected" : ""}>${r}</option>`).join("")}
            </select>
            <button class="btn saveRole" data-id="${p.id}">Save</button>
            <button
              class="btn btn-danger deleteUser"
              data-id="${p.id}"
              data-email="${email}"
              ${isSelf ? "disabled title=\"You cannot delete your own account\"" : ""}
            >Delete</button>
          </div>
        </div>
      `;
    }).join("");

    list.querySelectorAll(".saveRole").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const sel = list.querySelector(`.roleSel[data-id="${id}"]`);
        const newRole = sel.value;

        msg.textContent = "Updating role...";
        const { error } = await supabase.from("profiles").update({ role: newRole }).eq("id", id);
        msg.textContent = error ? `Error: ${error.message}` : "Updated.";
        await load();
      });
    });

    list.querySelectorAll(".deleteUser").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const email = btn.dataset.email || "(unknown email)";

        if (!id) return;
        if (id === ctx.profile.id) {
          msg.textContent = "You cannot delete your own account.";
          return;
        }

        const ok = confirm(`Do you really want to delete ${email}? This cannot be undone.`);
        if (!ok) return;

        const typed = prompt(`Second confirmation required. Type DELETE to remove ${email}.`, "");
        if (typed !== "DELETE") {
          msg.textContent = "Delete cancelled (confirmation text did not match).";
          return;
        }

        msg.textContent = "Deleting account...";
        const { error } = await supabase.rpc("admin_delete_user", { target_user_id: id });

        if (error) {
          msg.textContent = `Delete failed: ${error.message}. Run SQL setup for admin_delete_user first.`;
          return;
        }

        msg.textContent = "User deleted.";
        await load();
      });
    });
  }

  q.addEventListener("input", load);
  roleFilter.addEventListener("change", load);

  await load();
}
