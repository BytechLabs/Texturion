-- [#354] Pipeline stages — assertion suite for
-- supabase/migrations/20260801110000_pipeline_stages.sql.
--
-- The claim this file has to make true is the one the whole design rests on:
-- RENAMING A STAGE BREAKS NOTHING. Everything downstream reads the stage key,
-- so a crew calling it "Quoted" gets the same saved view and the same win rate
-- as a crew that never touched it.
--
-- The rest are the arithmetic traps: counting tag EVENTS instead of
-- conversations lets a tidy-up inflate a win rate, and bucketing by the WIN
-- date instead of the quote date makes every recent period look terrible.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/pipeline_stages.test.sql
--
-- One transaction, rolled back. Fixtures use a '51' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('51000000-0000-4000-8000-00000000000a'::uuid, 'pipeline-a@test.local');

-- The fixture is built by hand rather than through api_create_company: that RPC
-- is overloaded (the D15 timezone default) so neither a positional nor a
-- named-argument call can pick a candidate from psql. What is under test here
-- is `seed_pipeline`, which is the part creation delegates to anyway.
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('51000000-0000-4000-8000-0000000000c1'::uuid, 'Pipeline Plumbing',
   '51000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.company_members (company_id, user_id, role) values
  ('51000000-0000-4000-8000-0000000000c1'::uuid,
   '51000000-0000-4000-8000-00000000000a'::uuid, 'owner');

-- The four names creation seeds, unmarked — exactly the state every workspace
-- that predates this migration is in.
insert into public.tags (company_id, name) values
  ('51000000-0000-4000-8000-0000000000c1'::uuid, 'Quote sent'),
  ('51000000-0000-4000-8000-0000000000c1'::uuid, 'Scheduled'),
  ('51000000-0000-4000-8000-0000000000c1'::uuid, 'Won'),
  ('51000000-0000-4000-8000-0000000000c1'::uuid, 'Lost');

insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164)
values
  ('51000000-0000-4000-8000-0000000000f1'::uuid,
   '51000000-0000-4000-8000-0000000000c1'::uuid, 'active', 'test', 'US',
   '+14155550199');

select public.seed_pipeline(
  '51000000-0000-4000-8000-0000000000c1'::uuid,
  '51000000-0000-4000-8000-00000000000a'::uuid);

create temporary table pipeline_fixture as
  select '51000000-0000-4000-8000-0000000000c1'::uuid as company_id;

-- ===========================================================================
-- PS-1. Creation seeds all four stages, and the ready-made view.
-- ===========================================================================
do $$
declare
  v_company uuid := (select company_id from pipeline_fixture);
  v_stages  integer;
  v_views   integer;
begin
  select count(*) into v_stages from public.tags
   where company_id = v_company and pipeline_stage is not null;
  if v_stages is distinct from 4 then
    raise exception 'PS-1: expected 4 seeded stages, found %', v_stages;
  end if;

  -- #354 orders the saved view first: it delivers the marketed Monday-morning
  -- ritual with no loss of flexibility and no new constraints.
  select count(*) into v_views from public.saved_views
   where company_id = v_company and owner_user_id is null
     and surface = 'conversations';
  if v_views is distinct from 1 then
    raise exception 'PS-1: expected the shipped Quote sent view, found %', v_views;
  end if;
end $$;

-- ===========================================================================
-- PS-2. THE CLAIM: renaming a stage breaks nothing.
--
-- The saved view stores a tag id and the report keys on the stage, so neither
-- ever looked at the name. This is what lets #354 harden the workflow without
-- turning a lightweight convention into rigid configuration.
-- ===========================================================================
do $$
declare
  v_company uuid := (select company_id from pipeline_fixture);
  v_tag     uuid;
  v_filters jsonb;
begin
  select id into v_tag from public.tags
   where company_id = v_company and pipeline_stage = 'quote_sent';

  update public.tags set name = 'Estimate out' where id = v_tag;

  -- The view still points at the same tag.
  select filters into v_filters from public.saved_views
   where company_id = v_company and owner_user_id is null limit 1;
  if (v_filters->>'tag_id') is distinct from v_tag::text then
    raise exception 'PS-2: the shipped view lost its tag on a rename';
  end if;

  -- And the stage key is untouched.
  if (select pipeline_stage from public.tags where id = v_tag) is distinct from 'quote_sent' then
    raise exception 'PS-2: a rename changed the stage';
  end if;
end $$;

-- ===========================================================================
-- PS-3. One stage per company. Two "won" tags would double every count.
-- ===========================================================================
do $$
declare
  v_company uuid := (select company_id from pipeline_fixture);
begin
  begin
    insert into public.tags (company_id, name, pipeline_stage)
    values (v_company, 'Won again', 'won');
    raise exception 'PS-3: a second won stage was allowed';
  exception when unique_violation then
    null; -- expected
  end;
end $$;

-- ===========================================================================
-- PS-4. The report counts CONVERSATIONS, not tag events, and buckets by the
-- QUOTE's date.
-- ===========================================================================
do $$
declare
  v_company uuid := (select company_id from pipeline_fixture);
  v_quote   uuid;
  v_won     uuid;
  v_lost    uuid;
  -- Three contacts, because only one conversation per (number, contact) may be
  -- open at a time — the schema's own rule, not a quirk of this fixture.
  v_c1      uuid := '51000000-0000-4000-8000-0000000000d1'::uuid;
  v_c2      uuid := '51000000-0000-4000-8000-0000000000d2'::uuid;
  v_c3      uuid := '51000000-0000-4000-8000-0000000000d3'::uuid;
  v_conv_a  uuid := '51000000-0000-4000-8000-0000000000e1'::uuid;
  v_conv_b  uuid := '51000000-0000-4000-8000-0000000000e2'::uuid;
  v_conv_c  uuid := '51000000-0000-4000-8000-0000000000e3'::uuid;
  v_number  uuid := '51000000-0000-4000-8000-0000000000f1'::uuid;
  v_report  jsonb;
begin
  select id into v_quote from public.tags
   where company_id = v_company and pipeline_stage = 'quote_sent';
  select id into v_won from public.tags
   where company_id = v_company and pipeline_stage = 'won';
  select id into v_lost from public.tags
   where company_id = v_company and pipeline_stage = 'lost';

  insert into public.contacts (id, company_id, phone_e164) values
    (v_c1, v_company, '+14155550101'),
    (v_c2, v_company, '+14155550102'),
    (v_c3, v_company, '+14155550103');
  insert into public.conversations (id, company_id, contact_id, phone_number_id)
  values (v_conv_a, v_company, v_c1, v_number),
         (v_conv_b, v_company, v_c2, v_number),
         (v_conv_c, v_company, v_c3, v_number);

  -- A: quoted 10 days ago, won 4 days ago.
  insert into public.conversation_tags (conversation_id, tag_id, created_at)
  values (v_conv_a, v_quote, now() - interval '10 days'),
         (v_conv_a, v_won,   now() - interval '4 days');
  -- B: quoted 9 days ago, lost.
  insert into public.conversation_tags (conversation_id, tag_id, created_at)
  values (v_conv_b, v_quote, now() - interval '9 days'),
         (v_conv_b, v_lost,  now() - interval '2 days');
  -- C: quoted 8 days ago, still out.
  insert into public.conversation_tags (conversation_id, tag_id, created_at)
  values (v_conv_c, v_quote, now() - interval '8 days');

  v_report := public.api_pipeline_report(
    v_company, now() - interval '30 days', now());

  if (v_report->>'quoted')::int is distinct from 3 then
    raise exception 'PS-4: quoted was %, expected 3', v_report->>'quoted';
  end if;
  if (v_report->>'won')::int is distinct from 1 then
    raise exception 'PS-4: won was %, expected 1', v_report->>'won';
  end if;
  if (v_report->>'lost')::int is distinct from 1 then
    raise exception 'PS-4: lost was %, expected 1', v_report->>'lost';
  end if;
  if (v_report->>'open')::int is distinct from 1 then
    raise exception 'PS-4: open was %, expected 1', v_report->>'open';
  end if;
  -- 10 days quoted to 4 days won = 6 days, and it is the only win.
  if round((v_report->>'median_days_to_win')::numeric) is distinct from 6 then
    raise exception 'PS-4: median days to win was %',
      v_report->>'median_days_to_win';
  end if;
end $$;

-- ===========================================================================
-- PS-5. A window that predates the quotes reports nothing, rather than
-- reporting them under the wrong month.
--
-- The report buckets on the QUOTE's date. An owner asking how March's quotes
-- did means the ones they sent in March; bucketing by the win date would credit
-- a March quote to whichever month it finally closed.
-- ===========================================================================
do $$
declare
  v_company uuid := (select company_id from pipeline_fixture);
  v_report  jsonb;
begin
  v_report := public.api_pipeline_report(
    v_company, now() - interval '60 days', now() - interval '30 days');
  if (v_report->>'quoted')::int is distinct from 0 then
    raise exception 'PS-5: an earlier window claimed % quotes', v_report->>'quoted';
  end if;
end $$;

-- ===========================================================================
-- PS-6. Re-tagging does not inflate anything.
--
-- Counting tag ROWS instead of conversations would let a crew tidying up their
-- labels double their win rate, which is the sort of number that gets repeated
-- to other contractors before anybody checks it.
-- ===========================================================================
do $$
declare
  v_company uuid := (select company_id from pipeline_fixture);
  v_won     uuid;
  v_conv_a  uuid := '51000000-0000-4000-8000-0000000000e1'::uuid;
  v_report  jsonb;
begin
  select id into v_won from public.tags
   where company_id = v_company and pipeline_stage = 'won';

  -- Untag and re-tag, as somebody correcting a mistake would.
  delete from public.conversation_tags
   where conversation_id = v_conv_a and tag_id = v_won;
  insert into public.conversation_tags (conversation_id, tag_id, created_at)
  values (v_conv_a, v_won, now() - interval '1 day');

  v_report := public.api_pipeline_report(
    v_company, now() - interval '30 days', now());
  if (v_report->>'won')::int is distinct from 1 then
    raise exception 'PS-6: re-tagging turned 1 win into %', v_report->>'won';
  end if;
end $$;

-- ===========================================================================
-- PS-7. A workspace with no pipeline tags reports zeroes, not an error.
-- ===========================================================================
do $$
declare
  v_report jsonb;
begin
  v_report := public.api_pipeline_report(
    '51000000-0000-4000-8000-0000000000ff'::uuid,
    now() - interval '30 days', now());
  if (v_report->>'quoted')::int is distinct from 0 then
    raise exception 'PS-7: an unknown company reported % quotes',
      v_report->>'quoted';
  end if;
end $$;

-- ===========================================================================
-- PS-8. #287 — a SENT quote counts as quoted, and an accepted one as won,
-- with no pipeline tag anywhere near it.
--
-- The report was built on tags alone. The product now has a real quote object,
-- so a crew that sends prices through the product and never touches a tag was
-- invisible to the only business metric this product shows an owner.
-- ===========================================================================
do $$
declare
  v_company uuid := (select company_id from pipeline_fixture);
  v_contact uuid;
  v_conv    uuid;
  v_report  jsonb;
begin
  insert into public.contacts (company_id, phone_e164)
  values (v_company, '+14155550301')
  returning id into v_contact;

  insert into public.conversations
    (company_id, contact_id, phone_number_id, status)
  values (v_company, v_contact,
          '51000000-0000-4000-8000-0000000000f1'::uuid, 'open')
  returning id into v_conv;

  insert into public.quotes
    (company_id, conversation_id, contact_id, amount_cents, currency,
     description, status, expires_at, sent_at, decided_at)
  values (v_company, v_conv, v_contact, 45000, 'usd', 'New heater',
          'accepted', now() + interval '7 days',
          now() - interval '5 days', now() - interval '1 day');

  v_report := public.api_pipeline_report(
    v_company, now() - interval '30 days', now());

  if (v_report->>'quoted')::int < 1 then
    raise exception 'PS-8: a sent quote did not count as quoted (%)',
      v_report->>'quoted';
  end if;
  if (v_report->>'won')::int < 1 then
    raise exception 'PS-8: an accepted quote did not count as won (%)',
      v_report->>'won';
  end if;

  raise notice 'PS-8 PASSED: a quote counts without a tag';
end $$;

-- ===========================================================================
-- PS-9. #287 — a job that was BOTH tagged and formally quoted is ONE job.
--
-- The whole risk of adding a second signal: double counting turns a 50% win
-- rate into a 50% win rate over twice the jobs, which reads as a busier
-- business than exists and is the kind of number an owner repeats to somebody.
-- ===========================================================================
do $$
declare
  v_company uuid := (select company_id from pipeline_fixture);
  v_contact uuid;
  v_conv    uuid;
  v_qtag    uuid;
  v_won     uuid;
  v_before  int;
  v_after   int;
  v_report  jsonb;
begin
  select id into v_qtag from public.tags
   where company_id = v_company and pipeline_stage = 'quote_sent' limit 1;
  select id into v_won from public.tags
   where company_id = v_company and pipeline_stage = 'won' limit 1;

  v_report := public.api_pipeline_report(
    v_company, now() - interval '30 days', now());
  v_before := (v_report->>'quoted')::int;

  insert into public.contacts (company_id, phone_e164)
  values (v_company, '+14155550302')
  returning id into v_contact;

  insert into public.conversations
    (company_id, contact_id, phone_number_id, status)
  values (v_company, v_contact,
          '51000000-0000-4000-8000-0000000000f1'::uuid, 'open')
  returning id into v_conv;

  -- Tagged on Monday, formally quoted on Thursday. Both signals, one job.
  insert into public.conversation_tags (conversation_id, tag_id, created_at)
  values (v_conv, v_qtag, now() - interval '8 days'),
         (v_conv, v_won,  now() - interval '2 days');

  insert into public.quotes
    (company_id, conversation_id, contact_id, amount_cents, currency,
     description, status, expires_at, sent_at, decided_at)
  values (v_company, v_conv, v_contact, 22000, 'usd', 'Same job',
          'accepted', now() + interval '7 days',
          now() - interval '5 days', now() - interval '2 days');

  v_report := public.api_pipeline_report(
    v_company, now() - interval '30 days', now());
  v_after := (v_report->>'quoted')::int;

  if v_after is distinct from v_before + 1 then
    raise exception
      'PS-9: one job counted % times (% -> %)', v_after - v_before,
      v_before, v_after;
  end if;

  raise notice 'PS-9 PASSED: tagged and quoted is one job, not two';
end $$;

-- ===========================================================================
-- PS-10. #287 — a DRAFT quote is not a quote anybody was asked to answer.
--
-- Counting it would put unsent prices in the denominator of a win rate, which
-- makes a crew that drafts carefully look worse than one that does not.
-- ===========================================================================
do $$
declare
  v_company uuid := (select company_id from pipeline_fixture);
  v_contact uuid;
  v_conv    uuid;
  v_before  int;
  v_report  jsonb;
begin
  v_report := public.api_pipeline_report(
    v_company, now() - interval '30 days', now());
  v_before := (v_report->>'quoted')::int;

  insert into public.contacts (company_id, phone_e164)
  values (v_company, '+14155550303')
  returning id into v_contact;

  insert into public.conversations
    (company_id, contact_id, phone_number_id, status)
  values (v_company, v_contact,
          '51000000-0000-4000-8000-0000000000f1'::uuid, 'open')
  returning id into v_conv;

  insert into public.quotes
    (company_id, conversation_id, contact_id, amount_cents, currency,
     description, status, expires_at)
  values (v_company, v_conv, v_contact, 99000, 'usd', 'Never sent',
          'draft', now() + interval '7 days');

  v_report := public.api_pipeline_report(
    v_company, now() - interval '30 days', now());

  if (v_report->>'quoted')::int is distinct from v_before then
    raise exception 'PS-10: a draft was counted as quoted (% -> %)',
      v_before, v_report->>'quoted';
  end if;

  raise notice 'PS-10 PASSED: a draft is not an offer';
end $$;

rollback;