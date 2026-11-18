// @ts-nocheck
// SCENEDROME Hub · push notifications (Supabase Edge Function "hub-push")
// GET  ?key=1      → the public key phones use to subscribe (keys are created once and kept in the database)
// POST {id}        → called by the database when a notification is created; sends it to that person's phones
// Deploy with "Verify JWT" OFF. It only ever re-sends notifications that already exist, once each.
import { createClient } from 'npm:@supabase/supabase-js@2';
// Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) using only Web Crypto.
const te = new TextEncoder();
const b64u = (buf) => { const b = new Uint8Array(buf); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const ub64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const cat = (...a) => { const n = a.reduce((x, y) => x + y.length, 0); const o = new Uint8Array(n); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
async function hmac(key, data) { const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', k, data)); }

async function generateVapid() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { publicKey: b64u(pub), jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } };
}

async function vapidHeader(endpoint, vapid, subject) {
  const aud = new URL(endpoint).origin;
  const head = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', { ...vapid.jwk, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(head + '.' + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${vapid.publicKey}`;
}

async function encrypt(sub, payload) {
  const uaPub = ub64u(sub.keys.p256dh), auth = ub64u(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const prkKey = await hmac(auth, shared);
  const ikm = await hmac(prkKey, cat(te.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(te.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(te.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, cat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

async function sendPush(sub, payloadObj, vapid, subject) {
  const body = await encrypt(sub, te.encode(JSON.stringify(payloadObj)));
  const res = await fetch(sub.endpoint, { method: 'POST', body, headers: {
    'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high',
    Authorization: await vapidHeader(sub.endpoint, vapid, subject) } });
  return res;
}

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const SUBJECT = Deno.env.get('PUSH_CONTACT') || 'mailto:hub@scenedrome.com';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

async function vapid() {
  const { data } = await sb.from('push_config').select('data').eq('id', 'vapid').maybeSingle();
  if (data) return data.data;
  const k = await generateVapid();
  await sb.from('push_config').upsert({ id: 'vapid', data: k }, { onConflict: 'id', ignoreDuplicates: true });
  const { data: again } = await sb.from('push_config').select('data').eq('id', 'vapid').single();
  return again!.data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (req.method === 'GET') return json({ publicKey: (await vapid()).publicKey });
    const { id } = await req.json();
    if (!id) return json({ error: 'id required' }, 400);
    // claim the notification once, so it is never pushed twice
    const { data: n } = await sb.from('notifications').update({ pushed_at: new Date().toISOString() }).eq('id', id).is('pushed_at', null).select('id,to_user,data').maybeSingle();
    if (!n) return json({ skipped: true });
    const { data: subs } = await sb.from('push_subs').select('id,data').eq('user_id', n.to_user);
    if (!subs || !subs.length) return json({ sent: 0 });
    const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true }).eq('to_user', n.to_user).eq('data->>read', 'false');
    const brand = (await sb.from('settings').select('data').eq('id', 'brand').maybeSingle()).data?.data || {};
    const payload = { title: (brand.studio || 'SCENEDROME') + ' ' + (brand.hubName || 'Hub'), body: n.data?.text || 'You have a new update', link: n.data?.link || null, tag: n.id, badge: count || 1 };
    const keys = await vapid();
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        const r = await sendPush(s.data, payload, keys, SUBJECT);
        if (r.status === 404 || r.status === 410) await sb.from('push_subs').delete().eq('id', s.id);
        else if (r.ok) sent++;
        else console.warn('push', r.status, await r.text());
      } catch (e) { console.warn('push error', e); }
    }));
    return json({ sent });
  } catch (e) { console.error(e); return json({ error: String(e) }, 500); }
});
