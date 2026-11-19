alter table public.webhook_events
  add column next_attempt_at timestamptz,
  add column abandoned_at timestamptz;

update public.webhook_events
   set abandoned_at = received_at
 where processed_at is null
   and attempts >= 5
   and (
     received_at < now() - interval '30 days'
     or (provider = 'telnyx' and not (event_type like any (
       array['message.%', '10dlc.%', 'porting_order.%', 'portout.%']
     )))
   );

update public.webhook_events
   set next_attempt_at = now()
 where processed_at is null
   and abandoned_at is null
   and attempts > 0;

create index webhook_events_retry_at_idx
  on public.webhook_events (next_attempt_at nulls first, received_at)
  where processed_at is null and abandoned_at is null;

create index webhook_events_abandoned_received_idx
  on public.webhook_events (received_at)
  where abandoned_at is not null;

create or replace function public.api_prune_webhook_events(
  p_before timestamptz,
  p_limit integer
)
returns integer
language sql
security definer
set search_path = ''
as $$
  with doomed as (
    select provider, event_id
      from public.webhook_events
     where (processed_at is not null or abandoned_at is not null)
       and received_at < p_before
     order by received_at
     limit greatest(p_limit, 0)
     for update skip locked
  ), removed as (
    delete from public.webhook_events as events
    using doomed
    where events.provider = doomed.provider and events.event_id = doomed.event_id
    returning 1
  )
  select count(*)::int from removed;
$$;

create function public.thread_inbound_message(
  p_company_id uuid,
  p_phone_number_id uuid,
  p_from_e164 text,
  p_body text,
  p_telnyx_message_id text,
  p_timezone text,
  p_email_limit integer,
  p_push_limit integer,
  p_notify_emergency boolean,
  p_notify_media_count integer,
  p_occurred_at timestamptz,
  p_notify_opt_out_hint boolean default false,
  p_reaction jsonb default null
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.thread_inbound_message(
    p_company_id, p_phone_number_id, p_from_e164, p_body, p_telnyx_message_id,
    p_timezone, p_email_limit, p_push_limit, p_notify_emergency, p_notify_media_count,
    p_notify_opt_out_hint, p_reaction
  ) || jsonb_build_object(
    'allow_automated_reply',
    p_occurred_at is null or p_occurred_at >= now() - interval '15 minutes'
  );
$$;

revoke execute on function public.thread_inbound_message(
  uuid, uuid, text, text, text, text, integer, integer, boolean, integer, timestamptz, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.thread_inbound_message(
  uuid, uuid, text, text, text, text, integer, integer, boolean, integer, timestamptz, boolean, jsonb
) to service_role;
