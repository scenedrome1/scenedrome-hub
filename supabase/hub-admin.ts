// SCENEDROME Hub · Edge Function "hub-admin"
// Lets the owner (or someone the owner gave "Manage users & access") create accounts,
// reset passwords, suspend and remove people. Paste into Supabase → Edge Functions → new function "hub-admin".
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const firstKey = (name: string) => { try { const o = JSON.parse(Deno.env.get(name) ?? "{}"); return o.default ?? Object.values(o)[0]; } catch { return undefined; } };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? firstKey("SUPABASE_SECRET_KEYS");
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Not signed in" }, 401);
    const { data: me } = await admin.from("profiles").select("role, access, suspended").eq("id", user.id).single();
    const allowed = me && !me.suspended && (me.role === "owner" || (me.access && me.access["admin.users"] === true));
    if (!allowed) return json({ error: "Only the owner can manage accounts" }, 403);

    const b = await req.json();
    if (b.role === "owner") return json({ error: "There is only one owner" }, 400);
    if (b.id) {
      const { data: target } = await admin.from("profiles").select("role").eq("id", b.id).single();
      if (target?.role === "owner") return json({ error: "The owner account can’t be changed here" }, 400);
    }

    if (b.action === "create") {
      const { data, error } = await admin.auth.admin.createUser({ email: b.email, password: b.password, email_confirm: true });
      if (error) return json({ error: error.message }, 400);
      const { error: e2 } = await admin.from("profiles").insert({
        id: data.user.id, email: b.email, role: b.role, job: b.job, access: b.access ?? {}, suspended: false, data: b.data ?? {},
      });
      if (e2) { await admin.auth.admin.deleteUser(data.user.id); return json({ error: e2.message }, 400); }
      return json({ id: data.user.id });
    }
    if (b.action === "password") {
      const { error } = await admin.auth.admin.updateUserById(b.id, { password: b.password });
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }
    if (b.action === "suspend") {
      const { error } = await admin.auth.admin.updateUserById(b.id, { ban_duration: b.suspended ? "876000h" : "none" });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").update({ suspended: !!b.suspended }).eq("id", b.id);
      return json({ ok: true });
    }
    if (b.action === "delete") {
      const { error } = await admin.auth.admin.deleteUser(b.id);
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
