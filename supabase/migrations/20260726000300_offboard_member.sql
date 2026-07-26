-- ===========================================================================
-- [#276] Offboarding: deactivation hid the person, not their work.
--
-- `deactivated_at` was well-plumbed as a READ filter — every "who should see
-- or receive this" query excludes a deactivated member. Nothing ever asked
-- what they were HOLDING. So after someone quit, their assigned conversations
-- pointed at a person who would never open the app again and their open tasks
-- were owned by nobody, and neither fact surfaced anywhere. The work did not
-- fail loudly; it just stopped, and the first sign was a customer asking why
-- nobody called back.
--
-- Two functions:
--   api_member_holdings   — what this person is holding, for the flow that
--                           asks the owner where it should go.
--   offboard_member       — deactivate AND move the work, in ONE transaction.
--                           A crash between the two halves is exactly how the
--                           orphans got there in the first place.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- [#276] What a member is holding right now: open (not closed) conversations
-- assigned to them, and live tasks whose source message is not yet done.
--
-- Also answers the migration question — "show me work assigned to people who
-- already left" — because it takes any user id, deactivated or not.
-- ---------------------------------------------------------------------------
create or replace function public.api_member_holdings(
  p_company_id uuid,
  p_user_id    uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'conversations', (
      select count(*) from public.conversations c
       where c.company_id = p_company_id
         and c.assigned_user_id = p_user_id
         and c.closed_at is null
    ),
    'tasks', (
      select count(*) from public.tasks t
        join public.messages m on m.id = t.message_id
       where t.company_id = p_company_id
         and t.assigned_user_id = p_user_id
         and t.deleted_at is null
         and m.done_at is null
    )
  );
$$;

revoke execute on function public.api_member_holdings(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_member_holdings(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- [#276] Deactivate a member and hand their work on, atomically.
--
-- p_reassign_to NULL releases the work to unassigned, which is a legitimate
-- choice — the crew picks it up from the shared inbox. What is not legitimate
-- is leaving it pointing at someone who is gone, which is what happened
-- before. Either way the work ends up somewhere a person will look.
--
-- Only OPEN work moves. A closed conversation and a finished task are history,
-- and history keeps its attribution (#191): rewriting who handled a customer
-- last year to make a leaver disappear would be falsifying the record.
--
-- Returns jsonb:
--   { "outcome": "deactivated", "conversations": n, "tasks": n }
--   { "outcome": "not_found" }        -- no such member in this company
--   { "outcome": "owner" }            -- the owner row is immutable (SPEC §10)
--   { "outcome": "already" , ... }    -- already deactivated; work still moved
--   { "outcome": "bad_destination" }  -- destination is not an active member
-- ---------------------------------------------------------------------------
create or replace function public.offboard_member(
  p_company_id  uuid,
  p_member_id   uuid,
  p_reassign_to uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_role    text;
  v_deactivated timestamptz;
  v_conversations int := 0;
  v_tasks int := 0;
begin
  select m.user_id, m.role::text, m.deactivated_at
    into v_user_id, v_role, v_deactivated
    from public.company_members m
   where m.company_id = p_company_id and m.id = p_member_id
   for update;

  if v_user_id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_role = 'owner' then
    return jsonb_build_object('outcome', 'owner');
  end if;

  -- A destination must be someone who will actually see the work: an ACTIVE
  -- member of this company, and not the person being removed.
  if p_reassign_to is not null then
    if p_reassign_to = v_user_id then
      return jsonb_build_object('outcome', 'bad_destination');
    end if;
    if not exists (
      select 1 from public.company_members m
       where m.company_id = p_company_id
         and m.user_id = p_reassign_to
         and m.deactivated_at is null
    ) then
      return jsonb_build_object('outcome', 'bad_destination');
    end if;
  end if;

  if v_deactivated is null then
    update public.company_members
       set deactivated_at = now()
     where company_id = p_company_id and id = p_member_id;
  end if;

  -- Open conversations. `closed_at is null` is the same "still live" test the
  -- inbox uses, so what moves is exactly what someone would still be working.
  update public.conversations
     set assigned_user_id = p_reassign_to
   where company_id = p_company_id
     and assigned_user_id = v_user_id
     and closed_at is null;
  get diagnostics v_conversations = row_count;

  -- Open tasks. Completion derives from the source message's done_at (D17),
  -- so a finished task is left exactly as it was.
  update public.tasks t
     set assigned_user_id = p_reassign_to,
         updated_at = now()
   where t.company_id = p_company_id
     and t.assigned_user_id = v_user_id
     and t.deleted_at is null
     and exists (
       select 1 from public.messages m
        where m.id = t.message_id and m.done_at is null
     );
  get diagnostics v_tasks = row_count;

  return jsonb_build_object(
    'outcome', case when v_deactivated is null then 'deactivated' else 'already' end,
    'user_id', v_user_id,
    'conversations', v_conversations,
    'tasks', v_tasks
  );
end $$;

revoke execute on function public.offboard_member(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.offboard_member(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- [#276/#236] End a person's sessions.
--
-- Removing someone from a workspace has to mean their access is over, not that
-- they are hidden from lists. Every read path already excludes a deactivated
-- member, so their token resolves to nothing for THIS workspace — but the
-- session itself lived on, and with it push delivery and a warm app on their
-- phone.
--
-- Deleting the GoTrue session rows is what "sign out everywhere" does: the
-- refresh token has nothing to refresh against, so access ends when the
-- current access token expires (an hour at most) and cannot be renewed. There
-- is no admin endpoint for this — GoTrue's own global sign-out needs the
-- user's JWT, which we do not have and should not want.
--
-- NOTE this is per PERSON, not per workspace: someone in two workspaces is
-- signed out of both. That is the honest trade — a session is not scoped to a
-- company, and the alternative is pretending we ended access when we did not.
-- Returns the number of sessions removed.
-- ---------------------------------------------------------------------------
create or replace function public.api_revoke_user_sessions(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted int;
begin
  if p_user_id is null then
    raise exception 'api_revoke_user_sessions: p_user_id is required';
  end if;
  -- refresh_tokens cascade from sessions in GoTrue's schema; delete them
  -- explicitly too, since older rows can predate the session FK.
  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke execute on function public.api_revoke_user_sessions(uuid)
  from public, anon, authenticated;
grant execute on function public.api_revoke_user_sessions(uuid) to service_role;
