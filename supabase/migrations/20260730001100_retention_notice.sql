-- #284 — tell somebody BEFORE anything is destroyed.
--
-- The issue's last scope line is the one that decides this feature's
-- reputation: *"users must never discover retention by losing something."*
--
-- So the warning comes first, and deliberately without the deletion. What
-- ships here answers "what is about to age out, and who needs telling" — the
-- same question the enforcement job will ask, from the same function, so the
-- notice and the deletion can never disagree about which data is at stake.
--
-- ---------------------------------------------------------------------------
-- NOTHING HERE DELETES ANYTHING, AND THAT IS THE POINT OF THE ORDER.
--
-- D77 fixed the numbers. Legal hold shipped so destruction can be suspended.
-- The workspace can choose a shorter window. This adds the warning. Only then
-- is enforcement a small, well-lit change rather than the whole feature at
-- once — and it is the only piece that can destroy something.

create table if not exists public.retention_notices (
  company_id  uuid not null references public.companies(id) on delete cascade,
  -- The window this notice was about. A workspace that SHORTENS its retention
  -- must be warned again, because the data now at risk is different data.
  window_days int not null,
  sent_at     timestamptz not null default now(),
  -- How much was at stake when we wrote. Kept so a later complaint can be
  -- answered with what they were actually told.
  message_count int not null default 0,
  primary key (company_id, window_days)
);

comment on table public.retention_notices is
  '#284: one notice per workspace per retention window. Re-warns when the '
  'window changes, because shortening it puts different data at risk.';

/**
 * What is inside the last 30 days of its life, per workspace.
 *
 * ONE definition, shared with the enforcement job when it exists. If the
 * notice and the deletion computed this separately they would drift, and the
 * drift would be somebody warned about one thing and losing another.
 *
 * Legal hold excludes a workspace entirely: nothing is at risk there, so a
 * warning would be false and alarming at the worst possible moment.
 */
create or replace function public.api_retention_due(p_warn_days int default 30)
returns table (
  company_id    uuid,
  company_name  text,
  window_days   int,
  message_count bigint,
  oldest_at     timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.name,
    public.effective_retention_days(c.id),
    count(m.id),
    min(m.created_at)
  from public.companies c
  join public.conversations v on v.company_id = c.id
  join public.messages m on m.conversation_id = v.id
  where c.deleted_at is null
    -- A held workspace has nothing at risk, so warning it would be false.
    and c.legal_hold_at is null
    and m.created_at
        < now() - make_interval(days => public.effective_retention_days(c.id))
                + make_interval(days => greatest(p_warn_days, 1))
  group by c.id, c.name
  having count(m.id) > 0;
$$;

/** Record that a workspace was told, so it is told once per window. */
create or replace function public.api_record_retention_notice(
  p_company_id uuid,
  p_window     int,
  p_count      int
) returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with claimed as (
    insert into public.retention_notices (company_id, window_days, message_count)
    values (p_company_id, p_window, p_count)
    on conflict (company_id, window_days) do nothing
    returning 1
  )
  select exists (select 1 from claimed);
$$;

revoke all on function public.api_retention_due(int) from public, anon, authenticated;
grant execute on function public.api_retention_due(int) to service_role;

revoke all on function public.api_record_retention_notice(uuid, int, int)
  from public, anon, authenticated;
grant execute on function public.api_record_retention_notice(uuid, int, int) to service_role;

alter table public.retention_notices enable row level security;
revoke all on table public.retention_notices from public, anon, authenticated;
grant select, insert, update, delete on table public.retention_notices to service_role;
