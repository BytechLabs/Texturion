-- #284 — voicemail audio ages out on the year we PUBLISH for it.
--
-- Split into its own migration rather than appended to 20260802040000, which
-- had already shipped. A migration that has been applied never runs again, so
-- editing one in place is a function that exists on every machine that has not
-- yet applied it and on no machine that has — the worst kind of drift, because
-- local and CI both look correct.

-- ===========================================================================
-- VOICEMAIL AUDIO — the OTHER published window nothing enforced.
-- ===========================================================================
--
-- legal/privacy says voicemail recordings are kept for ONE YEAR while
-- everything else keeps seven, and gives the reason: "the transcript keeps
-- what was said, while the recording is somebody's actual voice in their home
-- and is worth far less after the first few weeks." Nothing ever deleted one.
-- A published window with no enforcement is the same defect the message half
-- of this migration fixes, on the most sensitive object in the product.
--
-- FIXED, NOT CONFIGURABLE. `retention_days` is the workspace's choice about
-- its own business records; this is a promise we made to the STRANGER who left
-- the message, and they are not a party to that setting. A workspace shortening
-- its window does not shorten this, and it cannot lengthen it either.
--
-- THE ROW AND THE TRANSCRIPT SURVIVE. Only the audio goes. That is what makes
-- this safe to run without the notice the message sweep requires: nothing is
-- discovered by loss, because what was said is still there to read. The call
-- record itself ages out on the seven-year clock with everything else.
create or replace function public.api_voicemail_audio_overdue(
  p_limit int default 500
)
returns table (call_id uuid, company_id uuid, voicemail_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select k.id, k.company_id, k.voicemail_path
    from public.calls k
    join public.companies c on c.id = k.company_id
   where k.voicemail_path is not null
     and c.deleted_at is null
     -- A held workspace keeps its audio, like everything else it holds.
     and c.legal_hold_at is null
     and k.started_at < now() - interval '365 days'
   order by k.started_at
   limit greatest(p_limit, 1);
$$;

comment on function public.api_voicemail_audio_overdue is
  '#284: voicemail recordings past the ONE-YEAR window legal/privacy publishes for them. Fixed rather than workspace-configurable — the promise is to the caller who left the message, not to the business that received it. Returns the path so the Worker can clear the object before nulling the column that points at it; the call row and its transcript are untouched, which is why this needs no warning: what was said survives.';

revoke all on function public.api_voicemail_audio_overdue(int)
  from public, anon, authenticated;
grant execute on function public.api_voicemail_audio_overdue(int) to service_role;
