-- [#303] Behavioural AUP signals — assertion suite for
-- supabase/migrations/20260802140000_aup_signals.sql.
--
-- The assertions are about the two ways this feature goes wrong, both named in
-- the issue's own devil's advocate:
--
--   1. It reports a busy crew. A roofer after a storm sends far more than
--      usual, to people who ALREADY called them. Judged against their own
--      baseline and their own contact history, that is not a marketing blast —
--      and a detector that cannot tell the difference gets muted in a week.
--   2. It reads content. Nothing here can: every value is a count or a ratio,
--      and the suite asserts on the numbers rather than on any body.
--
-- One transaction, rolled back. Fixtures use a 'ca' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('ca000000-0000-4000-8000-00000000000a'::uuid, 'aup-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('ca000000-0000-4000-8000-0000000000c1'::uuid, 'Blaster Co',
   'ca000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now()),
  ('ca000000-0000-4000-8000-0000000000c2'::uuid, 'Storm Week Roofing',
   'ca000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.phone_numbers
  (id, company_id, number_e164, status, provisioning_key, country)
values
  ('ca000000-0000-4000-8000-0000000000b1'::uuid,
   'ca000000-0000-4000-8000-0000000000c1'::uuid, '+14155550201', 'active',
   'aup-1', 'US'),
  ('ca000000-0000-4000-8000-0000000000b2'::uuid,
   'ca000000-0000-4000-8000-0000000000c2'::uuid, '+14155550202', 'active',
   'aup-2', 'US');

-- 40 contacts each. The blaster texts all of them today for the first time;
-- the roofer texted all of theirs a month ago and is texting them again.
do $$
declare
  i int;
begin
  for i in 1..40 loop
    insert into public.contacts (id, company_id, phone_e164)
    values
      (('ca000000-0000-4000-8000-0000d' || lpad(i::text, 7, '0'))::uuid,
       'ca000000-0000-4000-8000-0000000000c1'::uuid,
       '+1415666' || lpad(i::text, 4, '0')),
      (('ca000000-0000-4000-8000-0000e' || lpad(i::text, 7, '0'))::uuid,
       'ca000000-0000-4000-8000-0000000000c2'::uuid,
       '+1415777' || lpad(i::text, 4, '0'));

    insert into public.conversations (id, company_id, contact_id, phone_number_id)
    values
      (('ca000000-0000-4000-8000-0000a' || lpad(i::text, 7, '0'))::uuid,
       'ca000000-0000-4000-8000-0000000000c1'::uuid,
       ('ca000000-0000-4000-8000-0000d' || lpad(i::text, 7, '0'))::uuid,
       'ca000000-0000-4000-8000-0000000000b1'::uuid),
      (('ca000000-0000-4000-8000-0000b' || lpad(i::text, 7, '0'))::uuid,
       'ca000000-0000-4000-8000-0000000000c2'::uuid,
       ('ca000000-0000-4000-8000-0000e' || lpad(i::text, 7, '0'))::uuid,
       'ca000000-0000-4000-8000-0000000000b2'::uuid);

    -- Today: both send 4 each, so both are "busy" by raw volume.
    insert into public.messages
      (company_id, conversation_id, direction, status, body, created_at,
       sent_by_user_id)
    select
      'ca000000-0000-4000-8000-0000000000c1'::uuid,
      ('ca000000-0000-4000-8000-0000a' || lpad(i::text, 7, '0'))::uuid,
      'outbound', 'delivered', 'blast', now() - interval '2 hours',
      'ca000000-0000-4000-8000-00000000000a'::uuid
    from generate_series(1, 4);

    insert into public.messages
      (company_id, conversation_id, direction, status, body, created_at,
       sent_by_user_id)
    select
      'ca000000-0000-4000-8000-0000000000c2'::uuid,
      ('ca000000-0000-4000-8000-0000b' || lpad(i::text, 7, '0'))::uuid,
      'outbound', 'delivered', 'on our way', now() - interval '2 hours',
      'ca000000-0000-4000-8000-00000000000a'::uuid
    from generate_series(1, 4);

    -- The ROOFER already knew these people, and texted them INSIDE the
    -- baseline window. Both facts matter and they are different windows on
    -- purpose: `known` asks "have we ever texted them" over all history, while
    -- `baseline` asks "what does an ordinary day look like lately". A contact
    -- from two years ago still makes today's message a relationship; a send
    -- from two years ago says nothing about this week's normal.
    insert into public.messages
      (company_id, conversation_id, direction, status, body, created_at,
       sent_by_user_id)
    values
      ('ca000000-0000-4000-8000-0000000000c2'::uuid,
       ('ca000000-0000-4000-8000-0000b' || lpad(i::text, 7, '0'))::uuid,
       'outbound', 'delivered', 'quote attached', now() - interval '5 days',
       'ca000000-0000-4000-8000-00000000000a'::uuid);
  end loop;
end $$;

do $$
declare
  v_blaster record;
  v_roofer record;
begin
  select * into v_blaster from public.api_aup_signals(14)
   where company_id = 'ca000000-0000-4000-8000-0000000000c1'::uuid;
  select * into v_roofer from public.api_aup_signals(14)
   where company_id = 'ca000000-0000-4000-8000-0000000000c2'::uuid;

  -- Both sent the same volume today. Raw volume cannot tell them apart, which
  -- is exactly why it is not the signal.
  if v_blaster.sent_24h <> 160 or v_roofer.sent_24h <> 160 then
    raise exception 'both should have sent 160: blaster=% roofer=%',
      v_blaster.sent_24h, v_roofer.sent_24h;
  end if;

  -- THE DISCRIMINATOR. The blaster reached 40 strangers; the roofer reached 40
  -- people it had already texted. Same traffic, opposite meaning.
  if v_blaster.fresh_ratio < 0.99 then
    raise exception 'a blast to never-contacted numbers must read ~1.0, got %',
      v_blaster.fresh_ratio;
  end if;
  if v_roofer.fresh_ratio > 0.01 then
    raise exception
      'a busy week texting known customers must read ~0, got %', v_roofer.fresh_ratio;
  end if;

  -- The roofer has a real history, so it has a baseline to be judged against.
  -- The blaster has none, which is itself the tell — and precisely why the job
  -- requires the velocity arm AND the stranger arm before reporting anything.
  if v_roofer.baseline_daily <= 0 then
    raise exception 'a workspace with prior sends must have a baseline, got %',
      v_roofer.baseline_daily;
  end if;

  raise notice 'aup signals: all assertions passed';
end $$;

-- A workspace that sent nothing today is not in the result at all: there is no
-- shape to judge, and reporting a zero row would put every dormant workspace in
-- front of a human every day.
do $$
begin
  if exists (
    select 1 from public.api_aup_signals(14)
     where sent_24h = 0
  ) then
    raise exception 'a workspace with no sends today must not be reported';
  end if;
  raise notice 'aup signals: quiet workspaces stay out of the report';
end $$;

rollback;
