-- #378 — the data export outlived the deletion.
--
-- `workspace/export.ts` writes a workspace's export to a fourth storage bucket
-- that `workspace/purge.ts` never swept. The seven-day window the completion
-- email promises was enforced only as an ACCESS check: past `expires_at` the
-- API refuses to sign a URL and the row reads as expired, while the object
-- itself stays in the bucket forever. "Expired" meant invisible, not gone.
--
-- An export is, by its own header, "a copy of every message, contact and note
-- the workspace holds" — the most concentrated personal-data object this
-- system produces. Leaving it behind made it an UNDOCUMENTED survivor of D48's
-- erasure, and the survivor list in docs/DELETION.md gets its whole integrity
-- from being complete and deliberate. One unaccounted survivor damages that
-- document more than the accounted ones do, because it means the list was
-- never the whole list.
--
-- This column is what lets the reaper be idempotent and resumable.

alter table public.data_exports
  add column if not exists reaped_at timestamptz;

comment on column public.data_exports.reaped_at is
  '#378: when the export OBJECTS were deleted from storage. The row survives on purpose — a customer should see that they requested an export and that it has since expired, rather than a gap where it used to be. The row is the record of a request; the blob was the data.';

-- The reaper asks one question daily: what is expired and not yet reaped?
create index if not exists data_exports_reapable_idx
  on public.data_exports (expires_at)
  where reaped_at is null;
