-- #725: a call's own timeline says what happened, in order: it came in, whose
-- phones rang, who declined, who picked up, when it went to voicemail and why
-- it ended. The call machine writes each step as it takes it
-- (apps/api/src/calls/call-steps.ts); nothing reconstructs them later.
--
-- The kinds match CALL_STEP_KINDS in packages/shared/src/call-steps.ts. They
-- are written for the call record only, so a contact's or thread's timeline
-- keeps its one line per call.

alter table public.record_activity drop constraint record_activity_kind_check;
alter table public.record_activity add constraint record_activity_kind_check
  check (kind in (
    'text_in', 'text_out', 'scheduled_queued', 'scheduled_sent', 'scheduled_cancelled',
    'call', 'voicemail',
    'call_arrived', 'call_placed', 'call_rang', 'call_declined', 'call_answered',
    'call_voicemail', 'call_ended',
    'created', 'edited', 'tagged', 'untagged', 'merged', 'unmerged', 'deleted',
    'restored', 'assigned', 'unassigned', 'mentioned', 'referenced', 'opted_out',
    'opted_in', 'blocked', 'unblocked', 'task_created', 'task_completed',
    'completed', 'reopened'));

alter table public.record_activity alter column category set expression as (
  case
    when kind in ('text_in', 'text_out', 'scheduled_queued', 'scheduled_sent',
                  'scheduled_cancelled') then 'message'
    when kind in ('call', 'voicemail', 'call_arrived', 'call_placed', 'call_rang',
                  'call_declined', 'call_answered', 'call_voicemail', 'call_ended')
      then 'call'
    else 'change'
  end);

-- One call per session id (calls_call_session_id_key). A step whose call row
-- is not there yet, or belongs to another workspace, is skipped, and the count
-- written comes back so a test can tell.
create or replace function public.record_call_steps(
  p_company_id      uuid,
  p_call_session_id text,
  p_steps           jsonb
) returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  k       public.calls;
  s       jsonb;
  written int := 0;
begin
  select * into k from public.calls
   where call_session_id = p_call_session_id and company_id = p_company_id;
  if not found then
    return 0;
  end if;
  for s in select value from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) loop
    perform public.record_activity_add(
      k.company_id, 'call', k.id, s->>'kind',
      nullif(s->>'actor_user_id', '')::uuid,
      coalesce(s->>'actor_type', 'system'),
      coalesce(s->'payload', '{}'::jsonb),
      'call', k.id, k.conversation_id, k.phone_number_id,
      coalesce((s->>'at')::timestamptz, now()),
      'step:' || (s->>'kind') || ':' || coalesce(s->>'at', '') || ':'
        || coalesce(s->>'actor_user_id', '') || ':'
        || md5(coalesce(s->'payload', '{}'::jsonb)::text));
    written := written + 1;
  end loop;
  return written;
end $$;

revoke execute on function public.record_call_steps(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_call_steps(uuid, text, jsonb) to service_role;
