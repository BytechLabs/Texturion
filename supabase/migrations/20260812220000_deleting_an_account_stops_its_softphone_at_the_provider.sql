-- #581/C7 — deleting your account stops its softphone AT TELNYX, not just in our table.
--
-- `delete_account` deleted the member's telephony credential ROW and reported it as one
-- more "personal row removed". The credential itself lived on at Telnyx. It is durable
-- (no `expires_at`) and the login token minted from it stays valid, so a handset that
-- had already registered kept ringing and could ANSWER a customer as the business —
-- after the person had deleted their account. Nothing was left that could even find it:
-- the row holding the id was gone, so the orphan was unreachable by us and functional
-- for whoever held the phone.
--
-- #573 solved exactly this for the other three ways access ends, by returning the ids
-- from `api_revoke_sessions` so the caller could delete them at the provider. Account
-- deletion was the fourth path and it was not wired up: it deletes the rows itself,
-- BEFORE the session revoke it delegates to, so the sweep behind that revoke found
-- nothing left to report.
--
-- This makes the delete return what it deleted. The HTTP call belongs to the route
-- (`apps/api/src/routes/account.ts`), which hands the ids to the same
-- `releaseTelnyxCredentials` every other path now uses.
--
-- Body EXTRACTED from 20260726000600_delete_account.sql with three insertions, all
-- marked #581/C7, and diffed against the original with zero removed lines other than
-- the two the capture replaces.
--
-- Returns jsonb: { "outcome": "deleted", "personal_rows": n, "voice_credentials": [...] }
--                { "outcome": "owner" }   -- refused; transfer or close first
-- ---------------------------------------------------------------------------

create or replace function public.delete_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed int := 0;
  v_count int;
  -- #581/C7: the Telnyx ids of the credentials deleted below, handed back so the
  -- route can delete them at the provider. SQL cannot make an HTTP call.
  v_voice text[] := '{}';
begin
  if exists (
    select 1 from public.companies
     where owner_user_id = p_user_id and deleted_at is null
  ) then
    return jsonb_build_object('outcome', 'owner');
  end if;

  -- The tombstone. The row stays — 11 restrict FKs reach the auth user through
  -- it — but it no longer says who this was.
  update public.profiles set display_name = '', updated_at = now()
   where user_id = p_user_id;

  -- Personal data with no business meaning: preferences, read state, and the
  -- registrations that would otherwise keep a deleted person's phone buzzing.
  delete from public.notification_prefs where user_id = p_user_id;
  get diagnostics v_count = row_count; v_removed := v_removed + v_count;
  delete from public.notification_reads where user_id = p_user_id;
  get diagnostics v_count = row_count; v_removed := v_removed + v_count;
  delete from public.notification_read_items where user_id = p_user_id;
  get diagnostics v_count = row_count; v_removed := v_removed + v_count;
  delete from public.conversation_reads where user_id = p_user_id;
  get diagnostics v_count = row_count; v_removed := v_removed + v_count;
  delete from public.push_subscriptions where user_id = p_user_id;
  get diagnostics v_count = row_count; v_removed := v_removed + v_count;
  delete from public.device_push_tokens where user_id = p_user_id;
  get diagnostics v_count = row_count; v_removed := v_removed + v_count;
  -- #581/C7: the same delete, now returning what it deleted.
  --
  -- The row going is what stops us handing the credential to a NEW registration.
  -- It is not what stops a handset that has ALREADY registered: that credential
  -- still exists at Telnyx and the login token minted from it stays valid, so the
  -- phone of somebody who has just deleted their account went on ringing and could
  -- answer a customer as the business. Deleting it at Telnyx is the API's job, so
  -- the ids travel out in the return value rather than being reduced to a count.
  with gone as (
    delete from public.member_telephony_credentials
     where user_id = p_user_id
    returning telnyx_credential_id
  ) select coalesce(array_agg(telnyx_credential_id), '{}'), count(*)
      into v_voice, v_count from gone;
  v_removed := v_removed + v_count;

  -- Sessions last: nothing above needs one, and this is the point of no return
  -- for the person holding the app open.
  perform public.api_revoke_user_sessions(p_user_id);

  return jsonb_build_object(
    'outcome', 'deleted',
    'personal_rows', v_removed,
    -- #581/C7: the route deletes these at Telnyx and names any that survive.
    'voice_credentials', to_jsonb(v_voice)
  );
end $$;


-- Recreating a function hands it back the DEFAULT PUBLIC execute grant, which anon and
-- authenticated inherit. Re-revoked here rather than assumed: this one deletes a
-- person's account.
revoke execute on function public.delete_account(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_account(uuid) to service_role;
