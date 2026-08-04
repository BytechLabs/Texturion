-- #240 item 3 — the same file, stored once.
--
-- "A 25 MB file forwarded into three threads is 75 MB." Note attachments are
-- capped at 25 MB and ten per note (D19 §2.4), so the duplicate case is the
-- expensive one: a crew that shares the same spec sheet, warranty PDF or site
-- photo across jobs pays for it every time.
--
-- ---------------------------------------------------------------------------
-- WHY NOW, ON A FLEET THAT STORES 2 MB.
--
-- Measured on production 2026-08-04: 2 live note attachments totalling 990 KB,
-- 4 MMS media totalling 1.1 MB, across 3 workspaces. Deduplication saves
-- nothing today and will not save anything for a long time.
--
-- It is built now because the COST OF BUILDING IT grows and the benefit does
-- not shrink. Every hash is computed at upload; adding the column later means
-- backfilling by re-reading every object in the bucket, and the bucket is the
-- one thing in this product guaranteed to get large. Six rows is the cheapest
-- this migration will ever be.
--
-- ---------------------------------------------------------------------------
-- SCOPED TO ONE COMPANY, ALWAYS.
--
-- Cross-tenant dedup would save more and is not on the table: it would have one
-- workspace's row serving bytes that another workspace uploaded, and a bug
-- anywhere near the reference counting would be a cross-tenant data leak rather
-- than a broken image. The index below is keyed on company_id first for exactly
-- that reason — there is no query shape that can reach across.

alter table public.attachments
  add column if not exists content_sha256 text;

comment on column public.attachments.content_sha256 is
  '#240: hex SHA-256 of the uploaded bytes, so a second upload of the same file '
  'in the same company reuses the object instead of storing it again. Null for '
  'every row uploaded before this shipped — they simply never match.';

-- Partial: only LIVE rows are candidates to share with. A soft-deleted row is
-- on its way to the sweep, and pointing a new upload at an object that is about
-- to be reclaimed would be the worst possible saving.
create index if not exists attachments_content_hash_idx
  on public.attachments (company_id, content_sha256)
  where deleted_at is null and content_sha256 is not null;

-- ---------------------------------------------------------------------------
-- THE DELETION RULE, WHICH IS THE WHOLE RISK.
--
-- One row meant one object, so the sweep could delete an object the moment its
-- row was hard-deleted. With sharing, that becomes: delete the object only when
-- NO LIVE ROW still points at it. Get this wrong and deleting one attachment
-- silently breaks somebody else's photo in another thread — the kind of bug
-- that surfaces weeks later, from a customer, as "the app lost my picture".
--
-- Asked as "which of these paths are still spoken for" rather than "which can I
-- delete", because the sweep already holds the candidate list and this way the
-- answer is a filter it applies rather than a second source of truth about what
-- to reclaim.
--
-- Both columns, in one pass: a row's preview is as shareable as its original,
-- and a path is a path.
create or replace function public.api_attachment_paths_in_use(p_paths text[])
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select p.path
  from unnest(p_paths) as p(path)
  where exists (
    select 1 from public.attachments a
    where a.deleted_at is null
      and (a.storage_path = p.path or a.preview_path = p.path)
  )
$$;

comment on function public.api_attachment_paths_in_use(text[]) is
  '#240: of the given object paths, the ones a LIVE attachments row still '
  'points at. The sweep subtracts these before reclaiming, so deleting one '
  'attachment can never take another row''s object with it.';

revoke execute on function public.api_attachment_paths_in_use(text[])
  from public, anon, authenticated;
grant execute on function public.api_attachment_paths_in_use(text[]) to service_role;

-- ---------------------------------------------------------------------------
-- Finding the twin, at upload time.
--
-- A function rather than a PostgREST filter because the answer has to carry the
-- preview alongside the original: reusing an object without its preview would
-- store one file twice as far as the thread is concerned, which is the bug this
-- is meant to fix wearing a different hat.
create or replace function public.api_attachment_by_content(
  p_company_id uuid,
  p_sha256     text
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'storage_path', a.storage_path,
    'preview_path', a.preview_path,
    'preview_bytes', a.preview_bytes,
    'size_bytes', a.size_bytes,
    'content_type', a.content_type
  )
  from public.attachments a
  where a.company_id = p_company_id
    and a.deleted_at is null
    and a.content_sha256 = p_sha256
  -- Oldest wins, so the object a workspace shares is the one that has already
  -- survived longest rather than whichever row a race happened to write last.
  order by a.created_at
  limit 1
$$;

comment on function public.api_attachment_by_content(uuid, text) is
  '#240: the live attachment in this company already holding these exact bytes, '
  'or null. Company-scoped by argument AND by predicate — cross-tenant sharing '
  'would be a data leak, not an optimisation.';

revoke execute on function public.api_attachment_by_content(uuid, text)
  from public, anon, authenticated;
grant execute on function public.api_attachment_by_content(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- #240 item 2 — the fleet number, because there is nothing to tier.
--
-- Supabase Storage supports neither lifecycle rules nor storage classes (their
-- S3-compatibility page marks Get/PutBucketLifecycleConfiguration unimplemented
-- and x-amz-storage-class unsupported, checked 2026-08-04), so tiering would
-- mean a second storage vendor. And there is nothing to move: production the
-- same day held 2 live note attachments at 990 KB and 4 MMS media at 1.1 MB
-- across 3 workspaces, against the 100 GB Supabase Pro includes.
--
-- So this is what got built instead: the one number that says when that answer
-- expires. Its own function rather than a sum of the per-company arm, because
-- that arm is capped per cron run and would quietly under-report exactly as the
-- fleet grew past the point where the number matters.
create or replace function public.api_fleet_stored_bytes()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select sum(coalesce(a.size_bytes, 0) + coalesce(a.preview_bytes, 0))
        from public.attachments a
       where a.deleted_at is null
    ), 0)
    + coalesce((
      select sum(coalesce(m.size_bytes, 0)) from public.message_attachments m
    ), 0)
$$;

comment on function public.api_fleet_stored_bytes() is
  '#240: stored bytes across the WHOLE fleet, live rows only, both attachment '
  'tables and both objects on a row. The tripwire for when storage stops being '
  'free to us.';

revoke execute on function public.api_fleet_stored_bytes()
  from public, anon, authenticated;
grant execute on function public.api_fleet_stored_bytes() to service_role;
