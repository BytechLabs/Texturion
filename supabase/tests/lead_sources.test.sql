-- [#301] Lead sources — assertion suite for
-- supabase/migrations/20260804420000_lead_sources.sql.
--
-- LS-2 is the one that decides whether this feature is worth having. #301's
-- devil's-advocate section is blunt: asking the tech to categorise every
-- inbound is a tax on the person with the least time, and a source field
-- that is empty 80% of the time produces a MISLEADING report rather than no
-- report. Per-number attribution is the half that costs the crew nothing, and
-- it only works if the stamp is impossible to forget — hence a trigger rather
-- than a line copied into the eight functions that insert conversations.
--
-- LS-4 is the second: the stamp is a SNAPSHOT. A number retired from the yard
-- sign and reused for a Google ad must never retroactively relabel last year's
-- customers, because "where this customer came from" is a fact about first
-- contact and not about what the line means today.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/lead_sources.test.sql
--
-- One transaction, rolled back. Fixtures use a '7c' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('7c000000-0000-4000-8000-00000000000a'::uuid, 'lead-a@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('7c000000-0000-4000-8000-0000000000c1'::uuid, 'Reed Roofing',
   '7c000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

-- Two lines: one on the truck, one untracked.
insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status)
values
  ('7c000000-0000-4000-8000-0000000000b1'::uuid,
   '7c000000-0000-4000-8000-0000000000c1'::uuid, 'pk-7c-1', 'US',
   '+14155550501', 'active'),
  ('7c000000-0000-4000-8000-0000000000b2'::uuid,
   '7c000000-0000-4000-8000-0000000000c1'::uuid, 'pk-7c-2', 'US',
   '+14155550502', 'active');

insert into public.contacts (id, company_id, phone_e164)
values
  ('7c000000-0000-4000-8000-0000000000d1'::uuid,
   '7c000000-0000-4000-8000-0000000000c1'::uuid, '+14155559001'),
  ('7c000000-0000-4000-8000-0000000000d2'::uuid,
   '7c000000-0000-4000-8000-0000000000c1'::uuid, '+14155559002'),
  ('7c000000-0000-4000-8000-0000000000d3'::uuid,
   '7c000000-0000-4000-8000-0000000000c1'::uuid, '+14155559003');

insert into public.lead_sources (id, company_id, name, created_by)
values
  ('7c000000-0000-4000-8000-0000000000e1'::uuid,
   '7c000000-0000-4000-8000-0000000000c1'::uuid, 'Truck',
   '7c000000-0000-4000-8000-00000000000a'::uuid),
  ('7c000000-0000-4000-8000-0000000000e2'::uuid,
   '7c000000-0000-4000-8000-0000000000c1'::uuid, 'Neighbour',
   '7c000000-0000-4000-8000-00000000000a'::uuid);

update public.phone_numbers set lead_source_id = '7c000000-0000-4000-8000-0000000000e1'::uuid
  where id = '7c000000-0000-4000-8000-0000000000b1'::uuid;

-- ---------------------------------------------------------------------------
-- LS-1: an untracked line attributes nothing, and says nothing.
-- ---------------------------------------------------------------------------
do $$
declare
  v_source uuid;
  v_origin text;
begin
  insert into public.conversations (company_id, contact_id, phone_number_id)
  values ('7c000000-0000-4000-8000-0000000000c1'::uuid,
          '7c000000-0000-4000-8000-0000000000d1'::uuid,
          '7c000000-0000-4000-8000-0000000000b2'::uuid);

  select lead_source_id, lead_source_origin into v_source, v_origin
    from public.conversations
   where contact_id = '7c000000-0000-4000-8000-0000000000d1'::uuid;

  -- Unknown, and honestly so. #301: never present an inferred source as a
  -- fact — and "this line has no source set" infers nothing at all.
  if v_source is not null or v_origin is not null then
    raise exception 'LS-1: an untracked line invented a source (%, %)', v_source, v_origin;
  end if;
  raise notice 'LS-1 PASSED: an untracked line attributes nothing';
end $$;

-- ---------------------------------------------------------------------------
-- LS-2: a tracked line attributes with nobody doing anything.
-- ---------------------------------------------------------------------------
do $$
declare
  v_source uuid;
  v_origin text;
begin
  insert into public.conversations (company_id, contact_id, phone_number_id)
  values ('7c000000-0000-4000-8000-0000000000c1'::uuid,
          '7c000000-0000-4000-8000-0000000000d2'::uuid,
          '7c000000-0000-4000-8000-0000000000b1'::uuid);

  select lead_source_id, lead_source_origin into v_source, v_origin
    from public.conversations
   where contact_id = '7c000000-0000-4000-8000-0000000000d2'::uuid;

  -- THE ONE THAT MATTERS. Note what the INSERT above did NOT mention: the
  -- lead source. Eight functions in this schema create conversations and none
  -- of them knows this feature exists.
  if v_source is distinct from '7c000000-0000-4000-8000-0000000000e1'::uuid then
    raise exception 'LS-2: the truck line did not attribute, got %', v_source;
  end if;
  if v_origin is distinct from 'number' then
    raise exception 'LS-2: attribution by line must read as ''number'', got %', v_origin;
  end if;
  raise notice 'LS-2 PASSED: a tracked line attributes with nobody doing anything';
end $$;

-- ---------------------------------------------------------------------------
-- LS-3: a person's answer wins, and reads as a person's answer.
-- ---------------------------------------------------------------------------
do $$
declare
  v_source uuid;
  v_origin text;
begin
  insert into public.conversations
    (company_id, contact_id, phone_number_id, lead_source_id, lead_source_set_by)
  values ('7c000000-0000-4000-8000-0000000000c1'::uuid,
          '7c000000-0000-4000-8000-0000000000d3'::uuid,
          '7c000000-0000-4000-8000-0000000000b1'::uuid,
          '7c000000-0000-4000-8000-0000000000e2'::uuid,
          '7c000000-0000-4000-8000-00000000000a'::uuid);

  select lead_source_id, lead_source_origin into v_source, v_origin
    from public.conversations
   where contact_id = '7c000000-0000-4000-8000-0000000000d3'::uuid;

  -- The customer rang the truck number but told the tech a neighbour sent
  -- them. The human knows something the line does not.
  if v_source is distinct from '7c000000-0000-4000-8000-0000000000e2'::uuid then
    raise exception 'LS-3: the line overrode a person, got %', v_source;
  end if;
  if v_origin is distinct from 'manual' then
    raise exception 'LS-3: a person''s answer must read as ''manual'', got %', v_origin;
  end if;
  raise notice 'LS-3 PASSED: a person''s answer wins, and reads as one';
end $$;

-- ---------------------------------------------------------------------------
-- LS-4: retiring a tracked number never rewrites history.
-- ---------------------------------------------------------------------------
do $$
declare
  v_source uuid;
begin
  -- The truck number is repurposed for a Google campaign.
  insert into public.lead_sources (id, company_id, name)
  values ('7c000000-0000-4000-8000-0000000000e3'::uuid,
          '7c000000-0000-4000-8000-0000000000c1'::uuid, 'Google');
  update public.phone_numbers set lead_source_id = '7c000000-0000-4000-8000-0000000000e3'::uuid
    where id = '7c000000-0000-4000-8000-0000000000b1'::uuid;

  select lead_source_id into v_source from public.conversations
   where contact_id = '7c000000-0000-4000-8000-0000000000d2'::uuid;

  -- Last year's customer still came from the truck. A stamp that followed the
  -- column would make every historical report a function of today's config.
  if v_source is distinct from '7c000000-0000-4000-8000-0000000000e1'::uuid then
    raise exception 'LS-4: retiring a number rewrote history, got %', v_source;
  end if;
  raise notice 'LS-4 PASSED: retiring a tracked number never rewrites history';
end $$;

-- ---------------------------------------------------------------------------
-- LS-5: a source in use cannot be deleted out from under its history.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ok boolean;
begin
  -- THE OPPOSITE OF EVERY OTHER OPTIONAL FK HERE, on purpose. `set null`
  -- would let deleting one row erase where four hundred customers came from,
  -- silently and irreversibly.
  begin
    delete from public.lead_sources
      where id = '7c000000-0000-4000-8000-0000000000e1'::uuid;
    v_ok := false;
  exception when foreign_key_violation then
    v_ok := true;
  end;
  if v_ok is distinct from true then
    raise exception 'LS-5: deleting a source erased the history that used it';
  end if;

  -- The supported way out is archiving: gone from the picker, kept in the
  -- record.
  update public.lead_sources set archived_at = now()
    where id = '7c000000-0000-4000-8000-0000000000e1'::uuid;
  raise notice 'LS-5 PASSED: a source in use is archived, never deleted';
end $$;

-- ---------------------------------------------------------------------------
-- LS-6: a source and its story are never apart.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ok boolean;
begin
  -- A source with no origin is the "inferred source presented as a fact" the
  -- issue forbids; an origin with no source is a story about nothing.
  begin
    update public.conversations set lead_source_origin = null
      where contact_id = '7c000000-0000-4000-8000-0000000000d2'::uuid;
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  if v_ok is distinct from true then
    raise exception 'LS-6: a source was allowed to exist with no origin';
  end if;

  begin
    update public.conversations set lead_source_origin = 'number'
      where contact_id = '7c000000-0000-4000-8000-0000000000d1'::uuid;
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  if v_ok is distinct from true then
    raise exception 'LS-6: an origin was allowed with no source';
  end if;

  -- And a value the report has no column for is refused outright.
  begin
    update public.conversations set lead_source_origin = 'vibes'
      where contact_id = '7c000000-0000-4000-8000-0000000000d2'::uuid;
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  if v_ok is distinct from true then
    raise exception 'LS-6: an unknown origin was accepted';
  end if;
  raise notice 'LS-6 PASSED: a source and its story are never apart';
end $$;

-- ---------------------------------------------------------------------------
-- LS-7: two sources with the same name in one workspace is a support ticket.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ok boolean;
begin
  begin
    insert into public.lead_sources (company_id, name)
    values ('7c000000-0000-4000-8000-0000000000c1'::uuid, 'Neighbour');
    v_ok := false;
  exception when unique_violation then
    v_ok := true;
  end;
  if v_ok is distinct from true then
    raise exception 'LS-7: a duplicate source name was accepted';
  end if;

  -- Length is a picker chip, not a campaign name.
  begin
    insert into public.lead_sources (company_id, name)
    values ('7c000000-0000-4000-8000-0000000000c1'::uuid, repeat('x', 41));
    v_ok := false;
  exception when check_violation then
    v_ok := true;
  end;
  if v_ok is distinct from true then
    raise exception 'LS-7: a 41-character source name was accepted';
  end if;
  raise notice 'LS-7 PASSED: one name per workspace, and it fits in a chip';
end $$;

-- ---------------------------------------------------------------------------
-- LS-8: the report counts the unknowns, because they decide what it means.
-- ---------------------------------------------------------------------------
do $$
declare
  v_unknown bigint;
  v_truck   bigint;
  v_manual  bigint;
  v_rows    integer;
begin
  select count(*) into v_rows from public.api_lead_source_report(
    '7c000000-0000-4000-8000-0000000000c1'::uuid,
    now() - interval '1 day', now() + interval '1 day');
  if v_rows = 0 then
    raise exception 'LS-8: the report returned nothing for a workspace with conversations';
  end if;

  -- The untracked line's conversation groups under a NULL id. A
  -- `where lead_source_id is not null` here would make every percentage
  -- downstream a percentage of the wrong denominator, and the table would look
  -- complete.
  -- `total`, NOT by_number + by_person: an unattributed conversation has no
  -- origin, so both sub-counts skip it and the sum is zero. That is exactly
  -- the omission this test exists to catch, and it caught it.
  select total into v_unknown
    from public.api_lead_source_report(
      '7c000000-0000-4000-8000-0000000000c1'::uuid,
      now() - interval '1 day', now() + interval '1 day')
   where lead_source_id is null;
  if coalesce(v_unknown, 0) is distinct from 1 then
    raise exception 'LS-8: expected 1 unattributed conversation, got %', v_unknown;
  end if;

  -- And the two kinds of belief are counted apart: a line ringing is a fact
  -- about our own infrastructure, a tech tapping a chip is a report of what a
  -- customer said.
  select by_number, by_person into v_truck, v_manual
    from public.api_lead_source_report(
      '7c000000-0000-4000-8000-0000000000c1'::uuid,
      now() - interval '1 day', now() + interval '1 day')
   where lead_source_id = '7c000000-0000-4000-8000-0000000000e1'::uuid;
  if coalesce(v_truck, 0) is distinct from 1 or coalesce(v_manual, 0) is distinct from 0 then
    raise exception 'LS-8: truck should be 1 by number / 0 by person, got % / %',
      v_truck, v_manual;
  end if;
  raise notice 'LS-8 PASSED: the report counts the unknowns';
end $$;

-- LS-9 (#232): a conversation that started at the customer's own website is
-- credited to the website — not left among the ones we could not place, and
-- not double-counted against the line it happened to land on.
--
-- Three cases, because the rule has three edges and each one is a different
-- wrong answer if it drifts.
do $$
declare
  v_widget    bigint;
  v_unknown   bigint;
  v_number    bigint;
  v_total     bigint;
  v_person    bigint;
begin
  -- (1) THE COMMON CASE: a widget visitor did not ring an advertised number,
  -- so nothing puts a source on the conversation and it groups under the NULL
  -- id — right beside the ones we genuinely cannot explain. Without by_widget
  -- a workspace whose website produced most of its work would read "most of
  -- your conversations, we don't know where they came from".
  --
  -- d2 on the untracked line b2: a pair no earlier case used, because
  -- `conversations_open_uq` allows one open thread per (workspace, number,
  -- contact) and reusing one fails on the constraint rather than the report.
  insert into public.conversations (company_id, contact_id, phone_number_id, first_source)
  values ('7c000000-0000-4000-8000-0000000000c1'::uuid,
          '7c000000-0000-4000-8000-0000000000d2'::uuid,
          '7c000000-0000-4000-8000-0000000000b2'::uuid,
          'widget');

  select by_widget, total into v_widget, v_unknown
    from public.api_lead_source_report(
      '7c000000-0000-4000-8000-0000000000c1'::uuid,
      now() - interval '1 day', now() + interval '1 day')
   where lead_source_id is null;

  if coalesce(v_widget, 0) is distinct from 1 then
    raise exception 'LS-9: expected 1 widget conversation in the NULL group, got %', v_widget;
  end if;
  -- And it LEFT the unknown bucket rather than sitting in both. The group's
  -- total is still the one conversation LS-8 counted; the website's is
  -- reported beside it. Buckets that overlap make a card whose rows add up
  -- past its own footer.
  if coalesce(v_unknown, 0) is distinct from 1 then
    raise exception 'LS-9: the unknown bucket should still be 1, got %', v_unknown;
  end if;

  -- (2) A widget conversation landing on a line that carries a source. That
  -- source is an inference from which line rang; "started at the widget" is a
  -- fact, and the fact wins. b1 points at e3 by now — LS-4 repointed it — so
  -- the trigger stamps e3 and the report must still credit the website.
  insert into public.conversations (company_id, contact_id, phone_number_id, first_source)
  values ('7c000000-0000-4000-8000-0000000000c1'::uuid,
          '7c000000-0000-4000-8000-0000000000d1'::uuid,
          '7c000000-0000-4000-8000-0000000000b1'::uuid,
          'widget');

  select by_widget, by_number, total into v_widget, v_number, v_total
    from public.api_lead_source_report(
      '7c000000-0000-4000-8000-0000000000c1'::uuid,
      now() - interval '1 day', now() + interval '1 day')
   where lead_source_id = '7c000000-0000-4000-8000-0000000000e3'::uuid;

  if coalesce(v_widget, 0) is distinct from 1 then
    raise exception 'LS-9: a widget conversation on a sourced line should count as widget, got %',
      v_widget;
  end if;
  -- Taken OUT of that source's own counts rather than added alongside them.
  -- e3 has no other conversations, so it reports zero of both — a group that
  -- was ENTIRELY website. The Worker must read by_widget before it discards
  -- empty groups, or the one case where the website did all the work is the
  -- one case the card shows nothing for.
  if coalesce(v_number, 0) is distinct from 0 or coalesce(v_total, 0) is distinct from 0 then
    raise exception 'LS-9: the website conversation was double-counted (% by number, % total)',
      v_number, v_total;
  end if;
  -- And the truck group LS-8 measured is untouched by any of this.
  select by_number, total into v_number, v_total
    from public.api_lead_source_report(
      '7c000000-0000-4000-8000-0000000000c1'::uuid,
      now() - interval '1 day', now() + interval '1 day')
   where lead_source_id = '7c000000-0000-4000-8000-0000000000e1'::uuid;
  if coalesce(v_number, 0) is distinct from 1 or coalesce(v_total, 0) is distinct from 1 then
    raise exception 'LS-9: the truck group moved (% by number, % total)', v_number, v_total;
  end if;

  -- (3) EXCEPT AGAINST A PERSON. `manual` means somebody looked at the thread
  -- and said where this customer came from. A visitor can perfectly well find
  -- the website because a neighbour recommended the company, and overriding
  -- that with "Website" would erase a human's explicit answer in favour of our
  -- own inference — the move #301 forbids, run backwards.
  insert into public.conversations
    (company_id, contact_id, phone_number_id, lead_source_id, lead_source_set_by, first_source)
  values ('7c000000-0000-4000-8000-0000000000c1'::uuid,
          '7c000000-0000-4000-8000-0000000000d3'::uuid,
          '7c000000-0000-4000-8000-0000000000b2'::uuid,
          '7c000000-0000-4000-8000-0000000000e2'::uuid,
          '7c000000-0000-4000-8000-00000000000a'::uuid,
          'widget');

  select by_widget, by_person into v_widget, v_person
    from public.api_lead_source_report(
      '7c000000-0000-4000-8000-0000000000c1'::uuid,
      now() - interval '1 day', now() + interval '1 day')
   where lead_source_id = '7c000000-0000-4000-8000-0000000000e2'::uuid;

  if coalesce(v_widget, 0) is distinct from 0 then
    raise exception 'LS-9: the website overrode a person''s own answer, got % widget', v_widget;
  end if;
  if coalesce(v_person, 0) is distinct from 2 then
    raise exception 'LS-9: expected 2 person-tagged conversations, got %', v_person;
  end if;

  raise notice 'LS-9 PASSED: a website conversation is credited to the website, once';
end $$;

rollback;
