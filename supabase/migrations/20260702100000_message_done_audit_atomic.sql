-- D22 §5.1 fix — make the message done/undone flip AND its conversation_events
-- audit row ONE transaction. A NEW migration (never edits a shipped one, D7/D14).
--
-- Before: the D14 PATCH /v1/messages/:id handler (routes/messages.ts) did the
-- messages.done_at UPDATE and the conversation_events INSERT as TWO separate
-- PostgREST round-trips. A failure (or a Worker crash) between them left the
-- message flipped but unaudited (or, on undone, an orphaned audit row) — the
-- audit log and the done-state permanently inconsistent, and for a promoted
-- message the ONE completion audit (D17/T2.1) silently lost.
--
-- After: this SECURITY DEFINER RPC flips done_at + done_by_user_id AND appends
-- the message_done / message_undone event in a single PostgREST transaction —
-- all-or-nothing. It preserves every D14 semantic the route already guaranteed:
--   * company-scoped (§10): a message outside p_company_id is `not_found`.
--   * idempotent no-op: re-marking the current state writes nothing (no update,
--     no event, no broadcast churn) and returns outcome 'unchanged'.
--   * only a REAL done<->undone transition writes exactly one audit row.
--   * done=true stamps who/when; done=false clears both (the shipped
--     messages_done_consistency CHECK holds).
-- The existing broadcast_message_change trigger (20260702010000) still fires the
-- `message.status` realtime event off the UPDATE for free — this function never
-- publishes realtime itself (§8 broadcast-from-DB).
--
-- Service-role-only, like every RPC in this schema (SPEC §6 RLS posture): the
-- Worker calls it with the sb_secret_ / service_role key; end-user roles never
-- reach PostgREST. The message_done/message_undone enum values were added in the
-- earlier 20260702050000_appv2_event_types.sql, so referencing them here is safe.
--
-- Outcomes (jsonb { outcome, message }):
--   updated    — a real transition; done_at/done_by flipped + one event written.
--                `message` is the fresh row as jsonb.
--   unchanged  — already in the requested state (idempotent no-op); `message` is
--                the current row, no event, no broadcast.
--   not_found  — no such message in this company (route -> 404).

create or replace function public.set_message_done(
  p_company_id    uuid,
  p_message_id    uuid,
  p_done          boolean,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg  public.messages%rowtype;
  v_now  timestamptz := now();
begin
  -- Company-scope + lock the row so a concurrent toggle can't interleave the
  -- update and the audit insert (§10 + atomicity).
  select * into v_msg
    from public.messages m
   where m.company_id = p_company_id
     and m.id = p_message_id
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found', 'message', null);
  end if;

  -- Idempotent no-op: already in the requested state → no write, no event.
  if p_done = (v_msg.done_at is not null) then
    return jsonb_build_object('outcome', 'unchanged',
                              'message', to_jsonb(v_msg));
  end if;

  if p_done then
    update public.messages
       set done_at = v_now, done_by_user_id = p_actor_user_id
     where id = v_msg.id
    returning * into v_msg;
  else
    update public.messages
       set done_at = null, done_by_user_id = null
     where id = v_msg.id
    returning * into v_msg;
  end if;

  -- D22 audit — SAME txn as the flip above. Only real transitions reach here.
  -- Body is never copied into the payload (D8/D22 PII posture); the timeline
  -- joins the live message by message_id. conversation_id is always non-null.
  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, v_msg.conversation_id, p_actor_user_id,
     case when p_done then 'message_done' else 'message_undone' end,
     jsonb_build_object('message_id', v_msg.id));

  return jsonb_build_object('outcome', 'updated', 'message', to_jsonb(v_msg));
end $$;

-- Service-role-only (SPEC §6): strip PUBLIC EXECUTE, grant only service_role.
revoke execute on function public.set_message_done(uuid, uuid, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.set_message_done(uuid, uuid, boolean, uuid)
  to service_role;
