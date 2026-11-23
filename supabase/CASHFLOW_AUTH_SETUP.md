# Cash Flow WhatsApp and email authentication setup

Do not deploy the frontend gate until Meta has approved the Authentication template.

1. Run `update-2026-11-cashflow-auth.sql` in the Supabase SQL editor.
2. Deploy `supabase/functions/cashflow-auth` with JWT verification enabled.
3. Add these Supabase Edge Function secrets:
   - `WHATSAPP_ACCESS_TOKEN` — permanent system-user token, never a temporary dashboard token
   - `WHATSAPP_PHONE_NUMBER_ID=1392002084006992`
   - `WHATSAPP_TEMPLATE_NAME=cashflow_access_code`
   - `WHATSAPP_TEMPLATE_LANGUAGE=en_US`
   - `CASHFLOW_AUTH_RECIPIENT=201111167191`
   - `CASHFLOW_AUTH_SECRET` — at least 32 random bytes, used to hash OTPs
   - `WHATSAPP_GRAPH_VERSION=v27.0`
   - `RESEND_API_KEY` — send-only API key for Cash Flow security email
   - `CASHFLOW_EMAIL_FROM=SCENEDROME Hub <Contact@scenedrome.com>` — sender on the verified `scenedrome.com` email domain
4. Verify a real password sends the same code to WhatsApp and owner email simultaneously, then open → close → reopen.
5. Verify **Forgot Password?** sends the recovery code to both channels, accepts a new password, and rejects the old password.

The migration preserves the existing Cash Flow password hash. No plaintext password or OTP is stored.
