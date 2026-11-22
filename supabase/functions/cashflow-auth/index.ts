// @ts-nocheck
// SCENEDROME Hub · Cash Flow double authentication.
// Deploy with Verify JWT ON. All password, OTP, WhatsApp and email operations stay server-side.
import { createClient } from 'npm:@supabase/supabase-js@2';

const enc = new TextEncoder();
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
});
const firstKey = (name: string) => {
  try { const value = JSON.parse(Deno.env.get(name) ?? '{}'); return value.default ?? Object.values(value)[0]; }
  catch { return undefined; }
};
const hex = (data: ArrayBuffer | Uint8Array) => [...new Uint8Array(data)].map(x => x.toString(16).padStart(2, '0')).join('');
const randomHex = (bytes = 32) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
const equal = (a = '', b = '') => {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
const plus = (ms: number) => new Date(Date.now() + ms).toISOString();

async function sha256(value: string) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
}
async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}
async function passwordHash(password: string, salt: string, iterations: number) {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, material, 256));
}

const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? firstKey('SUPABASE_SECRET_KEYS');
const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false } });
const authSecret = Deno.env.get('CASHFLOW_AUTH_SECRET') ?? '';
const waToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN') ?? '';
const waPhoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';
const waRecipient = (Deno.env.get('CASHFLOW_AUTH_RECIPIENT') ?? '').replace(/\D/g, '');
const waTemplate = Deno.env.get('WHATSAPP_TEMPLATE_NAME') ?? 'cashflow_access_code';
const waLanguage = Deno.env.get('WHATSAPP_TEMPLATE_LANGUAGE') ?? 'en_US';
const graphVersion = Deno.env.get('WHATSAPP_GRAPH_VERSION') ?? 'v27.0';
const resendKey = Deno.env.get('RESEND_API_KEY') ?? '';
const emailFrom = Deno.env.get('CASHFLOW_EMAIL_FROM') ?? 'SCENEDROME Hub <Contact@scenedrome.com>';

