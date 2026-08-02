-- #284 — call records age out too, and the WARNING learns to count them.
--
-- legal/privacy puts call records on the same seven-year clock as texts, and
-- 20260802100000 only ever swept messages. So the last published window with no
-- enforcement was the calls table — and with it the voicemail transcript, which
-- the privacy page now says stays with the call record for the full term.
--
-- ===========================================================================
-- THE NOTICE HAS TO COUNT WHAT THE DELETION TAKES
-- ===========================================================================
--
-- `api_retention_due` counted MESSAGES only, which was right when messages were
-- the only thing that aged out. Left alone it would produce the one failure the
-- warning exists to prevent, in a new form: a workspace told "1,400 messages
-- age out next month" and then quietly losing three years of call history it
-- was never told about. Worse, a workspace whose data is ALL calls would never
-- appear in the notice at all, and — because the notice is a precondition for
-- deletion — would silently never be swept either. Two bugs pointing opposite
-- ways, from one count.
--
-- So the count widens to messages + calls, and `oldest_at` becomes the older of
-- the two. The email's shape is unchanged; only its arithmetic is now honest
-- about what is at stake.
--
-- ===========================================================================
-- WHY CALLS FOLLOW THE WORKSPACE'S WINDOW AND VOICEMAIL AUDIO DOES NOT
-- ===========================================================================
--
-- A call record is the business's own record of its own work, exactly like a
-- text, so it moves with `retention_days` — the setting the owner controls. The
-- voicemail RECORDING is somebody else's voice and keeps its fixed one-year
-- window (20260802110000), because that promise was made to the caller, who has
-- no say in this setting. Same table, two clocks, on purpose.

-- Widened: the warning now covers calls as well as messages.
create or replace function public.api_retention_due(p_warn_days int default 30)
returns table (
  company_id    uuid,
  company_name  text,
  window_days   int,
  message_count bigint,
  oldest_at     timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with horizon as (
    select
      c.id,
      c.name,
      public.effective_retention_days(c.id) as window_days,
      now() - make_interval(days => public.effective_retention_days(c.id))
            + make_interval(days => greatest(p_warn_days, 1)) as cutoff
    from public.companies c
    where c.deleted_at is null
      -- A held workspace has nothing at risk, so warning it would be false.
      and c.legal_hold_at is null
  ),
  at_risk as (
    select h.id, h.name, h.window_days, m.created_at as at
      from horizon h
      join public.conversations v on v.company_id = h.id
      join public.messages m on m.conversation_id = v.id
     where m.created_at < h.cutoff
    union all
    select h.id, h.name, h.window_days, k.started_at
      from horizon h
      join public.calls k on k.company_id = h.id
     where k.started_at < h.cutoff
  )
  select id, name, window_days, count(*), min(at)
    from at_risk
   group by id, name, window_days
  having count(*) > 0;
$$;

comment on function public.api_retention_due is
  '#284: workspaces whose messages OR call records fall inside the warning band before their retention window. Counts both because the enforcement deletes both — a count that named only messages would warn about one thing and destroy another, and a calls-only workspace would never be warned and therefore never swept.';

-- Widened: a workspace with overdue CALLS is eligible even with no overdue
-- messages. Same two guards, unchanged — legal hold, and having been warned.
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
  with eligible as (
    select
      c.id,
      public.effective_retention_days(c.id) as window_days,
      now() - make_interval(days => public.effective_retention_days(c.id)) as cutoff
    from public.companies c
    where c.deleted_at is null
      and c.legal_hold_at is null
      and exists (
        select 1 from public.retention_notices n
         where n.company_id = c.id
           and n.window_days = public.effective_retention_days(c.id)
      )
  ),
  overdue as (
    select e.id, e.window_days, m.created_at as at
      from eligible e
      join public.conversations v on v.company_id = e.id
      join public.messages m on m.conversation_id = v.id
     where m.created_at < e.cutoff
    union all
    select e.id, e.window_days, k.started_at
      from eligible e
      join public.calls k on k.company_id = e.id
     where k.started_at < e.cutoff
  )
  select id, window_days, count(*), min(at)
    from overdue
   group by id, window_days
  having count(*) > 0
   order by min(at)
   limit greatest(p_limit, 1);
$$;

comment on function public.api_retention_overdue_companies is
  '#284: workspaces holding messages OR call records past their retention window. Excludes any workspace under legal hold, and any not warned about its CURRENT window — the notice is a precondition for deletion, so a broken notice job destroys nothing.';

-- One bounded batch of a company's overdue calls, oldest first.
--
-- Returns the SESSION id as well as the row id because the sibling tables
-- (`call_records`, `call_member_legs`, `outbound_call_authorizations`) key on
-- it and carry no foreign key to `calls` — so nothing cascades, and a delete
-- that took only the parent would leave a customer's call legs behind forever.
create or replace function public.api_retention_overdue_calls(
  p_company_id uuid,
  p_limit      int default 500
)
returns table (call_id uuid, call_session_id text, voicemail_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select k.id, k.call_session_id, k.voicemail_path
    from public.calls k
    join public.companies c on c.id = k.company_id
   where k.company_id = p_company_id
     and c.deleted_at is null
     -- Re-checked here, like the message batch: a hold placed mid-run must
     -- stop the very next batch rather than the next day's.
     and c.legal_hold_at is null
     and k.started_at
         < now() - make_interval(days => public.effective_retention_days(p_company_id))
   order by k.started_at
   limit greatest(p_limit, 1);
$$;

comment on function public.api_retention_overdue_calls is
  '#284: the next batch of one company''s call records past its retention window. Carries the session id because the call sibling tables key on it and have no FK to cascade from, and the voicemail path so any recording the one-year sweep could not clear goes with its row rather than being stranded.';

revoke all on function public.api_retention_overdue_calls(uuid, int)
  from public, anon, authenticated;
grant execute on function public.api_retention_overdue_calls(uuid, int)
  to service_role;
