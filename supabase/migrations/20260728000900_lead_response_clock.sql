-- #388 — the mechanism behind the name.
--
-- The brand is FIRST RESPONSE. The product notified once, on a 15-minute
-- debounce, and then did nothing: a lead texting at 9:02 produced one push
-- into a pocket, and at 9:07 — the interval the whole positioning is built on
-- — nothing had happened and nothing was going to. The debounce was actively
-- suppressing the second nudge inside the only window that matters.
--
-- This adds the missing piece and nothing else: a clock on an unanswered lead,
-- and a rule for who hears about it as the clock runs out. Assignment,
-- notification_prefs, push, business hours and #106 access are all already
-- built; none of them are re-implemented here.
--
-- THE LADDER
--   rung 1 (~2 min)  re-notify the SAME audience the first alert went to.
--                    Default ON. This is the rung that wins leads: a phone in
--                    a pocket missed the first buzz and a second one two
--                    minutes later is the single likeliest thing to produce a
--                    reply.
--   rung 2 (~5 min)  widen to everyone who can see the thread — but ONLY when
--                    the thread is ASSIGNED, so the first alert went to one
--                    person and widening reaches somebody new. Default OFF;
--                    an owner opts in.
--
-- On an UNASSIGNED thread the ladder ENDS at rung 1. Everyone was already told
-- twice, a third buzz reaches no new person and carries no new fact, and #244
-- already warns that every alert waking everybody forever is how a crew learns
-- to mute the app. A muted crew loses more leads than this feature wins.
--
-- WHAT STOPS THE CLOCK, and why each one counts as "somebody has this"
--   * a human outbound message (`automated = false`) — the response itself.
--     Auto-replies do NOT stop it: a robot answering the phone is precisely
--     the situation this feature exists to escalate out of. `sent_by_user_id`
--     cannot make this distinction and never could — a CHECK constraint
--     requires an actor on every outbound row, so the away reply, MCTB and the
--     emergency ack are all attributed to the company owner. That is what
--     `messages.automated` was added for; see 20260728001000.
--   * assignment while the clock runs — claiming a thread is an explicit human
--     act on this exact thread. Sounding a crew-wide alarm because the person
--     who just claimed it is still typing is how the klaxon gets muted.
--   * closing, or marking spam.
--
-- The clock is deliberately NOT stopped by reading the thread. Opening a
-- message on a phone at a red light is not a response, and treating it as one
-- would let the promise fail silently — which is the exact failure mode #387
-- describes.

-- ---------------------------------------------------------------------------
-- Settings (company-level, same shape as away_enabled / mctb_enabled)
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists lead_chase_enabled boolean not null default true,
  add column if not exists lead_chase_crew_enabled boolean not null default false;

comment on column public.companies.lead_chase_enabled is
  '#388 rung 1: re-notify the original audience when a new lead goes unanswered. On by default — it reaches nobody who was not already told once.';
comment on column public.companies.lead_chase_crew_enabled is
  '#388 rung 2: widen an unanswered ASSIGNED lead to the whole crew. Off by default — it tells people who were not told before, which is the setting that can become a klaxon.';

-- ---------------------------------------------------------------------------
-- The clock itself
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column if not exists awaiting_reply_since timestamptz,
  add column if not exists chase_level smallint not null default 0;

comment on column public.conversations.awaiting_reply_since is
  '#388: when the unanswered-lead clock started (first inbound on a new or reopened thread). Null = no clock running.';
comment on column public.conversations.chase_level is
  '#388: how many rungs of the escalation ladder have been sent for the CURRENT clock. Reset to 0 whenever the clock (re)starts.';

-- The scan runs every minute, so it must never be a seq scan over a tenant's
-- whole history. Only a live clock is ever a candidate, and that set is tiny.
create index if not exists conversations_awaiting_reply_idx
  on public.conversations (awaiting_reply_since)
  where awaiting_reply_since is not null;

-- ---------------------------------------------------------------------------
-- Starting and stopping the clock, as triggers rather than in the send paths
-- ---------------------------------------------------------------------------
-- Triggers, deliberately: there are already several ways an outbound message
-- reaches a thread (manual send, auto-send, MCTB, the away reply, the
-- emergency ack) and more will be added. A rule enforced at each call site is
-- a rule that is one new send path away from being wrong, and the failure
-- would be silent — a clock that never stops, escalating a lead somebody
-- answered.

create or replace function public.start_lead_response_clock()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.direction <> 'inbound' then
    return new;
  end if;

  -- 'new' is the status of both a freshly created conversation and one
  -- reopened by inbound (the reopen sets status='new'), which is exactly the
  -- LEAD definition thread_inbound_message already computes for notify_reason.
  -- Reading it off the row here avoids rebuilding that 300-line function to
  -- pass one more flag out of it.
  --
  -- `awaiting_reply_since is null` keeps a second inbound from restarting the
  -- clock: the customer's FIRST message opened the window, and a follow-up
  -- three minutes later ("hello?") is more reason to escalate, not less.
  update public.conversations
     set awaiting_reply_since = new.created_at,
         chase_level = 0
   where id = new.conversation_id
     and status = 'new'
     and awaiting_reply_since is null
     and is_spam = false
     and closed_at is null;

  return new;
end;
$function$;

