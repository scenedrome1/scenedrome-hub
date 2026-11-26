-- Run AFTER the hub-public function is deployed and the new Hub is live.
-- Username sign-in now happens inside hub-public, so the email lookup is no longer open to anyone.
revoke execute on function public.login_email(text) from anon, authenticated, public;
