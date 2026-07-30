-- #275 — act on every conversation matching a filter, in one operation.
--
-- Every operation in the product was one row at a time. Invisible at ten
-- conversations, brutal at a thousand, which is where a real customer lives
-- after six months: a week off means hundreds of threads that need archiving
-- rather than reading, and a robotext blast means twenty junk threads marked
-- individually.
--
-- ONE FUNCTION FOR EVERY ACTION, and that is the load-bearing decision. The
-- actions write to three different places — `conversations` columns,
-- `conversation_reads` (per-user), and `conversation_tags` (a join table) — so
-- the obvious shape is one RPC per action. It is the wrong shape. Four things
-- have to be identical across all of them, and each is a security or honesty
-- property that a fifth action, added later by someone in a hurry, would get
-- wrong:
--
--   1. #106 ACCESS FILTERING. A bulk action must never touch a conversation on a
--      number the actor cannot see, and select-all must not silently include
--      invisible rows. Here it is one predicate, applied once, before any write.
--   2. THE CAP. An unbounded bulk write is an unbounded transaction and an
--      unbounded undo payload.
--   3. HONEST PARTIAL RESULTS. The caller gets back the ids that changed and the
--      ids that did not, with a reason. A green toast over twelve silent
--      failures is the exact thing #275 says must not happen.
--   4. PRIOR VALUES FOR UNDO. docs/UNDO-AUDIT.md §4 requires a bulk undo to
--      revert EXACTLY the rows the operation touched, from a list captured
--      before it ran — never "reopen everything closed in the last minute",
--      which would also revert a teammate's concurrent work. That list can only
--      be captured here, inside the transaction that does the writing.
--
-- THERE IS NO SEND ACTION AND THERE NEVER WILL BE. Multi-select plus a compose
-- box is a mass-texting tool, which is a product this company has deliberately
-- not built: it is the fastest route to carrier filtering, CASL exposure, and
-- the destruction of the number reputation the whole business rests on. The
-- action list is an enum checked in SQL, so a bulk send is not something a client
-- can ask for by passing a different string — it is a validation_failed from the
-- database.
--
-- THE FILTER AND THE TARGET ARE SEPARATE PARAMETERS, always. `p_is_spam` selects
-- rows by their spam state and `p_target_spam` sets it; folding them into one
-- would make the most common request — "mark these NOT-spam threads AS spam" —
-- impossible to express, and would have been discovered by a user rather than by
-- a test.

-- How many rows one bulk call may touch. Chosen against the issue's own worked
-- example ("all 340 archived-and-untagged"), with room above it: a week away from
-- a busy line is hundreds of threads, not tens of thousands. Past this the caller
-- is told how many matched and how many were done, so "run it again" is an
-- informed choice rather than a silent truncation.
create or replace function public.api_bulk_conversation_cap()
returns int language sql immutable as $$ select 500 $$;

-- Service-role only like every other api_* function. It returns a constant and
-- leaks nothing, but the posture rule is the rule — `api_functions.test.sql` F5
-- enumerates every api_* function and fails on any that anon or authenticated can
-- execute, which is how this omission was caught rather than shipped.
revoke execute on function public.api_bulk_conversation_cap()
  from public, anon, authenticated;
grant execute on function public.api_bulk_conversation_cap()
  to service_role;

comment on function public.api_bulk_conversation_cap is
  'Max conversations one api_bulk_conversations call may touch (#275). A function rather than a literal so the Worker and the SQL suite read the same number.';

-- Ids the caller named that the selection did not reach: another tenant's, or
-- on a number the actor cannot see (#106). Reported rather than
-- dropped — #275 requires that a partial failure be named specifically.
--
-- Deliberately does NOT distinguish "hidden from you" from "does not exist": a
-- restricted member who could tell those apart would learn that a conversation
-- exists on a number they were denied, which is the thing the deny list is for.
create or replace function public.api_bulk_unreached(
  p_requested uuid[],
  p_selected  uuid[]
) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('id', r.id, 'reason', 'not_found')),
    '[]'::jsonb
  )
  from unnest(coalesce(p_requested, '{}'::uuid[])) as r(id)
  where not (r.id = any(coalesce(p_selected, '{}'::uuid[])))
$$;

revoke execute on function public.api_bulk_unreached(uuid[], uuid[])
  from public, anon, authenticated;
grant execute on function public.api_bulk_unreached(uuid[], uuid[])
  to service_role;

