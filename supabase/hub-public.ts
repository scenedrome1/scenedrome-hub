// SCENEDROME Hub · Edge Function "hub-public" — sign in with a username, and sign up with an invite code.
// Deploy with Verify JWT OFF (people are not signed in yet). Never returns an email address.
import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const firstKey = (name: string) => { try { const o = JSON.parse(Deno.env.get(name) ?? "{}"); return o.default ?? Object.values(o)[0]; } catch { return undefined; } };
const hits = new Map<string, number[]>();
const limited = (k: string, max: number) => { const now = Date.now(); const a = (hits.get(k) ?? []).filter((t) => now - t < 600000); a.push(now); hits.set(k, a); return a.length > max; };
const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const uclean = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}._]/gu, "").slice(0, 24);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? firstKey("SUPABASE_SECRET_KEYS"), { auth: { persistSession: false } });
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? firstKey("SUPABASE_PUBLISHABLE_KEYS") ?? req.headers.get("apikey") ?? "";
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "?";
    const b = await req.json();

    if (b.action === "login") {
      const uname = uclean(clean(b.username, 40));
      const bad = () => json({ error: "Username or password doesn’t match" }, 401);
      if (!uname || !b.password) return bad();
      if (limited("l:" + ip, 12) || limited("lu:" + uname, 8)) return json({ error: "Too many tries — wait a few minutes" }, 429);
      const esc = uname.replace(/[\\%_]/g, (c) => "\\" + c);
      const { data: rows } = await admin.from("profiles").select("email, suspended").filter("data->>username", "ilike", esc).limit(2);
      const row = rows && rows.length === 1 ? rows[0] : null;
      if (!row || row.suspended) return bad();
      const c = createClient(url, anon, { auth: { persistSession: false } });
      const { data, error } = await c.auth.signInWithPassword({ email: row.email, password: String(b.password) });
      if (error || !data.session) return bad();
      return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
    }

    if (b.action === "signup") {
      if (limited("s:" + ip, 6)) return json({ error: "Too many tries — wait a few minutes" }, 429);
      const code = clean(b.code, 20).toUpperCase();
      const name = clean(b.name, 80), email = clean(b.email, 120).toLowerCase(), phone = clean(b.phone, 30), about = clean(b.about, 200);
      const password = String(b.password ?? "");
      if (!/^[A-Z0-9-]{6,20}$/.test(code)) return json({ error: "That invite code isn’t valid or was already used" }, 400);
      if (name.length < 2) return json({ error: "Please add your full name" }, 400);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "That email doesn’t look right" }, 400);
      if (password.length < 8) return json({ error: "Password needs at least 8 characters" }, 400);
      const now = new Date().toISOString();
      const { data: claimed } = await admin.from("invites").update({ used_at: now }).eq("code", code).is("used_at", null).is("revoked_at", null).or(`expires_at.is.null,expires_at.gt.${now}`).select("code").maybeSingle();
      if (!claimed) return json({ error: "That invite code isn’t valid or was already used" }, 400);
      const release = () => admin.from("invites").update({ used_at: null, used_by: null }).eq("code", code);
      const { data: cu, error: e1 } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (e1) { await release(); return json({ error: /registered|exists/i.test(e1.message) ? "That email already has an account" : e1.message }, 400); }
      const base = uclean(name.split(" ")[0]) || "user";
      let uname = base;
      for (let n = 2; n < 200; n++) {
        const { data: t } = await admin.from("profiles").select("id").filter("data->>username", "ilike", uname.replace(/[\\%_]/g, (c) => "\\" + c)).limit(1);
        if (!t || !t.length) break;
        uname = base + n;
      }
      const data = { name, phone, about, username: uname, pending: true, signedUp: Date.now(), invite: code, title: "None", dept: "Unassigned", joined: now.slice(0, 10), lang: "English", status: "available", photo: null, kudos: 0, headline: "", bio: "", skills: [], tools: [], cover: 0, leave: 21, overtime: 0, perf: 0, salary: 0 };
      const { error: e2 } = await admin.from("profiles").insert({ id: cu.user.id, email, role: "artist", job: "none", access: {}, suspended: false, data });
      if (e2) { await admin.auth.admin.deleteUser(cu.user.id); await release(); return json({ error: e2.message }, 400); }
      await admin.from("invites").update({ used_by: cu.user.id }).eq("code", code);
      return json({ ok: true });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) { return json({ error: String(e) }, 500); }
});
