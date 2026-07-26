-- ===========================================================================
-- [#261] The signed-URL egress ledger counted MINTS, not exposure.
--
-- Every call to GET /v1/attachments/:id/url claimed the object's full
-- size_bytes again, so re-minting a URL for the SAME object charged the
-- company again — even though the previous URL was still valid and no new
-- bytes had become downloadable. Any member could therefore spend the whole
-- workspace's 200 GB period allowance from one 25 MB attachment with a loop of
-- a few thousand requests, after which every download, gallery page, MMS
-- thumbnail and voicemail in the workspace answered 402 until the billing
-- period rolled. Nothing decrements the ledger and there is no admin reset.
--
-- The fix is to claim per OBJECT rather than per request, and to skip an object
-- already claimed within the lifetime of the URL that claim paid for. Minting
-- again inside that window hands back access the caller already had, so it
-- costs nothing; once the window passes it is genuine new exposure and is
-- charged. Honest use is unaffected (a gallery re-opened a minute later is
-- free, exactly as it is free in reality); the abuse loop converges on one
-- charge per object per window instead of one per request.
--
-- EXPAND/CONTRACT: adds a nullable column and a NEW function name, leaving
-- claim_signed_url_egress in place so the currently-deployed Worker keeps
-- working through the deploy window. The old function is dropped in a later
-- migration once nothing calls it.
-- ===========================================================================

-- The object each claim paid for. Nullable: rows written before this migration
-- have no key and simply never match a dedupe lookup (they still count toward
-- the period sum, which is the honest reading — they were real claims).
alter table public.egress_events
  add column if not exists object_key text;

-- The dedupe lookup: "has this company claimed this object since <cutoff>".
create index if not exists egress_events_company_object_idx
  on public.egress_events (company_id, object_key, created_at)
  where object_key is not null;

-- ---------------------------------------------------------------------------
-- [#261] The set a claim would actually charge for: the request's objects,
-- deduplicated by key (a gallery page can list one object twice), minus
-- anything this company already paid for inside the still-valid window.
--
-- Its own function so the claim below can name the same set twice — for the
-- total and for the insert — without a temp table. Both calls run under the
-- claim's advisory lock, where we are the only writer, so they agree.
-- ---------------------------------------------------------------------------
create or replace function public.egress_claimable_objects(
  p_company_id   uuid,
  p_dedupe_since timestamptz,
  p_objects      jsonb
) returns table (object_key text, bucket text, bytes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (o.key) o.key, o.bucket, coalesce(o.bytes, 0)::int8
    from jsonb_to_recordset(p_objects) as o(key text, bucket text, bytes int8)
   where o.key is not null
     and o.bucket is not null
     and not exists (
       select 1
         from public.egress_events e
        where e.company_id = p_company_id
          and e.object_key = o.key
          and e.created_at >= p_dedupe_since
     )
   order by o.key;
$$;

revoke execute on function public.egress_claimable_objects(uuid, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.egress_claimable_objects(uuid, timestamptz, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- [#261] claim_signed_url_egress_objects — the per-object claim.
--
-- p_objects is a jsonb array of { "key": text, "bucket": text, "bytes": int8 }.
-- p_dedupe_since is the cutoff before which a previous claim no longer counts
-- (the caller passes now() minus the signed-URL TTL it is about to hand out).
--
-- Same guarded-claim idiom as before: one per-company advisory xact lock
-- serializes the re-sum and the insert, so N concurrent mints at the allowance
-- cannot overshoot. Still limit-agnostic — the allowance lives in code.
--
-- Returns jsonb:
--   { "allowed": true,  "used_bytes": <total after this claim>, "claimed_bytes": <charged now> }
--   { "allowed": false, "used_bytes": <total, unchanged>,       "claimed_bytes": 0 }
-- ---------------------------------------------------------------------------
create or replace function public.claim_signed_url_egress_objects(
  p_company_id   uuid,
  p_since        timestamptz,
  p_dedupe_since timestamptz,
  p_objects      jsonb,
  p_limit_bytes  bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used    int8;
  v_claimed int8;
begin
  if p_limit_bytes is null or p_limit_bytes < 0 then
    raise exception 'claim_signed_url_egress_objects: p_limit_bytes must be >= 0';
  end if;
  -- A NULL window would make every `created_at >= p_since` predicate NULL and
  -- the sum 0 — i.e. an accidental infinite allowance. Fail closed instead.
  if p_since is null then
    raise exception 'claim_signed_url_egress_objects: p_since is required';
  end if;
  -- A NULL dedupe cutoff would match nothing and silently restore the
  -- per-request charging this migration exists to remove.
  if p_dedupe_since is null then
    raise exception 'claim_signed_url_egress_objects: p_dedupe_since is required';
  end if;
  if p_objects is null or jsonb_typeof(p_objects) <> 'array' then
    raise exception 'claim_signed_url_egress_objects: p_objects must be a json array';
  end if;

  -- Serialize per company (distinct lock key from claim_attachment_storage so
  -- a mint never waits on an upload; auto-released at txn end).
  perform pg_advisory_xact_lock(hashtext('egress:' || p_company_id::text));

  -- The objects actually worth charging for: deduplicated within the request
  -- (a gallery page can list one object twice) and against anything this
  -- company already paid for inside the still-valid window. Held under the
  -- advisory lock, so the total below and the insert further down see the same
  -- set — we are the only writer.
  select coalesce(sum(f.bytes), 0)::int8 into v_claimed
    from public.egress_claimable_objects(p_company_id, p_dedupe_since, p_objects) f;

  -- Nothing new to charge: the caller already holds live URLs for all of it.
  if v_claimed = 0 then
    select coalesce(sum(e.bytes), 0)::int8 into v_used
      from public.egress_events e
     where e.company_id = p_company_id
       and e.created_at >= p_since;
    return jsonb_build_object(
      'allowed', true, 'used_bytes', v_used, 'claimed_bytes', 0
    );
  end if;

  -- Re-sum the period's minted bytes under the lock — the authoritative total.
  select coalesce(sum(e.bytes), 0)::int8 into v_used
    from public.egress_events e
   where e.company_id = p_company_id
     and e.created_at >= p_since;

  if v_used + v_claimed > p_limit_bytes then
    return jsonb_build_object(
      'allowed', false, 'used_bytes', v_used, 'claimed_bytes', 0
    );
  end if;

  insert into public.egress_events (company_id, bucket, bytes, object_key)
  select p_company_id, f.bucket, f.bytes, f.object_key
    from public.egress_claimable_objects(p_company_id, p_dedupe_since, p_objects) f;

  return jsonb_build_object(
    'allowed', true,
    'used_bytes', v_used + v_claimed,
    'claimed_bytes', v_claimed
  );
end $$;

revoke execute on function public.claim_signed_url_egress_objects(
  uuid, timestamptz, timestamptz, jsonb, bigint
) from public, anon, authenticated;
grant execute on function public.claim_signed_url_egress_objects(
  uuid, timestamptz, timestamptz, jsonb, bigint
) to service_role;
