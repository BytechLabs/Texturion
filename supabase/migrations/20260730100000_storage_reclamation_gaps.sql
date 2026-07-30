-- #479 — the two buckets nothing ever reclaimed.
--
-- The audit behind `docs/DISASTER-RECOVERY.md` §4 tabulated all four Supabase
-- Storage buckets against their sweepers and found two rows reading "none, in
-- either direction" and "delete-on-expiry only". Those are not restore-day
-- problems: they are live gaps that need no disaster to bite.
--
--   `voicemails` — a recording is downloaded into our bucket and the Telnyx copy
--   deleted (`calls.voicemail_path`). If the calls-row write that follows fails,
--   or a call row is ever removed, the audio is unreachable and billed forever.
--   Nothing has ever looked. This is a stranger's recorded VOICE sitting in a
--   bucket that nothing in the product can enumerate.
--
--   `exports` — #378 built the reaper, and it is driven entirely by the
--   `data_exports` row: expired rows are found, their prefix listed, objects
--   removed, `reaped_at` stamped. Lose the row and nothing will ever look at
--   that prefix again. A data export is, by its own header, "a copy of every
--   message, contact and note the workspace holds" — the single most
--   concentrated personal-data object this system produces, and the one whose
--   orphan is worst.
--
-- BOTH DIRECTIONS ARE DELIBERATE, and they are not symmetric in what they DO.
-- An orphan object is deleted. A ghost voicemail is NOT: `calls` is a business
-- record, and a call that happened still happened. Only the pointer is cleared,
-- and the TRANSCRIPT is deliberately kept — see the function comment.
--
-- WHAT THIS DOES NOT FIX, and #479 is explicit about it: after a PITR restore,
-- every one of these RPCs is blind for the same reason the existing four are —
-- they all reason from `storage.objects`, which is a table in the cluster being
-- restored. That is the reconciliation script's job, not this migration's.

-- The orphan anti-join probes calls by voicemail_path; without this every
-- candidate object seq-scans a table that grows with every call ever made.
-- Partial, because the overwhelming majority of calls have no voicemail.
create index if not exists calls_voicemail_path_idx
  on public.calls (voicemail_path)
  where voicemail_path is not null;

-- Objects in the `voicemails` bucket older than the cutoff with no calls row
-- pointing at them. Oldest first, bounded per run, same shape as the #15 and
-- #263 anti-joins.
--
-- The cutoff matters more here than elsewhere: `storeVoicemailRecording`
-- uploads the object and THEN stamps the row, so the window between them is a
-- real (if brief) state where a healthy recording looks orphaned. SWEEP_GRACE_MS
-- is 15 minutes against a Worker request that lives seconds.
create or replace function public.api_orphan_voicemail_objects(
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
  where o.bucket_id = 'voicemails'
    and o.created_at < p_cutoff
    and not exists (
      select 1 from public.calls c
      where c.voicemail_path = o.name
    )
  order by o.created_at
  limit p_limit
$$;

revoke execute on function public.api_orphan_voicemail_objects(timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.api_orphan_voicemail_objects(timestamptz, int)
  to service_role;

-- Calls whose `voicemail_path` points at an object that is gone.
--
-- THE ROW IS NOT DELETED, and that is the whole difference from the other three
-- ghost scans. `attachments` and `message_attachments` rows exist only to
-- describe an object, so a row with no object is meaningless and goes. A `calls`
-- row is a record that somebody phoned this business — it survives its audio.
--
-- So the caller clears the POINTER (`voicemail_path`, `voicemail_seconds`) and
-- keeps everything else. Both, not just the path: the calls list decides whether
-- to draw a player from `voicemail_seconds`, and the detail route derives
-- `has_voicemail` from `voicemail_path`. Clearing one and not the other leaves a
-- play button that 404s on exactly one of the two surfaces.
--
-- THE TRANSCRIPT STAYS, deliberately. It is the words of a customer who rang,
-- and it is the only remaining record of what they wanted — more valuable once
-- the audio is gone, not less. Deleting it would turn "we lost the recording"
-- into "we lost the message", which is a different and worse outcome. The same
-- reasoning covers `voicemail_intake` (#367).
create or replace function public.api_ghost_voicemail_calls(
  p_cutoff timestamptz,
  p_limit  int
) returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.calls c
  where c.voicemail_path is not null
    and c.started_at < p_cutoff
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'voicemails'
        and o.name = c.voicemail_path
    )
  order by c.started_at
  limit p_limit
$$;

revoke execute on function public.api_ghost_voicemail_calls(timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.api_ghost_voicemail_calls(timestamptz, int)
  to service_role;

-- Objects under the `exports` bucket with no live `data_exports` row.
--
-- "Live" means a row that still owns its objects: `reaped_at is null`. A REAPED
-- row is one whose objects #378 already removed, so anything still sitting under
-- its prefix is debris from a partially-failed reap — exactly as orphaned as an
-- object whose row vanished entirely, and previously just as invisible.
--
-- Matching is by PREFIX, not by path, because an export writes one file per
-- table under `{company}/{export}/`. `left(o.name, length(prefix))` rather than
-- `like prefix || '%'` so a prefix containing an underscore or a percent sign
-- cannot be read as a wildcard and match a DIFFERENT workspace's export — the
-- object being matched here is a copy of an entire company's data, and a
-- pattern-matching accident in this predicate would delete the wrong one.
create or replace function public.api_orphan_export_objects(
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
  where o.bucket_id = 'exports'
    and o.created_at < p_cutoff
    and not exists (
      select 1
      from public.data_exports d
      where d.reaped_at is null
        and d.storage_prefix is not null
        and left(o.name, length(d.storage_prefix)) = d.storage_prefix
    )
  order by o.created_at
  limit p_limit
$$;

revoke execute on function public.api_orphan_export_objects(timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.api_orphan_export_objects(timestamptz, int)
  to service_role;
