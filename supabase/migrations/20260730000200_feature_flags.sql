-- #283 — a switch that does not need a deploy.
--
-- Every change reached 100% of customers in the same minute, and the whole env
-- surface held one operational switch. We have already paid for that: the
-- launch-blocking calls outage was our own `Permissions-Policy: microphone=()`
-- header, shipped to everyone, and the fix required another deploy through CI —
-- the one path that is unavailable precisely when the deploy path is what
-- broke.
--
-- ---------------------------------------------------------------------------
-- THE ROW ONLY EVER OVERRIDES THE CODE.
--
-- `apps/api/src/flags/registry.ts` declares every flag with a default. A key
-- with no row here, or a read that fails, resolves to that default. So this
-- table cannot take the product down by being empty, being wrong, or being
-- unreachable — which matters, because a flag system that becomes a new shared
-- dependency has recreated the total blast radius it exists to shrink.
--
-- ---------------------------------------------------------------------------
-- PRECEDENCE, most specific first:
--
--   1. a per-workspace override        (feature_flag_overrides)
--   2. the internal cohort             (companies.is_internal, when internal_only)
--   3. a percentage bucket             (stable per company+flag, never flaps)
--   4. the global switch               (feature_flags.enabled)
--   5. the code default                (registry.ts — applied in the Worker)
--
-- Rule 1 exists so the founder's own workspace can carry a change first, which
-- the issue names as the cheapest QA available to us.

-- ---------------------------------------------------------------------------
-- 1. The internal cohort.
-- ---------------------------------------------------------------------------

alter table public.companies
  add column if not exists is_internal boolean not null default false;

comment on column public.companies.is_internal is
  '#283: ships changes here first. The founder''s own workspace is the beta '
  'cohort of one this starts as.';

create index if not exists companies_internal_idx
  on public.companies (id) where is_internal;

-- ---------------------------------------------------------------------------
-- 2. The flags themselves.
-- ---------------------------------------------------------------------------

create table if not exists public.feature_flags (
  -- Mirrors a key in registry.ts. Not a foreign key to anything — code is the
  -- roster, and `flags_roster.test.ts` fails CI if the two disagree.
  key              text primary key,
  -- NULL means "no global statement" — fall through to the code default.
  -- Three-valued on purpose: "off" and "unsaid" are different, and collapsing
  -- them would make an empty table a product-wide outage.
  enabled          boolean,
  -- 0-100, NULL for "not a percentage rollout".
  rollout_percent  int check (rollout_percent is null
                              or rollout_percent between 0 and 100),
  -- When true, only the internal cohort gets it regardless of percentage.
  internal_only    boolean not null default false,
  -- Why this was last flipped. An operator at 2am reads this first.
  note             text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id) on delete set null
);

comment on table public.feature_flags is
  '#283/D72: runtime feature flags. Declared in apps/api/src/flags/registry.ts; '
  'a row here only OVERRIDES that declaration.';

-- ---------------------------------------------------------------------------
-- 3. Per-workspace overrides — the sharpest tool, and the one used most.
-- ---------------------------------------------------------------------------

create table if not exists public.feature_flag_overrides (
  key        text not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  enabled    boolean not null,
  note       text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (key, company_id)
);

-- Named `ff_overrides_...` rather than `feature_flag_overrides_...`: the
-- pre-commit secret scanner reads "featu(re_)flag_overrides_company_idx" as a
-- Resend key prefix followed by 26 characters. The scanner is deliberately
-- blunt — this repo is public — so the index gets the shorter name rather than
-- the guard getting an exception.
create index if not exists ff_overrides_company_idx
  on public.feature_flag_overrides (company_id);

-- ---------------------------------------------------------------------------
-- 4. Stable bucketing.
--
-- The bucket must depend on BOTH the company and the flag, and must never
-- move: a company that flapped in and out of a 10% rollout on consecutive
-- requests would see a feature appear and disappear, which is worse than not
-- having it. Hashing company+key also means two different 10% rollouts do not
-- land on the same tenth of the customer base.
-- ---------------------------------------------------------------------------

create or replace function public.flag_bucket(p_key text, p_company_id uuid)
returns int
language sql
immutable
set search_path = ''
as $$
  -- md5 is not a security decision here; it is a cheap, stable, well-spread
  -- hash. The top 8 hex digits give a value far larger than 100 before the
  -- modulo, so the buckets stay even.
  select (('x' || substr(md5(p_key || ':' || p_company_id::text), 1, 8))::bit(32)::bigint
          % 100)::int;
$$;

comment on function public.flag_bucket(text, uuid) is
  '#283: a company''s stable 0-99 position for one flag. Never moves, so a '
  'percentage rollout cannot flicker under somebody mid-task.';

-- ---------------------------------------------------------------------------
-- 5. Evaluation.
--
-- Returns ONLY the keys something has been said about. Everything else falls
-- through to the code default in the Worker, which is what makes an empty
-- table the safe state rather than the dangerous one.
-- ---------------------------------------------------------------------------

