alter table public.webhook_endpoints add column failure_streak_started_at timestamptz;

create index webhook_deliveries_due_endpoint_idx
  on public.webhook_deliveries (endpoint_id, next_attempt_at, id)
  where status in ('pending', 'delivering');

create index webhook_deliveries_recent_success_idx
  on public.webhook_deliveries (endpoint_id, delivered_at)
  where status = 'succeeded';

create or replace function public.api_claim_webhook_deliveries(p_limit int default 50)
returns setof public.webhook_deliveries
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit <= 0 or p_limit > 500 then
    raise exception 'api_claim_webhook_deliveries: p_limit must be between 1 and 500';
  end if;

  return query
  with ranked as (
    select d.id, d.next_attempt_at,
           row_number() over (partition by d.endpoint_id order by d.next_attempt_at, d.id) as position
      from public.webhook_deliveries d
     where d.status in ('pending', 'delivering') and d.next_attempt_at <= now()
  ), due as (
    select d.id
      from ranked r
      join public.webhook_deliveries d on d.id = r.id
     where r.position <= 10
       and d.status in ('pending', 'delivering') and d.next_attempt_at <= now()
     order by r.next_attempt_at, d.id
     limit p_limit
     for update of d skip locked
  )
  update public.webhook_deliveries d
     set status = 'delivering',
         attempts = d.attempts + 1,
         next_attempt_at = now() + interval '15 minutes'
    from due
   where d.id = due.id
  returning d.*;
end $$;

create function public.api_record_webhook_delivery_outcome(
  p_endpoint_id uuid,
  p_succeeded boolean,
  p_failed integer,
  p_disable_after integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  endpoint public.webhook_endpoints%rowtype;
  observed_at timestamptz := now();
  streak integer;
  streak_started_at timestamptz;
  should_disable boolean;
begin
  select * into endpoint from public.webhook_endpoints
   where id = p_endpoint_id and active for update;
  if not found then return false; end if;

  if p_succeeded then
    update public.webhook_endpoints
       set consecutive_failures = 0, last_success_at = observed_at, failure_streak_started_at = null
     where id = p_endpoint_id;
    return false;
  end if;

  streak := endpoint.consecutive_failures + p_failed;
  streak_started_at := coalesce(endpoint.failure_streak_started_at, observed_at);
  should_disable := streak >= p_disable_after
    and streak_started_at <= observed_at - interval '6 hours'
    and (endpoint.last_success_at is null or endpoint.last_success_at <= observed_at - interval '6 hours')
    and not exists (
      select 1 from public.webhook_deliveries d
      where d.endpoint_id = p_endpoint_id and d.status = 'succeeded'
        and d.delivered_at > observed_at - interval '6 hours'
    );

  update public.webhook_endpoints
     set consecutive_failures = streak,
         last_failure_at = observed_at,
         failure_streak_started_at = streak_started_at,
         active = not should_disable,
         disabled_at = case when should_disable then observed_at else disabled_at end,
         disabled_reason = case when should_disable then 'webhooks.disabled.tooManyFailures' else disabled_reason end
   where id = p_endpoint_id;

  if should_disable then
    insert into public.audit_log (company_id, action, target_type, target_id, before, after)
    values (endpoint.company_id, 'webhook.endpoint_disabled', 'webhook_endpoint', p_endpoint_id::text,
            jsonb_build_object('active', true),
            jsonb_build_object('active', false, 'consecutive_failures', streak));
  end if;
  return should_disable;
end $$;

revoke execute on function public.api_record_webhook_delivery_outcome(uuid, boolean, integer, integer)
  from public, anon, authenticated;
grant execute on function public.api_record_webhook_delivery_outcome(uuid, boolean, integer, integer)
  to service_role;
