-- ---------------------------------------------------------------------------
-- #313 — how did the job go, asked in the thread that is already open.
--
-- The owner knows their revenue. What they do not know is which technician
-- customers are consistently happy with, and which one generates the
-- complaints they only hear about when somebody finally calls. A dissatisfied
-- customer contacted within a day is often recoverable; one contacted never
-- leaves a review instead.
--
-- INTERNAL SIGNAL ONLY. D47 re-affirms D32: there is no public-review path in
-- this product, no review link, no routing a happy customer anywhere. That is
-- not a gap this migration is quietly leaving open — it is the decision, and
-- the review-gating practice it forecloses is one Google penalises businesses
-- for. If it is ever amended, the amendment is D47's to make.
--
-- ---------------------------------------------------------------------------
-- WHY THIS DOES NOT BUILD A SECOND SEND PATH
--
-- D47's live objection to the feature D32 deleted is worth quoting, because it
-- is the thing this migration has to answer:
--
--   "a dedicated one-tap ask is a SECOND send path carrying its own
--    suppression and quiet-hours plumbing for something a saved template
--    already does ... every automated outbound path has to satisfy all of it.
--    A second pipeline is more expensive today than it was when the decision
--    was made, not less."
--
-- Correct, and it dissolves rather than applies here: the ask is a
-- `scheduled_messages` row with `origin = 'rating'`. It inherits the lease, the
-- exactly-once firing, #331's clearance minted at FIRE time, the hold/disclose
-- rules and the quiet-hours shift that #237 added. There is no second pipeline,
-- no second suppression list and no second quiet-hours implementation — which
-- is precisely what D47 says an amendment would have to do ("route through the
-- shared send gate rather than reintroducing a bespoke path").
--
-- ---------------------------------------------------------------------------
-- WHY THE RATING IS ITS OWN TABLE AND NOT A COLUMN ON `tasks`
--
-- Because the question has three answers, not one: it was asked, it was
-- answered, and it was answered THIS well. A nullable `score` on the task
-- cannot distinguish "we never asked" from "we asked and they ignored it",
-- and the difference is the whole rate-limiting argument below — a customer
-- who ignores the question must not be asked again next week.
--
-- It also carries WHO the job was attributed to, captured at ask time. The
-- task's assignee can change afterwards, and a rating that followed it would
-- silently move a complaint onto whoever inherited the job.
-- ---------------------------------------------------------------------------

-- The ask is a scheduled message, so the origin vocabulary grows by one.
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'scheduled_messages_origin_ck'
  ) then
    alter table public.scheduled_messages drop constraint scheduled_messages_origin_ck;
  end if;
  alter table public.scheduled_messages
    add constraint scheduled_messages_origin_ck
    check (origin in ('human', 'reminder', 'rating'));
end $$;

-- The reminder shape constraint said 'human' rows carry no offset. A 'rating'
-- row does not either, and it is tied to a task the same way a reminder is.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'scheduled_messages_reminder_shape_ck'
  ) then
    alter table public.scheduled_messages
      drop constraint scheduled_messages_reminder_shape_ck;
  end if;
  alter table public.scheduled_messages
    add constraint scheduled_messages_reminder_shape_ck
    check (
      (origin = 'reminder'
        and task_id is not null and reminder_offset_minutes is not null)
      -- #313: attached to the job it is asking about, and carrying no offset —
      -- it is scheduled from the moment the job FINISHED, not from a booking.
      or (origin = 'rating'
        and task_id is not null and reminder_offset_minutes is null)
      or (origin = 'human' and reminder_offset_minutes is null)
    );
end $$;

comment on column public.scheduled_messages.origin is
  '#237/#313: ''reminder'' rows are generated from appointment_reminder_rules '
  'and regenerated wholesale when the job moves; ''rating'' rows ask how a '
  'finished job went. ''human'' rows are somebody''s own words and are never '
  'touched by either sweep.';