create or replace function public.stop_lead_response_clock()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- A HUMAN reply. An auto-reply must not silence the ladder — "we'll get
  -- back to you" is the state this feature exists to escalate out of, not a
  -- resolution of it. Testing sent_by_user_id here would be wrong: it is
  -- NOT NULL on automated sends too (they are attributed to the owner), so
  -- that test silently reads every away reply as the owner answering.
  if new.direction = 'outbound' and new.automated = false then
    update public.conversations
       set awaiting_reply_since = null,
           chase_level = 0
     where id = new.conversation_id
       and awaiting_reply_since is not null;
  end if;

  return new;
end;
$function$;

create or replace function public.stop_lead_response_clock_on_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.awaiting_reply_since is null then
    return new;
  end if;

  -- Somebody claimed it, closed it, or called it spam. Each is a human acting
  -- on this thread; none of them need a crew-wide alarm afterwards.
  if (old.assigned_user_id is null and new.assigned_user_id is not null)
     or (old.closed_at is null and new.closed_at is not null)
     or (old.is_spam = false and new.is_spam = true) then
    new.awaiting_reply_since := null;
    new.chase_level := 0;
  end if;

  return new;
end;
$function$;

drop trigger if exists messages_start_lead_clock on public.messages;
create trigger messages_start_lead_clock
  after insert on public.messages
  for each row execute function public.start_lead_response_clock();

drop trigger if exists messages_stop_lead_clock on public.messages;
create trigger messages_stop_lead_clock
  after insert on public.messages
  for each row execute function public.stop_lead_response_clock();

-- BEFORE, not AFTER: this one edits the row being written rather than issuing
-- a second update, so an assignment and its clock-stop commit as one write.
drop trigger if exists conversations_stop_lead_clock on public.conversations;
create trigger conversations_stop_lead_clock
  before update on public.conversations
  for each row execute function public.stop_lead_response_clock_on_conversation();

-- ---------------------------------------------------------------------------
-- api_due_lead_chases — what the clock says is overdue, without claiming it
-- ---------------------------------------------------------------------------
-- Deliberately does NOT stamp. The business-hours test lives in TypeScript
-- (packages/shared/business-hours, already the single implementation used by
-- the away reply and MCTB), so a row selected here may still be dropped by the
-- caller. Stamping before that filter would burn the rung on a conversation
-- nobody was told about — the ladder would silently skip a rung at 8:59am
-- every morning.
--
-- Thresholds are parameters rather than literals: they are product constants
-- and they live in packages/shared, next to every other number the clients and
-- the server have to agree on.
create or replace function public.api_due_lead_chases(
  p_now             timestamptz,
  p_nudge_minutes   int,
  p_widen_minutes   int,
  p_limit           int default 200
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'conversation_id',   c.id,
           'company_id',        c.company_id,
           'assigned_user_id',  c.assigned_user_id,
           'phone_number_id',   c.phone_number_id,
           'contact_name',      ct.name,
           'contact_phone',     ct.phone_e164,
           'awaiting_since',    c.awaiting_reply_since,
           'from_level',        c.chase_level,
           'to_level',          c.chase_level + 1,
           'timezone',          co.timezone,
           'business_hours',    co.business_hours)
         order by c.awaiting_reply_since), '[]'::jsonb)
    from public.conversations c
    join public.companies co on co.id = c.company_id
    join public.contacts  ct on ct.id = c.contact_id
   where c.awaiting_reply_since is not null
     and c.closed_at is null
     and c.is_spam = false
     and co.deleted_at is null
     -- No subscription-status gate, deliberately. A push costs nothing at
     -- either end, the ordinary inbound notification does not gate on billing
     -- state either, and a workspace still receiving texts is a workspace
     -- whose leads still matter. An allowlist here would be one unanticipated
     -- status away from silently switching off the feature the brand is named
     -- after — the #387 failure shape exactly.
     and (
       -- rung 1: due, and the company has not turned it off.
       (c.chase_level = 0
        and co.lead_chase_enabled
        and c.awaiting_reply_since <= p_now - make_interval(mins => p_nudge_minutes))
       or
       -- rung 2: due, opted in, and ASSIGNED — widening an unassigned thread
       -- reaches nobody new (see the header).
       (c.chase_level = 1
        and co.lead_chase_crew_enabled
        and c.assigned_user_id is not null
        and c.awaiting_reply_since <= p_now - make_interval(mins => p_widen_minutes))
     )
   limit p_limit
$function$;

-- ---------------------------------------------------------------------------
-- api_claim_lead_chases — advance the rung, exactly once
-- ---------------------------------------------------------------------------
-- `chase_level = p_from_level` is the whole concurrency story: two overlapping
-- cron runs both select the same conversation, both try to claim it, and the
-- second one updates zero rows and sends nothing. The caller notifies only
-- what comes back.
create or replace function public.api_claim_lead_chases(
  p_conversation_ids uuid[],
  p_from_level       smallint
)
returns jsonb
language sql
volatile
security definer
set search_path = public
as $function$
  with claimed as (
    update public.conversations
       set chase_level = p_from_level + 1
     where id = any(p_conversation_ids)
       and chase_level = p_from_level
       and awaiting_reply_since is not null
       and closed_at is null
       and is_spam = false
    returning id
  )
  select coalesce(jsonb_agg(id), '[]'::jsonb) from claimed
$function$;

revoke execute on function public.api_due_lead_chases(timestamptz, int, int, int)
  from public, anon, authenticated;
grant execute on function public.api_due_lead_chases(timestamptz, int, int, int)
  to service_role;
revoke execute on function public.api_claim_lead_chases(uuid[], smallint)
  from public, anon, authenticated;
grant execute on function public.api_claim_lead_chases(uuid[], smallint)
  to service_role;