-- Apply one action to every conversation the actor may see that matches either an
-- explicit id list or the list filter.
--
-- Returns { action, matched, applied: [{id, previous}], failed: [{id, reason}],
--           capped }. `previous` carries only the field the action changed —
-- what an undo needs and the least that can be stored.
create or replace function public.api_bulk_conversations(
  p_company_id        uuid,
  p_user_id           uuid,
  p_action            text,
  -- Explicit selection. NULL means "use the filter" (select-all-matching).
  p_ids               uuid[]      default null,
  -- The list filter: same names and semantics as api_list_conversations, so
  -- "everything I am looking at" cannot mean something different here.
  p_status            text        default null,
  p_assigned_user_id  uuid        default null,
  p_tag_id            uuid        default null,
  p_is_spam           boolean     default false,
  p_unread            boolean     default false,
  p_q                 text        default null,
  -- Action targets, never reusing a filter parameter.
  p_target_user_id    uuid        default null,
  p_target_tag_id     uuid        default null,
  p_target_status     text        default null,
  p_target_spam       boolean     default null,
  p_hidden_number_ids uuid[]      default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap      int := public.api_bulk_conversation_cap();
  v_matched  int  := 0;
  v_selected uuid[];
  v_applied  jsonb := '[]'::jsonb;
  v_now      timestamptz := now();
begin
  if p_action is null or p_action not in (
    'mark_read', 'set_status', 'assign', 'set_spam', 'add_tag', 'remove_tag'
  ) then
    return jsonb_build_object('error', 'validation_failed');
  end if;

  -- Argument coherence BEFORE anything is selected. An assign with no target
  -- would unassign every matching conversation, and a set_status with no target
  -- would write null — both are plausible client bugs with a large blast radius,
  -- so they fail rather than proceed.
  if p_action = 'set_status'
     and (p_target_status is null
          or p_target_status not in ('new', 'open', 'waiting', 'closed')) then
    return jsonb_build_object('error', 'validation_failed');
  end if;
  if p_action in ('add_tag', 'remove_tag') and p_target_tag_id is null then
    return jsonb_build_object('error', 'validation_failed');
  end if;
  if p_action = 'set_spam' and p_target_spam is null then
    return jsonb_build_object('error', 'validation_failed');
  end if;
  -- `assign` with a null target is legitimate: it means unassign. But it must be
  -- said deliberately, so an explicit selection is required for it — an
  -- unassign-everything-matching-the-filter is not something a UI should be able
  -- to fire by omitting a field.
  if p_action = 'assign' and p_target_user_id is null and p_ids is null then
    return jsonb_build_object('error', 'validation_failed');
  end if;

  -- Resolve the selection ONCE, so the access predicate cannot be skipped for one
  -- action. An explicit id list is INTERSECTED with what the actor may see rather
  -- than trusted: an id for a hidden number comes back as failed, not applied.
  select count(*)::int,
         (array_agg(v.id order by v.last_message_at desc nulls last, v.id))[1:v_cap]
    into v_matched, v_selected
    from (
      select c.id, c.last_message_at
      from public.conversations c
      join public.contacts ct on ct.id = c.contact_id
      -- Conversations are not soft-deleted (no deleted_at column) — closing is
      -- the archive, and a closed row is still a row a bulk action may touch.
      where c.company_id = p_company_id
        -- conversations.phone_number_id is NOT NULL, so there is no
        -- "unassigned number" case to let through here — unlike calls, where the
        -- column is nullable and the deny-list check has to allow for it.
        and (
          p_hidden_number_ids is null
          or not (c.phone_number_id = any(p_hidden_number_ids))
        )
        and (p_ids is null or c.id = any(p_ids))
        and (
          -- Filter mode only. With an explicit id list the filter is ignored:
          -- the user pointed at specific rows.
          p_ids is not null
          or (
            (p_status is null or c.status = p_status::public.conversation_status)
            and (p_assigned_user_id is null
                 or c.assigned_user_id = p_assigned_user_id)
            and (coalesce(p_is_spam, false) = coalesce(c.is_spam, false))
            and (
              p_tag_id is null
              or exists (
                select 1 from public.conversation_tags cg
                where cg.conversation_id = c.id and cg.tag_id = p_tag_id
              )
            )
            and (
              not coalesce(p_unread, false)
              or not exists (
                select 1 from public.conversation_reads r
                where r.conversation_id = c.id
                  and r.user_id = p_user_id
                  and r.last_read_at >= c.last_message_at
              )
            )
            and (
              p_q is null
              or ct.name ilike ('%' || p_q || '%')
              or ct.phone_e164 ilike ('%' || p_q || '%')
            )
          )
        )
    ) v;

  v_selected := coalesce(v_selected, '{}'::uuid[]);

  if array_length(v_selected, 1) is null then
    return jsonb_build_object(
      'action', p_action,
      'matched', 0,
      'applied', '[]'::jsonb,
      'failed', public.api_bulk_unreached(p_ids, '{}'::uuid[]),
      'capped', false
    );
  end if;

  -- Apply. Each branch captures the prior value of exactly the field it changes,
  -- BEFORE writing it.
  if p_action = 'mark_read' then
    -- Per-user, so this writes conversation_reads rather than the conversation.
    -- `previous` is empty: the prior state is "unread", which the absence of a
    -- row already expresses, and un-reading a thread in bulk is not a thing
    -- anybody asks for. greatest() keeps a newer read from being walked back.
    insert into public.conversation_reads (conversation_id, user_id, last_read_at)
    select sel.id, p_user_id, v_now from unnest(v_selected) as sel(id)
    on conflict (conversation_id, user_id) do update
      set last_read_at = greatest(
            public.conversation_reads.last_read_at, excluded.last_read_at);

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', sel.id, 'previous', '{}'::jsonb)), '[]'::jsonb)
      into v_applied from unnest(v_selected) as sel(id);

  elsif p_action = 'set_status' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id,
             'previous', jsonb_build_object('status', c.status::text))), '[]'::jsonb)
      into v_applied
      from public.conversations c
      join unnest(v_selected) as sel(id) on sel.id = c.id;

    update public.conversations c
       set status = p_target_status::public.conversation_status,
           updated_at = v_now,
           -- conversations_closed_consistency: status and closed_at move
           -- together, so a bulk close has to stamp it and a bulk reopen has to
           -- clear it. Getting this wrong is a constraint violation that rolls
           -- back the whole batch, which is at least loud.
           closed_at = case when p_target_status = 'closed'
                            then coalesce(c.closed_at, v_now) else null end
      from unnest(v_selected) as sel(id)
     where c.id = sel.id
       and c.status is distinct from p_target_status::public.conversation_status;

  elsif p_action = 'assign' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id,
             'previous', jsonb_build_object(
               'assigned_user_id', c.assigned_user_id))), '[]'::jsonb)
      into v_applied
      from public.conversations c
      join unnest(v_selected) as sel(id) on sel.id = c.id;

    update public.conversations c
       set assigned_user_id = p_target_user_id, updated_at = v_now
      from unnest(v_selected) as sel(id)
     where c.id = sel.id
       and c.assigned_user_id is distinct from p_target_user_id;

  elsif p_action = 'set_spam' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id,
             'previous', jsonb_build_object('is_spam', coalesce(c.is_spam, false))
           )), '[]'::jsonb)
      into v_applied
      from public.conversations c
      join unnest(v_selected) as sel(id) on sel.id = c.id;

    update public.conversations c
       set is_spam = p_target_spam, updated_at = v_now
      from unnest(v_selected) as sel(id)
     where c.id = sel.id
       and coalesce(c.is_spam, false) is distinct from p_target_spam;

  elsif p_action = 'add_tag' then
    -- `previous.had_tag` records whether the tag was ALREADY on the row, so an
    -- undo removes only the ones this operation actually added.
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', sel.id,
             'previous', jsonb_build_object('had_tag', exists (
               select 1 from public.conversation_tags cg
               where cg.conversation_id = sel.id
                 and cg.tag_id = p_target_tag_id
             )))), '[]'::jsonb)
      into v_applied
      from unnest(v_selected) as sel(id);

    insert into public.conversation_tags (conversation_id, tag_id)
    select sel.id, p_target_tag_id from unnest(v_selected) as sel(id)
    on conflict do nothing;

  elsif p_action = 'remove_tag' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', sel.id,
             'previous', jsonb_build_object('had_tag', exists (
               select 1 from public.conversation_tags cg
               where cg.conversation_id = sel.id
                 and cg.tag_id = p_target_tag_id
             )))), '[]'::jsonb)
      into v_applied
      from unnest(v_selected) as sel(id);

    delete from public.conversation_tags cg
     where cg.tag_id = p_target_tag_id
       and cg.conversation_id = any(v_selected);
  end if;

  return jsonb_build_object(
    'action', p_action,
    'matched', v_matched,
    'applied', v_applied,
    'failed', public.api_bulk_unreached(p_ids, v_selected),
    'capped', v_matched > v_cap
  );
end $$;

revoke execute on function public.api_bulk_conversations(
  uuid, uuid, text, uuid[], text, uuid, uuid, boolean, boolean, text,
  uuid, uuid, text, boolean, uuid[]
) from public, anon, authenticated;
grant execute on function public.api_bulk_conversations(
  uuid, uuid, text, uuid[], text, uuid, uuid, boolean, boolean, text,
  uuid, uuid, text, boolean, uuid[]
) to service_role;

comment on function public.api_bulk_conversations is
  'Apply one action (mark_read | set_status | assign | set_spam | add_tag | remove_tag) to every conversation the actor may see matching an id list or the list filter (#275). Enforces the #106 deny list once for every action, caps at api_bulk_conversation_cap(), returns prior values so a bulk undo reverts exactly the rows it touched, and names ids it could not reach instead of dropping them. There is deliberately no send action: bulk management only, never bulk messaging.';
