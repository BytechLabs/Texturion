-- Storage cost hardening (launch-audit #15 / #16; cost-protection mandate).
-- Two holes around the attachments / mms-media buckets are closed here:
--
--   [#15] Orphan reclamation. POST /v1/attachments used to upload the object
--         FIRST and claim the D30 budget second — a rejected claim (or a crash
--         between the two) left a Storage object with no `attachments` row,
--         invisible to the D19 sweep (which selects soft-deleted ROWS only) and
--         to api_storage_usage (which sums rows). The Worker now claims FIRST
--         (a rejection writes nothing anywhere); this migration adds the
--         belt-and-suspenders GC substrate for every remaining crash window:
--         two anti-join scans between public.attachments and storage.objects
--         that the 15-min sweep drains — objects with no row ("orphans", the
--         old ordering's leftovers) and live rows with no object ("ghosts",
--         the new ordering's crash window, which otherwise hold budget forever
--         and 500 on download).
--
--   [#16] Egress metering + cap. GET /v1/attachments/:id/url mints signed
--         Storage URLs for both buckets with no byte accounting — the one
--         provider cost center (Supabase egress, $0.09/GB past 250 GB) with
--         neither cap nor alert (docs/PRICING-AUDIT.md §2/§4 calls egress "the
--         sleeper cost (4x storage)"). This migration adds the per-company
--         egress ledger (`egress_events`), the atomic claim RPC the mint route
--         calls (cap-and-drop: over the plan-derived allowance, the mint is
--         refused), the period-sum RPC the 80%/100% usage-alert cron reads,
--         and the `egress` usage_alerts metric.

-- ===========================================================================
-- [#16] egress_events — one row per signed-URL mint, `bytes` = the object's
-- size_bytes (the downloadable exposure that mint created; the download itself
-- hits Supabase directly and is invisible to the Worker, so the mint is the
-- meterable moment). Same shape/posture as call_records: service-role only,
-- summed per (company, period window) by an api_* RPC. Rows are retention-swept
-- by the attachment sweep cron so the ledger itself can't become a cost center.
-- ===========================================================================
create table public.egress_events (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  bucket     text not null,                              -- 'attachments' | 'mms-media'
  bytes      bigint not null check (bytes >= 0),
  created_at timestamptz not null default now()
);

-- Period-sum read path (company + created_at window), mirroring
-- call_records_company_period_idx.
create index egress_events_company_period_idx
  on public.egress_events (company_id, created_at);

-- Service-role only, like call_records: the rls.sql default-privilege revoke
-- already strips anon/authenticated from future tables; enabling RLS with no
-- end-user policy makes the denial explicit (service_role bypasses RLS).
alter table public.egress_events enable row level security;

-- ---------------------------------------------------------------------------
-- [#16] claim_signed_url_egress — the atomic egress claim the mint route calls
-- BEFORE signing (fail closed: an RPC error means no URL). The guarded-claim
-- idiom of claim_attachment_storage: a per-company advisory xact lock (keyed
-- separately from the storage claim so mints never queue behind uploads)
-- serializes the re-sum and the insert, so N concurrent mints at the allowance
-- can't overshoot by N×25 MB. p_limit_bytes is passed by the Worker (the
-- allowance derives from billing/plans.ts budgets via attachments/egress.ts —
-- the single source of truth stays in code); this function is limit-agnostic.
--
-- Returns jsonb:
--   { "allowed": true,  "used_bytes": <total after this mint> }
--   { "allowed": false, "used_bytes": <total, unchanged> }  -- over, nothing written
-- ---------------------------------------------------------------------------
create or replace function public.claim_signed_url_egress(
  p_company_id  uuid,
  p_since       timestamptz,
  p_bucket      text,
  p_bytes       bigint,
  p_limit_bytes bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used int8;
begin
  if p_bytes is null or p_bytes < 0 then
    raise exception 'claim_signed_url_egress: p_bytes must be >= 0';
  end if;
  if p_limit_bytes is null or p_limit_bytes < 0 then
    raise exception 'claim_signed_url_egress: p_limit_bytes must be >= 0';
  end if;
  -- A NULL window would make every `created_at >= p_since` predicate NULL and
  -- the sum 0 — i.e. an accidental infinite allowance. Fail closed instead.
  if p_since is null then
    raise exception 'claim_signed_url_egress: p_since is required';
  end if;

  -- Serialize per company (distinct lock key from claim_attachment_storage so
  -- a mint never waits on an upload; auto-released at txn end).
  perform pg_advisory_xact_lock(hashtext('egress:' || p_company_id::text));

  -- Re-sum the period's minted bytes under the lock — the authoritative total.
  select coalesce(sum(e.bytes), 0)::int8 into v_used
    from public.egress_events e
   where e.company_id = p_company_id
     and e.created_at >= p_since;

  if v_used + p_bytes > p_limit_bytes then
    return jsonb_build_object('allowed', false, 'used_bytes', v_used);
  end if;

  insert into public.egress_events (company_id, bucket, bytes)
  values (p_company_id, p_bucket, p_bytes);

  return jsonb_build_object('allowed', true, 'used_bytes', v_used + p_bytes);
end $$;

revoke execute on function
  public.claim_signed_url_egress(uuid, timestamptz, text, bigint, bigint)
  from public, anon, authenticated;
grant execute on function
  public.claim_signed_url_egress(uuid, timestamptz, text, bigint, bigint)
  to service_role;

-- ---------------------------------------------------------------------------
-- [#16] api_period_egress_bytes — the read the usage-alert cron (and any usage
-- surface) makes: minted egress bytes since a period start. Server-side sum for
-- the same reason api_period_voice_seconds is an RPC: a PostgREST read would
-- truncate at the row cap.
-- ---------------------------------------------------------------------------
create or replace function public.api_period_egress_bytes(
  p_company_id uuid,
  p_since      timestamptz
) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(e.bytes), 0)::bigint
  from public.egress_events e
  where e.company_id = p_company_id
    and e.created_at >= p_since
$$;

revoke execute on function public.api_period_egress_bytes(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_period_egress_bytes(uuid, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- [#16] usage_alerts: allow the 'egress' metric so the usage-alert cron can
-- warn owners at 80%/100% of the download allowance BEFORE the mint route
-- starts refusing (cap-and-drop with an alert before the cap). Widens the
-- existing metric check; the PK (company_id, period_start, metric, threshold)
-- already keeps it distinct from the other arms.
-- ---------------------------------------------------------------------------
alter table public.usage_alerts drop constraint usage_alerts_metric_check;

alter table public.usage_alerts
  add constraint usage_alerts_metric_check
  check (metric in (
    'segments', 'mms_storage', 'attachment_storage', 'voice_minutes',
    'mms_messages', 'egress'
  ));

-- ===========================================================================
-- [#15] Orphan GC substrate. Both scans are SECURITY DEFINER anti-joins over
-- storage.objects (readable by the migration/postgres role; end-user roles
-- never execute these). The Worker's sweep cron calls them with a cutoff past
-- the grace window and acts on the results:
--   - orphan OBJECTS are removed via the Storage API (a direct DELETE on
--     storage.objects would leave the underlying file behind — only the
--     Storage API reclaims the bytes);
--   - ghost ROWS are hard-deleted via PostgREST (no object exists, so there
--     is nothing to remove — the delete releases the D30 budget they hold).
-- ===========================================================================

-- The orphan-object anti-join probes attachments by storage_path; without an
-- index every candidate object would seq-scan a table that grows with every
-- tenant's files.
create index attachments_storage_path_idx
  on public.attachments (storage_path);

-- Objects in the attachments bucket older than the cutoff with NO attachments
-- row at all (live OR soft-deleted — a soft-deleted row still owns its object
-- until the D19 sweep hard-deletes both). These are unreachable, unaccounted
-- bytes: pre-fix rejected/crashed uploads. Oldest first, bounded per run.
create or replace function public.api_orphan_attachment_objects(
  p_cutoff timestamptz,
  p_limit  int
) returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'attachments'
    and o.created_at < p_cutoff
    and not exists (
      select 1 from public.attachments a
      where a.storage_path = o.name
    )
  order by o.created_at
  limit p_limit
$$;

revoke execute on function public.api_orphan_attachment_objects(timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.api_orphan_attachment_objects(timestamptz, int)
  to service_role;

-- LIVE attachments rows older than the cutoff whose object never landed (the
-- claim-first crash window: claim committed, upload never happened). They hold
-- D30 budget forever and 500 on download; hard-deleting them releases both.
-- The cutoff (grace window ≫ a Worker request lifetime) guarantees no in-flight
-- upload can be swept between its claim and its object write. Soft-deleted rows
-- are excluded — the existing sweep pass owns those.
create or replace function public.api_ghost_attachment_rows(
  p_cutoff timestamptz,
  p_limit  int
) returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from public.attachments a
  where a.deleted_at is null
    and a.created_at < p_cutoff
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'attachments'
        and o.name = a.storage_path
    )
  order by a.created_at
  limit p_limit
$$;

revoke execute on function public.api_ghost_attachment_rows(timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.api_ghost_attachment_rows(timestamptz, int)
  to service_role;
