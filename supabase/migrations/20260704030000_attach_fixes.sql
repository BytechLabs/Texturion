-- Attachment/task follow-up fixes (verified review findings on the D28/D30 diff).
-- A NEW migration — never edits a shipped one (D7/D14). Two independent fixes:
--
--   [#2] create_task re-created to link the SOURCE note back to the new task
--        (messages.task_id), so a note's files reach the task's derived
--        attachments union (loadTaskAttachments arm (b)); plus a one-off backfill
--        for note-source tasks that already exist.
--   [#3] claim_attachment_storage — an atomic, race-safe replacement for the D30
--        check-then-write budget gate (the TOCTOU where N concurrent uploads all
--        read the same pre-insert sum and overshoot). The guarded-claim idiom:
--        a per-company advisory xact lock serializes the re-sum and the insert.

-- ===========================================================================
-- [#2] create_task — additionally link the promoted NOTE back to the new task.
--
-- D28 makes a task's attachments a DERIVED union; arm (b) of loadTaskAttachments
-- (routes/tasks.ts) surfaces the files of notes linked to the task via
-- messages.task_id. But when a `direction='note'` message is promoted to a task,
-- the source note's own files were LOST from that union: create_task set
-- tasks.message_id but never set the note's messages.task_id, so arm (b) — which
-- matches messages.task_id = task — missed the source note itself. A note that
-- had a quote PDF attached, then got "made into a task", showed zero attachments.
--
-- Coherent fix: after inserting the tasks row, when the source message is a note
-- with no existing task link, set its messages.task_id to the new task id. This
-- makes the source note behave exactly like any other note composed into the
-- task's discussion — its files flow through the same arm (b), no special-case.
-- Only a note is linked (direction='note'); an inbound/outbound source message
-- is left untouched (its MMS media already surfaces through arm (a), and it is
-- not a discussion note). The `task_id is null` guard keeps the write idempotent
-- and never steals a note already linked to another task.
--
-- Signature, grants, outcomes, and all other behavior are IDENTICAL to the
-- shipped body (20260702090000_appv2_task_mutations.sql) — this is a targeted
-- re-create, not a redesign.
-- ---------------------------------------------------------------------------
create or replace function public.create_task(
  p_company_id       uuid,
  p_message_id       uuid,
  p_title            text,
  p_description      text,
  p_assigned_user_id uuid,
  p_due_at           timestamptz,
  p_actor_user_id    uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
  v_body            text;
  v_direction       text;
  v_title           text;
  v_task            public.tasks%rowtype;
begin
  -- Resolve + company-scope the source message (§10). direction decides whether
  -- the source is a note we should also link back (below).
  select m.conversation_id, m.body, m.direction
    into v_conversation_id, v_body, v_direction
    from public.messages m
   where m.company_id = p_company_id
     and m.id = p_message_id;
  if not found then
    return jsonb_build_object('outcome', 'no_message', 'task', null);
  end if;

  -- Assignee must be an active member of the company (validation_failed).
  if p_assigned_user_id is not null then
    perform 1
      from public.company_members cm
     where cm.company_id = p_company_id
       and cm.user_id = p_assigned_user_id
       and cm.deactivated_at is null;
    if not found then
      return jsonb_build_object('outcome', 'not_member', 'task', null);
    end if;
  end if;

  -- Title defaults to the message-body snippet (whitespace-collapsed, ≤500),
  -- matching routes/tasks.ts `snippet()`; an empty body yields 'Task'.
  v_title := coalesce(
    nullif(p_title, ''),
    left(nullif(trim(regexp_replace(coalesce(v_body, ''), '\s+', ' ', 'g')), ''), 500),
    'Task');

  begin
    insert into public.tasks
      (company_id, message_id, conversation_id, title, description,
       assigned_user_id, due_at, created_by_user_id)
    values
      (p_company_id, p_message_id, v_conversation_id, v_title,
       coalesce(p_description, ''), p_assigned_user_id, p_due_at,
       p_actor_user_id)
    returning * into v_task;
  exception when unique_violation then
    -- A second live promotion of the same message (tasks_message_uq).
    return jsonb_build_object('outcome', 'conflict', 'task', null);
  end;

  -- [#2] Link the SOURCE note back to the new task so its own files reach the
  -- task's derived attachments union (arm (b): messages.task_id = task). Only a
  -- note is linked; the `task_id is null` guard keeps it idempotent and never
  -- reassigns a note already linked to another task.
  if v_direction = 'note' then
    update public.messages
       set task_id = v_task.id
     where id = p_message_id
       and task_id is null;
  end if;

  -- T2.1 audit — one task_created row on the source conversation, same txn.
  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, v_conversation_id, p_actor_user_id, 'task_created',
     jsonb_build_object('task_id', v_task.id, 'message_id', p_message_id));

  return jsonb_build_object('outcome', 'created', 'task', to_jsonb(v_task));
end $$;

-- Re-assert the shipped grants for the re-created function (a create-or-replace
-- preserves existing grants, but restating them keeps this migration
-- self-describing and safe if the function were ever dropped first).
revoke execute on function
  public.create_task(uuid, uuid, text, text, uuid, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function
  public.create_task(uuid, uuid, text, text, uuid, timestamptz, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- [#2] Backfill: existing note-source tasks whose source note was never linked.
-- For every LIVE task whose source message is a note with no task link, point
-- that note at its task. WHERE messages.task_id IS NULL keeps it idempotent and
-- avoids clobbering any note already linked. Deleted tasks are skipped (their
-- promotion was removed). This runs once at migrate time; the fixed create_task
-- prevents the gap for all future promotions.
-- ---------------------------------------------------------------------------
update public.messages m
   set task_id = t.id
  from public.tasks t
 where t.message_id = m.id
   and t.deleted_at is null
   and m.direction = 'note'
   and m.task_id is null;

-- ===========================================================================
-- [#3] claim_attachment_storage — atomic D30 budget claim (fixes the TOCTOU).
--
-- The route's old gate was check-then-write: it summed live generic bytes, then
-- (separately) inserted the row. N concurrent 25 MB uploads all read the same
-- pre-insert sum, all pass the check, and all insert — overshooting the budget
-- by up to N×25 MB. This RPC makes the sum-check and the size-visible insert
-- ONE atomic step under a per-company lock, mirroring the guarded-claim idiom
-- (bump_text_enablement_counter, 20260704010000): the update-or-reject there is
-- a single guarded statement; here the advisory xact lock is what makes the
-- multi-statement re-sum-then-insert equally race-safe.
--
--   pg_advisory_xact_lock(hashtext(p_company_id::text)) serializes all storage
--   claims for one company (auto-released at txn end; other companies never
--   block). Inside the lock we re-sum the LIVE generic rows — now seeing every
--   already-committed concurrent insert — and insert the new row IFF
--   sum + p_size_bytes <= p_budget_bytes. The insert makes the new bytes visible
--   to the NEXT waiter's re-sum, so the boundary holds exactly: the (N+1)th
--   upload at the budget gets allowed=false, no overshoot.
--
-- The Worker uploads to Storage FIRST, then calls this; on allowed=false it
-- returns the 409 and lets the orphaned object fall to the existing D19 sweep.
-- p_budget_bytes is passed by the Worker (STORAGE_BUDGET_BYTES stays the single
-- source of truth in billing/plans.ts); this function is budget-agnostic.
--
-- Returns jsonb:
--   { "allowed": true,  "attachment": <the inserted row as jsonb> }
--   { "allowed": false }                              -- over budget, nothing written
-- SECURITY DEFINER, service-role-only (SPEC §6) like every claim_* RPC.
-- ===========================================================================
create or replace function public.claim_attachment_storage(
  p_company_id      uuid,
  p_owner_type      text,
  p_owner_id        uuid,
  p_conversation_id uuid,
  p_storage_path    text,
  p_file_name       text,
  p_content_type    text,
  p_size_bytes      bigint,
  p_uploaded_by     uuid,
  p_budget_bytes    bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used int8;
  v_row  public.attachments%rowtype;
begin
  if p_size_bytes is null or p_size_bytes < 0 then
    raise exception 'claim_attachment_storage: p_size_bytes must be >= 0';
  end if;
  if p_budget_bytes is null or p_budget_bytes < 0 then
    raise exception 'claim_attachment_storage: p_budget_bytes must be >= 0';
  end if;

  -- Serialize per company: concurrent storage claims queue here so the re-sum
  -- below sees every committed insert (auto-released at txn end).
  perform pg_advisory_xact_lock(hashtext(p_company_id::text));

  -- Re-sum LIVE generic bytes under the lock — the authoritative, current total.
  select coalesce(sum(a.size_bytes), 0)::int8 into v_used
    from public.attachments a
   where a.company_id = p_company_id
     and a.deleted_at is null;

  if v_used + p_size_bytes > p_budget_bytes then
    return jsonb_build_object('allowed', false);
  end if;

  insert into public.attachments
    (company_id, owner_type, owner_id, conversation_id, storage_path,
     file_name, content_type, size_bytes, uploaded_by_user_id)
  values
    (p_company_id, p_owner_type, p_owner_id, p_conversation_id, p_storage_path,
     p_file_name, p_content_type, p_size_bytes, p_uploaded_by)
  returning * into v_row;

  return jsonb_build_object('allowed', true, 'attachment', to_jsonb(v_row));
end $$;

revoke execute on function
  public.claim_attachment_storage(
    uuid, text, uuid, uuid, text, text, text, bigint, uuid, bigint)
  from public, anon, authenticated;
grant execute on function
  public.claim_attachment_storage(
    uuid, text, uuid, uuid, text, text, text, bigint, uuid, bigint)
  to service_role;
