// SCENEDROME Hub · Edge Function "hub-admin" — create accounts, passwords, emails, suspend, remove.
// Rules: the studio account (main owner) can do everything; owners manage everyone except other owners;
// "Manage users & access" holders manage non-owners; "Add people" holders can create accounts.
// Only owners remove people. Deploy with Verify JWT ON.
import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const firstKey = (name: string) => { try { const o = JSON.parse(Deno.env.get(name) ?? "{}"); return o.default ?? Object.values(o)[0]; } catch { return undefined; } };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? firstKey("SUPABASE_SECRET_KEYS"), { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Not signed in" }, 401);
    const { data: me } = await admin.from("profiles").select("role, job, access, suspended").eq("id", user.id).single();
    if (!me || me.suspended) return json({ error: "Not allowed" }, 403);
    const acc = me.access || {};
    const main = me.role === "owner" && me.job === "founder";
    const owner = me.role === "owner" && (main || acc["admin.users"] !== false);
    const manage = owner || acc["admin.users"] === true;
    const add = manage || acc["people.add"] === true;

    const b = await req.json();
    let target: { role: string; job: string } | null = null;
    if (b.id) { const { data } = await admin.from("profiles").select("role, job").eq("id", b.id).single(); target = data; }
    const targetOwner = target?.role === "owner";
    const self = b.id === user.id;

    if (b.action === "create") {
      if (!add) return json({ error: "You can’t add people" }, 403);
      if (b.role === "owner" && !main) return json({ error: "Only the studio account can add an owner" }, 403);
      const { data, error } = await admin.auth.admin.createUser({ email: b.email, password: b.password, email_confirm: true });
      if (error) return json({ error: error.message }, 400);
      const { error: e2 } = await admin.from("profiles").insert({ id: data.user.id, email: b.email, role: b.role, job: b.job, access: b.access ?? {}, suspended: false, data: b.data ?? {} });
      if (e2) { await admin.auth.admin.deleteUser(data.user.id); return json({ error: e2.message }, 400); }
      return json({ id: data.user.id });
    }
    if (!target) return json({ error: "Unknown person" }, 400);
    if (target.job === "founder" && !self) return json({ error: "The studio account can only be changed by itself" }, 403);
    const canTouch = targetOwner ? (main || self) : manage;
    if (b.action === "password") {
      if (!canTouch) return json({ error: "Not allowed" }, 403);
      const { error } = await admin.auth.admin.updateUserById(b.id, { password: b.password });
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }
    if (b.action === "email") {
      if (!(canTouch || (add && !targetOwner))) return json({ error: "Not allowed" }, 403);
      const { error } = await admin.auth.admin.updateUserById(b.id, { email: b.email, email_confirm: true });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").update({ email: b.email }).eq("id", b.id);
      return json({ ok: true });
    }
    if (b.action === "suspend") {
      if (!canTouch || self) return json({ error: "Not allowed" }, 403);
      const { error } = await admin.auth.admin.updateUserById(b.id, { ban_duration: b.suspended ? "876000h" : "none" });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").update({ suspended: !!b.suspended }).eq("id", b.id);
      return json({ ok: true });
    }
    if (b.action === "delete") {
      if (me.role !== "owner" || self || (targetOwner && !main)) return json({ error: "Only an owner can remove people" }, 403);
      const { error } = await admin.auth.admin.deleteUser(b.id);
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").delete().eq("id", b.id);
      return json({ ok: true });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) { return json({ error: String(e) }, 500); }
});
