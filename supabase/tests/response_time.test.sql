-- [#239] Time to first response — assertion suite for
-- supabase/migrations/20260730020000_response_time_stats.sql.
--
-- This metric is a retention argument the customer is meant to repeat to other
-- contractors, so what this suite mostly pins is the cases where a NAIVE
-- implementation would produce a flattering lie: an auto-reply counted as an
-- answer, a note counted as an answer, an unanswered lead quietly dropped so the
-- median improves, a thread we opened counted as a lead we were slow to.
--
-- Every one of those makes the number better than the truth, which is the
-- direction that destroys trust the first time it disagrees with the crew's gut.
--
-- One transaction, rolled back. Fixtures use an 'f2' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('f2000000-0000-4000-8000-00000000000a'::uuid, 'rt-owner@test.local'),
  ('f2000000-0000-4000-8000-00000000000b'::uuid, 'rt-tech@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status)
values
  ('f2000000-0000-4000-8000-0000000000c1'::uuid, 'Response Co',
   'f2000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 'active');

insert into public.phone_numbers
  (id, company_id, number_e164, status, country, provisioning_key,
   telnyx_phone_number_id)
values
  ('f2000000-0000-4000-8000-0000000000f1'::uuid,
   'f2000000-0000-4000-8000-0000000000c1'::uuid, '+14155550100', 'active', 'US',
   'rt-prov-1', 'tn-f2-1');

insert into public.contacts (id, company_id, phone_e164)
values
  ('f2000000-0000-4000-8000-0000000000a1'::uuid,
   'f2000000-0000-4000-8000-0000000000c1'::uuid, '+14155550201'),
  ('f2000000-0000-4000-8000-0000000000a2'::uuid,
   'f2000000-0000-4000-8000-0000000000c1'::uuid, '+14155550202'),
  ('f2000000-0000-4000-8000-0000000000a3'::uuid,
   'f2000000-0000-4000-8000-0000000000c1'::uuid, '+14155550203'),
  ('f2000000-0000-4000-8000-0000000000a4'::uuid,
   'f2000000-0000-4000-8000-0000000000c1'::uuid, '+14155550204'),
  ('f2000000-0000-4000-8000-0000000000a5'::uuid,
   'f2000000-0000-4000-8000-0000000000c1'::uuid, '+14155550205'),
  ('f2000000-0000-4000-8000-0000000000a6'::uuid,
   'f2000000-0000-4000-8000-0000000000c1'::uuid, '+14155550206'),
  ('f2000000-0000-4000-8000-0000000000a7'::uuid,
   'f2000000-0000-4000-8000-0000000000c1'::uuid, '+14155550207');

-- Helper: a thread, and the messages on it at explicit offsets from a base.
create or replace function pg_temp.thread(
  p_conv uuid, p_contact uuid, p_spam boolean default false
) returns void language plpgsql as $$
begin
  insert into public.conversations
    (id, company_id, contact_id, phone_number_id, status, is_spam)
  values
    (p_conv, 'f2000000-0000-4000-8000-0000000000c1'::uuid, p_contact,
     'f2000000-0000-4000-8000-0000000000f1'::uuid, 'open', p_spam);
end $$;

create or replace function pg_temp.msg(
  p_conv uuid,
  p_direction message_direction,
  p_minutes numeric,
  p_automated boolean default false,
  p_actor uuid default 'f2000000-0000-4000-8000-00000000000a'::uuid
) returns void language plpgsql as $$
begin
  insert into public.messages
    (company_id, conversation_id, direction, body, status, sent_by_user_id,
     automated, created_at)
  values
    ('f2000000-0000-4000-8000-0000000000c1'::uuid,
     p_conv,
     p_direction,
     'x',
     case when p_direction = 'note' then null
          when p_direction = 'inbound' then 'received'::message_status
          else 'delivered'::message_status end,
     case when p_direction = 'inbound' then null else p_actor end,
     p_automated,
     timestamptz '2026-07-01 12:00:00+00' + (p_minutes || ' minutes')::interval);
end $$;

create or replace function pg_temp.stats() returns jsonb language sql as $$
  select public.api_response_time_stats(
    'f2000000-0000-4000-8000-0000000000c1'::uuid,
    timestamptz '2026-06-01 00:00:00+00',
    timestamptz '2026-08-01 00:00:00+00');
$$;

-- ===========================================================================
-- RT-1. The straightforward case, and the units.
-- ===========================================================================
do $$
declare s jsonb;
begin
  perform pg_temp.thread('f2000000-0000-4000-8000-0000000000e1'::uuid,
                         'f2000000-0000-4000-8000-0000000000a1'::uuid);
  perform pg_temp.msg('f2000000-0000-4000-8000-0000000000e1'::uuid, 'inbound', 0);
  perform pg_temp.msg('f2000000-0000-4000-8000-0000000000e1'::uuid, 'outbound', 4);

  s := pg_temp.stats();
  if (s->>'leads')::int is distinct from 1 then
    raise exception 'RT-1 FAILED: leads = % (want 1)', s->>'leads';
  end if;
  if (s->>'answered')::int is distinct from 1 then
    raise exception 'RT-1 FAILED: answered = % (want 1)', s->>'answered';
  end if;
  if (s->>'median_seconds')::numeric is distinct from 240 then
    raise exception 'RT-1 FAILED: median = % (want 240s = 4 min)',
      s->>'median_seconds';
  end if;
  raise notice 'RT-1 PASSED: a four-minute reply measures 240 seconds';
end $$;

-- ===========================================================================
-- RT-2. An AUTO-REPLY IS NOT AN ANSWER.
--
-- The single most tempting wrong implementation. "We'll get back to you" is the
-- state this product exists to get out of; counting it would report a median of
-- seconds for a workspace that answers nothing, which is worse than no metric.
--
-- Note the specific trap: sent_by_user_id is NOT NULL on the automated row (the
-- outbound-actor CHECK requires an actor, so auto-replies are attributed to the
-- owner). Any implementation testing the actor instead of `automated` reads
-- every away reply as the owner answering.
-- ===========================================================================
do $$
declare s jsonb;
begin
  perform pg_temp.thread('f2000000-0000-4000-8000-0000000000e2'::uuid,
                         'f2000000-0000-4000-8000-0000000000a2'::uuid);
  perform pg_temp.msg('f2000000-0000-4000-8000-0000000000e2'::uuid, 'inbound', 0);
  -- Robot answers in one minute…
  perform pg_temp.msg('f2000000-0000-4000-8000-0000000000e2'::uuid, 'outbound', 1, true);
  -- …a human, ninety minutes later. THAT is the response.
  perform pg_temp.msg('f2000000-0000-4000-8000-0000000000e2'::uuid, 'outbound', 90);

  s := pg_temp.stats();
  -- Two leads now (RT-1's and this one): 240s and 5400s → median 2820.
  if (s->>'answered')::int is distinct from 2 then
    raise exception 'RT-2 FAILED: answered = % (want 2)', s->>'answered';
  end if;
  if (s->>'median_seconds')::numeric is distinct from 2820 then
    raise exception
      'RT-2 FAILED: median = % (want 2820 — the auto-reply must not count)',
      s->>'median_seconds';
  end if;
  raise notice 'RT-2 PASSED: the auto-reply did not stop the clock';
end $$;

-- ===========================================================================
-- RT-3. A NOTE IS NOT AN ANSWER, and a note before the customer texts does not
--       disqualify the thread.
--
-- Both directions matter. A dispatcher's internal note is not a reply to the
-- customer; and a note written first must not make the thread look
-- outbound-started and vanish from the metric entirely.
-- ===========================================================================
do $$
declare s jsonb;
begin
  perform pg_temp.thread('f2000000-0000-4000-8000-0000000000e3'::uuid,
                         'f2000000-0000-4000-8000-0000000000a3'::uuid);
  -- A note lands BEFORE the customer's first text.
  perform pg_temp.msg('f2000000-0000-4000-8000-0000000000e3'::uuid, 'note', -10);
  perform pg_temp.msg('f2000000-0000-4000-8000-0000000000e3'::uuid, 'inbound', 0);
  -- Another note is not a reply…
  perform pg_temp.msg('f2000000-0000-4000-8000-0000000000e3'::uuid, 'note', 2);
  -- …the outbound at +10 is.
  perform pg_temp.msg('f2000000-0000-4000-8000-0000000000e3'::uuid, 'outbound', 10);

  s := pg_temp.stats();
  if (s->>'leads')::int is distinct from 3 then
    raise exception
      'RT-3 FAILED: leads = % (want 3 — the note-first thread still counts)',
      s->>'leads';
  end if;
  -- 240, 600, 5400 → median 600.
  if (s->>'median_seconds')::numeric is distinct from 600 then
    raise exception 'RT-3 FAILED: median = % (want 600 — notes are not replies)',
      s->>'median_seconds';
  end if;
  raise notice 'RT-3 PASSED: notes neither answer nor disqualify';
end $$;

-- ===========================================================================
-- RT-4. A THREAD WE OPENED IS NOT A LEAD.
--
-- We texted them first; there was nobody waiting. Counting it would punish a
-- workspace for doing outreach, and their reply-to-our-reply time is not the
-- claim we sell.
-- ===========================================================================
do $$
declare s jsonb; v_before int;
begin
  select (pg_temp.stats()->>'leads')::int into v_before;

  perform pg_temp.thread('f2000000-0000-4000-8000-0000000000e4'::uuid,
                         'f2000000-0000-4000-8000-0000000000a4'::uuid);
  perform pg_temp.msg('f2000000-0000-4000-8000-0000000000e4'::uuid, 'outbound', 0);
  perform pg_temp.msg('f2000000-0000-4000-8000-0000000000e4'::uuid, 'inbound', 60);
  perform pg_temp.msg('f2000000-0000-4000-8000-0000000000e4'::uuid, 'outbound', 1000);

  s := pg_temp.stats();
  if (s->>'leads')::int is distinct from v_before then
    raise exception 'RT-4 FAILED: leads went % -> % (an outbound-started thread counted)',
      v_before, s->>'leads';
  end if;
  raise notice 'RT-4 PASSED: a thread we opened is not measured';
end $$;

-- ===========================================================================
-- RT-5. AN UNANSWERED LEAD IS COUNTED, NOT DROPPED.
--
-- The load-bearing one. If silence is excluded, a workspace improves its median
-- by ignoring more leads — the exact behaviour the metric exists to expose. So
-- the unanswered lead must raise `leads` and `unanswered` while leaving the
-- median of the answered ones untouched.
-- ===========================================================================
do $$
declare s jsonb; v_median numeric; v_leads int;
begin
  select (pg_temp.stats()->>'median_seconds')::numeric,
         (pg_temp.stats()->>'leads')::int
    into v_median, v_leads;

  perform pg_temp.thread('f2000000-0000-4000-8000-0000000000e5'::uuid,
                         'f2000000-0000-4000-8000-0000000000a5'::uuid);
  perform pg_temp.msg('f2000000-0000-4000-8000-0000000000e5'::uuid, 'inbound', 0);
  -- Nobody ever replies. Not even a robot.

  s := pg_temp.stats();
  if (s->>'leads')::int is distinct from v_leads + 1 then
    raise exception 'RT-5 FAILED: the unanswered lead did not raise leads (% -> %)',
      v_leads, s->>'leads';
  end if;
  if (s->>'unanswered')::int is distinct from 1 then
    raise exception 'RT-5 FAILED: unanswered = % (want 1)', s->>'unanswered';
  end if;
  if (s->>'median_seconds')::numeric is distinct from v_median then
    raise exception
      'RT-5 FAILED: median moved % -> % because of a lead with no reply',
      v_median, s->>'median_seconds';
  end if;
  raise notice 'RT-5 PASSED: silence is counted and does not flatter the median';
end $$;

-- ===========================================================================
-- RT-6. SPAM IS EXCLUDED.
-- ===========================================================================
do $$
declare s jsonb; v_leads int;
begin
  select (pg_temp.stats()->>'leads')::int into v_leads;

  perform pg_temp.thread('f2000000-0000-4000-8000-0000000000e6'::uuid,
                         'f2000000-0000-4000-8000-0000000000a6'::uuid, true);
  perform pg_temp.msg('f2000000-0000-4000-8000-0000000000e6'::uuid, 'inbound', 0);

  s := pg_temp.stats();
  if (s->>'leads')::int is distinct from v_leads then
    raise exception 'RT-6 FAILED: a spam thread counted as a lead (% -> %)',
      v_leads, s->>'leads';
  end if;
  raise notice 'RT-6 PASSED: spam is not a lead';
end $$;

-- ===========================================================================
-- RT-7. The window is honoured, and the cap is REPORTED rather than implied.
--
-- A cap that reports nothing reads as "we looked at everything". The aggregates
-- must stay exact over every lead even when the row list is short, because the
-- headline number must never quietly become a number about a sample.
-- ===========================================================================
do $$
declare s jsonb; v_all int;
begin
  select (pg_temp.stats()->>'leads')::int into v_all;

  -- A one-row cap: aggregates unchanged, rows short, truncated = true.
  s := public.api_response_time_stats(
    'f2000000-0000-4000-8000-0000000000c1'::uuid,
    timestamptz '2026-06-01 00:00:00+00',
    timestamptz '2026-08-01 00:00:00+00',
    1);
  if (s->>'leads')::int is distinct from v_all then
    raise exception 'RT-7 FAILED: the cap changed the lead count (% vs %)',
      s->>'leads', v_all;
  end if;
  if jsonb_array_length(s->'rows') is distinct from 1 then
    raise exception 'RT-7 FAILED: rows = % (want 1)',
      jsonb_array_length(s->'rows');
  end if;
  if (s->>'truncated')::boolean is not true then
    raise exception 'RT-7 FAILED: truncated must be true when rows are short';
  end if;
  if (s->>'row_limit')::int is distinct from 1 then
    raise exception 'RT-7 FAILED: row_limit not reported';
  end if;

  -- A zero cap is clamped, never honoured: it would return no rows while the
  -- aggregates looked healthy.
  s := public.api_response_time_stats(
    'f2000000-0000-4000-8000-0000000000c1'::uuid,
    timestamptz '2026-06-01 00:00:00+00',
    timestamptz '2026-08-01 00:00:00+00',
    0);
  if jsonb_array_length(s->'rows') < 1 then
    raise exception 'RT-7 FAILED: a zero cap returned no rows';
  end if;

  -- A window before any of these threads finds nothing, and says so without
  -- inventing a median.
  s := public.api_response_time_stats(
    'f2000000-0000-4000-8000-0000000000c1'::uuid,
    timestamptz '2026-01-01 00:00:00+00',
    timestamptz '2026-02-01 00:00:00+00');
  if (s->>'leads')::int is distinct from 0 then
    raise exception 'RT-7 FAILED: an empty window found % leads', s->>'leads';
  end if;
  if s->>'median_seconds' is not null then
    raise exception 'RT-7 FAILED: an empty window invented a median of %',
      s->>'median_seconds';
  end if;
  raise notice 'RT-7 PASSED: window honoured, cap reported, empty window honest';
end $$;

-- ===========================================================================
-- RT-8. Per-member and per-number breakdowns attribute to the right people.
--
-- The member arm exists behind an owner opt-in (companies.
-- response_stats_per_member, default FALSE) because per-member numbers are
-- motivating in some crews and toxic in others. The RPC still computes it; the
-- API decides whether anyone may see it.
-- ===========================================================================
do $$
declare s jsonb; v_tech jsonb; v_default boolean;
begin
  -- The opt-in exists and defaults to off.
  select response_stats_per_member into v_default
  from public.companies
  where id = 'f2000000-0000-4000-8000-0000000000c1'::uuid;
  if v_default is not false then
    raise exception 'RT-8 FAILED: response_stats_per_member defaults to % (want false)',
      v_default;
  end if;

  -- The tech answers a fresh lead in one minute.
  perform pg_temp.thread('f2000000-0000-4000-8000-0000000000e8'::uuid,
                         'f2000000-0000-4000-8000-0000000000a7'::uuid);
  perform pg_temp.msg('f2000000-0000-4000-8000-0000000000e8'::uuid, 'inbound', 0);
  perform pg_temp.msg('f2000000-0000-4000-8000-0000000000e8'::uuid, 'outbound', 1,
                      false, 'f2000000-0000-4000-8000-00000000000b'::uuid);

  s := pg_temp.stats();
  select m into v_tech
  from jsonb_array_elements(s->'by_member') m
  where m->>'user_id' = 'f2000000-0000-4000-8000-00000000000b';
  if v_tech is null then
    raise exception 'RT-8 FAILED: the tech is missing from by_member';
  end if;
  if (v_tech->>'median_seconds')::numeric is distinct from 60 then
    raise exception 'RT-8 FAILED: tech median = % (want 60)',
      v_tech->>'median_seconds';
  end if;

  -- Every lead here is on the one number, so by_number carries them all.
  if jsonb_array_length(s->'by_number') is distinct from 1 then
    raise exception 'RT-8 FAILED: by_number has % entries (want 1)',
      jsonb_array_length(s->'by_number');
  end if;
  raise notice 'RT-8 PASSED: attribution is per responder, opt-in defaults off';
end $$;

-- ===========================================================================
-- RT-9. Grants: the Worker calls this, nobody else can.
-- ===========================================================================
do $$
declare leaked text;
begin
  select string_agg(distinct r.rolname, ',') into leaked
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(p.proacl) a
  join pg_roles r on r.oid = a.grantee
  where n.nspname = 'public'
    and p.proname = 'api_response_time_stats'
    and a.privilege_type = 'EXECUTE'
    and r.rolname in ('public', 'anon', 'authenticated');
  if leaked is not null then
    raise exception 'RT-9 FAILED: api_response_time_stats EXECUTE leaked to %', leaked;
  end if;
  raise notice 'RT-9 PASSED: service-role only';
end $$;

rollback;
