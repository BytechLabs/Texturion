-- #722 phase 4: every state transition is recorded, in the database.
--
-- WHY THE DATABASE. A lifecycle moves through routes, provider webhooks, crons,
-- RPCs and trigger cascades. Instrumenting each writer means the one somebody
-- forgets is the one that goes quiet, so the capture sits on the column every
-- writer has to touch. A trigger fires only when the state column CHANGED, so a
-- repeat pass over the same state (the retry loop that flooded pushes on
-- 2026-11-10) is not an event, and "why is this stuck" is one PostHog query on
-- the record id.
--
-- WHAT IS SENT. One `state_transition` event per move through Supabase's
-- built-in pg_net, in the same shape apps/api/src/analytics/posthog.ts sends:
-- distinct_id is the company id, never a person, and `$process_person_profile`
-- is false. Properties are machine, from, to, record_id, expected (is the move
-- an edge of the shared definition), cause and environment. Nothing else: no
-- names, numbers or message text.
--
-- THE KEY lives in Supabase Vault (secret `posthog_api_key`), read at run time.
-- With no secret (local, CI, the rig) the capture returns at once and enqueues
-- nothing. pg_net queues the request in the writer's own transaction, so a
-- rolled-back write sends nothing, and the capture never raises: a pg_net or
-- Vault failure cannot fail the business write.
--
-- MONITORING IS POSTHOG ONLY. No table, no alert, no console is added here.
--
-- ACTIVITY. The transitions a person sees on a record go to record_activity
-- (#714) and the workspace-level ones to the audit log (#231); most already
-- wrote a row from a route or a trigger. This migration adds the missing ones
-- (docs/STATE-MACHINES.md, "Recorded:" under each machine):
--   - a restored task (record_activity `restored`);
--   - audit rows for port, registration, text enablement, phone number,
--     subscription status, data export, calendar connection, dispute, quote and
--     payment request (paid and expired; sent and cancelled have route rows).
--
-- The high-volume pipelines (call_leg, calendar_outbox, calendar_reminder_replan,
-- calendar_push_subscription, webhook_delivery, geocode, message delivery status,
-- number_health) get PostHog only. packages/shared/src/state-machines/
-- transition-records.test.ts pins every machine to its trigger and its activity.

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Is a move an edge of the definition? Generated from
--    packages/shared/src/state-machines (a null `from` row is an initial state).
--    The roster test fails when this list and the definitions disagree.
-- ---------------------------------------------------------------------------
create or replace function public.state_transition_expected(
  p_machine text,
  p_from    text,
  p_to      text
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1
    from (values
    ('call', null::text, 'dialing'),
    ('call', null::text, 'ringing'),
    ('call', null::text, 'voicemail_greeting'),
    ('call', 'dialing', 'answered'),
    ('call', 'dialing', 'ended_answered'),
    ('call', 'dialing', 'ended_voicemail'),
    ('call', 'dialing', 'ended_missed'),
    ('call', 'dialing', 'ended_rejected'),
    ('call', 'ringing', 'answered'),
    ('call', 'ringing', 'voicemail_greeting'),
    ('call', 'ringing', 'ended_answered'),
    ('call', 'ringing', 'ended_voicemail'),
    ('call', 'ringing', 'ended_missed'),
    ('call', 'ringing', 'ended_rejected'),
    ('call', 'answered', 'ended_answered'),
    ('call', 'answered', 'ended_voicemail'),
    ('call', 'answered', 'ended_missed'),
    ('call', 'answered', 'ended_rejected'),
    ('call', 'voicemail_greeting', 'voicemail_recording'),
    ('call', 'voicemail_greeting', 'ended_answered'),
    ('call', 'voicemail_greeting', 'ended_voicemail'),
    ('call', 'voicemail_greeting', 'ended_missed'),
    ('call', 'voicemail_greeting', 'ended_rejected'),
    ('call', 'voicemail_recording', 'ended_answered'),
    ('call', 'voicemail_recording', 'ended_voicemail'),
    ('call', 'voicemail_recording', 'ended_missed'),
    ('call', 'voicemail_recording', 'ended_rejected'),
    ('call', 'ended_missed', 'ended_voicemail'),
    ('call', 'ended_missed', 'ended_answered'),
    ('call_leg', null::text, 'ringing'),
    ('call_leg', 'ringing', 'answered'),
    ('call_leg', 'ringing', 'failed'),
    ('call_leg', 'answered', 'failed'),
    ('scheduled_message', null::text, 'pending'),
    ('scheduled_message', 'pending', 'pending'),
    ('scheduled_message', 'pending', 'held'),
    ('scheduled_message', 'pending', 'sent'),
    ('scheduled_message', 'pending', 'canceled'),
    ('scheduled_message', 'pending', 'expired'),
    ('scheduled_message', 'pending', 'failed'),
    ('scheduled_message', 'held', 'held'),
    ('scheduled_message', 'held', 'pending'),
    ('scheduled_message', 'held', 'sent'),
    ('scheduled_message', 'held', 'canceled'),
    ('scheduled_message', 'held', 'expired'),
    ('scheduled_message', 'held', 'failed'),
    ('calendar_connection', null::text, 'active'),
    ('calendar_connection', 'active', 'reauth_required'),
    ('calendar_connection', 'active', 'disconnected'),
    ('calendar_connection', 'active', 'revoked'),
    ('calendar_connection', 'reauth_required', 'active'),
    ('calendar_connection', 'reauth_required', 'disconnected'),
    ('calendar_connection', 'reauth_required', 'revoked'),
    ('calendar_connection', 'disconnected', 'revoked'),
    ('calendar_outbox', null::text, 'queued'),
    ('calendar_outbox', 'queued', 'leased'),
    ('calendar_outbox', 'queued', 'completed'),
    ('calendar_outbox', 'queued', 'cancelled'),
    ('calendar_outbox', 'leased', 'leased'),
    ('calendar_outbox', 'leased', 'queued'),
    ('calendar_outbox', 'leased', 'completed'),
    ('calendar_outbox', 'leased', 'cancelled'),
    ('calendar_reminder_replan', null::text, 'queued'),
    ('calendar_reminder_replan', 'queued', 'leased'),
    ('calendar_reminder_replan', 'queued', 'completed'),
    ('calendar_reminder_replan', 'queued', 'cancelled'),
    ('calendar_reminder_replan', 'leased', 'leased'),
    ('calendar_reminder_replan', 'leased', 'queued'),
    ('calendar_reminder_replan', 'leased', 'completed'),
    ('calendar_reminder_replan', 'leased', 'cancelled'),
    ('calendar_link', null::text, 'active'),
    ('calendar_link', null::text, 'conflict'),
    ('calendar_link', 'active', 'conflict'),
    ('calendar_link', 'active', 'event_removed'),
    ('calendar_link', 'active', 'refused'),
    ('calendar_link', 'active', 'unlinked'),
    ('calendar_link', 'conflict', 'active'),
    ('calendar_link', 'conflict', 'unlinked'),
    ('calendar_link', 'event_removed', 'active'),
    ('calendar_link', 'event_removed', 'refused'),
    ('calendar_link', 'event_removed', 'unlinked'),
    ('calendar_link', 'refused', 'active'),
    ('calendar_link', 'refused', 'event_removed'),
    ('calendar_link', 'refused', 'unlinked'),
    ('calendar_link', 'unlinked', 'active'),
    ('calendar_push_subscription', null::text, 'active'),
    ('calendar_push_subscription', 'active', 'error'),
    ('calendar_push_subscription', 'active', 'revoking'),
    ('calendar_push_subscription', 'active', 'revoked'),
    ('calendar_push_subscription', 'renewing', 'active'),
    ('calendar_push_subscription', 'renewing', 'error'),
    ('calendar_push_subscription', 'renewing', 'revoking'),
    ('calendar_push_subscription', 'renewing', 'revoked'),
    ('calendar_push_subscription', 'error', 'active'),
    ('calendar_push_subscription', 'error', 'revoking'),
    ('calendar_push_subscription', 'error', 'revoked'),
    ('calendar_push_subscription', 'expired', 'revoking'),
    ('calendar_push_subscription', 'expired', 'revoked'),
    ('calendar_push_subscription', 'revoking', 'revoked'),
    ('webhook_delivery', null::text, 'pending'),
    ('webhook_delivery', 'pending', 'delivering'),
    ('webhook_delivery', 'delivering', 'delivering'),
    ('webhook_delivery', 'delivering', 'pending'),
    ('webhook_delivery', 'delivering', 'succeeded'),
    ('webhook_delivery', 'delivering', 'failed'),
    ('subscription', null::text, 'incomplete'),
    ('subscription', 'incomplete', 'active'),
    ('subscription', 'incomplete', 'incomplete_expired'),
    ('subscription', 'incomplete', 'canceled'),
    ('subscription', 'active', 'past_due'),
    ('subscription', 'active', 'unpaid'),
    ('subscription', 'active', 'canceled'),
    ('subscription', 'past_due', 'active'),
    ('subscription', 'past_due', 'unpaid'),
    ('subscription', 'past_due', 'canceled'),
    ('subscription', 'unpaid', 'active'),
    ('subscription', 'unpaid', 'canceled'),
    ('subscription', 'canceled', 'incomplete'),
    ('subscription', 'canceled', 'active'),
    ('conversation', null::text, 'new'),
    ('conversation', null::text, 'open'),
    ('conversation', 'new', 'open'),
    ('conversation', 'new', 'waiting'),
    ('conversation', 'new', 'closed'),
    ('conversation', 'open', 'new'),
    ('conversation', 'open', 'waiting'),
    ('conversation', 'open', 'closed'),
    ('conversation', 'waiting', 'new'),
    ('conversation', 'waiting', 'open'),
    ('conversation', 'waiting', 'closed'),
    ('conversation', 'closed', 'new'),
    ('conversation', 'closed', 'open'),
    ('conversation', 'closed', 'waiting'),
    ('conversation_visibility', null::text, 'live'),
    ('conversation_visibility', 'live', 'spam'),
    ('conversation_visibility', 'live', 'trashed'),
    ('conversation_visibility', 'spam', 'live'),
    ('conversation_visibility', 'spam', 'trashed'),
    ('conversation_visibility', 'trashed', 'live'),
    ('message', null::text, 'received'),
    ('message', null::text, 'queued'),
    ('message', 'queued', 'sent'),
    ('message', 'queued', 'delivered'),
    ('message', 'queued', 'failed'),
    ('message', 'sent', 'delivered'),
    ('message', 'sent', 'failed'),
    ('message', 'failed', 'queued'),
    ('registration', null::text, 'draft'),
    ('registration', 'draft', 'submitted'),
    ('registration', 'submitted', 'pending'),
    ('registration', 'submitted', 'approved'),
    ('registration', 'submitted', 'rejected'),
    ('registration', 'pending', 'approved'),
    ('registration', 'pending', 'rejected'),
    ('registration', 'approved', 'suspended'),
    ('registration', 'rejected', 'submitted'),
    ('registration', 'suspended', 'approved'),
    ('registration', 'suspended', 'rejected'),
    ('registration', 'suspended', 'submitted'),
    ('number_health', null::text, 'healthy'),
    ('number_health', 'healthy', 'degraded'),
    ('number_health', 'degraded', 'healthy'),
    ('payment_request', null::text, 'requested'),
    ('payment_request', 'requested', 'paid'),
    ('payment_request', 'requested', 'cancelled'),
    ('payment_request', 'requested', 'expired'),
    ('payment_request', 'cancelled', 'paid'),
    ('payment_request', 'expired', 'paid'),
    ('phone_number', null::text, 'provisioning'),
    ('phone_number', null::text, 'active'),
    ('phone_number', 'provisioning', 'active'),
    ('phone_number', 'provisioning', 'provision_failed'),
    ('phone_number', 'provisioning', 'released'),
    ('phone_number', 'active', 'suspended'),
    ('phone_number', 'active', 'released'),
    ('phone_number', 'active', 'ported_out'),
    ('phone_number', 'suspended', 'active'),
    ('phone_number', 'suspended', 'released'),
    ('phone_number', 'suspended', 'ported_out'),
    ('phone_number', 'provision_failed', 'provisioning'),
    ('phone_number', 'provision_failed', 'released'),
    ('port', null::text, 'draft'),
    ('port', 'draft', 'in-process'),
    ('port', 'draft', 'submitted'),
    ('port', 'draft', 'exception'),
    ('port', 'draft', 'cancel-pending'),
    ('port', 'draft', 'cancelled'),
    ('port', 'in-process', 'submitted'),
    ('port', 'in-process', 'exception'),
    ('port', 'in-process', 'foc-date-confirmed'),
    ('port', 'in-process', 'activation-in-progress'),
    ('port', 'in-process', 'ported'),
    ('port', 'in-process', 'cancel-pending'),
    ('port', 'in-process', 'cancelled'),
    ('port', 'submitted', 'exception'),
    ('port', 'submitted', 'foc-date-confirmed'),
    ('port', 'submitted', 'activation-in-progress'),
    ('port', 'submitted', 'ported'),
    ('port', 'submitted', 'cancel-pending'),
    ('port', 'submitted', 'cancelled'),
    ('port', 'exception', 'submitted'),
    ('port', 'exception', 'in-process'),
    ('port', 'exception', 'foc-date-confirmed'),
    ('port', 'exception', 'activation-in-progress'),
    ('port', 'exception', 'ported'),
    ('port', 'exception', 'cancel-pending'),
    ('port', 'exception', 'cancelled'),
    ('port', 'foc-date-confirmed', 'activation-in-progress'),
    ('port', 'foc-date-confirmed', 'ported'),
    ('port', 'foc-date-confirmed', 'exception'),
    ('port', 'foc-date-confirmed', 'cancel-pending'),
    ('port', 'foc-date-confirmed', 'cancelled'),
    ('port', 'activation-in-progress', 'ported'),
    ('port', 'activation-in-progress', 'exception'),
    ('port', 'activation-in-progress', 'cancel-pending'),
    ('port', 'activation-in-progress', 'cancelled'),
    ('port', 'cancel-pending', 'cancelled'),
    ('port_messaging', null::text, 'not_applicable'),
    ('port_messaging', 'not_applicable', 'pending'),
    ('port_messaging', 'not_applicable', 'activating'),
    ('port_messaging', 'not_applicable', 'ported'),
    ('port_messaging', 'not_applicable', 'exception'),
    ('port_messaging', 'pending', 'activating'),
    ('port_messaging', 'pending', 'ported'),
    ('port_messaging', 'pending', 'exception'),
    ('port_messaging', 'activating', 'ported'),
    ('port_messaging', 'activating', 'exception'),
    ('port_messaging', 'exception', 'activating'),
    ('port_messaging', 'exception', 'ported'),
    ('quote', null::text, 'draft'),
    ('quote', 'draft', 'sent'),
    ('quote', 'sent', 'viewed'),
    ('quote', 'sent', 'accepted'),
    ('quote', 'sent', 'declined'),
    ('quote', 'sent', 'expired'),
    ('quote', 'viewed', 'accepted'),
    ('quote', 'viewed', 'declined'),
    ('quote', 'viewed', 'expired'),
    ('text_enablement', null::text, 'pending'),
    ('text_enablement', 'pending', 'in-progress'),
    ('text_enablement', 'pending', 'action-required'),
    ('text_enablement', 'pending', 'completed'),
    ('text_enablement', 'pending', 'failed'),
    ('text_enablement', 'pending', 'cancelled'),
    ('text_enablement', 'action-required', 'pending'),
    ('text_enablement', 'action-required', 'in-progress'),
    ('text_enablement', 'action-required', 'completed'),
    ('text_enablement', 'action-required', 'failed'),
    ('text_enablement', 'action-required', 'cancelled'),
    ('text_enablement', 'in-progress', 'action-required'),
    ('text_enablement', 'in-progress', 'completed'),
    ('text_enablement', 'in-progress', 'failed'),
    ('text_enablement', 'in-progress', 'cancelled'),
    ('text_enablement', 'completed', 'cancelled'),
    ('text_enablement', 'failed', 'pending'),
    ('text_enablement', 'failed', 'cancelled'),
    ('data_export', null::text, 'pending'),
    ('data_export', 'pending', 'running'),
    ('data_export', 'pending', 'failed'),
    ('data_export', 'running', 'running'),
    ('data_export', 'running', 'ready'),
    ('data_export', 'running', 'failed'),
    ('consent', null::text, 'implied'),
    ('consent', null::text, 'express'),
    ('consent', null::text, 'revoked'),
    ('consent', 'implied', 'express'),
    ('consent', 'implied', 'revoked'),
    ('consent', 'express', 'revoked'),
    ('consent', 'revoked', 'express'),
    ('geocode', null::text, 'pending'),
    ('geocode', null::text, 'no_address'),
    ('geocode', 'pending', 'ok'),
    ('geocode', 'pending', 'failed'),
    ('geocode', 'pending', 'no_address'),
    ('geocode', 'ok', 'pending'),
    ('geocode', 'ok', 'no_address'),
    ('geocode', 'failed', 'pending'),
    ('geocode', 'failed', 'no_address'),
    ('geocode', 'no_address', 'pending'),
    ('billing_dispute', null::text, 'warning_needs_response'),
    ('billing_dispute', null::text, 'needs_response'),
    ('billing_dispute', 'warning_needs_response', 'warning_under_review'),
    ('billing_dispute', 'warning_needs_response', 'warning_closed'),
    ('billing_dispute', 'warning_needs_response', 'needs_response'),
    ('billing_dispute', 'warning_needs_response', 'under_review'),
    ('billing_dispute', 'warning_needs_response', 'won'),
    ('billing_dispute', 'warning_needs_response', 'lost'),
    ('billing_dispute', 'warning_under_review', 'warning_closed'),
    ('billing_dispute', 'warning_under_review', 'needs_response'),
    ('billing_dispute', 'warning_under_review', 'under_review'),
    ('billing_dispute', 'warning_under_review', 'won'),
    ('billing_dispute', 'warning_under_review', 'lost'),
    ('billing_dispute', 'needs_response', 'under_review'),
    ('billing_dispute', 'needs_response', 'won'),
    ('billing_dispute', 'needs_response', 'lost'),
    ('billing_dispute', 'under_review', 'won'),
    ('billing_dispute', 'under_review', 'lost'),
    ('task', null::text, 'open'),
    ('task', 'open', 'done'),
    ('task', 'open', 'trashed'),
    ('task', 'done', 'open'),
    ('task', 'done', 'trashed'),
    ('task', 'trashed', 'open'),
    ('task', 'trashed', 'done'),
    ('invite', null::text, 'pending'),
    ('invite', 'pending', 'pending'),
    ('invite', 'pending', 'accepted'),
    ('invite', 'pending', 'revoked'),
    ('invite', 'pending', 'expired'),
    ('invite', 'expired', 'pending'),
    ('invite', 'expired', 'revoked'),
    ('workspace', null::text, 'active'),
    ('workspace', 'active', 'paused'),
    ('workspace', 'active', 'closed'),
    ('workspace', 'paused', 'active'),
    ('workspace', 'paused', 'closed'),
    ('workspace', 'closed', 'active'),
    ('workspace', 'closed', 'purged')
    ) e(machine, from_state, to_state)
    where e.machine = p_machine
      and e.from_state is not distinct from p_from
      and e.to_state = p_to
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. The one capture. record_id is text because disputes and call legs are
--    keyed by a provider id, not a uuid.
-- ---------------------------------------------------------------------------
create or replace function public.capture_state_transition(
  p_machine    text,
  p_company_id uuid,
  p_record_id  text,
  p_from       text,
  p_to         text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select s.decrypted_secret into v_key
    from vault.decrypted_secrets s
   where s.name = 'posthog_api_key'
   limit 1;
  if v_key is null or v_key = '' then
    return;
  end if;

  perform net.http_post(
    url     := 'https://us.i.posthog.com/capture/',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'api_key', v_key,
      'event', 'state_transition',
      'distinct_id', p_company_id::text,
      'properties', jsonb_build_object(
        'machine', p_machine,
        'from', p_from,
        'to', p_to,
        'record_id', p_record_id,
        'expected', public.state_transition_expected(p_machine, p_from, p_to),
        'cause', coalesce(
          nullif(current_setting('loonext.cause', true), ''),
          nullif(current_setting('request.path', true), ''),
          'database'),
        'environment', 'production',
        '$process_person_profile', false)));
exception when others then
  raise warning 'state transition capture skipped: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Column-backed machines: one trigger function, parameterised by
--    (machine, state column, id column, company column).
-- ---------------------------------------------------------------------------
create or replace function public.state_transition_capture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new  jsonb := to_jsonb(new);
  v_from text;
begin
  if tg_op = 'UPDATE' then
    v_from := to_jsonb(old) ->> tg_argv[1];
  end if;
  perform public.capture_state_transition(
    tg_argv[0], (v_new ->> tg_argv[3])::uuid, v_new ->> tg_argv[2], v_from,
    v_new ->> tg_argv[1]);
  return null;
exception when others then
  raise warning 'state transition capture skipped: %', sqlerrm;
  return null;
end $$;

create trigger state_transition_call
  after update of state on public.calls
  for each row when (old.state is distinct from new.state)
  execute function public.state_transition_capture('call', 'state', 'id', 'company_id');
create trigger state_entered_call
  after insert on public.calls
  for each row when (new.state is not null)
  execute function public.state_transition_capture('call', 'state', 'id', 'company_id');

create trigger state_transition_call_leg
  after update of state on public.call_member_legs
  for each row when (old.state is distinct from new.state)
  execute function public.state_transition_capture('call_leg', 'state', 'call_control_id', 'company_id');
create trigger state_entered_call_leg
  after insert on public.call_member_legs
  for each row when (new.state is not null)
  execute function public.state_transition_capture('call_leg', 'state', 'call_control_id', 'company_id');

create trigger state_transition_scheduled_message
  after update of status on public.scheduled_messages
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_capture('scheduled_message', 'status', 'id', 'company_id');
create trigger state_entered_scheduled_message
  after insert on public.scheduled_messages
  for each row when (new.status is not null)
  execute function public.state_transition_capture('scheduled_message', 'status', 'id', 'company_id');

create trigger state_transition_calendar_connection
  after update of status on public.calendar_connections
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_capture('calendar_connection', 'status', 'id', 'company_id');
create trigger state_entered_calendar_connection
  after insert on public.calendar_connections
  for each row when (new.status is not null)
  execute function public.state_transition_capture('calendar_connection', 'status', 'id', 'company_id');

create trigger state_transition_calendar_outbox
  after update of state on public.calendar_outbox
  for each row when (old.state is distinct from new.state)
  execute function public.state_transition_capture('calendar_outbox', 'state', 'id', 'company_id');
create trigger state_entered_calendar_outbox
  after insert on public.calendar_outbox
  for each row when (new.state is not null)
  execute function public.state_transition_capture('calendar_outbox', 'state', 'id', 'company_id');

create trigger state_transition_calendar_reminder_replan
  after update of state on public.calendar_reminder_replans
  for each row when (old.state is distinct from new.state)
  execute function public.state_transition_capture('calendar_reminder_replan', 'state', 'id', 'company_id');
create trigger state_entered_calendar_reminder_replan
  after insert on public.calendar_reminder_replans
  for each row when (new.state is not null)
  execute function public.state_transition_capture('calendar_reminder_replan', 'state', 'id', 'company_id');

create trigger state_transition_calendar_link
  after update of link_state on public.task_calendar_links
  for each row when (old.link_state is distinct from new.link_state)
  execute function public.state_transition_capture('calendar_link', 'link_state', 'id', 'company_id');
create trigger state_entered_calendar_link
  after insert on public.task_calendar_links
  for each row when (new.link_state is not null)
  execute function public.state_transition_capture('calendar_link', 'link_state', 'id', 'company_id');

create trigger state_transition_calendar_push_subscription
  after update of status on public.webhook_subscriptions
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_capture('calendar_push_subscription', 'status', 'id', 'company_id');
create trigger state_entered_calendar_push_subscription
  after insert on public.webhook_subscriptions
  for each row when (new.status is not null)
  execute function public.state_transition_capture('calendar_push_subscription', 'status', 'id', 'company_id');

create trigger state_transition_webhook_delivery
  after update of status on public.webhook_deliveries
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_capture('webhook_delivery', 'status', 'id', 'company_id');
create trigger state_entered_webhook_delivery
  after insert on public.webhook_deliveries
  for each row when (new.status is not null)
  execute function public.state_transition_capture('webhook_delivery', 'status', 'id', 'company_id');

create trigger state_transition_subscription
  after update of subscription_status on public.companies
  for each row when (old.subscription_status is distinct from new.subscription_status)
  execute function public.state_transition_capture('subscription', 'subscription_status', 'id', 'id');
create trigger state_entered_subscription
  after insert on public.companies
  for each row when (new.subscription_status is not null)
  execute function public.state_transition_capture('subscription', 'subscription_status', 'id', 'id');

create trigger state_transition_conversation
  after update of status on public.conversations
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_capture('conversation', 'status', 'id', 'company_id');
create trigger state_entered_conversation
  after insert on public.conversations
  for each row when (new.status is not null)
  execute function public.state_transition_capture('conversation', 'status', 'id', 'company_id');

create trigger state_transition_message
  after update of status on public.messages
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_capture('message', 'status', 'id', 'company_id');
create trigger state_entered_message
  after insert on public.messages
  for each row when (new.status is not null)
  execute function public.state_transition_capture('message', 'status', 'id', 'company_id');

create trigger state_transition_registration
  after update of status on public.messaging_registrations
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_capture('registration', 'status', 'id', 'company_id');
create trigger state_entered_registration
  after insert on public.messaging_registrations
  for each row when (new.status is not null)
  execute function public.state_transition_capture('registration', 'status', 'id', 'company_id');

create trigger state_transition_number_health
  after update of state on public.number_health
  for each row when (old.state is distinct from new.state)
  execute function public.state_transition_capture('number_health', 'state', 'phone_number_id', 'company_id');
create trigger state_entered_number_health
  after insert on public.number_health
  for each row when (new.state is not null)
  execute function public.state_transition_capture('number_health', 'state', 'phone_number_id', 'company_id');

create trigger state_transition_payment_request
  after update of status on public.payment_requests
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_capture('payment_request', 'status', 'id', 'company_id');
create trigger state_entered_payment_request
  after insert on public.payment_requests
  for each row when (new.status is not null)
  execute function public.state_transition_capture('payment_request', 'status', 'id', 'company_id');

create trigger state_transition_phone_number
  after update of status on public.phone_numbers
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_capture('phone_number', 'status', 'id', 'company_id');
create trigger state_entered_phone_number
  after insert on public.phone_numbers
  for each row when (new.status is not null)
  execute function public.state_transition_capture('phone_number', 'status', 'id', 'company_id');

create trigger state_transition_port
  after update of status on public.port_requests
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_capture('port', 'status', 'id', 'company_id');
create trigger state_entered_port
  after insert on public.port_requests
  for each row when (new.status is not null)
  execute function public.state_transition_capture('port', 'status', 'id', 'company_id');

create trigger state_transition_port
  after update of porting_status on public.phone_numbers
  for each row when (old.porting_status is distinct from new.porting_status)
  execute function public.state_transition_capture('port', 'porting_status', 'id', 'company_id');
create trigger state_entered_port
  after insert on public.phone_numbers
  for each row when (new.porting_status is not null)
  execute function public.state_transition_capture('port', 'porting_status', 'id', 'company_id');

create trigger state_transition_port_messaging
  after update of messaging_port_status on public.port_requests
  for each row when (old.messaging_port_status is distinct from new.messaging_port_status)
  execute function public.state_transition_capture('port_messaging', 'messaging_port_status', 'id', 'company_id');
create trigger state_entered_port_messaging
  after insert on public.port_requests
  for each row when (new.messaging_port_status is not null)
  execute function public.state_transition_capture('port_messaging', 'messaging_port_status', 'id', 'company_id');

create trigger state_transition_quote
  after update of status on public.quotes
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_capture('quote', 'status', 'id', 'company_id');
create trigger state_entered_quote
  after insert on public.quotes
  for each row when (new.status is not null)
  execute function public.state_transition_capture('quote', 'status', 'id', 'company_id');

create trigger state_transition_text_enablement
  after update of status on public.text_enablement_orders
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_capture('text_enablement', 'status', 'id', 'company_id');
create trigger state_entered_text_enablement
  after insert on public.text_enablement_orders
  for each row when (new.status is not null)
  execute function public.state_transition_capture('text_enablement', 'status', 'id', 'company_id');

create trigger state_transition_data_export
  after update of status on public.data_exports
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_capture('data_export', 'status', 'id', 'company_id');
create trigger state_entered_data_export
  after insert on public.data_exports
  for each row when (new.status is not null)
  execute function public.state_transition_capture('data_export', 'status', 'id', 'company_id');

create trigger state_transition_geocode
  after update of geocode_status on public.contacts
  for each row when (old.geocode_status is distinct from new.geocode_status)
  execute function public.state_transition_capture('geocode', 'geocode_status', 'id', 'company_id');
create trigger state_entered_geocode
  after insert on public.contacts
  for each row when (new.geocode_status is not null)
  execute function public.state_transition_capture('geocode', 'geocode_status', 'id', 'company_id');

create trigger state_transition_geocode
  after update of geocode_status on public.tasks
  for each row when (old.geocode_status is distinct from new.geocode_status)
  execute function public.state_transition_capture('geocode', 'geocode_status', 'id', 'company_id');
create trigger state_entered_geocode
  after insert on public.tasks
  for each row when (new.geocode_status is not null)
  execute function public.state_transition_capture('geocode', 'geocode_status', 'id', 'company_id');

create trigger state_transition_billing_dispute
  after update of status on public.billing_disputes
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_capture('billing_dispute', 'status', 'stripe_dispute_id', 'company_id');
create trigger state_entered_billing_dispute
  after insert on public.billing_disputes
  for each row when (new.status is not null)
  execute function public.state_transition_capture('billing_dispute', 'status', 'stripe_dispute_id', 'company_id');

-- ---------------------------------------------------------------------------
-- 4. Derived machines: the state is computed, so each computes it the way the
--    shared definition documents it, through the SQL functions that already
--    hold that rule (task_state, invite_state, workspace_state,
--    conversation_visibility).
-- ---------------------------------------------------------------------------

-- task: done_at (the source message's when the task has one) and deleted_at.
create or replace function public.state_transition_capture_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text;
  v_to   text := public.task_state(public.task_done_at(new), new.deleted_at);
begin
  if tg_op = 'UPDATE' then
    v_from := public.task_state(public.task_done_at(old), old.deleted_at);
    if v_from = v_to then
      return null;
    end if;
  end if;
  perform public.capture_state_transition('task', new.company_id, new.id::text, v_from, v_to);
  return null;
exception when others then
  raise warning 'state transition capture skipped: %', sqlerrm;
  return null;
end $$;

create trigger state_transition_task
  after update of done_at, deleted_at on public.tasks
  for each row when (old.done_at is distinct from new.done_at
                     or old.deleted_at is distinct from new.deleted_at)
  execute function public.state_transition_capture_task();
create trigger state_entered_task
  after insert on public.tasks
  for each row execute function public.state_transition_capture_task();

-- A task from a message is done when its MESSAGE is, so completing the message
-- moves every task that points at it.
create or replace function public.state_transition_capture_task_via_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t      record;
  v_from text;
  v_to   text;
begin
  for t in
    select k.id, k.company_id, k.deleted_at from public.tasks k where k.message_id = new.id
  loop
    v_from := public.task_state(old.done_at, t.deleted_at);
    v_to := public.task_state(new.done_at, t.deleted_at);
    if v_from <> v_to then
      perform public.capture_state_transition('task', t.company_id, t.id::text, v_from, v_to);
    end if;
  end loop;
  return null;
exception when others then
  raise warning 'state transition capture skipped: %', sqlerrm;
  return null;
end $$;

create trigger state_transition_task_via_message
  after update of done_at on public.messages
  for each row when (old.done_at is distinct from new.done_at)
  execute function public.state_transition_capture_task_via_message();

-- invite: accepted_at, revoked_at, expires_at. Expiry by the clock is not a
-- write, so only an extended or revoked invite shows as a move.
create or replace function public.state_transition_capture_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text;
  v_to   text := public.invite_state(new.accepted_at, new.revoked_at, new.expires_at, now());
begin
  if tg_op = 'UPDATE' then
    v_from := public.invite_state(old.accepted_at, old.revoked_at, old.expires_at, now());
    if v_from = v_to then
      return null;
    end if;
  end if;
  perform public.capture_state_transition('invite', new.company_id, new.id::text, v_from, v_to);
  return null;
exception when others then
  raise warning 'state transition capture skipped: %', sqlerrm;
  return null;
end $$;

create trigger state_transition_invite
  after update of accepted_at, revoked_at, expires_at on public.invites
  for each row when (old.accepted_at is distinct from new.accepted_at
                     or old.revoked_at is distinct from new.revoked_at
                     or old.expires_at is distinct from new.expires_at)
  execute function public.state_transition_capture_invite();
create trigger state_entered_invite
  after insert on public.invites
  for each row execute function public.state_transition_capture_invite();

-- workspace: paused_at, deleted_at, purged_at on companies.
create or replace function public.state_transition_capture_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text;
  v_to   text := public.workspace_state(new.paused_at, new.deleted_at, new.purged_at);
begin
  if tg_op = 'UPDATE' then
    v_from := public.workspace_state(old.paused_at, old.deleted_at, old.purged_at);
    if v_from = v_to then
      return null;
    end if;
  end if;
  perform public.capture_state_transition('workspace', new.id, new.id::text, v_from, v_to);
  return null;
exception when others then
  raise warning 'state transition capture skipped: %', sqlerrm;
  return null;
end $$;

create trigger state_transition_workspace
  after update of paused_at, deleted_at, purged_at on public.companies
  for each row when (old.paused_at is distinct from new.paused_at
                     or old.deleted_at is distinct from new.deleted_at
                     or old.purged_at is distinct from new.purged_at)
  execute function public.state_transition_capture_workspace();
create trigger state_entered_workspace
  after insert on public.companies
  for each row execute function public.state_transition_capture_workspace();

-- conversation_visibility: is_spam and deleted_at on conversations.
create or replace function public.state_transition_capture_conversation_visibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text;
  v_to   text := public.conversation_visibility(new.is_spam, new.deleted_at);
begin
  if tg_op = 'UPDATE' then
    v_from := public.conversation_visibility(old.is_spam, old.deleted_at);
    if v_from = v_to then
      return null;
    end if;
  end if;
  perform public.capture_state_transition(
    'conversation_visibility', new.company_id, new.id::text, v_from, v_to);
  return null;
exception when others then
  raise warning 'state transition capture skipped: %', sqlerrm;
  return null;
end $$;

create trigger state_transition_conversation_visibility
  after update of is_spam, deleted_at on public.conversations
  for each row when (old.is_spam is distinct from new.is_spam
                     or old.deleted_at is distinct from new.deleted_at)
  execute function public.state_transition_capture_conversation_visibility();
create trigger state_entered_conversation_visibility
  after insert on public.conversations
  for each row execute function public.state_transition_capture_conversation_visibility();

-- consent: an append-only ledger, so every row is a state entered. `from` is the
-- contact's previous row.
create or replace function public.state_transition_capture_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text;
begin
  select e.state into v_from
    from public.contact_consent_events e
   where e.contact_id = new.contact_id and e.id <> new.id
   order by e.captured_at desc, e.id desc
   limit 1;
  perform public.capture_state_transition(
    'consent', new.company_id, new.contact_id::text, v_from, new.state);
  return null;
exception when others then
  raise warning 'state transition capture skipped: %', sqlerrm;
  return null;
end $$;

create trigger state_entered_consent
  after insert on public.contact_consent_events
  for each row execute function public.state_transition_capture_consent();

-- ---------------------------------------------------------------------------
-- 5. The audit log: workspace-level machines leave a row on each move. The
--    actor is null (the system), because the statuses are written by providers,
--    crons and webhooks; a person's own action keeps the row its route writes.
--    before and after carry the status only, never customer content.
-- ---------------------------------------------------------------------------
create or replace function public.state_transition_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_to  text  := to_jsonb(new) ->> tg_argv[2];
begin
  if tg_argv[5] <> ''
     and not coalesce(v_to = any (string_to_array(tg_argv[5], ',')), false) then
    return null;
  end if;
  -- A closed workspace is on its way to the purge, which erases the log with it
  -- (audit_log is append-only except for retention), so a row written during the
  -- teardown would only block it. PostHog still has the move.
  if exists (select 1 from public.companies c
              where c.id = (v_new ->> tg_argv[4])::uuid and c.deleted_at is not null) then
    return null;
  end if;
  insert into public.audit_log
    (company_id, actor_user_id, action, target_type, target_id, before, after)
  values
    ((v_new ->> tg_argv[4])::uuid, null, tg_argv[0], tg_argv[1], v_new ->> tg_argv[3],
     jsonb_build_object('status', to_jsonb(old) ->> tg_argv[2]),
     jsonb_build_object('status', v_to));
  return null;
exception when others then
  raise warning 'state transition audit skipped: %', sqlerrm;
  return null;
end $$;

create trigger state_audit_port_status_changed
  after update of status on public.port_requests
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_audit('port.status_changed', 'port_request', 'status', 'id', 'company_id', '');

create trigger state_audit_registration_status_changed
  after update of status on public.messaging_registrations
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_audit('registration.status_changed', 'registration', 'status', 'id', 'company_id', '');

create trigger state_audit_text_enablement_status_changed
  after update of status on public.text_enablement_orders
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_audit('text_enablement.status_changed', 'text_enablement', 'status', 'id', 'company_id', '');

create trigger state_audit_number_status_changed
  after update of status on public.phone_numbers
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_audit('number.status_changed', 'phone_number', 'status', 'id', 'company_id', '');

create trigger state_audit_billing_subscription_status_changed
  after update of subscription_status on public.companies
  for each row when (old.subscription_status is distinct from new.subscription_status)
  execute function public.state_transition_audit('billing.subscription_status_changed', 'subscription', 'subscription_status', 'id', 'id', '');

create trigger state_audit_data_export_status_changed
  after update of status on public.data_exports
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_audit('data_export.status_changed', 'data_export', 'status', 'id', 'company_id', '');

create trigger state_audit_calendar_connection_status_changed
  after update of status on public.calendar_connections
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_audit('calendar.connection_status_changed', 'calendar_connection', 'status', 'id', 'company_id', '');

create trigger state_audit_billing_dispute_status_changed
  after update of status on public.billing_disputes
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_audit('billing.dispute_status_changed', 'billing_dispute', 'status', 'stripe_dispute_id', 'company_id', '');

create trigger state_audit_quote_status_changed
  after update of status on public.quotes
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_audit('quote.status_changed', 'quote', 'status', 'id', 'company_id', '');

create trigger state_audit_payments_request_status_changed
  after update of status on public.payment_requests
  for each row when (old.status is distinct from new.status)
  execute function public.state_transition_audit('payments.request_status_changed', 'payment_request', 'status', 'id', 'company_id', 'paid,expired');

-- ---------------------------------------------------------------------------
-- 6. A restored task. Trashing a task already writes `deleted`; restoring it
--    wrote nothing.
-- ---------------------------------------------------------------------------
create or replace function public.record_activity_on_task_restore()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_number uuid;
begin
  select c.phone_number_id into v_number
    from public.conversations c where c.id = new.conversation_id;
  perform public.record_activity_add(new.company_id, 'task', new.id, 'restored',
    null, 'system', '{}'::jsonb, 'task', new.id, new.conversation_id, v_number,
    null, 'task_restored:' || new.id || ':' || extract(epoch from clock_timestamp())::text);
  return null;
end $$;

create trigger record_activity_from_tasks_restore
  after update of deleted_at on public.tasks
  for each row when (old.deleted_at is not null and new.deleted_at is null)
  execute function public.record_activity_on_task_restore();

-- ---------------------------------------------------------------------------
-- 7. Grants. Hosted Supabase grants EXECUTE on a recreated function by name, so
--    each one is revoked from public, anon and authenticated explicitly. Only
--    the triggers and the owner call them; nothing is granted back.
-- ---------------------------------------------------------------------------
revoke execute on function public.state_transition_expected(text, text, text)
  from public, anon, authenticated;
revoke execute on function public.capture_state_transition(text, uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.state_transition_capture()
  from public, anon, authenticated;
revoke execute on function public.state_transition_capture_task()
  from public, anon, authenticated;
revoke execute on function public.state_transition_capture_task_via_message()
  from public, anon, authenticated;
revoke execute on function public.state_transition_capture_invite()
  from public, anon, authenticated;
revoke execute on function public.state_transition_capture_workspace()
  from public, anon, authenticated;
revoke execute on function public.state_transition_capture_conversation_visibility()
  from public, anon, authenticated;
revoke execute on function public.state_transition_capture_consent()
  from public, anon, authenticated;
revoke execute on function public.state_transition_audit()
  from public, anon, authenticated;
revoke execute on function public.record_activity_on_task_restore()
  from public, anon, authenticated;
