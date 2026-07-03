-- App-v2 backend: task mutation RPCs (D17 / TASKS.md T3). A NEW migration —
-- never edits a shipped one (D7/D14).
--
-- TASKS.md T3 binds task mutations to `security definer` PostgREST RPC functions
-- (the §3 pattern used for threading and send-gating): the Worker calls them
-- with the sb_secret_ / service_role key, each runs atomically inside
-- PostgREST's per-request transaction, and end-user roles never call them
-- (EXECUTE revoked). This closes two gaps the inline-PostgREST implementation
-- left open:
--   1. Non-atomicity. Every mutation writes the `tasks` row AND its
--      `conversation_events` audit row (and, for delete, the task's generic
--      `attachments` rows) — previously separate round-trips. A failure between
--      them left the log or the attachments inconsistent with the task. Here
--      each is ONE transaction: all-or-nothing.
--   2. Orphaned gallery attachments (the T3 atomicity guarantee). `delete_task`
--      soft-deletes the task AND its generic attachment rows AND writes the
--      audit event together, so a partial failure can never leave live
--      attachment rows whose owning task is gone surfacing in the D21/T7.2
--      conversation gallery (conversations.ts generic arm filters
--      attachments.deleted_at IS NULL).
--
-- There is NO `mark_done()` task function and NO mirror transaction (T2 killed
-- them): completion is DERIVED from messages.done_at, written only by the D14
-- PATCH /v1/messages/:id {done} handler. None of these functions touch
-- messages.done_at.
--
-- Every function: SECURITY DEFINER, empty search_path (fully-qualified
-- references), EXECUTE revoked from end-user roles → only service_role. The
-- Worker passes an explicit p_company_id everywhere (SPEC §10 tenant isolation)
-- and the p_actor_user_id for the audit `actor_user_id`. The conversation_event
-- type literals used here ('task_created','task_assigned','task_due_set',
-- 'task_deleted') were added in 20260702050000_appv2_event_types.sql (a new enum
-- value cannot be used in the txn that adds it), so referencing them here is safe.
--
-- The tasks_broadcast trigger (20260702060000) fires the ID-only `task.changed`
-- broadcast on every insert/update/delete of `tasks` for free (T1.3) — these
-- functions never publish realtime themselves (SPEC §8 broadcast-from-DB).

-- ---------------------------------------------------------------------------
-- create_task — promote a message to a task (T3, T4 POST /v1/tasks).
--
-- Resolves conversation_id from the source message (company-scoped: a message
-- outside the caller's company is `no_message`, never a promotion of a foreign
-- row). Validates the assignee is an active member when one is given. Inserts
-- the tasks row and, atomically, the `task_created` event. The partial-unique
-- tasks_message_uq (WHERE deleted_at IS NULL) rejects a second LIVE promotion of
-- the same message — caught here and reported as `conflict` (race-safe: the
-- index is the arbiter, so two concurrent promotions produce exactly one task).
--
-- Outcomes (jsonb { outcome, task }):
--   created     — task inserted; `task` is the row as jsonb.
--   no_message  — no such message in this company (route → 422 validation_failed).
--   not_member  — assignee is not an active member (route → 422 validation_failed).
--   conflict    — the message is already a live task (route → 409 conflict).
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
  v_title           text;
  v_task            public.tasks%rowtype;
begin
  -- Resolve + company-scope the source message (§10).
  select m.conversation_id, m.body
    into v_conversation_id, v_body
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

  -- T2.1 audit — one task_created row on the source conversation, same txn.
  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, v_conversation_id, p_actor_user_id, 'task_created',
     jsonb_build_object('task_id', v_task.id, 'message_id', p_message_id));

  return jsonb_build_object('outcome', 'created', 'task', to_jsonb(v_task));
end $$;

-- ---------------------------------------------------------------------------
-- assign_task — set assigned_user_id, write task_assigned (T3). SET NULL-safe
-- (a null assignee unassigns). Only a live task in the company is touched.
--
-- Outcomes (jsonb { outcome, task }):
--   updated     — assignee changed; `task` is the fresh row.
--   unchanged   — the assignee already matched (idempotent no-op: no write, no
--                 event, no task.changed churn); `task` is the current row.
--   not_found   — no such live task in this company (route → 404).
--   not_member  — the new assignee is not an active member (route → 422).
-- ---------------------------------------------------------------------------
create or replace function public.assign_task(
  p_company_id       uuid,
  p_task_id          uuid,
  p_assigned_user_id uuid,
  p_actor_user_id    uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task     public.tasks%rowtype;
  v_from     uuid;
begin
  select * into v_task
    from public.tasks t
   where t.company_id = p_company_id
     and t.id = p_task_id
     and t.deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found', 'task', null);
  end if;

  if v_task.assigned_user_id is not distinct from p_assigned_user_id then
    return jsonb_build_object('outcome', 'unchanged', 'task', to_jsonb(v_task));
  end if;

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

  -- Capture the PRIOR assignee for the audit before the update overwrites it.
  v_from := v_task.assigned_user_id;

  update public.tasks
     set assigned_user_id = p_assigned_user_id
   where id = v_task.id
  returning * into v_task;

  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, v_task.conversation_id, p_actor_user_id, 'task_assigned',
     jsonb_build_object(
       'task_id', v_task.id,
       'from_user_id', v_from,
       'to_user_id', p_assigned_user_id));

  return jsonb_build_object('outcome', 'updated', 'task', to_jsonb(v_task));
