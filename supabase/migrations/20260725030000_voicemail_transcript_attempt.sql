-- Remember that a voicemail was already put to the model.
--
-- A recording whose transcription yields nothing usable (a hang-up after the
-- beep, road noise, a caller who says nothing) stores no transcript, so the
-- column stays null and reads as "never tried". Playback backfills on open, and
-- the clients mint a fresh signed URL on every tap without caching, so each
-- replay of one dud recording downloaded the whole file again and spent another
-- monthly transcription unit. A crew replaying a voicemail a few times could
-- burn a workspace's month on a recording with nothing in it.
--
-- This records the attempt rather than the result, so a recording is put to the
-- model once and the answer (words, or nothing worth showing) stands.

alter table public.calls
  add column if not exists voicemail_transcript_attempted_at timestamptz;

comment on column public.calls.voicemail_transcript_attempted_at is
  'When this recording was last put to the transcription model, whether or not '
  'it produced anything usable. Null means never tried. Guards the backfill on '
  'playback so a recording with nothing in it is not paid for on every open.';

-- Recordings that already carry words were plainly attempted, so they must not
-- read as owed an attempt.
update public.calls
   set voicemail_transcript_attempted_at = coalesce(ended_at, created_at)
 where voicemail_transcript is not null
   and voicemail_transcript_attempted_at is null;
