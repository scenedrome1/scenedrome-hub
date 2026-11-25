// hub-media: OneDrive bridge for the SCENEDROME Hub (delegated sign-in as the studio's OneDrive account).
// Step 1: link (device-code sign-in, owner only) + test. More actions are added later.
import { createClient } from "npm:@supabase/supabase-js@2";

const CID = "b95c254b-d55e-4928-a08e-e50c39b3eddb";
const TID = "face857e-b116-4030-a105-25378f844062";
const SCOPE = "offline_access Files.ReadWrite User.Read";
const ROOT = "SCENEDROME HUB Media Storage/Projects Media Preview";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const TOK = "https://login.microsoftonline.com/"+TID+"/oauth2/v2.0/token";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const me = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const adm = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: owner } = await me.rpc("is_owner");
    if (owner !== true) return json({ error: "owner only" }, 403);
    const b = await req.json().catch(() => ({}));

    async function accessToken() {
      const { data } = await adm.from("media_auth").select("refresh_token").eq("id", 1).maybeSingle();
      if (!data?.refresh_token) throw new Error("not linked");
      const r = await fetch(TOK, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ client_id: CID, grant_type: "refresh_token", refresh_token: data.refresh_token, scope: SCOPE }),
      });
      const t = await r.json();
      if (!t.access_token) throw new Error(t.error_description || "token refresh failed");
      if (t.refresh_token) await adm.from("media_auth").update({ refresh_token: t.refresh_token, updated_at: new Date().toISOString() }).eq("id", 1);
      return t.access_token as string;
    }

    if (b.action === "link_start") {
      const r = await fetch("https://login.microsoftonline.com/"+TID+"/oauth2/v2.0/devicecode", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ client_id: CID, scope: SCOPE }),
      });
      return json(await r.json());
    }
    if (b.action === "link_poll") {
      const r = await fetch(TOK, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ client_id: CID, grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: String(b.device_code || "") }),
      });
      const t = await r.json();
      if (t.error === "authorization_pending" || t.error === "slow_down") return json({ pending: true });
      if (!t.access_token) return json({ error: t.error_description || t.error || "failed" });
      const g = await (await fetch("https://graph.microsoft.com/v1.0/me", { headers: { Authorization: "Bearer " + t.access_token } })).json();
      const up = await adm.from("media_auth").upsert({ id: 1, refresh_token: t.refresh_token, account: g.userPrincipalName || g.mail || "", updated_at: new Date().toISOString() });
      if (up.error) return json({ error: "save failed: " + up.error.message });
      return json({ ok: true, account: g.userPrincipalName || g.mail });
    }
    if (b.action === "status") {
      const { data } = await adm.from("media_auth").select("account,updated_at").eq("id", 1).maybeSingle();
      return json({ linked: !!data, account: data?.account || null });
    }
    if (b.action === "test") {
      const at = await accessToken();
      const r = await fetch("https://graph.microsoft.com/v1.0/me/drive/root:/"+encodeURIComponent(ROOT)+":/children?$top=10&$select=name,folder,size", { headers: { Authorization: "Bearer " + at } });
      return json({ status: r.status, body: await r.json() });
    }
    if (b.action === "graph_get") {
      const at = await accessToken();
      const r = await fetch("https://graph.microsoft.com/v1.0" + String(b.path || ""), { headers: { Authorization: "Bearer " + at } });
      return json({ status: r.status, body: await r.json().catch(() => null) });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
