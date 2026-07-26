-- ===========================================================================
-- [#227] Self-serve data export.
--
-- PIPEDA and Quebec Law 25 both carry a portability right, and Law 25's came
-- into force in 2024. Today the only way to get a copy of a workspace's data
-- is to ask us, which means the right exists on our privacy page and nowhere
-- else.
--
-- IT IS A QUEUED JOB, NOT A REQUEST. A busy workspace has tens of thousands of
-- messages; building that inside an HTTP request would blow the Worker's
-- limits on exactly the customers most likely to want it. The request enqueues,
-- a cron builds it in bounded pages, and the customer is emailed when it is
-- ready.
--
-- Output is JSONL per table plus a manifest — machine-readable, so it can be
-- loaded somewhere else, which is the entire point of portability.
-- ===========================================================================

-- Private bucket. Exports contain everything a workspace holds, so a public
-- bucket would be the single worst object store in the product.
insert into storage.buckets (id, name, public)
values ('exports', 'exports', false)
on conflict (id) do nothing;

create table if not exists public.data_exports (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  requested_by  uuid not null references auth.users(id) on delete restrict,
  status        text not null default 'pending'
                check (status in ('pending', 'running', 'ready', 'failed')),
  -- Where the files live: `exports/<company>/<export>/…`. Null until the job
  -- writes the first one.
  storage_prefix text,
  -- What was written, per table. The customer's receipt AND our evidence that
  -- the export is complete rather than truncated.
  row_counts    jsonb not null default '{}'::jsonb,
  -- Resume position: which tables are finished. No cursor column needed beyond
  -- this — each table is written whole before the next begins.
  completed_tables jsonb not null default '[]'::jsonb,
  error         text,
  requested_at  timestamptz not null default now(),
  started_at    timestamptz,
  completed_at  timestamptz,
  -- Exports are a copy of everything; they should not sit in a bucket forever.
  expires_at    timestamptz
);

-- The queue read: oldest unfinished first.
create index if not exists data_exports_pending_idx
  on public.data_exports (status, requested_at)
  where status in ('pending', 'running');

-- The workspace's own list, newest first.
create index if not exists data_exports_company_idx
  on public.data_exports (company_id, requested_at desc);

alter table public.data_exports enable row level security;

-- ---------------------------------------------------------------------------
-- [#227] Request an export, at most one in flight per workspace.
--
-- Cost protection (the standing mandate): an export reads every row a
-- workspace has and writes a copy of it. Ten queued at once is ten times the
-- read and ten copies in the bucket, for a button somebody clicked twice. One
-- at a time, and the second click gets told about the first rather than
-- silently making another.
--
-- Returns jsonb:
--   { "outcome": "queued",   "export_id": … }
--   { "outcome": "in_flight","export_id": … }  -- one already building
-- ---------------------------------------------------------------------------
create or replace function public.request_data_export(
  p_company_id uuid,
  p_user_id    uuid,
  p_ttl        interval default interval '7 days'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_id uuid;
begin
  -- Serialize per company so two clicks cannot both see "nothing in flight".
  perform pg_advisory_xact_lock(hashtext('data_export:' || p_company_id::text));

  select id into v_existing
    from public.data_exports
   where company_id = p_company_id and status in ('pending', 'running')
   order by requested_at
   limit 1;
  if v_existing is not null then
    return jsonb_build_object('outcome', 'in_flight', 'export_id', v_existing);
  end if;

  insert into public.data_exports (company_id, requested_by, expires_at)
  values (p_company_id, p_user_id, now() + p_ttl)
  returning id into v_id;

  return jsonb_build_object('outcome', 'queued', 'export_id', v_id);
end $$;

revoke execute on function public.request_data_export(uuid, uuid, interval)
  from public, anon, authenticated;
grant execute on function public.request_data_export(uuid, uuid, interval)
  to service_role;

-- ---------------------------------------------------------------------------
-- [#227] Record one finished table and its row count.
--
-- Called after each table's files are safely in the bucket, so an interrupted
-- run resumes at the next table rather than rewriting what is already there.
-- ---------------------------------------------------------------------------
create or replace function public.record_export_table(
  p_export_id uuid,
  p_table     text,
  p_rows      int
) returns void
language sql
security definer
set search_path = ''
as $$
  update public.data_exports
     set completed_tables = completed_tables || to_jsonb(p_table),
         row_counts = row_counts || jsonb_build_object(p_table, p_rows),
         status = 'running',
         started_at = coalesce(started_at, now())
   where id = p_export_id;
$$;

revoke execute on function public.record_export_table(uuid, text, int)
  from public, anon, authenticated;
grant execute on function public.record_export_table(uuid, text, int) to service_role;
