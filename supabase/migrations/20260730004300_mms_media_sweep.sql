-- #263 — the mms-media bucket had no sweeper at all, and a retry could not tell
-- a text message from one whose photos were wiped.
--
-- THE COST HALF. `sweepOrphanObjects` and `sweepGhostRows` (#15) reclaim the
-- `attachments` bucket, and both anti-joins hardcode `o.bucket_id =
-- 'attachments'`. Outbound MMS media lives in a DIFFERENT bucket (`mms-media`)
-- against a DIFFERENT table (`public.message_attachments`), so nothing has ever
-- swept it. An object written there with no row is invisible to every read path,
-- unaccounted by `api_storage_usage` (whose `mms_bytes` sums ROWS), and billed
-- forever with no way for anybody to find it.
--
-- That is reachable from both directions of media, not just the one #263 found:
--
--   OUTBOUND (`messaging/media.ts`): upload object, insert row, per item. A
--   transient PostgREST error on item N leaves item N's object row-less. The
--   all-or-nothing cleanup added for #263 removes them, but it is deliberately
--   best-effort — a cleanup failure must not mask the send failure the caller is
--   already reporting — so when it fails the debris is permanent without a sweep.
--
--   INBOUND (`messaging/inbound.ts`): same upload-then-insert order, same bucket,
--   same path scheme. A non-unique-violation insert error throws with the object
--   already written.
--
-- BOTH SWEEP DIRECTIONS ARE SAFE FOR BOTH KINDS OF MEDIA, and that had to be
-- checked rather than assumed, because `message_attachments` holds inbound rows
-- too (they carry `source_url`). Inbound stores its own copy in this bucket at
-- the same `{company}/{message}/{n}` path before inserting, so every row of
-- either kind has a real object and every object has a row — an object with no
-- row is genuine debris, and a row with no object is genuinely broken. Neither
-- sweep can touch a healthy row.
--
-- THE TRUNCATION HALF. `messages.media_count` records how many media items the
-- send was created with, so `POST /v1/messages/:id/retry` can compare it against
-- the `message_attachments` rows it is about to re-send and REFUSE rather than
-- quietly dispatch a message with two of the customer's three photos. Before
-- this the retry rebuilt the media set from whatever rows existed and returned
-- 200, so the thread showed a clean send and nothing anywhere said a photo had
-- been dropped.
--
-- Null means "no media was attached", which is every text message and every row
-- written before this migration. A retry only ever refuses on a POSITIVE count
-- it can compare, so no historical message becomes un-retryable.

alter table public.messages
  add column if not exists media_count int
  constraint messages_media_count_nonneg check (media_count is null or media_count >= 0);

comment on column public.messages.media_count is
  'How many outbound media items this send was created with (#263). Set before the objects are uploaded, so a crash anywhere in the media path leaves evidence that media was intended. POST /v1/messages/:id/retry refuses when message_attachments holds fewer rows than this, instead of silently re-sending a truncated media set. NULL = no media (every text message, and every row predating the column).';

-- The orphan anti-join probes message_attachments by storage_path; without this
-- every candidate object seq-scans a table that grows with every tenant's media.
-- (The attachments bucket got the same index in #15.)
create index if not exists message_attachments_storage_path_idx
  on public.message_attachments (storage_path);

-- Objects in the mms-media bucket older than the cutoff with NO
-- message_attachments row: unreachable, unaccounted, billed bytes. Oldest first,
-- bounded per run. The cutoff (SWEEP_GRACE_MS, 15 minutes) is far longer than a
-- Worker request, so the gap between an upload and its row insert can never be
-- swept out from under an in-flight send.
create or replace function public.api_orphan_mms_media_objects(
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
  where o.bucket_id = 'mms-media'
    and o.created_at < p_cutoff
    and not exists (
      select 1 from public.message_attachments a
      where a.storage_path = o.name
    )
  order by o.created_at
  limit p_limit
$$;

revoke execute on function public.api_orphan_mms_media_objects(timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.api_orphan_mms_media_objects(timestamptz, int)
  to service_role;

-- message_attachments rows older than the cutoff whose object is gone. These are
-- worse than orphan objects and that is why the direction exists: they are summed
-- into `mms_bytes`, so they OVER-REPORT the customer's storage, and the retry
-- path mints a signed URL for each one, so Telnyx fetches a 404 and the send
-- fails for a reason nobody can see. Reachable when the #263 cleanup removes an
-- object but its row delete fails, and by any future purge that drops objects
-- without rows.
--
-- There is no `deleted_at` on this table — message media is not
-- individually deletable — so a live row is simply a row.
create or replace function public.api_ghost_mms_media_rows(
  p_cutoff timestamptz,
  p_limit  int
) returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from public.message_attachments a
  where a.created_at < p_cutoff
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'mms-media'
        and o.name = a.storage_path
    )
  order by a.created_at
  limit p_limit
$$;

revoke execute on function public.api_ghost_mms_media_rows(timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.api_ghost_mms_media_rows(timestamptz, int)
  to service_role;
