-- #304 — an export somebody can hand to a bookkeeper, a lawyer or an adjuster.
--
-- #227 built the privacy dump: everything the workspace holds, driven by a
-- legal right. That is not a usable answer to "send me last month's texts with
-- the Elgin Street customer", which is the case #304 opens with and calls
-- time-sensitive: a dispute or an insurance claim, where the current answer is
-- screenshots.
--
-- The two exports share their plumbing — the queue, the bucket, the reaper,
-- the short-lived signed URLs, the audit line — and this migration is what
-- lets one table carry both.
--
-- ── THE DECISION THAT SHAPES THIS FILE ────────────────────────────────────
--
-- `request_data_export` allows ONE export in flight per workspace, on cost
-- grounds, and that reasoning is right and stays: "ten queued at once is ten
-- times the read and ten copies in the bucket, for a button somebody clicked
-- twice."
--
-- But it is a rule about COST, and it was written when every export was the
-- whole workspace. Left as it is, an owner asking for one customer's thread —
-- because an adjuster wants it today — waits behind a bookkeeper's full dump
-- of two hundred thousand messages. The cost protection is not what makes that
-- happen; the shared queue slot is.
--
-- So the lock scopes to the KIND. One full dump at a time, one scoped export
-- at a time, which keeps the protection exactly where the cost is and stops it
-- standing in front of a small urgent read.

-- ---------------------------------------------------------------------------
-- What kind of export this is, and what it was asked for.
-- ---------------------------------------------------------------------------
alter table public.data_exports
  add column kind text not null default 'workspace'
    check (kind in ('workspace', 'conversation_history'));

comment on column public.data_exports.kind is
  '#304: `workspace` is the #227 privacy dump — everything, driven by a legal '
  'right. `conversation_history` is one contact over a date range, for a human '
  'recipient. Defaulted so every row that predates this is what it always was.';

-- The filters the request was made with, and the reason the export is
-- reproducible: a row that says only "conversation_history" cannot tell an
-- owner six months later WHICH history somebody took.
alter table public.data_exports
  add column filters jsonb not null default '{}'::jsonb;

comment on column public.data_exports.filters is
  '#304: what was asked for — contact, date range. Read back on the audit '
  'screen, because "who exported what" is the question an owner asks after '
  'somebody leaves (#276), and the kind alone does not answer it.';

-- ---------------------------------------------------------------------------
-- The queue read, per kind.
-- ---------------------------------------------------------------------------
drop index if exists public.data_exports_pending_idx;
create index data_exports_pending_idx
  on public.data_exports (kind, status, requested_at)
  where status in ('pending', 'running');

-- ---------------------------------------------------------------------------
-- Request an export — now of a KIND, and at most one of each in flight.
-- ---------------------------------------------------------------------------
create or replace function public.request_data_export(
  p_company_id uuid,
  p_user_id    uuid,
  p_ttl        interval default interval '7 days',
  -- Defaulted, so the #227 call site is unchanged and still means the dump.
  p_kind       text default 'workspace',
  p_filters    jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_id uuid;
begin
  if p_kind not in ('workspace', 'conversation_history') then
    raise exception 'request_data_export: unknown kind %', p_kind;
  end if;

  -- Serialize per company AND KIND, so two clicks cannot both see "nothing in
  -- flight" while an urgent scoped export still gets past a running dump.
  perform pg_advisory_xact_lock(
    hashtext('data_export:' || p_company_id::text || ':' || p_kind)
  );

  select id into v_existing
    from public.data_exports
   where company_id = p_company_id
     and kind = p_kind
     and status in ('pending', 'running')
   order by requested_at
   limit 1;
  if v_existing is not null then
    return jsonb_build_object('outcome', 'in_flight', 'export_id', v_existing);
  end if;

  insert into public.data_exports
    (company_id, requested_by, expires_at, kind, filters)
  values
    (p_company_id, p_user_id, now() + p_ttl, p_kind, coalesce(p_filters, '{}'::jsonb))
  returning id into v_id;

  return jsonb_build_object('outcome', 'queued', 'export_id', v_id);
end $$;

revoke execute on function
  public.request_data_export(uuid, uuid, interval, text, jsonb)
  from public, anon, authenticated;
grant execute on function
  public.request_data_export(uuid, uuid, interval, text, jsonb)
  to service_role;

-- The four-argument form is gone: leaving it would mean two functions with the
-- same name, and a caller that forgot the kind would silently get the dump.
drop function if exists public.request_data_export(uuid, uuid, interval);
