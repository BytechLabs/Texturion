-- Settings, Account tells the truth about whether you have a password.
--
-- Founder report: an account created with Google, then given a password in
-- Settings, still listed "Password: Not linked" — and was offered "Set a
-- password" as though it had none.
--
-- Cause: the screen inferred the password from `user.identities`, looking for
-- an identity with provider 'email'. Supabase only creates that identity when
-- the account SIGNED UP with email and password. `updateUser({ password })` on
-- an OAuth account sets a real password and creates no identity, so the array
-- keeps saying google-only forever. Confirmed against production: two accounts
-- have a stored password while their identities list only 'google'.
--
-- The identities array remains correct for Google and Apple — those really are
-- linked identities. Only the password row needed a different source, and the
-- only authoritative one is auth.users itself, which no client can read.
--
-- SECURITY: returns a single boolean for one user id, nothing else. Same
-- posture as every api_* function — SECURITY DEFINER with an empty
-- search_path, EXECUTE revoked from end-user roles, granted to service_role
-- only, so it is reachable exclusively through the Worker's authenticated
-- GET /v1/me (which passes the JWT-verified caller's own id and never a
-- caller-supplied one).

create or replace function public.api_user_has_password(
  p_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = p_user_id
      and u.encrypted_password is not null
      and u.encrypted_password <> ''
  )
$$;

revoke execute on function public.api_user_has_password(uuid)
  from public, anon, authenticated;
grant execute on function public.api_user_has_password(uuid)
  to service_role;
