create table public.state_transition_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  machine text not null,
  record_id text not null,
  from_state text,
  to_state text not null,
  expected boolean not null,
  cause text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  available_at timestamptz not null default now()
);

create index state_transition_outbox_available_idx on public.state_transition_outbox (available_at, id);
create index state_transition_outbox_company_idx on public.state_transition_outbox (company_id);
create index state_transition_outbox_occurred_idx on public.state_transition_outbox (occurred_at);

alter table public.state_transition_outbox enable row level security;
revoke all on public.state_transition_outbox from public, anon, authenticated;
grant select, insert, update, delete on public.state_transition_outbox to service_role;

create or replace function public.capture_state_transition(
  p_machine text,
  p_company_id uuid,
  p_record_id text,
  p_from text,
  p_to text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('loonext.deploy_env', true) = 'rig' then
    return;
  end if;
  insert into public.state_transition_outbox
    (company_id, machine, record_id, from_state, to_state, expected, cause)
  values (p_company_id, p_machine, p_record_id, p_from, p_to,
    public.state_transition_expected(p_machine, p_from, p_to),
    left(coalesce(nullif(current_setting('loonext.cause', true), ''),
                  nullif(current_setting('request.path', true), ''), 'database'), 255));
exception when others then
  raise warning 'state transition capture skipped (SQLSTATE %)', sqlstate;
end $$;

revoke execute on function public.capture_state_transition(text, uuid, text, text, text)
  from public, anon, authenticated, service_role;

create function public.api_claim_state_transitions()
returns setof public.state_transition_outbox
language sql
set search_path = ''
as $$
  delete from public.state_transition_outbox where occurred_at < now() - interval '1 day';

  with due as (
    select id from public.state_transition_outbox
    where available_at <= now()
    order by available_at, id
    limit 500
    for update skip locked
  )
  update public.state_transition_outbox o
     set available_at = now() + interval '5 minutes'
    from due
   where o.id = due.id
  returning o.*;
$$;

revoke execute on function public.api_claim_state_transitions() from public, anon, authenticated;
grant execute on function public.api_claim_state_transitions() to service_role;

create function public.api_ack_state_transitions(p_ids uuid[])
returns void
language sql
set search_path = ''
as $$
  delete from public.state_transition_outbox where id = any(p_ids);
$$;

revoke execute on function public.api_ack_state_transitions(uuid[]) from public, anon, authenticated;
grant execute on function public.api_ack_state_transitions(uuid[]) to service_role;

do $migration$
declare
  original text := pg_get_functiondef('public.purge_workspace_step(uuid,integer)'::regprocedure);
  updated text := replace(original, '''usage_events'',', '''usage_events'', ''state_transition_outbox'',');
begin
  if updated = original then
    raise exception 'Workspace purge order changed';
  end if;
  execute updated;
end;
$migration$;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_trigger t
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where not t.tgisinternal and n.nspname = 'supabase_functions' and p.proname = 'http_request'
  ) then
    raise exception 'Migrate database webhooks before removing pg_net';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname <> 'net'
      and (n.nspname, p.proname) not in (
        ('extensions', 'grant_pg_net_access'), ('supabase_functions', 'http_request')
      )
      and p.prosrc ~* '(net[.]http_|supabase_functions[.]http_request)'
  ) then
    raise exception 'Migrate functions that use pg_net before removing it';
  end if;

  if to_regclass('cron.job') is not null then
    if exists (select 1 from cron.job where command ~* '(net[.]http_|supabase_functions[.]http_request)') then
      raise exception 'Migrate database cron jobs before removing pg_net';
    end if;
  end if;
end $$;

drop extension if exists pg_net;
