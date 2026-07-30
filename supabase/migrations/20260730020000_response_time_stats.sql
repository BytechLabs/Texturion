-- #239 — time to first response, measured.
--
-- We sell "FIRST RESPONSE". A contractor cannot currently open the app and see
-- "you answer in 4 minutes; you used to take 3 hours", which is the whole
-- retention argument — without it they are paying a monthly bill for a feeling.
--
-- ===========================================================================
-- THE DEFINITION, WHICH IS THE HARD PART
-- ===========================================================================
--
-- The issue is right that definitional honesty must be settled before build:
-- "getting this wrong produces a vanity metric the customer stops trusting the
-- first time it disagrees with their gut". So each rule below is stated with
-- the reason, and `docs/RESPONSE-TIME.md` says the same thing in the words the
-- UI uses.
--
-- ONE MEASUREMENT PER CONVERSATION: the first inbound message, and the first
-- human reply after it.
--
-- 1. WHAT STARTS THE CLOCK. The first message in the thread, and only if it is
--    INBOUND. A thread we opened is us reaching out, not a customer waiting —
--    there is nothing to be fast about. This matches the shipped #388 lead
--    clock, which only ever starts on inbound.
--
-- 2. WHAT STOPS IT. `direction = 'outbound' AND automated = false` — a HUMAN
--    reply, exactly as the #388 clock defines it. Testing `sent_by_user_id`
--    instead would be WRONG: it is NOT NULL on automated sends too (they are
--    attributed to the owner because the outbound-actor CHECK requires an
--    actor), so that test silently reads every away reply as the owner
--    answering. An auto-reply is the state this product exists to get out of,
--    not a response to it.
--
-- 3. NOTES ARE NOT REPLIES, and are not the start of a thread either. A note is
--    `direction = 'note'`, so rule 2 excludes it for free; rule 1 excludes it
--    explicitly, because a note a dispatcher wrote before the customer ever
--    texted must not disqualify the thread from being measured.
--
-- 4. SPAM IS EXCLUDED. Nobody owes a spammer a fast answer, and leaving them in
--    would make the number worse for doing the right thing.
--
-- 5. A REOPENED THREAD IS NOT RE-MEASURED. Three weeks later the same person
--    texting again is a returning customer, not a new lead, and blending the
--    two makes the headline drift for reasons the crew cannot act on.
--
--    THIS IS A DELIBERATE DIFFERENCE FROM THE #388 LADDER, which does chase a
--    reopened thread (the reopen sets status='new'). The two answer different
--    questions: the ladder asks "who is waiting right now", and it should chase
--    a returning customer. This asks "how fast do we answer a new customer",
--    which is the claim we sell. Documented rather than reconciled, because
--    reconciling them would make one of the two wrong.
--
-- 6. UNANSWERED LEADS ARE COUNTED, NOT DROPPED. A thread nobody ever replied to
--    contributes to `unanswered`, and to nothing else. Silently excluding them
--    would let a workspace improve its median by ignoring more leads, which is
--    the exact behaviour the metric is supposed to expose.
--
-- ===========================================================================
-- WHY THIS IS A READ-ONLY FUNCTION OVER EXISTING COLUMNS
-- ===========================================================================
--
-- The issue's third acceptance criterion: "computed from data we already store,
-- without a new write path on the hot send/receive path". So there is no
-- materialized table and no trigger — every number here is derived from
-- `messages`, and the two indexes it needs already exist:
-- `messages_conv_created_idx` (conversation_id, created_at) and the #388
-- `messages_human_outbound_idx` partial index on human outbound.
--
-- WHY IT RETURNS ROWS AS WELL AS AGGREGATES. The business-hours split the issue
-- asks for cannot be computed here. Business-hours evaluation lives in
-- `packages/shared` and the 20260730002500 migration says why in as many words:
-- "the shape is enforced there, not here, so the four surfaces share one rule".
-- A plpgsql copy of the weekday loop, the timezone conversion and the #402
-- date-range exceptions would be a FIFTH implementation of load-bearing logic,
-- and the one that drifts is always the one nobody reads.
--
-- So the percentiles are computed here, exactly, over every qualifying lead —
-- they are never affected by the row cap — and the rows are returned so the
-- Worker can classify each lead's opening time with the one shared evaluator.
-- `truncated` says plainly when the row list is short of the aggregate count,
-- because a cap that reports nothing reads as "we looked at everything".

alter table public.companies
  add column if not exists response_stats_per_member boolean not null default false;

comment on column public.companies.response_stats_per_member is
  '#239: the owner has opted into per-member response times. Default FALSE. '
  'Per-member numbers are motivating in some crews and toxic in others, so '
  'workspace-level is the default and naming individuals is a choice the owner '
  'makes, not one we make for them.';

