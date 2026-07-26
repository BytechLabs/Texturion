-- ===========================================================================
-- [#231] audit_log — who changed what in this workspace.
--
-- A crew churns, and the owner is liable for what happens on their number. The
-- questions they eventually ask — who removed that contact, who turned off the
-- missed-call text-back three weeks ago, did the person we let go on Friday
-- take the contact list on the way out — have had one honest answer so far:
-- we don't know. For a product whose premise is that the business owns its
-- number and its history, that is the wrong answer, and it is the one feature
-- that cannot be added retroactively: the day it is needed it must already
-- have been running for months.
--
-- APPEND-ONLY IS ENFORCED HERE, not in application code — that is the entire
-- point of the table. UPDATE and DELETE raise, for every role including
-- service_role, so no route and no compromised key can rewrite history. The
-- one exception is retention (api_prune_audit_log below), which sets a
-- transaction-local flag the trigger recognises and can only remove rows past
-- the window.
--
-- Coverage is the PRIVILEGED surface, not everything: logging every message
-- send would be noise and an unbounded bill, and the message record is already
-- immutable. Membership, access, settings, billing and bulk contact operations
-- are what an incident timeline is made of.
-- ===========================================================================

create table public.audit_log (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  -- NULL actor = the system acted (a cron, a provider webhook). A row is never
  -- attributed to nobody by accident: the writer passes it explicitly.
  actor_user_id uuid references auth.users(id) on delete restrict,
  -- Where the action came from. Both are best-effort request metadata (a
  -- proxy can omit either), kept because "signed in from a new place" is the
  -- first thing anyone looks at after a phishing report.
  actor_ip      text,
  actor_agent   text,
  -- Free text rather than an enum ON PURPOSE: the privileged surface grows
  -- with the product, and needing a migration to record a new kind of action
  -- is how audit coverage quietly stops keeping up. The writer's union type
  -- (apps/api/src/audit/log.ts) is the contract.
  action        text not null check (length(action) between 1 and 100),
  target_type   text not null check (length(target_type) between 1 and 60),
  target_id     text,
  -- The change itself. Whatever a reader needs to answer "what did this do",
  -- and never message bodies or customer content — those live in the record
  -- proper and would turn the log into a second copy of the inbox.
  before        jsonb not null default '{}'::jsonb,
  after         jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now()
);

-- The history screen's read path: newest-first per company, optionally
-- narrowed to one person.
create index audit_log_company_time_idx
  on public.audit_log (company_id, occurred_at desc);
create index audit_log_company_actor_time_idx
  on public.audit_log (company_id, actor_user_id, occurred_at desc);

-- Service-role only, like call_records and egress_events: the rls.sql
-- default-privilege revoke already strips anon/authenticated from future
-- tables; enabling RLS with no end-user policy makes the denial explicit.
alter table public.audit_log enable row level security;

-- ---------------------------------------------------------------------------
-- Append-only. An audit log a customer (or an attacker holding their session)
-- can edit is worse than none: it reads as evidence while being anything but.
-- Retention identifies itself with a transaction-local flag; nothing else can
-- set it, because nothing else is granted the function that does.
-- ---------------------------------------------------------------------------
create or replace function public.audit_log_is_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and current_setting('loonext.audit_retention', true) = 'on' then
    return old;  -- the retention prune, and only it
  end if;
  raise exception
    'audit_log is append-only: % is not permitted', tg_op
    using errcode = 'restrict_violation';
end $$;

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.audit_log_is_append_only();

-- Same posture as every other definer function here: nobody but the trigger
-- (which runs as its owner) gets to call it.
revoke execute on function public.audit_log_is_append_only()
  from public, anon, authenticated;

-- Belt-and-braces alongside the trigger: no role holds the privilege either.
revoke update, delete, truncate on public.audit_log from public, anon, authenticated, service_role;
grant select, insert on public.audit_log to service_role;

-- ---------------------------------------------------------------------------
-- [#231] Retention with a cost cap. An unbounded log is an unbounded bill, and
-- the ledger is written on every privileged action forever. Oldest-first and
-- batched, so a backlog drains over consecutive days rather than one cron run
-- holding a long delete. Returns the number of rows removed.
-- ---------------------------------------------------------------------------
create or replace function public.api_prune_audit_log(
  p_before timestamptz,
  p_limit  int
) returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted int;
begin
  if p_before is null then
    raise exception 'api_prune_audit_log: p_before is required';
  end if;
  if p_limit is null or p_limit <= 0 then
    raise exception 'api_prune_audit_log: p_limit must be > 0';
  end if;

  -- Transaction-local, so the append-only trigger relaxes for this statement
  -- and nothing else — not the rest of the session, not a later request on a
  -- pooled connection.
  perform set_config('loonext.audit_retention', 'on', true);

  with doomed as (
    select id from public.audit_log
     where occurred_at < p_before
     order by occurred_at
     limit p_limit
  )
  delete from public.audit_log a using doomed d where a.id = d.id;
  get diagnostics v_deleted = row_count;

  perform set_config('loonext.audit_retention', 'off', true);
  return v_deleted;
end $$;

revoke execute on function public.api_prune_audit_log(timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.api_prune_audit_log(timestamptz, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- [#231] The history screen's page: newest-first, keyset-paginated, optionally
-- narrowed by actor, action and date. Kept as one function so the screen, the
-- CSV export and the mobile list all read the same rows through the same
-- scoping — a filter that exists on one and not the others is how a log stops
-- being trustworthy.
-- ---------------------------------------------------------------------------
create or replace function public.api_list_audit_log(
  p_company_id uuid,
  p_limit      int,
  p_actor      uuid default null,
  p_action     text default null,
  p_since      timestamptz default null,
  p_until      timestamptz default null,
  p_cursor_ts  timestamptz default null,
  p_cursor_id  uuid default null
) returns table (
  id            uuid,
  actor_user_id uuid,
  actor_name    text,
  actor_ip      text,
  action        text,
  target_type   text,
  target_id     text,
  before        jsonb,
  after         jsonb,
  occurred_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id,
         a.actor_user_id,
         p.display_name,
         a.actor_ip,
         a.action,
         a.target_type,
         a.target_id,
         a.before,
         a.after,
         a.occurred_at
    from public.audit_log a
    left join public.profiles p on p.user_id = a.actor_user_id
   where a.company_id = p_company_id
     and (p_actor  is null or a.actor_user_id = p_actor)
     and (p_action is null or a.action = p_action)
     and (p_since  is null or a.occurred_at >= p_since)
     and (p_until  is null or a.occurred_at <  p_until)
     and (
       p_cursor_ts is null
       or a.occurred_at < p_cursor_ts
       or (a.occurred_at = p_cursor_ts and a.id < p_cursor_id)
     )
   order by a.occurred_at desc, a.id desc
   limit p_limit;
$$;

revoke execute on function public.api_list_audit_log(
  uuid, int, uuid, text, timestamptz, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.api_list_audit_log(
  uuid, int, uuid, text, timestamptz, timestamptz, timestamptz, uuid
) to service_role;
