-- [#324] "What have we done for this customer?" — answered by scrolling once.
--
-- D7's threading rule means a long relationship is MANY conversations, not one
-- long thread: a customer who returns after 31 days starts a new one, so a
-- homeowner serviced once a year for six years is six conversations. That is a
-- reasonable design for an annual furnace service, and it is why the question
-- asked before every visit has no single answer surface.
--
-- ---------------------------------------------------------------------------
-- WHAT ALREADY EXISTED, BECAUSE THIS ISSUE WAS CORRECTED TWICE.
--
--   * the prior-conversations list (G6) — on all three clients
--   * per-contact call history (#205) — shipped, day-grouped
--
-- Both are real and neither is being replaced. What was missing is that they
-- are SEPARATE BLOCKS: calls in one, conversations in another, tasks nowhere.
-- The issue's own correction puts it exactly: "It is a list of conversations,
-- not a history of the relationship... there is no single chronology — so
-- 'what have we done for this customer?' still means opening threads one at a
-- time."
--
-- This is that chronology, and it is the whole addition: one ordered stream of
-- the three record types, so the answer is read rather than assembled.
--
-- ---------------------------------------------------------------------------
-- WHY A UNION RATHER THAN A VIEW OVER ONE TABLE.
--
-- The three records genuinely differ in shape and none of them is a subset of
-- another: a conversation spans time, a call is an instant with a duration, a
-- task is a commitment with a due date. Flattening them into a shared table
-- would need a discriminator column and would make every existing query pay
-- for it. The union costs one query per read and keeps each table's own
-- indexes doing the work.
--
-- TASKS REACH A CONTACT THROUGH THEIR CONVERSATION. `tasks.contact_id` does
-- not exist: D17 anchors a task to a message, and the message's conversation
-- carries the contact. D64 has since decided a task may promote a CALL as
-- well, and when that column lands this function needs one more arm — noted
-- here rather than left for somebody to rediscover.

create or replace function public.api_contact_timeline(
  p_company_id uuid,
  p_contact_id uuid,
  p_limit      int default 50,
  -- Keyset pagination AND jump-to-date, which are the same operation: "show me
  -- from here backwards". #324 asks for jump-to-date on the contact timeline
  -- specifically, since any single conversation is bounded by the 30-day rule
  -- and unlikely to be enormous.
  p_before     timestamptz default null
) returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with entries as (
    -- CONVERSATIONS. Ordered by last activity rather than creation: a thread
    -- reopened last week belongs beside last week, not beside the day it was
    -- first opened. `last_message_at` is what the inbox already sorts on.
    select
      'conversation'::text as kind,
      c.id                 as id,
      coalesce(c.last_message_at, c.created_at) as occurred_at,
      c.id                 as conversation_id,
      c.status::text       as status,
      null::text           as detail,
      c.created_at         as started_at,
      null::int            as talk_seconds,
      null::timestamptz    as due_at,
      null::boolean        as done
    from public.conversations c
    where c.company_id = p_company_id
      and c.contact_id = p_contact_id
      -- A spam thread is not part of the relationship. It stays reachable in
      -- the inbox's spam view; putting it in the history of a real customer
      -- would be the one entry that makes the rest untrustworthy.
      and coalesce(c.is_spam, false) = false

    union all

    -- CALLS. Already listed on this page by #205; here they interleave rather
    -- than sitting in their own block.
    select
      'call'::text,
      k.id,
      -- started_at, not created_at: it is when the call HAPPENED, and it is
      -- what calls_company_recency_idx is keyed on.
      k.started_at,
      k.conversation_id,
      k.outcome::text,
      k.caller_name,
      k.started_at,
      -- Talk time. Named forward_seconds on the table because it is the
      -- forward leg's billable seconds and never ring time.
      k.forward_seconds,
      null::timestamptz,
      null::boolean
    from public.calls k
    where k.company_id = p_company_id
      and k.contact_id = p_contact_id

    union all

    -- TASKS, via their conversation. `done` derives from the source message's
    -- done_at exactly as the checklist reads it (D17), rather than from a
    -- second flag that could disagree with it.
    select
      'task'::text,
      t.id,
      t.created_at,
      t.conversation_id,
      null::text,
      t.title,
      t.created_at,
      null::int,
      t.due_at,
      m.done_at is not null
    from public.tasks t
    join public.conversations tc on tc.id = t.conversation_id
    join public.messages m on m.id = t.message_id
    where t.company_id = p_company_id
      and tc.contact_id = p_contact_id
      and t.deleted_at is null
  )
  select jsonb_build_object(
    'kind', e.kind,
    'id', e.id,
    'occurred_at', e.occurred_at,
    'conversation_id', e.conversation_id,
    'status', e.status,
    'detail', e.detail,
    'started_at', e.started_at,
    'talk_seconds', e.talk_seconds,
    'due_at', e.due_at,
    'done', e.done
  )
  from entries e
  where p_before is null or e.occurred_at < p_before
  -- id breaks ties so a page boundary cannot repeat or skip a row when two
  -- records share a timestamp, which they do whenever a call threads a message.
  order by e.occurred_at desc, e.id desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

comment on function public.api_contact_timeline is
  'One chronology of a contact''s conversations, calls and tasks (#324). The prior-conversations list (G6) and per-contact call history (#205) both already existed as separate blocks; what was missing was a single ordered stream, which is what "what have we done for this customer?" actually asks for. Spam conversations are excluded. Tasks reach the contact through their conversation, because tasks anchor to a message (D17); when D64''s call-anchored tasks land this needs a fourth arm.';

revoke all on function public.api_contact_timeline(uuid, uuid, int, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_contact_timeline(uuid, uuid, int, timestamptz)
  to service_role;

-- The timeline reads conversations by (company, contact) newest-first. The
-- existing conversation indexes are keyed for the INBOX (by number, by status),
-- so without this the contact page falls back to a scan that grows with the
-- workspace rather than with the customer's own history — which is #324's
-- scale point: "the risk is not one thread with 4,000 messages; it is a
-- contact with 60 conversations".
create index if not exists conversations_contact_recent_idx
  on public.conversations (company_id, contact_id, last_message_at desc);
