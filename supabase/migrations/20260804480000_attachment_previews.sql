-- #240 item 1 — serve a derivative, not the original.
--
-- A note attachment is capped at 25 MB and ten per note (D19 §2.4). A thread
-- with a few of those in it re-fetches every one of them on every scroll, for
-- every member of the crew, against a fixed 200 GB egress allowance (D34) — and
-- on the tech's own mobile data (#289). The image on screen is a few hundred
-- pixels wide; the bytes are a 25 MB original.
--
-- ---------------------------------------------------------------------------
-- WHY A STORED OBJECT AND NOT A TRANSFORM AT SIGN TIME.
--
-- The obvious route is Supabase Storage image transformations, which would need
-- no new column at all. Its billing unit decided against it: as of 2026-08-04
-- the pricing page reads "100 origin images included, then $5 per 1000 origin
-- images", counted per BILLING PERIOD — so a photo that stays in view costs
-- again every month, forever, and the total scales with how much customers look
-- at their own threads. That is an uncapped recurring cost center, which the
-- founder's standing cost rule does not allow without a cap, and capping it
-- would mean a thread that stops rendering images.
--
-- A stored derivative costs storage, which D34 already made free and which runs
-- ~$0.021/GB-month against ~$0.09/GB served. A preview is ~1-2% of its
-- original, so the object it saves pays for itself the first time somebody
-- scrolls past it.
--
-- ---------------------------------------------------------------------------
-- WHY THE UPLOADER MAKES IT.
--
-- Because the device that is uploading has already decoded the image — it just
-- showed it to the person in a picker — so the resize is free there and costs
-- us nothing at all. The alternatives both buy something we would then have to
-- cap: a transform API bills per image, and decoding a 25 MB JPEG inside a
-- Worker buys CPU time and a WASM codec in the bundle.
--
-- It also shrinks the UPLOAD, which is the half of #289 nobody was going to
-- fix otherwise: a tech on a job site sending five photos over LTE.
--
-- Both columns are nullable and stay nullable. A row without a preview serves
-- its original, which is exactly what happens today — so every attachment
-- uploaded before this, and any client that does not send one, keeps working.

alter table public.attachments
  add column if not exists preview_path  text,
  add column if not exists preview_bytes bigint;

comment on column public.attachments.preview_path is
  '#240: object path of the bounded preview the uploader generated, or null. '
  'Thread and gallery views are served this; the original is served only on an '
  'explicit full-size view or download.';
comment on column public.attachments.preview_bytes is
  '#240: size of the preview object, so the egress claim charges what is '
  'actually served rather than what the row happens to carry.';

-- ---------------------------------------------------------------------------
-- The orphan sweep would eat them.
--
-- #15's pass 2 removes any object in the bucket with no `attachments` row
-- pointing at it, which is the correct rule for a table where one row means one
-- object. A preview is a second object under one row, so without this it would
-- be swept the moment it aged past the cutoff — silently, and only for files
-- old enough that nobody was watching.
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
         or a.preview_path = o.name
    )
  order by o.created_at
  limit p_limit
$$;

revoke execute on function public.api_orphan_attachment_objects(timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.api_orphan_attachment_objects(timestamptz, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- Stored bytes are stored bytes.
--
-- Two readers sum this table and neither may start under-counting: the D34
-- abuse tripwire (api_storage_usage, also the owner-facing usage arm) and the
-- per-workspace cost report (#240 item 4, api_storage_fleet). A preview is real
-- storage we pay for, and a bill does not care which of a row's two objects a
-- byte belongs to.
--
-- Summed as ONE expression per row rather than two column sums added together:
-- `size_bytes` is nullable, `sum()` skips nulls, and `null + 12` is null — so
-- the two-sum spelling silently drops every preview byte belonging to a row
-- whose original size was never recorded.
--
-- Amended in place rather than given a column of their own in the output. The
-- split an owner cares about is note media versus MMS media, which is what
-- these already report; "original versus preview" is our implementation detail,
-- and putting it on a usage screen would invite the question of whether they
-- can turn it off.
create or replace function public.api_storage_usage(
  p_company_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'attachments_bytes', coalesce((
      select sum(coalesce(a.size_bytes, 0) + coalesce(a.preview_bytes, 0))
      from public.attachments a
      where a.company_id = p_company_id
        and a.deleted_at is null
    ), 0)::bigint,
    'mms_bytes', coalesce((
      select sum(m.size_bytes)
      from public.message_attachments m
      where m.company_id = p_company_id
    ), 0)::bigint
  )
$$;

revoke execute on function public.api_storage_usage(uuid)
  from public, anon, authenticated;
grant execute on function public.api_storage_usage(uuid) to service_role;

create or replace function public.api_storage_fleet(
  p_days  int default 30,
  p_limit int default 200
)
returns table (
  company_id      uuid,
  company_name    text,
  stored_bytes    bigint,
  added_bytes     bigint,
  egress_bytes    bigint,
  monthly_cost_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with window_start as (
    select now() - make_interval(days => greatest(p_days, 1)) as since
  ),
  stored as (
    select
      c.id,
      c.name,
      coalesce((
        select sum(coalesce(a.size_bytes, 0) + coalesce(a.preview_bytes, 0))
          from public.attachments a
         where a.company_id = c.id and a.deleted_at is null
      ), 0)
      + coalesce((
        select sum(m.size_bytes) from public.message_attachments m
         where m.company_id = c.id
      ), 0) as stored_bytes,
      coalesce((
        select sum(coalesce(a.size_bytes, 0) + coalesce(a.preview_bytes, 0))
          from public.attachments a, window_start w
         where a.company_id = c.id and a.deleted_at is null
           and a.created_at >= w.since
      ), 0)
      + coalesce((
        select sum(m.size_bytes) from public.message_attachments m, window_start w
         where m.company_id = c.id and m.created_at >= w.since
      ), 0) as added_bytes,
      coalesce((
        select sum(e.bytes) from public.egress_events e, window_start w
         where e.company_id = c.id and e.created_at >= w.since
      ), 0) as egress_bytes
    from public.companies c
    where c.deleted_at is null
  )
  select
    id,
    name,
    stored_bytes::bigint,
    added_bytes::bigint,
    egress_bytes::bigint,
    -- storageGbMonth 2.1 and egressGb 9, both CENTS per GB (billing/costs.ts:
    -- $0.021/GB/mo and $0.09/GB). Stored bytes are a monthly rent; egress is
    -- what the window actually spent, so the two sum to "what this workspace
    -- costs us in a month that looks like this one".
    round(
      (stored_bytes::numeric / 1073741824) * 2.1
      + (egress_bytes::numeric / 1073741824) * 9
    )::bigint
  from stored
  -- Zero-byte workspaces are the majority and say nothing; a report nobody can
  -- scan is one nobody reads.
  where stored_bytes > 0 or egress_bytes > 0
  order by
    (stored_bytes::numeric / 1073741824) * 2.1
    + (egress_bytes::numeric / 1073741824) * 9 desc
  limit greatest(p_limit, 1);
$$;

revoke execute on function public.api_storage_fleet(int, int)
  from public, anon, authenticated;
grant execute on function public.api_storage_fleet(int, int) to service_role;
