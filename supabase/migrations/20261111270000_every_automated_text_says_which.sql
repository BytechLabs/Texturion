-- #725: a text a machine sent says which machine.
--
-- `messages.automated` (#388) was meant to be set by every automated send, and
-- three were missed: the missed-call text-back, the job rating ask and a task's
-- reminder all landed as if a person had typed them. That stopped the lead
-- clock on a robot's reply, which is the failure #388 was written to prevent,
-- and showed the owner as the author of texts nobody wrote.
--
-- `messages.automation` names the automation (MESSAGE_AUTOMATIONS in
-- packages/shared/src/message-automations.ts). Every function that writes an
-- automated text sets both, and supabase/tests/automated_texts.test.sql fails
-- when a new writer of public.messages is neither rostered as a human or
-- inbound path nor names its automation.
--
-- The writers are rewritten from their live definitions, so a later fix that a
-- retyped copy would miss cannot silently revert.

alter table public.messages add column automation text;
alter table public.messages add constraint messages_automation_check
  check (automation in ('away_reply', 'help_reply', 'off_ramp', 'emergency_ack',
                        'missed_call_text', 'job_rating', 'reminder'));
alter table public.messages add constraint messages_automation_is_automated
  check (automation is null or automated);

comment on column public.messages.automation is
  '#725: which automation sent this text (MESSAGE_AUTOMATIONS). Null for a person''s text, an inbound one, and an automated text sent before this column existed.';

do $mig$
declare
  v_def text;
  v_new text;
begin
  -- The shared auto-send claim serves the away reply, the French help reply
  -- and the off-ramp, so it is told which. Defaulted, so a caller that names
  -- none is recorded as what it was before: an away reply.
  v_def := pg_get_functiondef(
    'public.claim_auto_reply(uuid, uuid, text, integer, integer)'::regprocedure);
  v_new := replace(v_def, 'p_throttle_seconds integer)',
    'p_throttle_seconds integer, p_automation text DEFAULT ''away_reply''::text)');
  v_new := replace(v_new,
$n$     sent_by_user_id, automated)
  values
    (p_company_id, p_conversation_id, 'outbound', p_body, 'queued',
     p_segments_estimate, v_company.owner_user_id, true)$n$,
$n$     sent_by_user_id, automated, automation)
  values
    (p_company_id, p_conversation_id, 'outbound', p_body, 'queued',
     p_segments_estimate, v_company.owner_user_id, true, p_automation)$n$);
  if v_new = v_def or v_new not like '%p_automation)%' then
    raise exception 'claim_auto_reply: an anchor was not found';
  end if;
  drop function public.claim_auto_reply(uuid, uuid, text, integer, integer);
  execute v_new;

  v_def := pg_get_functiondef(
    'public.claim_emergency_ack(uuid, uuid, text, integer, integer, integer)'::regprocedure);
  v_new := replace(v_def,
$n$     sent_by_user_id, automated)
  values
    (p_company_id, p_conversation_id, 'outbound', p_body, 'queued',
     p_segments_estimate, v_company.owner_user_id, true)$n$,
$n$     sent_by_user_id, automated, automation)
  values
    (p_company_id, p_conversation_id, 'outbound', p_body, 'queued',
     p_segments_estimate, v_company.owner_user_id, true, 'emergency_ack')$n$);
  if v_new = v_def then
    raise exception 'claim_emergency_ack: the insert anchor was not found';
  end if;
  execute v_new;

  v_def := pg_get_functiondef(
    'public.claim_missed_call_text(uuid, uuid, text, text, text, integer, integer)'::regprocedure);
  v_new := replace(v_def,
$n$     sent_by_user_id)
  values
    (p_company_id, v_conv.id, 'outbound', p_body, 'queued',
     p_segments_estimate, v_company.owner_user_id)$n$,
$n$     sent_by_user_id, automated, automation)
  values
    (p_company_id, v_conv.id, 'outbound', p_body, 'queued',
     p_segments_estimate, v_company.owner_user_id, true, 'missed_call_text')$n$);
  if v_new = v_def then
    raise exception 'claim_missed_call_text: the insert anchor was not found';
  end if;
  execute v_new;

  -- A text a member scheduled is theirs; a reminder or a rating ask is the
  -- system's, sent in the name of whoever made the task.
  v_def := pg_get_functiondef('public.api_fire_scheduled_message(uuid, integer)'::regprocedure);
  v_new := replace(v_def,
$n$     sent_by_user_id)
  values
    (v_scheduled.company_id, v_scheduled.conversation_id, 'outbound',
     v_scheduled.body, 'queued', p_segments_estimate, v_scheduled.created_by)$n$,
$n$     sent_by_user_id, automated, automation)
  values
    (v_scheduled.company_id, v_scheduled.conversation_id, 'outbound',
     v_scheduled.body, 'queued', p_segments_estimate, v_scheduled.created_by,
     v_scheduled.origin <> 'human',
     case v_scheduled.origin
       when 'reminder' then 'reminder'
       when 'rating' then 'job_rating'
     end)$n$);
  if v_new = v_def then
    raise exception 'api_fire_scheduled_message: the insert anchor was not found';
  end if;
  execute v_new;

  -- The activity row of an automated text says which automation.
  v_def := pg_get_functiondef('public.record_activity_message(public.messages)'::regprocedure);
  v_new := replace(v_def,
$n$'automated', coalesce(m.automated, false));$n$,
$n$'automated', coalesce(m.automated, false),
                                  'automation', m.automation);$n$);
  if v_new = v_def then
    raise exception 'record_activity_message: the payload anchor was not found';
  end if;
  execute v_new;
end $mig$;

revoke execute on function public.claim_auto_reply(uuid, uuid, text, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.claim_auto_reply(uuid, uuid, text, integer, integer, text)
  to service_role;

-- What can be proven: a text a reminder or rating ask sent. Older away
-- replies, acknowledgments and text-backs cannot be told apart, so they keep
-- a null automation.
update public.messages m
   set automated = true,
       automation = case s.origin when 'reminder' then 'reminder' else 'job_rating' end
  from public.scheduled_messages s
 where s.sent_message_id = m.id
   and s.origin in ('reminder', 'rating');
