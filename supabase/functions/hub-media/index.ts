// hub-media: OneDrive bridge for the SCENEDROME Hub. Bytes live in OneDrive (signed in as the studio account), metadata in media_* tables.
import { createClient } from "npm:@supabase/supabase-js@2";

const CID = "b95c254b-d55e-4928-a08e-e50c39b3eddb";
const TID = "face857e-b116-4030-a105-25378f844062";
const SCOPE = "offline_access Files.ReadWrite User.Read";
const ROOT = "SCENEDROME HUB Media Storage/Projects Media Preview";
const G = "https://graph.microsoft.com/v1.0";
const TOK = "https://login.microsoftonline.com/" + TID + "/oauth2/v2.0/token";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const safe = (s: string) => String(s || "").replace(/[\\/:*?"<>|#%~&{}]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "file";
const rid = (p: string) => p + crypto.randomUUID().replace(/-/g, "").slice(0, 12);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const me = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const adm = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: ud } = await me.auth.getUser();
    const uid = ud?.user?.id;
    if (!uid) return json({ error: "sign in first" }, 401);
    const isOwner = (await me.rpc("is_owner")).data === true;
    const inh = (await me.rpc("review_inhouse")).data === true;
    const b = await req.json().catch(() => ({}));
    const A = String(b.action || "");

    async function accessToken() {
      const { data } = await adm.from("media_auth").select("refresh_token").eq("id", 1).maybeSingle();
      if (!data?.refresh_token) throw new Error("OneDrive is not linked yet");
      const r = await fetch(TOK, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ client_id: CID, grant_type: "refresh_token", refresh_token: data.refresh_token, scope: SCOPE }) });
      const t = await r.json();
      if (!t.access_token) throw new Error(t.error_description || "token refresh failed");
      if (t.refresh_token) await adm.from("media_auth").update({ refresh_token: t.refresh_token, updated_at: new Date().toISOString() }).eq("id", 1);
      return t.access_token as string;
    }
    async function gj(at: string, path: string, init: RequestInit = {}) {
      const r = await fetch(G + path, { ...init, headers: { Authorization: "Bearer " + at, "Content-Type": "application/json", ...((init.headers as Record<string, string>) || {}) } });
      const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { /* empty */ }
      return { s: r.status, j };
    }
    const projOf = async (pid: string) => (await me.from("projects").select("id,producer,client,data").eq("id", String(pid || "")).maybeSingle()).data;
    async function ensureProj(pid: string, name: string, at: string) {
      const { data: mp } = await adm.from("media_projects").select("item_id").eq("project_id", pid).maybeSingle();
      if (mp) return mp.item_id as string;
      const fname = safe(name) + " [" + pid.slice(-6) + "]";
      const r = await gj(at, "/me/drive/root:/" + enc(ROOT) + ":/children", { method: "POST", body: JSON.stringify({ name: fname, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }) });
      let id = r.j?.id;
      if (!id) id = (await gj(at, "/me/drive/root:/" + enc(ROOT + "/" + fname))).j?.id;
      if (!id) throw new Error("could not create the project folder");
      await adm.from("media_projects").upsert({ project_id: pid, item_id: id });
      return id as string;
    }
    const isGM = (await me.rpc("is_general_manager")).data === true;
    const isMgr = (p: any) => isOwner || isGM || (p && p.producer === uid);
    const canEdit = (_row: any, p: any) => isMgr(p);

    // ---- owner-only: link the studio OneDrive account ----
    if (["link_start", "link_poll", "test", "graph_get"].includes(A) && !isOwner) return json({ error: "owner only" }, 403);
    if (A === "link_start") {
      const r = await fetch("https://login.microsoftonline.com/" + TID + "/oauth2/v2.0/devicecode", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ client_id: CID, scope: SCOPE }) });
      return json(await r.json());
    }
    if (A === "link_poll") {
      const r = await fetch(TOK, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ client_id: CID, grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: String(b.device_code || "") }) });
      const t = await r.json();
      if (t.error === "authorization_pending" || t.error === "slow_down") return json({ pending: true });
      if (!t.access_token) return json({ error: t.error_description || t.error || "failed" });
      const g = await (await fetch(G + "/me", { headers: { Authorization: "Bearer " + t.access_token } })).json();
      const up = await adm.from("media_auth").upsert({ id: 1, refresh_token: t.refresh_token, account: g.userPrincipalName || g.mail || "", updated_at: new Date().toISOString() });
      if (up.error) return json({ error: "save failed: " + up.error.message });
      return json({ ok: true, account: g.userPrincipalName || g.mail });
    }
    if (A === "graph_get") {
      const at = await accessToken();
      const r = await gj(at, String(b.path || ""));
      return json({ status: r.s, body: r.j });
    }
    if (A === "test") {
      const at = await accessToken();
      const r = await gj(at, "/me/drive/root:/" + enc(ROOT) + ":/children?$top=20&$select=name,folder");
      return json({ status: r.s, body: r.j });
    }
    if (!inh && A !== "url") return json({ error: "not allowed" }, 403);
    if (A === "status") {
      const { data } = await adm.from("media_auth").select("account").eq("id", 1).maybeSingle();
      return json({ linked: !!data, account: data?.account || null });
    }

    if (A === "ensure_project") {
      const p = await projOf(b.project_id); if (!p) return json({ error: "no access to this project" }, 403);
      await ensureProj(p.id, p.data?.name || p.id, await accessToken());
      return json({ ok: true });
    }

    // ---- uploads ----
    if (A === "upload_start") {
      const p = await projOf(b.project_id); if (!p) return json({ error: "no access to this project" }, 403);
      const at = await accessToken(); const folder = await ensureProj(p.id, p.data?.name || p.id, at);
      const fname = safe(b.name);
      const r = await gj(at, "/me/drive/items/" + folder + ":/" + encodeURIComponent(fname) + ":/createUploadSession", { method: "POST", body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename" } }) });
      if (!r.j?.uploadUrl) return json({ error: "could not start the upload (" + r.s + ")" }, 500);
      return json({ uploadUrl: r.j.uploadUrl });
    }
    if (A === "upload_done") {
      const p = await projOf(b.project_id); if (!p) return json({ error: "no access to this project" }, 403);
      const at = await accessToken(); const folder = await ensureProj(p.id, p.data?.name || p.id, at);
      const it = await gj(at, "/me/drive/items/" + encodeURIComponent(String(b.item_id)) + "?$select=id,name,size,parentReference,file");
      if (!it.j?.id || it.j.parentReference?.id !== folder) return json({ error: "file not found in the project folder" }, 400);
      let inheritSt: string | null = null; let group = String(b.group_id || ""); let ver = 1; let fid: string | null = b.folder_id ? String(b.folder_id) : null;
      if (group) {
        const { data: last } = await adm.from("media_files").select("ver,folder_id,status").eq("group_id", group).eq("project_id", p.id).order("ver", { ascending: false }).limit(1);
        if (!last?.length) return json({ error: "unknown file group" }, 400);
        ver = (last[0].ver || 0) + 1; fid = last[0].folder_id; inheritSt = ["approved", "changes"].includes(last[0].status) ? "review" : (last[0].status || null);
      } else if (fid) {
        const ok = (await me.from("media_folders").select("id").eq("id", fid).eq("project_id", p.id).maybeSingle()).data;
        if (!ok) return json({ error: "folder not available" }, 403);
      }
      const id = rid("mf_"); if (!group) group = id;
      const row = { id, project_id: p.id, folder_id: fid, group_id: group, ver, name: it.j.name, item_id: it.j.id, mime: String(b.mime || it.j.file?.mimeType || ""), size: it.j.size || 0, status: inheritSt, by: uid, ts: Date.now() };
      const ins = await adm.from("media_files").insert(row);
      if (ins.error) return json({ error: ins.error.message }, 500);
      return json({ file: row });
    }
    if (A === "url") {
      const row = (await adm.from("media_files").select("*").eq("id", String(b.file_id || "")).maybeSingle()).data;
      if (!row) return json({ error: "file not found" }, 404);
      let ok = !!(await me.from("media_files").select("id").eq("id", row.id).maybeSingle()).data;
      if (!ok) {
        const p = await projOf(row.project_id);
        const pv = (p?.data?.previews || []) as any[];
        ok = !!p && pv.some((v) => v.show !== false && (Array.isArray(v.to) && v.to.includes(uid)) && (v.vers || []).some((x: any) => x.fid === row.id));
      }
      if (!ok) return json({ error: "no access" }, 403);
      const at = await accessToken();
      const r = await gj(at, "/me/drive/items/" + row.item_id + "?select=id,@microsoft.graph.downloadUrl");
      const dl = r.j?.["@microsoft.graph.downloadUrl"];
      if (!dl) return json({ error: "file unavailable (" + r.s + ")" }, 500);
      return json({ url: dl, exp: Date.now() + 45 * 60000 });
    }
    if (A === "file_delete") {
      const row = (await adm.from("media_files").select("*").eq("id", String(b.id || "")).maybeSingle()).data;
      if (!row) return json({ ok: true });
      const p = await projOf(row.project_id);
      if (!p || !canEdit(row, p)) return json({ error: "only the producer, the General Manager or the owner can delete" }, 403);
      const at = await accessToken();
      await gj(at, "/me/drive/items/" + row.item_id, { method: "DELETE" });
      await adm.from("media_files").delete().eq("id", row.id);
      const left = await adm.from("media_files").select("id").eq("group_id", row.group_id).limit(1);
      if (!left.data?.length) await adm.from("media_mirrors").delete().eq("group_id", row.group_id);
      return json({ ok: true });
    }
    if (A === "file_move") {
      const row = (await me.from("media_files").select("id,project_id,group_id").eq("id", String(b.id || "")).maybeSingle()).data;
      if (!row) return json({ error: "file not found" }, 404);
      if (!isMgr(await projOf(row.project_id))) return json({ error: "only the producer, the General Manager or the owner can move files" }, 403);
      const to = b.folder_id ? String(b.folder_id) : null;
      if (to && !(await me.from("media_folders").select("id").eq("id", to).eq("project_id", row.project_id).maybeSingle()).data) return json({ error: "folder not available" }, 403);
      await adm.from("media_files").update({ folder_id: to }).eq("group_id", row.group_id);
      return json({ ok: true });
    }

    if (A === "file_rename") {
      const row = (await me.from("media_files").select("id,project_id,group_id").eq("id", String(b.id || "")).maybeSingle()).data;
      if (!row) return json({ error: "file not found" }, 404);
      if (!isMgr(await projOf(row.project_id))) return json({ error: "only the producer, the General Manager or the owner can rename" }, 403);
      const nm = safe(b.name); if (!nm) return json({ error: "name needed" }, 400);
      await adm.from("media_files").update({ name: nm }).eq("group_id", row.group_id);
      return json({ ok: true, name: nm });
    }

    if (A === "file_status") {
      const gid = String(b.group_id || "");
      const row = (await adm.from("media_files").select("project_id,status").eq("group_id", gid).order("ver", { ascending: false }).limit(1)).data?.[0];
      if (!row) return json({ error: "file not found" }, 404);
      const p = await projOf(row.project_id); if (!p) return json({ error: "no access" }, 403);
      const mg = isMgr(p);
      const pv = ((p.data?.previews || []) as any[]).find((v) => v.gid === gid);
      const recip = !!pv && pv.show !== false && Array.isArray(pv.to) && pv.to.includes(uid) && !inh;
      const seen = !!(await me.from("media_files").select("id").eq("group_id", gid).limit(1)).data?.length;
      const can = mg || recip || (!inh && seen);
      const opts = mg ? ["", "wip", "review", "changes", "approved"] : ["review", "changes", "approved"];
      if (b.status === undefined) { if (!(can || seen)) return json({ error: "no access" }, 403); return json({ status: row.status || "", can, opts: can ? opts : [] }); }
      if (!can) return json({ error: "only the producer, the General Manager, the owner or the client with access can change the status" }, 403);
      const stv = String(b.status || ""); if (!opts.includes(stv)) return json({ error: "not allowed" }, 400);
      await adm.from("media_files").update({ status: stv || null }).eq("group_id", gid);
      return json({ ok: true, status: stv });
    }
    // ---- versions, mirrors ----
    const mgrOf = async (pid: string) => { const p = await projOf(pid); return p && isMgr(p) ? p : null; };
    if (A === "file_as_version") {
      const src = (await adm.from("media_files").select("*").eq("id", String(b.id || "")).maybeSingle()).data;
      if (!src) return json({ error: "file not found" }, 404);
      if (!(await mgrOf(src.project_id))) return json({ error: "only the producer, the General Manager or the owner can do this" }, 403);
      const tg = String(b.target_group || "");
      if (!tg || tg === src.group_id) return json({ error: "pick a different clip" }, 400);
      const { data: tv } = await adm.from("media_files").select("*").eq("group_id", tg).eq("project_id", src.project_id).order("ver", { ascending: false });
      if (!tv?.length) return json({ error: "target clip not found" }, 404);
      const { data: sv } = await adm.from("media_files").select("*").eq("group_id", src.group_id).order("ver", { ascending: true });
      let n = tv[0].ver || 0;
      for (const r of sv || []) { n += 1; await adm.from("media_files").update({ group_id: tg, folder_id: tv[0].folder_id, ver: n }).eq("id", r.id); }
      await adm.from("media_mirrors").delete().eq("group_id", src.group_id);
      return json({ ok: true });
    }
    if (A === "file_unstack") {
      const row = (await adm.from("media_files").select("*").eq("id", String(b.id || "")).maybeSingle()).data;
      if (!row) return json({ error: "file not found" }, 404);
      if (!(await mgrOf(row.project_id))) return json({ error: "only the producer, the General Manager or the owner can do this" }, 403);
      await adm.from("media_files").update({ group_id: row.id, ver: 1 }).eq("id", row.id);
      return json({ ok: true });
    }
    if (A === "file_mirror" || A === "file_unmirror") {
      const f = (await adm.from("media_files").select("project_id").eq("group_id", String(b.group_id || "")).limit(1)).data?.[0];
      if (!f) return json({ error: "file not found" }, 404);
      if (!(await mgrOf(f.project_id))) return json({ error: "only the producer, the General Manager or the owner can do this" }, 403);
      const fid = String(b.folder_id || "");
      if (A === "file_unmirror") { await adm.from("media_mirrors").delete().eq("group_id", String(b.group_id)).eq("folder_id", fid); return json({ ok: true }); }
      if (!(await adm.from("media_folders").select("id").eq("id", fid).eq("project_id", f.project_id).maybeSingle()).data) return json({ error: "folder not available" }, 403);
      const ins = await adm.from("media_mirrors").upsert({ id: rid("mm_"), project_id: f.project_id, group_id: String(b.group_id), folder_id: fid, by: uid, ts: Date.now() }, { onConflict: "group_id,folder_id" });
      if (ins.error) return json({ error: ins.error.message }, 500);
      return json({ ok: true });
    }

    // ---- virtual folders ----
    if (A === "folder_create") {
      const p = await projOf(b.project_id); if (!p) return json({ error: "no access to this project" }, 403);
      if (!isMgr(p)) return json({ error: "only the producer, the General Manager or the owner can create folders" }, 403);
      const parent = b.parent ? String(b.parent) : null;
      if (parent && !(await me.from("media_folders").select("id").eq("id", parent).eq("project_id", p.id).maybeSingle()).data) return json({ error: "parent not available" }, 403);
      const row = { id: rid("mfd_"), project_id: p.id, parent, name: safe(b.name), access: { users: Array.isArray(b.users) ? b.users.map(String) : [] }, by: uid, ts: Date.now() };
      const ins = await adm.from("media_folders").insert(row);
      if (ins.error) return json({ error: ins.error.message }, 500);
      return json({ folder: row });
    }
    if (A === "folder_update" || A === "folder_delete") {
      const f = (await adm.from("media_folders").select("*").eq("id", String(b.id || "")).maybeSingle()).data;
      if (!f) return json({ ok: true });
      const p = await projOf(f.project_id);
      if (!p || !canEdit(f, p)) return json({ error: "only the producer, the General Manager or the owner can change folders" }, 403);
      if (A === "folder_update") {
        const patch: Record<string, unknown> = {};
        if (b.name != null) patch.name = safe(b.name);
        if (Array.isArray(b.users)) patch.access = { users: b.users.map(String) };
        if (b.parent !== undefined) {
          const np = b.parent ? String(b.parent) : null; let c = np; let k = 0;
          while (c && k++ < 40) { if (c === f.id) return json({ error: "a folder can’t go inside itself" }, 400); const x = (await adm.from("media_folders").select("parent,project_id").eq("id", c).maybeSingle()).data; if (!x || x.project_id !== f.project_id) return json({ error: "folder not available" }, 403); c = x.parent; }
          patch.parent = np;
        }
        await adm.from("media_folders").update(patch).eq("id", f.id);
      } else {
        await adm.from("media_files").update({ folder_id: f.parent }).eq("folder_id", f.id);
        await adm.from("media_folders").update({ parent: f.parent }).eq("parent", f.id);
        await adm.from("media_folders").delete().eq("id", f.id);
      }
      return json({ ok: true });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