create or replace function public.api_response_time_stats(
  p_company_id uuid,
  p_since timestamptz,
  p_until timestamptz,
  p_max_rows int default 5000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_result jsonb;
begin
  if p_company_id is null then
    raise exception 'api_response_time_stats: p_company_id is required';
  end if;
  -- A cap of zero or less would return no rows while the aggregates looked
  -- healthy, which is the silent-truncation failure this function is written to
  -- avoid. Clamp rather than trust the caller.
  p_max_rows := greatest(coalesce(p_max_rows, 5000), 1);

  -- ONE statement, no temp table. A temp table would have meant a DELETE with
  -- no WHERE (which the migration guard rightly refuses to read as safe) and,
  -- worse, temp state inside a pooled PostgREST connection whose transaction
  -- boundary is not this function's to assume. A CTE is visible to every
  -- subquery in the statement, which is all the reuse this needs.
  with first_message as (
    -- The opening message of each thread. Notes are not messages for this
    -- purpose (rule 3), so they cannot become the thread's first row and
    -- disqualify it.
    select
      m.conversation_id,
      m.created_at,
      m.direction,
      row_number() over (
        partition by m.conversation_id
        order by m.created_at, m.id
      ) as rn
    from public.messages m
    where m.company_id = p_company_id
      and m.direction <> 'note'
  ),
  leads as (
    select
      f.conversation_id,
      c.phone_number_id,
      f.created_at as opened_at
    from first_message f
    join public.conversations c on c.id = f.conversation_id
    where f.rn = 1
      and f.direction = 'inbound'          -- rule 1
      and c.is_spam = false                -- rule 4
      and c.company_id = p_company_id
      and f.created_at >= p_since
      and f.created_at < p_until
  ),
  scored as (
    select
      l.conversation_id,
      l.phone_number_id,
      l.opened_at,
      r.created_at as responded_at,
      r.sent_by_user_id as responder_user_id,
      case
        when r.created_at is null then null
        else extract(epoch from (r.created_at - l.opened_at))
      end as response_seconds
    from leads l
    left join lateral (
      -- Rule 2: the first HUMAN outbound at or after the opening message.
      select m.created_at, m.sent_by_user_id
      from public.messages m
      where m.conversation_id = l.conversation_id
        and m.direction = 'outbound'
        and m.automated = false
        and m.created_at >= l.opened_at
      order by m.created_at, m.id
      limit 1
    ) r on true
  ),
  answered as (
    select * from scored where response_seconds is not null
  )
  select jsonb_build_object(
    'since', p_since,
    'until', p_until,
    -- Every aggregate below is over ALL qualifying leads, never over the capped
    -- row list, so the headline number cannot quietly become a number about a
    -- sample.
    'leads', (select count(*) from scored),
    'answered', (select count(*) from answered),
    -- Rule 6: counted, never dropped. Excluding them would let a workspace
    -- improve its median by ignoring more leads.
    'unanswered', (select count(*) from scored where response_seconds is null),
    'median_seconds', (
      select percentile_cont(0.5) within group (order by response_seconds)
      from answered
    ),
    'p90_seconds', (
      select percentile_cont(0.9) within group (order by response_seconds)
      from answered
    ),
    'by_member', (
      select coalesce(jsonb_agg(m order by (m->>'median_seconds')::numeric), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'user_id', responder_user_id,
          'answered', count(*),
          'median_seconds', percentile_cont(0.5) within group (
            order by response_seconds
          )
        ) as m
        from answered
        where responder_user_id is not null
        group by responder_user_id
      ) s
    ),
    'by_number', (
      select coalesce(jsonb_agg(n), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'phone_number_id', phone_number_id,
          'leads', count(*),
          'answered', count(*) filter (where response_seconds is not null),
          'median_seconds', percentile_cont(0.5) within group (
            order by response_seconds
          ) filter (where response_seconds is not null)
        ) as n
        from scored
        where phone_number_id is not null
        group by phone_number_id
      ) s
    ),
    -- The rows, capped, for the Worker's business-hours classification. Newest
    -- first so a truncated list is the recent window rather than an arbitrary
    -- slice.
    'rows', (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
      from (
        select
          conversation_id,
          phone_number_id,
          opened_at,
          responded_at,
          responder_user_id,
          response_seconds
        from scored
        order by opened_at desc
        limit p_max_rows
      ) t
    ),
    -- Named, never implied. A caller that cannot see the cap will report a
    -- business-hours split about a subset as though it covered everything.
    'row_limit', p_max_rows,
    'truncated', (select count(*) from scored) > p_max_rows
  )
  into v_result;

  return v_result;
end;
$function$;

comment on function public.api_response_time_stats(uuid, timestamptz, timestamptz, int) is
  '#239: time to first HUMAN response per lead, plus exact percentiles over '
  'every qualifying lead and a capped row list for the Worker business-hours '
  'split. Read-only; see the header of its migration and docs/RESPONSE-TIME.md '
  'for the definition the UI must match.';

revoke all on function public.api_response_time_stats(uuid, timestamptz, timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.api_response_time_stats(uuid, timestamptz, timestamptz, int)
  to service_role;
