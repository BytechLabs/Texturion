-- D22 §5.1 follow-up — FIX a runtime type error in set_message_done.
-- A NEW migration; never edits a shipped one (D7/D14).
--
-- 20260702100000_message_done_audit_atomic.sql introduced set_message_done, but
-- its audit INSERT typed the event as
--     case when p_done then 'message_done' else 'message_undone' end
-- A CASE whose branches are string literals resolves to `text`, and there is NO
-- implicit assignment cast from text to the conversation_event_type ENUM inside
-- a VALUES list, so EVERY real done/undone call raised at runtime:
--     column "type" is of type public.conversation_event_type
--     but expression is of type text
-- The function only `create or replace`s at migration time (the body is never
-- executed then), and the JS route tests stub the RPC, so neither caught it —
-- but in production every PATCH /v1/messages/:id {done} that actually flips the
-- state would 500 (`set_message_done failed`), taking the whole done feature and
-- its D22 audit down. The task RPCs sidestep this by using BARE literals (which
-- are `unknown`-typed and DO coerce to the enum); the CASE here does not.
--
-- Fix: cast the CASE result explicitly to public.conversation_event_type. All
-- other semantics (company-scope, idempotent no-op, atomic flip+audit,
-- service-role-only) are preserved verbatim from the introducing migration.

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
  -- The event type is cast to the enum explicitly: a CASE over string literals
  -- is `text`, which does not implicitly coerce to conversation_event_type in a
  -- VALUES list (the bug this migration fixes).
  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, v_msg.conversation_id, p_actor_user_id,
     (case when p_done then 'message_done' else 'message_undone' end)
       ::public.conversation_event_type,
     jsonb_build_object('message_id', v_msg.id));

  return jsonb_build_object('outcome', 'updated', 'message', to_jsonb(v_msg));
end $$;

-- Re-assert the service-role-only posture (SPEC §6): create-or-replace keeps the
-- prior ACL, but restating it makes the posture explicit and deterministic.
revoke execute on function public.set_message_done(uuid, uuid, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.set_message_done(uuid, uuid, boolean, uuid)
  to service_role;
