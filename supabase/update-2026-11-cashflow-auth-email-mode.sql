-- Allow the temporary email-only delivery mode (CASHFLOW_DELIVERY=email) used until
-- Meta approves the WhatsApp template. Touches only the Cash Flow auth table.
alter table public.cashflow_auth_challenges drop constraint if exists cashflow_auth_challenges_delivery_check;
alter table public.cashflow_auth_challenges add constraint cashflow_auth_challenges_delivery_check
  check (delivery in ('both', 'email'));
