-- #572 / #545 — a bulk conversation action cannot borrow another workspace's ids.
--
-- `api_bulk_conversations` validated `p_target_tag_id` and `p_target_user_id` for
-- PRESENCE and never for belonging. The route's Zod schema checks uuid shape only
-- and forwards them raw, so two writes were reachable across the tenancy line:
--
--   * `add_tag` / `remove_tag` with another workspace's tag id, which attaches that
--     tag to the caller's own conversations and moves the OTHER workspace's tag
--     counts — and its pipeline win rate, since #354 derives the pipeline from tags.
--   * `assign` to somebody who is not a member, including a deactivated ex
--     teammate whose real user id is visible in timeline `assigned` events.
--
-- ## Why this is a gap rather than a decision
--
-- Two of the three sibling paths already refuse both. `api_bulk_tasks`
-- (20260731180000_bulk_tasks.sql:151-164) checks membership and returns
-- `not_member` for the whole call, with its reasoning written down. The single-row
-- assign refuses too. An asymmetry among three implementations of one rule is a
-- gap by definition.
--
-- ## How this file was produced, because it matters
--
-- The body below is the CURRENT definition extracted verbatim from
-- 20260730004500_bulk_conversations.sql, with exactly two blocks inserted (both
-- marked #572) among the existing argument-coherence guards. It is diffed against
-- the original in CI-adjacent tooling and by hand: zero removed lines.
--
-- I first tried to retype it and the diff caught two silent changes — a hardcoded
-- 500 where the real body calls `api_bulk_conversation_cap()`, and a return shape
-- missing `action`, `failed` and `capped`, all three of which the route reads.
-- That is the whole reason for the rule about never retyping a SQL function.
--
-- `create or replace` preserves the existing ACL, so the revoke/grant pair from the
-- original is deliberately NOT restated. If this ever becomes a drop-and-recreate
-- it must come back: a fresh function is granted EXECUTE to PUBLIC, which anon and
-- authenticated inherit (see 20260810120000, where exactly that happened).

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

  -- #572: the tag must be THIS workspace's. Without it, another workspace's tag id
  -- attached that tag to the caller's own conversations and moved its OWNER's tag
  -- counts — and, because #354 derives the pipeline from tags, that workspace's win
  -- rate with them. `tags.company_id` is NOT NULL, so this can only narrow.
  if p_action in ('add_tag', 'remove_tag') then
    perform 1 from public.tags t
     where t.id = p_target_tag_id
       and t.company_id = p_company_id;
    if not found then
      return jsonb_build_object('error', 'validation_failed');
    end if;
  end if;

  -- #572: the assignee must be an active member, which api_bulk_tasks and the
  -- single-row assign already require — this was the one path of three that did
  -- not, so it was a gap rather than a decision. A deactivated ex-teammate's real
  -- user id is visible in timeline `assigned` events, so no guessing was involved.
  --
  -- Refused for the whole call rather than per row, quoting the tasks twin's own
  -- reasoning: applying it to some rows and not others would leave a half-assigned
  -- list nobody asked for.
  if p_action = 'assign' and p_target_user_id is not null then
    perform 1 from public.company_members cm
     where cm.company_id = p_company_id
       and cm.user_id = p_target_user_id
       and cm.deactivated_at is null;
    if not found then
      return jsonb_build_object('error', 'not_member');
    end if;
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
