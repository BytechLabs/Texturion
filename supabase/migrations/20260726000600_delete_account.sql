-- ===========================================================================
-- [#346] Deleting your own account — the one the app stores actually require.
--
-- Apple 5.1.1(v) obliges any app with account creation to offer in-app ACCOUNT
-- deletion, and Play's data-deletion requirement reads the same way. Every
-- deletion issue we had was about deleting a WORKSPACE, which most users
-- cannot do at all: SPEC §10 restricts that to the owner, and D12's crew is
-- 1–10 field staff who will never be one.
--
-- `delete from auth.users` cannot work either: 11 foreign keys point at that
-- row with `on delete restrict`, and they are exactly the records that must
-- survive — messages sent, tasks created, consent attested, opt-outs recorded,
-- audit entries, templates authored. A tech who leaves cannot take the record
-- of who texted a customer with them; that history belongs to the business,
-- and the consent part of it is under the CASL three-year floor.
--
-- So deletion SEVERS IDENTITY FROM THE RECORD rather than removing the record:
-- the personal data goes, the person can never sign in again, and what remains
-- in the business's history is an unnamed former member. Same shape as D48's
-- answer for workspaces, for the same reason.
-- ===========================================================================

-- The tombstone every attribution falls back to. One place, so the web, both
-- apps and any export all say the same thing about the same person.
comment on column public.profiles.display_name is
  '#346: set to '''' on account deletion — clients render a nameless profile as "A former member". The row itself survives because 11 restrict FKs point at the auth user through it.';

-- ---------------------------------------------------------------------------
-- [#346] Can this account be deleted, and what would it touch?
--
-- Separate from the deletion itself so the confirmation screen can say
-- precisely what will happen BEFORE anything does — including the one case
-- where the answer is "not yet".
--
-- Returns jsonb:
--   { "blocked_by": "owner", "owned": [{id,name}, …] }   -- must transfer/close first
--   { "blocked_by": null, "memberships": n, "conversations": n, "tasks": n }
-- ---------------------------------------------------------------------------
create or replace function public.account_deletion_preview(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owned jsonb;
  v_memberships int;
  v_conversations int := 0;
  v_tasks int := 0;
  v_row record;
  v_holdings jsonb;
begin
  -- An owner deleting their personal account would leave a workspace with no
  -- owner and no transfer path (#332). Say so specifically rather than failing
  -- generically — the customer needs to know WHICH workspaces and WHAT to do.
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name)), '[]'::jsonb)
    into v_owned
    from public.companies c
   where c.owner_user_id = p_user_id and c.deleted_at is null;

  if jsonb_array_length(v_owned) > 0 then
    return jsonb_build_object('blocked_by', 'owner', 'owned', v_owned);
  end if;

  select count(*) into v_memberships
    from public.company_members m
    join public.companies c on c.id = m.company_id
   where m.user_id = p_user_id and c.deleted_at is null;

  -- What they are still holding, across every workspace — the same count the
  -- offboarding flow shows, so the two never disagree.
  for v_row in
    select m.company_id from public.company_members m
      join public.companies c on c.id = m.company_id
     where m.user_id = p_user_id and c.deleted_at is null
  loop
    v_holdings := public.api_member_holdings(v_row.company_id, p_user_id);
    v_conversations := v_conversations + (v_holdings->>'conversations')::int;
    v_tasks := v_tasks + (v_holdings->>'tasks')::int;
  end loop;

  return jsonb_build_object(
    'blocked_by', null,
    'memberships', v_memberships,
    'conversations', v_conversations,
    'tasks', v_tasks
  );
end $$;

revoke execute on function public.account_deletion_preview(uuid)
  from public, anon, authenticated;
grant execute on function public.account_deletion_preview(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- [#346] Delete the account: strip the identity, keep the record.
--
-- Runs AFTER the caller has offboarded every membership (#276), because that
-- is where open work is handed on and sessions end. This is the identity half.
--
-- Removed: the display name, notification preferences, read state, push
-- registrations, device tokens, softphone credentials. Kept, deliberately, and
-- now attributed to a nameless former member: messages sent, notes written,
-- tasks created, calls answered, consent attested, opt-outs recorded, audit
-- entries, templates.
--
-- Returns jsonb: { "outcome": "deleted", "personal_rows": n }
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
  delete from public.member_telephony_credentials where user_id = p_user_id;
  get diagnostics v_count = row_count; v_removed := v_removed + v_count;

  -- Sessions last: nothing above needs one, and this is the point of no return
  -- for the person holding the app open.
  perform public.api_revoke_user_sessions(p_user_id);

  return jsonb_build_object('outcome', 'deleted', 'personal_rows', v_removed);
end $$;

revoke execute on function public.delete_account(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_account(uuid) to service_role;
