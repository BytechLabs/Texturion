-- [#431] AI outcomes — assertion suite for
-- supabase/migrations/20260730004900_ai_outcomes.sql.
--
-- We metered every AI unit we spent and recorded nothing about whether anyone
-- used the output. For the one feature whose output is explicitly OPTIONAL — a
-- drafted reply a human accepts or discards — that made "is Lou worth what it
-- costs?" unanswerable rather than merely unanswered.
--
--   AO-1  the three outcomes are counted separately, never collapsed
--   AO-2  an unknown outcome is rejected and counted nowhere
--   AO-3  spend and value land on the SAME row
--   AO-4  an outcome arriving with no prior reservation still counts
--   AO-5  the report is tenant-scoped, states its denominator, and returns no rate
--
-- One transaction, rolled back. Fixtures use an 'ae' id prefix (uuids are hex, so
-- 'ai' is not a legal prefix).

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                        created_at, updated_at, aud, role)
values ('ae000000-0000-4000-8000-000000000001', 'ai@test.local', '', now(),
        now(), now(), 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values ('ae000000-0000-4000-8000-0000000000a1', 'Drafting Co',
        'ae000000-0000-4000-8000-000000000001', 'US', '212', now(), 'active', 'pro'),
       ('ae000000-0000-4000-8000-0000000000b1', 'Transcribing Co',
        'ae000000-0000-4000-8000-000000000001', 'US', '213', now(), 'active', 'pro');

-- ===========================================================================
-- AO-1. Three counters, never one rate.
--
--       #431's own devil's advocate is the reason. A discard can mean the draft
--       was wrong, or that the crew member wanted to say something more personal
--       — which is the product working as intended. An edit can mean 80% right
--       and time saved, or 20% right and time lost. Collapsing them destroys the
--       exact distinction that makes the number worth reading.
-- ===========================================================================
do $$
declare
  co uuid := 'ae000000-0000-4000-8000-0000000000a1';
  u  public.company_ai_usage%rowtype;
begin
  perform public.ai_outcome_record(co, 'suggest_reply', 'used');
  perform public.ai_outcome_record(co, 'suggest_reply', 'used');
  perform public.ai_outcome_record(co, 'suggest_reply', 'edited');
  perform public.ai_outcome_record(co, 'suggest_reply', 'discarded');

  select * into u from public.company_ai_usage
   where company_id = co and feature = 'suggest_reply';

  if u.outcome_used_count is distinct from 2 then
    raise exception 'AO-1 FAILED: used = % (want 2)', u.outcome_used_count;
  end if;
  if u.outcome_edited_count is distinct from 1 then
    raise exception 'AO-1 FAILED: edited = % (want 1)', u.outcome_edited_count;
  end if;
  if u.outcome_discarded_count is distinct from 1 then
    raise exception 'AO-1 FAILED: discarded = % (want 1)', u.outcome_discarded_count;
  end if;
  raise notice 'AO-1 PASSED: used/edited/discarded counted separately (2/1/1)';
end $$;

-- ===========================================================================
-- AO-2. An unknown outcome is REJECTED.
--
--       A client typo must surface as an error, not as a quietly missing number.
--       A quietly missing number is the entire failure this issue is about.
-- ===========================================================================
do $$
declare
  co       uuid := 'ae000000-0000-4000-8000-0000000000a1';
  v_before integer;
  v_after  integer;
  v_bad    text;
begin
  select outcome_used_count + outcome_edited_count + outcome_discarded_count
    into v_before from public.company_ai_usage
   where company_id = co and feature = 'suggest_reply';

  foreach v_bad in array array['accepted', 'thumbs_up', '', 'USED'] loop
    if (public.ai_outcome_record(co, 'suggest_reply', v_bad) ->> 'error')
       is distinct from 'validation_failed' then
      raise exception 'AO-2 FAILED: outcome "%" was accepted', v_bad;
    end if;
  end loop;

  select outcome_used_count + outcome_edited_count + outcome_discarded_count
    into v_after from public.company_ai_usage
   where company_id = co and feature = 'suggest_reply';
  if v_after is distinct from v_before then
    raise exception 'AO-2 FAILED: a rejected outcome still moved a counter (% -> %)',
      v_before, v_after;
  end if;
  raise notice 'AO-2 PASSED: unknown outcomes rejected and counted nowhere';
end $$;

-- ===========================================================================
-- AO-3. Spend and value share one row.
--
--       Ask 3 wants acceptance surfaced beside cost. Making them the same row is
--       how that stops depending on somebody remembering to join. This runs the
--       upsert from the OTHER direction than AO-1 did — outcomes first, then a
--       reservation — because both orders happen in production and either one
--       creating a second row would separate cost from value forever.
-- ===========================================================================
do $$
declare
  co     uuid := 'ae000000-0000-4000-8000-0000000000a1';
  v_rows integer;
  u      public.company_ai_usage%rowtype;
begin
  perform public.ai_usage_reserve(co, 'suggest_reply', 1500, 1200);

  select count(*) into v_rows from public.company_ai_usage
   where company_id = co and feature = 'suggest_reply';
  if v_rows is distinct from 1 then
    raise exception 'AO-3 FAILED: spend and outcomes are on % rows, want 1', v_rows;
  end if;

  select * into u from public.company_ai_usage
   where company_id = co and feature = 'suggest_reply';
  if u.request_count < 1 or u.outcome_used_count < 2 then
    raise exception 'AO-3 FAILED: the shared row lost one side (requests %, used %)',
      u.request_count, u.outcome_used_count;
  end if;
  raise notice 'AO-3 PASSED: cost and value on one row (requests %, used %)',
    u.request_count, u.outcome_used_count;
end $$;

-- ===========================================================================
-- AO-4. An outcome with no prior reservation still counts.
--
--       A suggestion drafted on the last day of a month and sent on the first of
--       the next one would otherwise lose its outcome, biasing the rate toward
--       whatever happened mid-month. It must NOT invent a request while doing so:
--       a fabricated request is spend we never paid for.
-- ===========================================================================
do $$
declare
  co uuid := 'ae000000-0000-4000-8000-0000000000b1';
  u  public.company_ai_usage%rowtype;
begin
  perform public.ai_outcome_record(co, 'voicemail_transcript', 'used');

  select * into u from public.company_ai_usage
   where company_id = co and feature = 'voicemail_transcript';
  if u.company_id is null then
    raise exception 'AO-4 FAILED: an outcome with no reservation was dropped';
  end if;
  if u.outcome_used_count is distinct from 1 then
    raise exception 'AO-4 FAILED: used = % (want 1)', u.outcome_used_count;
  end if;
  if u.request_count is distinct from 0 then
    raise exception 'AO-4 FAILED: recording an outcome invented % request(s)',
      u.request_count;
  end if;
  raise notice 'AO-4 PASSED: outcome kept, and it fabricated no spend';
end $$;

-- ===========================================================================
-- AO-5. The report is tenant-scoped and reports its own denominator.
--
--       `outcomes_recorded` is separate from `requests` on purpose: they will NOT
--       match, because a suggestion generated and never looked at is a request
--       with no outcome. Reading a rate over the wrong denominator is how a
--       number like this becomes misleading, so the function returns both and no
--       ratio — ask 5 requires the threshold be chosen BEFORE the data arrives,
--       and a blessed rate here would quietly become that threshold's definition.
-- ===========================================================================
do $$
declare
  co      uuid := 'ae000000-0000-4000-8000-0000000000a1';
  other   uuid := 'ae000000-0000-4000-8000-0000000000b1';
  v_entry jsonb;
begin
  select value into v_entry
    from jsonb_array_elements(public.api_ai_value_report(co)) value
   where value ->> 'feature' = 'suggest_reply';
  if v_entry is null then
    raise exception 'AO-5 FAILED: the report omits a feature with activity';
  end if;

  if (v_entry ->> 'outcomes_recorded')::integer is distinct from 4 then
    raise exception 'AO-5 FAILED: outcomes_recorded = % (want 4)',
      v_entry ->> 'outcomes_recorded';
  end if;
  if (v_entry ->> 'requests')::integer is distinct from 1 then
    raise exception 'AO-5 FAILED: requests = % (want 1)', v_entry ->> 'requests';
  end if;
  if v_entry ? 'acceptance_rate' or v_entry ? 'rate' then
    raise exception 'AO-5 FAILED: the report computes a rate; it must return counts';
  end if;

  -- The other tenant's voicemail row must not appear in this company's report.
  if exists (
    select 1 from jsonb_array_elements(public.api_ai_value_report(co)) v
     where v ->> 'feature' = 'voicemail_transcript'
  ) then
    raise exception 'AO-5 FAILED: the report leaked another tenant''s feature row';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(public.api_ai_value_report(other)) v
     where v ->> 'feature' = 'voicemail_transcript'
  ) then
    raise exception 'AO-5 FAILED: the other tenant''s own row is missing';
  end if;

  raise notice 'AO-5 PASSED: tenant-scoped, both denominators reported, no rate';
end $$;

select 'ai_outcomes.test.sql: AO-1..AO-5 PASSED' as result;

rollback;
