-- #284 — the half that actually destroys something.
--
-- 20260730001000 gave a workspace a retention window it can shorten, and
-- 20260730001100 gave it a warning 30 days before the axe. Nothing ever swung
-- the axe. That order was deliberate ("deliberately shipped ahead of the
-- enforcement job — nobody should discover retention by losing something"),
-- and leaving it there is the worse failure of the two: we mail a customer to
-- say their oldest messages are about to age out, and then keep them forever.
-- The promise is the liability, not the deletion.
--
-- ===========================================================================
-- TWO GUARDS, AND NEITHER IS OPTIONAL
-- ===========================================================================
--
-- 1. LEGAL HOLD. A held workspace is skipped in the QUERY, never in the loop —
--    the same posture `purgeClosedWorkspaces` takes, for the same reason: a
--    held workspace must never enter a partially-executed deletion somebody
--    then has to recover it from.
--
-- 2. IT MUST HAVE BEEN WARNED. `retention_notices` is joined, not consulted as
--    a courtesy: a workspace with no notice row for its CURRENT window is not
--    eligible, full stop. That makes the notice job load-bearing rather than
--    decorative — if it is broken, nothing is destroyed, which is the correct
--    direction for that failure to point. Shortening the window writes a new
--    (company, window) row, so the warning and the deletion are always about
--    the same data.
--
-- ===========================================================================
-- WHY THIS RETURNS IDS RATHER THAN DELETING
-- ===========================================================================
--
-- The rows are where the object paths live. A delete that takes `messages`
-- before its attachments' objects are removed leaves a customer's photos in a
-- bucket with nothing pointing at them — unreachable, unbilled to anyone, and
-- undeleted, which is the exact shape of the #378 bug. So the Worker reads the
-- batch, clears storage, then deletes the rows, mirroring DELETION.md and
-- `purge.ts` step for step.

-- Companies with messages past their own window, oldest first.
create or replace function public.api_retention_overdue_companies(
  p_limit int default 5
)
returns table (
  company_id    uuid,
  window_days   int,
  message_count bigint,
  oldest_at     timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    public.effective_retention_days(c.id),
    count(m.id),
    min(m.created_at)
  from public.companies c
  join public.conversations v on v.company_id = c.id
  join public.messages m on m.conversation_id = v.id
  where c.deleted_at is null
    -- Guard 1: held workspaces keep everything.
    and c.legal_hold_at is null
    -- Guard 2: warned about THIS window, or not eligible.
    and exists (
      select 1 from public.retention_notices n
       where n.company_id = c.id
         and n.window_days = public.effective_retention_days(c.id)
    )
    and m.created_at
        < now() - make_interval(days => public.effective_retention_days(c.id))
  group by c.id
  having count(m.id) > 0
  order by min(m.created_at)
  limit greatest(p_limit, 1);
$$;

comment on function public.api_retention_overdue_companies is
  '#284: workspaces holding messages past their retention window. Excludes any workspace under legal hold, and any that has not been warned about its CURRENT window — the notice is a precondition for deletion, not a courtesy alongside it, so a broken notice job destroys nothing.';

-- One bounded batch of a company's overdue message ids, oldest first.
create or replace function public.api_retention_overdue_messages(
  p_company_id uuid,
  p_limit      int default 500
)
returns table (message_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
    from public.messages m
    join public.conversations v on v.id = m.conversation_id
    join public.companies c on c.id = v.company_id
   where v.company_id = p_company_id
     and c.deleted_at is null
     -- Re-checked HERE rather than trusted from the caller. A hold placed
     -- between the sweep's company query and this read must stop the very next
     -- batch, and the window between the two is a whole cron run wide.
     and c.legal_hold_at is null
     and m.created_at
         < now() - make_interval(days => public.effective_retention_days(p_company_id))
   order by m.created_at
   limit greatest(p_limit, 1);
$$;

comment on function public.api_retention_overdue_messages is
  '#284: the next batch of one company''s messages past its retention window, oldest first. Returns ids rather than deleting, because the Worker must clear each message''s storage objects before the rows that hold their paths go away (DELETION.md).';

revoke all on function public.api_retention_overdue_companies(int)
  from public, anon, authenticated;
grant execute on function public.api_retention_overdue_companies(int) to service_role;

revoke all on function public.api_retention_overdue_messages(uuid, int)
  from public, anon, authenticated;
grant execute on function public.api_retention_overdue_messages(uuid, int)
  to service_role;

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
