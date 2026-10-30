-- D142: deleting your account erases the push and ring evidence about you.
--
-- `push_attempts` and `ring_beacons` cascade from the member's
-- `company_members` row, which a workspace purge deletes. Account deletion does
-- not: it severs the person (offboard_member, then delete_account) and keeps
-- the membership row, because restrict FKs to the auth user hang off it. So
-- the cascade never fires for a deleted account, and fourteen days of
-- "which of this person's devices rang, and when" would outlive them.
--
-- Body copied from 20260812220000_deleting_an_account_stops_its_softphone_at_the_provider.sql
-- with one insertion, the two deletes marked D142, counted as personal rows
-- like the others.
--
-- Returns jsonb: { "outcome": "deleted", "personal_rows": n, "voice_credentials": [...] }
--                { "outcome": "owner" }   -- refused; transfer or close first

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
  -- D142: the evidence about this person's pushes and rings. The membership
  -- row it cascades from outlives the account, so it goes here.
  delete from public.push_attempts where user_id = p_user_id;
  get diagnostics v_count = row_count; v_removed := v_removed + v_count;
  delete from public.ring_beacons where user_id = p_user_id;
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

-- Recreating a function hands it back the default PUBLIC execute grant, which
-- anon and authenticated inherit. This one deletes a person's account.
revoke execute on function public.delete_account(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_account(uuid) to service_role;
