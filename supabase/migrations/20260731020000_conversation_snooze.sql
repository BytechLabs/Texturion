-- #293 — "needs attention, but on Thursday".
--
-- A conversation has two states today: needing attention, or not. Most threads
-- in this business are in neither. "I'll get you a price once I've spoken to my
-- supplier." "Call me after the 15th." The only options are to leave it unread
-- so it stays visible and clutters the queue, or mark it read and rely on
-- memory — and the second is how jobs get lost.
--
-- The cost is not the clutter. It is that the focus queue, the surface that
-- tells a crew what needs them, fills with things that need them LATER, and an
-- inbox where half the items are not actionable today trains people to stop
-- trusting the count. That is alert fatigue (#244) arriving through a different
-- door.
--
-- PER MEMBER, NOT PER WORKSPACE, which is why this is a table and not a column
-- on `conversations`. My deferral must not hide the thread from a colleague who
-- could handle it now: the snooze is mine, the conversation is the crew's.

create table if not exists public.conversation_snoozes (
  company_id      uuid not null references public.companies(id) on delete restrict,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(user_id) on delete cascade,
  -- When it comes back. Always in the future when written; the read side treats
  -- a past `until` as already returned rather than deleting rows on a timer, so
  -- there is no cron in the hot path and no window where a thread is invisible
  -- because a sweep has not run yet.
  until           timestamptz not null,
  -- The reason a person deferred it, for the list that shows what they deferred.
  -- Bounded because it renders: 120 is a note, not a payload.
  note            text check (char_length(note) <= 120),
  created_at      timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- "What have I deferred, and when does it come back?" — the snoozed view.
create index if not exists conversation_snoozes_user_idx
  on public.conversation_snoozes (company_id, user_id, until);

-- Deny-by-default RLS (SPEC §6 / D8): enabled, no policies, no end-user grants.
-- Every read and write goes through the Worker with the service key, which is
-- where the company scoping is enforced.
alter table public.conversation_snoozes enable row level security;

comment on table public.conversation_snoozes is
  '#293: per-member deferral of a conversation. A row means "hidden from MY '
  'default view until `until`". Deleted the moment the customer replies — see '
  'cancel_snoozes_on_inbound.';

-- ---------------------------------------------------------------------------
-- THE NON-NEGOTIABLE RULE, and it lives in the database on purpose.
--
-- #293: "A customer reply cancels the snooze immediately. This is the
-- non-negotiable rule: if they text again, the thread is live, no matter what
-- the timer said. Getting this wrong means ignoring a customer who is actively
-- trying to reach you, which is the single worst thing this product can do."
--
-- A rule that important does not belong in a route handler, where the next
-- ingress path added is one that forgets it. Inbound messages already arrive
-- through the threading RPC and could arrive through a backfill or a repair
-- script tomorrow; a trigger on the row itself covers all of them.
--
-- EVERY member's snooze, not just the one who deferred it. If the customer is
-- trying to reach the business, the thread is live for the business.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_snoozes_on_inbound()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Inbound only. An outbound reply is the crew acting on the thread, and a
  -- person who answers and then defers again has said something deliberate —
  -- clearing their own snooze there would undo what they just asked for.
  if new.direction <> 'inbound' then
    return new;
  end if;

  delete from public.conversation_snoozes
  where conversation_id = new.conversation_id;

  return new;
end;
$function$;

drop trigger if exists messages_cancel_snoozes on public.messages;
create trigger messages_cancel_snoozes
  after insert on public.messages
  for each row execute function public.cancel_snoozes_on_inbound();

-- ---------------------------------------------------------------------------
-- Reads. Both are service-role only, like every other api_* function: the
-- Worker holds the membership check, and `authenticated` has no grant here.
-- ---------------------------------------------------------------------------

/**
 * The conversation ids this member currently has deferred.
 *
 * "Currently" is computed rather than stored: a row whose `until` has passed is
 * simply not returned. No sweep, no cron, and no window in which a thread is
 * invisible because the sweep has not run.
 */
create or replace function public.api_snoozed_conversation_ids(
  p_company uuid,
  p_user uuid
)
returns table (conversation_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select s.conversation_id
  from public.conversation_snoozes s
  where s.company_id = p_company
    and s.user_id = p_user
    and s.until > now();
$$;

/** What this member deferred, soonest first, with the reason they gave. */
create or replace function public.api_snoozed_conversations(
  p_company uuid,
  p_user uuid
)
returns table (
  conversation_id uuid,
  until           timestamptz,
  note            text,
  created_at      timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.conversation_id, s.until, s.note, s.created_at
  from public.conversation_snoozes s
  where s.company_id = p_company
    and s.user_id = p_user
    and s.until > now()
  order by s.until asc, s.conversation_id asc;
$$;

revoke execute on function public.api_snoozed_conversation_ids(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.api_snoozed_conversations(uuid, uuid) from public, anon, authenticated;
-- The Worker calls these with the service key; end-user roles cannot. That
-- split is the posture every api_* function here holds, and api_functions.sql
-- asserts it — a revoke without the matching grant leaves the Worker locked out
-- of its own read.
grant execute on function public.api_snoozed_conversation_ids(uuid, uuid) to service_role;
grant execute on function public.api_snoozed_conversations(uuid, uuid) to service_role;