-- ---------------------------------------------------------------------------
-- The rating itself.
-- ---------------------------------------------------------------------------
create table if not exists public.job_ratings (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  task_id         uuid not null references public.tasks(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,

  -- WHO was asked. Carried explicitly rather than joined through the
  -- conversation, because the rate limit is per PERSON and a contact merged or
  -- re-threaded later must not reset it.
  contact_id      uuid not null references public.contacts(id) on delete cascade,

  -- WHO the job was attributed to, captured when the question was asked.
  --
  -- Not joined live from the task. An assignee can change afterwards, and a
  -- rating that followed it would move a complaint onto whoever inherited the
  -- job — which is the single most damaging thing a per-member signal can do.
  -- Nullable: an unassigned job is still worth asking about, and the answer is
  -- about the workspace rather than about nobody.
  rated_user_id   uuid references auth.users(id) on delete set null,

  -- 1..5, and NULL until they answer. The three states this table exists to
  -- tell apart are (no row) = never asked, (row, null score) = asked and
  -- ignored, (row, score) = answered.
  score           smallint check (score is null or score between 1 and 5),

  asked_at        timestamptz not null default now(),
  answered_at     timestamptz,

  -- #313: "a poor answer reaches the owner immediately, as something needing a
  -- human today". Stamped when that alert goes, so a redelivery or a second
  -- reply cannot wake the crew twice about one unhappy customer.
  escalated_at    timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.job_ratings is
  '#313: one post-job satisfaction question and its answer. INTERNAL signal '
  'only — D47/D32 forbid any public-review path. The ASK is a '
  'scheduled_messages row with origin=''rating''; this is the record of it.';

-- One question per job. Asking twice about the same visit reads as a business
-- that is not listening, which is the opposite of the point.
create unique index if not exists job_ratings_task_uq
  on public.job_ratings (task_id);

-- The rate-limit read: "when did we last ask this person anything?"
create index if not exists job_ratings_contact_idx
  on public.job_ratings (company_id, contact_id, asked_at desc);

-- The reporting read: scores over time, and per member when the owner has
-- deliberately turned that on (#239's argument, restated by this issue).
create index if not exists job_ratings_answered_idx
  on public.job_ratings (company_id, answered_at)
  where answered_at is not null;

alter table public.job_ratings enable row level security;
revoke all on public.job_ratings from public, anon, authenticated;
grant select, insert, update, delete on public.job_ratings to service_role;

-- ---------------------------------------------------------------------------
-- How often one customer may be asked.
--
-- #313: "a customer who gets a satisfaction request after every visit stops
-- answering and starts resenting it." Thirty days is longer than the gap
-- between two visits for most trades, so a customer on a maintenance contract
-- is asked about roughly one visit a quarter rather than all of them.
--
-- A FUNCTION rather than a constant in TypeScript, because the check has to be
-- inside the claim below — two jobs finishing minutes apart would otherwise
-- both pass a check made before either wrote a row.
-- ---------------------------------------------------------------------------
create or replace function public.job_rating_cooldown_days()
  returns integer language sql immutable as $$ select 30 $$;

-- ---------------------------------------------------------------------------
-- Claim the right to ask about one job.
--
-- Returns a `{ outcome }` sentinel rather than raising: "we asked this person
-- last week" is something to record and move on from, not an exception.
--
-- WRITES THE ROW AS PART OF THE CHECK. The rate limit and the insert cannot
-- straddle two statements — two jobs for the same customer finishing in the
-- same minute would both read "nothing recent" and both ask.
-- ---------------------------------------------------------------------------
create or replace function public.api_claim_job_rating(
  p_company_id      uuid,
  p_task_id         uuid,
  p_conversation_id uuid,
  p_contact_id      uuid,
  p_rated_user_id   uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last timestamp with time zone;
  v_id   uuid;
begin
  -- Already asked about THIS job: not a failure, just nothing to do.
  if exists (
    select 1 from public.job_ratings
     where task_id = p_task_id and company_id = p_company_id
  ) then
    return jsonb_build_object('outcome', 'already_asked');
  end if;

  select max(asked_at) into v_last
    from public.job_ratings
   where company_id = p_company_id
     and contact_id = p_contact_id;

  if v_last is not null
     and v_last > now() - make_interval(days => public.job_rating_cooldown_days())
  then
    return jsonb_build_object(
      'outcome', 'too_soon',
      'last_asked_at', v_last,
      'cooldown_days', public.job_rating_cooldown_days()
    );
  end if;

  insert into public.job_ratings
    (company_id, task_id, conversation_id, contact_id, rated_user_id)
  values
    (p_company_id, p_task_id, p_conversation_id, p_contact_id, p_rated_user_id)
  returning id into v_id;

  return jsonb_build_object('outcome', 'claimed', 'id', v_id);
end $$;

revoke all on function public.api_claim_job_rating(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_claim_job_rating(uuid, uuid, uuid, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Record the answer.
--
-- Idempotent on the first answer, like `api_confirm_task`: a customer who
-- replies twice answered once, and the caller needs to tell "this reply is the
-- answer" from "they had already answered" to decide whether anything is posted
-- to the thread or anybody is woken.
--
-- Answers only the MOST RECENT unanswered ask on the conversation. A digit
-- arriving months after a question nobody answered is not an answer to it —
-- and the cooldown means there is at most one open question per customer
-- anyway, which is the property that makes "the most recent" unambiguous.
-- ---------------------------------------------------------------------------
create or replace function public.api_record_job_rating(
  p_company_id      uuid,
  p_conversation_id uuid,
  p_score           smallint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.job_ratings;
begin
  if p_score is null or p_score < 1 or p_score > 5 then
    return jsonb_build_object('outcome', 'out_of_range');
  end if;

  select * into v_row
    from public.job_ratings
   where company_id = p_company_id
     and conversation_id = p_conversation_id
     and answered_at is null
   order by asked_at desc
   limit 1
   for update;

  if not found then
    return jsonb_build_object('outcome', 'nothing_asked');
  end if;

  update public.job_ratings
     set score = p_score, answered_at = now(), updated_at = now()
   where id = v_row.id;

  return jsonb_build_object(
    'outcome', 'recorded',
    'id', v_row.id,
    'task_id', v_row.task_id,
    'score', p_score,
    'rated_user_id', v_row.rated_user_id
  );
end $$;

revoke all on function public.api_record_job_rating(uuid, uuid, smallint)
  from public, anon, authenticated;
grant execute on function public.api_record_job_rating(uuid, uuid, smallint)
  to service_role;