end $$;

-- ---------------------------------------------------------------------------
-- update_task — metadata field updates (title/description/due_at), writing a
-- `task_due_set` event only when due_at actually changes (T3). Assignee is NOT
-- handled here (assign_task owns it, matching the route's per-field events).
-- NULL params mean "leave unchanged"; a due_at change TO null is expressed via
-- p_clear_due (so null-param and null-value are distinguishable).
--
-- Outcomes (jsonb { outcome, task }):
--   updated    — at least one field changed; `task` is the fresh row.
--   unchanged  — nothing changed (idempotent no-op); `task` is the current row.
--   not_found  — no such live task in this company (route → 404).
-- ---------------------------------------------------------------------------
create or replace function public.update_task(
  p_company_id    uuid,
  p_task_id       uuid,
  p_title         text,
  p_description   text,
  p_due_at        timestamptz,
  p_clear_due     boolean,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task        public.tasks%rowtype;
  v_new_title   text;
  v_new_desc    text;
  v_new_due     timestamptz;
  v_due_changed boolean := false;
  v_changed     boolean := false;
begin
  select * into v_task
    from public.tasks t
   where t.company_id = p_company_id
     and t.id = p_task_id
     and t.deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found', 'task', null);
  end if;

  v_new_title := coalesce(p_title, v_task.title);
  v_new_desc  := coalesce(p_description, v_task.description);
  -- due_at target: an explicit clear wins; else a provided value; else keep.
  if p_clear_due then
    v_new_due := null;
  elsif p_due_at is not null then
    v_new_due := p_due_at;
  else
    v_new_due := v_task.due_at;
  end if;

  v_changed := (v_new_title is distinct from v_task.title)
            or (v_new_desc  is distinct from v_task.description)
            or (v_new_due   is distinct from v_task.due_at);
  if not v_changed then
    return jsonb_build_object('outcome', 'unchanged', 'task', to_jsonb(v_task));
  end if;

  v_due_changed := v_new_due is distinct from v_task.due_at;

  update public.tasks
     set title = v_new_title,
         description = v_new_desc,
         due_at = v_new_due
   where id = v_task.id
  returning * into v_task;

  -- Only a due_at change is audited (T2.1 canonical list: task_due_set). Title/
  -- description edits carry no event, matching routes/tasks.ts.
  if v_due_changed then
    insert into public.conversation_events
      (company_id, conversation_id, actor_user_id, type, payload)
    values
      (p_company_id, v_task.conversation_id, p_actor_user_id, 'task_due_set',
       jsonb_build_object('task_id', v_task.id, 'due_at', v_new_due));
  end if;

  return jsonb_build_object('outcome', 'updated', 'task', to_jsonb(v_task));
end $$;

-- ---------------------------------------------------------------------------
-- delete_task — soft-delete a task ATOMICALLY (T3, the atomicity guarantee).
--
-- In ONE transaction: soft-delete the tasks row, soft-delete its generic
-- attachments (D19; so the sweep cron can best-effort remove their objects AND
-- the D21/T7.2 gallery — which filters attachments.deleted_at IS NULL — never
-- surfaces them again), and write the task_deleted audit event. A partial
-- failure rolls back all three, so an orphaned attachment can never leak into
-- the gallery. Never touches messages.done_at (D14 archetype A stays intact).
--
-- Authorization (creator-or-owner/admin, T4 M*) stays in the Worker — this
-- function is the atomic write path, not the policy check — but it re-checks
-- deleted_at IS NULL so a lost race with a concurrent delete is `not_found`.
--
-- Outcomes (jsonb { outcome }):
--   deleted    — task (and its live attachments) soft-deleted, event written.
--   not_found  — already gone / no such live task (route → 404).
-- ---------------------------------------------------------------------------
create or replace function public.delete_task(
  p_company_id    uuid,
  p_task_id       uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
  v_now  timestamptz := now();
begin
  update public.tasks
     set deleted_at = v_now
   where company_id = p_company_id
     and id = p_task_id
     and deleted_at is null
  returning * into v_task;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  -- Soft-delete the task's live generic attachment rows (D19) in the SAME txn.
  update public.attachments
     set deleted_at = v_now
   where company_id = p_company_id
     and owner_type = 'task'
     and owner_id = p_task_id
     and deleted_at is null;

  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, v_task.conversation_id, p_actor_user_id, 'task_deleted',
     jsonb_build_object('task_id', p_task_id));

  return jsonb_build_object('outcome', 'deleted');
end $$;

-- Service-role-only, like every RPC in this schema (SPEC §6 RLS posture):
-- end-user roles never touch PostgREST.
revoke execute on function
  public.create_task(uuid, uuid, text, text, uuid, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function
  public.create_task(uuid, uuid, text, text, uuid, timestamptz, uuid)
  to service_role;

revoke execute on function
  public.assign_task(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.assign_task(uuid, uuid, uuid, uuid)
  to service_role;

revoke execute on function
  public.update_task(uuid, uuid, text, text, timestamptz, boolean, uuid)
  from public, anon, authenticated;
grant execute on function
  public.update_task(uuid, uuid, text, text, timestamptz, boolean, uuid)
  to service_role;

revoke execute on function
  public.delete_task(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.delete_task(uuid, uuid, uuid)
  to service_role;