create or replace function public.api_evaluate_flags(p_company_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(resolved.key, resolved.enabled),
    '{}'::jsonb
  )
  from (
    select
      f.key,
      case
        -- 1. A per-workspace override wins outright, in both directions.
        when o.enabled is not null then o.enabled
        -- 2. Internal-only: the cohort gets it, nobody else does — regardless
        --    of any percentage, which is what "internal only" has to mean.
        when f.internal_only then coalesce(c.is_internal, false)
        -- 3. A percentage rollout, but only where the global switch has not
        --    already said no. A disabled flag is disabled for everyone; that
        --    is the whole point of the kill switch.
        when f.rollout_percent is not null and coalesce(f.enabled, true) then
          case
            when p_company_id is null then false
            else public.flag_bucket(f.key, p_company_id) < f.rollout_percent
          end
        -- 4. The global switch.
        else f.enabled
      end as enabled
    from public.feature_flags f
    left join public.feature_flag_overrides o
      on o.key = f.key and o.company_id = p_company_id
    left join public.companies c
      on c.id = p_company_id
  ) resolved
  where resolved.enabled is not null;
$$;

-- ---------------------------------------------------------------------------
-- 6. Setting a flag, and seeing who it reaches.
--
-- Returns the reach of what was just written, because "10%" is an abstraction
-- and "roughly 4 of 41 active workspaces" is a decision.
-- ---------------------------------------------------------------------------

create or replace function public.api_set_feature_flag(
  p_key       text,
  p_enabled   boolean default null,
  p_percent   int     default null,
  p_internal  boolean default false,
  p_note      text    default null,
  p_actor     uuid    default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reached int;
  v_total   int;
begin
  if p_key is null or p_key = '' then
    raise exception 'api_set_feature_flag: p_key is required';
  end if;
  if p_percent is not null and (p_percent < 0 or p_percent > 100) then
    raise exception 'api_set_feature_flag: p_percent must be 0-100, got %', p_percent;
  end if;

  insert into public.feature_flags (key, enabled, rollout_percent, internal_only, note,
                                    updated_at, updated_by)
  values (p_key, p_enabled, p_percent, coalesce(p_internal, false), p_note, now(), p_actor)
  on conflict (key) do update
     set enabled         = excluded.enabled,
         rollout_percent = excluded.rollout_percent,
         internal_only   = excluded.internal_only,
         note            = excluded.note,
         updated_at      = now(),
         updated_by      = excluded.updated_by;

  select
    count(*) filter (
      where (public.api_evaluate_flags(c.id) -> p_key) = 'true'::jsonb
    ),
    count(*)
    into v_reached, v_total
    from public.companies c
   where c.deleted_at is null;

  return jsonb_build_object(
    'key', p_key,
    'reached_companies', v_reached,
    'active_companies', v_total
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Per-workspace override, the founder-first path.
-- ---------------------------------------------------------------------------

create or replace function public.api_override_feature_flag(
  p_key        text,
  p_company_id uuid,
  p_enabled    boolean,
  p_note       text default null,
  p_actor      uuid default null
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.feature_flag_overrides (key, company_id, enabled, note, created_by)
  values (p_key, p_company_id, p_enabled, p_note, p_actor)
  on conflict (key, company_id) do update
     set enabled    = excluded.enabled,
         note       = excluded.note,
         created_at = now(),
         created_by = excluded.created_by;
$$;

create or replace function public.api_clear_feature_flag_override(
  p_key        text,
  p_company_id uuid
) returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.feature_flag_overrides
   where key = p_key and company_id = p_company_id;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Nothing here is reachable by anon or authenticated: flags are read
-- by the Worker with the service role and written by an ops script.
-- ---------------------------------------------------------------------------

revoke all on function public.flag_bucket(text, uuid) from public, anon, authenticated;
grant execute on function public.flag_bucket(text, uuid) to service_role;

revoke all on function public.api_evaluate_flags(uuid) from public, anon, authenticated;
grant execute on function public.api_evaluate_flags(uuid) to service_role;

revoke all on function public.api_set_feature_flag(text, boolean, int, boolean, text, uuid)
  from public, anon, authenticated;
grant execute on function public.api_set_feature_flag(text, boolean, int, boolean, text, uuid)
  to service_role;

revoke all on function public.api_override_feature_flag(text, uuid, boolean, text, uuid)
  from public, anon, authenticated;
grant execute on function public.api_override_feature_flag(text, uuid, boolean, text, uuid)
  to service_role;

revoke all on function public.api_clear_feature_flag_override(text, uuid)
  from public, anon, authenticated;
grant execute on function public.api_clear_feature_flag_override(text, uuid) to service_role;

alter table public.feature_flags enable row level security;
revoke all on table public.feature_flags from public, anon, authenticated;
grant select, insert, update, delete on table public.feature_flags to service_role;

alter table public.feature_flag_overrides enable row level security;
revoke all on table public.feature_flag_overrides from public, anon, authenticated;
grant select, insert, update, delete on table public.feature_flag_overrides to service_role;