async function audit(userId: string | null, event: string, success: boolean, detail = {}) {
  await admin.from('cashflow_auth_audit').insert({ user_id: userId, event, success, detail });
}
async function recentCount(userId: string, events: string[], minutes: number) {
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  const { count } = await admin.from('cashflow_auth_audit').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).in('event', events).gte('created_at', since);
  return count ?? 0;
}
async function sendWhatsAppCode(code: string) {
  if (!waToken || !waPhoneId || !waRecipient) throw new Error('WhatsApp authentication is not configured');
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${waPhoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${waToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: waRecipient,
      type: 'template',
      template: {
        name: waTemplate,
        language: { code: waLanguage },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          // Meta represents the Authentication template's Copy Code control as a URL button at send time.
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error?.message || `WhatsApp error ${response.status}`);
  return result?.messages?.[0]?.id ?? null;
}
async function sendEmailCode(code: string, email: string) {
  if (!resendKey) throw new Error('Email authentication is not configured');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: emailFrom,
      to: [email],
      subject: `${code} is your SCENEDROME Cash Flow code`,
      html: `<div style="background:#03100c;color:#eef3ef;padding:32px;font-family:Arial,sans-serif"><div style="max-width:520px;margin:auto;background:#081c17;border:1px solid #5a4520;border-radius:16px;padding:28px"><p style="color:#f0c46a;font-size:12px;letter-spacing:2px;text-transform:uppercase">SCENEDROME Cash Flow</p><h1 style="font-size:34px;letter-spacing:8px;margin:22px 0">${code}</h1><p style="line-height:1.6;color:#c6d4cf">Enter this code to continue. It expires in five minutes and can be used only once.</p><p style="font-size:12px;color:#82958e;margin-top:28px">If you did not request this code, do not share it and review your Hub account security.</p></div></div>`,
      text: `${code} is your SCENEDROME Cash Flow verification code. It expires in five minutes and can be used only once.`,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.message || `Email error ${response.status}`);
  return result?.id ?? null;
}
function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  if (!name || !domain) return 'your Hub email';
  const visible = name.length <= 2 ? name[0] : name.slice(0, 2);
  return `${visible}${'•'.repeat(Math.max(3, Math.min(8, name.length - visible.length)))}@${domain}`;
}
function code6() {
  // Rejection sampling avoids modulo bias while retaining a cryptographic source.
  const ceiling = 4294000000;
  let value = 4294967295;
  while (value >= ceiling) value = crypto.getRandomValues(new Uint32Array(1))[0];
  return String(value % 1000000).padStart(6, '0');
}
async function createChallenge(userId: string, purpose: 'login' | 'reset', email?: string) {
  const code = code6();
  const id = crypto.randomUUID();
  const codeHash = await hmac(authSecret, `${id}:${code}`);
  const expiresAt = plus(5 * 60000);
  const { error } = await admin.from('cashflow_auth_challenges').insert({
    id, user_id: userId, purpose, delivery: 'both', code_hash: codeHash, expires_at: expiresAt,
  });
  if (error) throw error;
  try {
    if (!email) throw new Error('The signed-in owner does not have an email address');
    const [whatsApp, emailResult] = await Promise.allSettled([
      sendWhatsAppCode(code), sendEmailCode(code, email),
    ]);
    const failed = [];
    if (whatsApp.status === 'rejected') failed.push(`WhatsApp: ${String(whatsApp.reason?.message ?? whatsApp.reason)}`);
    if (emailResult.status === 'rejected') failed.push(`Email: ${String(emailResult.reason?.message ?? emailResult.reason)}`);
    if (failed.length) throw new Error(`Code delivery failed — ${failed.join(' · ')}`);
    await audit(userId, 'otp_sent', true, {
      purpose, delivery: 'both', whatsapp_message_id: whatsApp.value, email_message_id: emailResult.value,
    });
  } catch (error) {
    await admin.from('cashflow_auth_challenges').delete().eq('id', id);
    await audit(userId, 'otp_send_failed', false, { purpose, delivery: 'both', error: String(error) });
    throw error;
  }
  return {
    challengeId: id, expiresAt, resendAfter: plus(60000), delivery: 'both',
    maskedRecipient: `WhatsApp •••• 7191 and ${maskEmail(email!)}`,
  };
}
async function getSession(userId: string, raw: string, purpose: string) {
  if (!raw) return null;
  const tokenHash = await sha256(raw);
  const { data } = await admin.from('cashflow_auth_sessions').select('*')
    .eq('user_id', userId).eq('purpose', purpose).eq('token_hash', tokenHash)
    .is('revoked_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
  return data;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    if (!serviceKey || !authSecret) return json({ error: 'Cash Flow authentication is not configured' }, 503);
    const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await admin.auth.getUser(bearer);
    if (!user) return json({ error: 'Not signed in' }, 401);
    const { data: profile } = await admin.from('profiles').select('role,access,suspended').eq('id', user.id).maybeSingle();
    const permitted = profile && !profile.suspended && (profile.role === 'owner' || profile.access?.['fin.cashflow'] === true);
    if (!permitted) return json({ error: 'Cash Flow access is not allowed for this account' }, 403);

    const body = await req.json();
    const action = String(body?.action ?? '');
    // Both channels include the signed-in owner's email, so Cash Flow opening is owner-only.
    if (profile.role !== 'owner') return json({ error: 'Cash Flow verification is available only to the signed-in owner.' }, 403);

    if (action === 'start_login') {
      if (await recentCount(user.id, ['password_failed'], 15) >= 5) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
      if (await recentCount(user.id, ['otp_sent'], 10) >= 4) return json({ error: 'Too many codes requested. Try again later.' }, 429);
      const password = String(body.password ?? '');
      const { data: config, error } = await admin.from('cashflow_auth_config').select('*').eq('id', 'primary').single();
      if (error || !config) throw error ?? new Error('Password is not configured');
      const candidate = await passwordHash(password, config.password_salt, config.password_iterations);
      if (!equal(candidate, config.password_hash)) {
        await audit(user.id, 'password_failed', false);
        return json({ error: 'That Cash Flow password is not correct.' }, 401);
      }
      await audit(user.id, 'password_verified', true);
      return json(await createChallenge(user.id, 'login', user.email));
    }

    if (action === 'start_reset') {
      if (profile.role !== 'owner') return json({ error: 'Only an owner can change the Cash Flow password.' }, 403);
      if (await recentCount(user.id, ['otp_sent'], 10) >= 4) return json({ error: 'Too many codes requested. Try again later.' }, 429);
      await audit(user.id, 'password_reset_requested', true);
      return json(await createChallenge(user.id, 'reset', user.email));
    }

    if (action === 'resend') {
      const { data: challenge } = await admin.from('cashflow_auth_challenges').select('*')
        .eq('id', body.challengeId).eq('user_id', user.id).is('consumed_at', null).maybeSingle();
      if (!challenge || new Date(challenge.expires_at).getTime() <= Date.now()) return json({ error: 'This code has expired. Start again.' }, 410);
      if (Date.now() - new Date(challenge.last_sent_at).getTime() < 60000) return json({ error: 'Please wait before requesting another code.' }, 429);
      if (await recentCount(user.id, ['otp_sent'], 10) >= 4) return json({ error: 'Too many codes requested. Try again later.' }, 429);
      // Create/send the replacement first; the previous code stays valid if delivery fails.
      const next = await createChallenge(user.id, challenge.purpose, user.email);
      await admin.from('cashflow_auth_challenges').update({ consumed_at: new Date().toISOString() }).eq('id', challenge.id).is('consumed_at', null);
      return json(next);
    }

    if (action === 'verify') {
      const code = String(body.code ?? '').replace(/\D/g, '');
      if (!/^\d{6}$/.test(code)) return json({ error: 'Enter the six-digit code.' }, 400);
      const { data: challenge } = await admin.from('cashflow_auth_challenges').select('*')
        .eq('id', body.challengeId).eq('user_id', user.id).is('consumed_at', null).maybeSingle();
      if (!challenge || new Date(challenge.expires_at).getTime() <= Date.now()) return json({ error: 'This code has expired. Start again.' }, 410);
      if (challenge.attempts >= 5) return json({ error: 'Too many incorrect codes. Start again.' }, 429);
      const candidate = await hmac(authSecret, `${challenge.id}:${code}`);
      if (!equal(candidate, challenge.code_hash)) {
        await admin.from('cashflow_auth_challenges').update({ attempts: challenge.attempts + 1 }).eq('id', challenge.id).is('consumed_at', null);
        await audit(user.id, 'otp_failed', false, { purpose: challenge.purpose });
        return json({ error: 'That code is not correct.' }, 401);
      }
      const now = new Date().toISOString();
      const { data: consumed } = await admin.from('cashflow_auth_challenges').update({ consumed_at: now })
        .eq('id', challenge.id).is('consumed_at', null).select('id').maybeSingle();
      if (!consumed) return json({ error: 'This code has already been used.' }, 409);
      const token = randomHex(32);
      const purpose = challenge.purpose === 'reset' ? 'password_reset' : 'cashflow';
      const expiresAt = plus(challenge.purpose === 'reset' ? 10 * 60000 : 8 * 3600000);
      await admin.from('cashflow_auth_sessions').insert({ user_id: user.id, purpose, token_hash: await sha256(token), expires_at: expiresAt });
      await audit(user.id, 'otp_verified', true, { purpose: challenge.purpose });
      return json({ token, purpose, expiresAt });
    }

    if (action === 'set_password') {
      if (profile.role !== 'owner') return json({ error: 'Only an owner can change the Cash Flow password.' }, 403);
      const password = String(body.password ?? '');
      if (password.length < 10) return json({ error: 'Use at least 10 characters.' }, 400);
      if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return json({ error: 'Use letters and numbers in the password.' }, 400);
      const session = await getSession(user.id, String(body.token ?? ''), 'password_reset');
      if (!session) return json({ error: 'Password change approval has expired. Start again.' }, 401);
      const salt = randomHex(16), iterations = 310000;
      const hash = await passwordHash(password, salt, iterations);
      const now = new Date().toISOString();
      const { error } = await admin.from('cashflow_auth_config').update({
        password_salt: salt, password_hash: hash, password_iterations: iterations,
        password_changed_at: now, updated_at: now,
      }).eq('id', 'primary');
      if (error) throw error;
      // The Cash Flow password is shared, so changing it closes every existing Cash Flow approval.
      await admin.from('cashflow_auth_sessions').update({ revoked_at: now }).is('revoked_at', null);
      await audit(user.id, 'password_changed', true);
      return json({ ok: true });
    }

    if (action === 'logout') {
      const tokenHash = await sha256(String(body.token ?? ''));
      await admin.from('cashflow_auth_sessions').update({ revoked_at: new Date().toISOString() })
        .eq('user_id', user.id).eq('purpose', 'cashflow').eq('token_hash', tokenHash).is('revoked_at', null);
      await audit(user.id, 'cashflow_closed', true);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: String(error?.message ?? error) }, 500);
  }
});
