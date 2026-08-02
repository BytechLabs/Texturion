-- [#298] Tag merge and usage — assertion suite for
-- supabase/migrations/20260801150000_tag_governance.sql.
--
-- Merge exists because delete was the only cleanup and delete loses the
-- associations. So the thing to prove is that NOTHING is lost: every
-- conversation that carried either tag carries the survivor, including the ones
-- that carried both, which are the rows a naive UPDATE would crash on.
--
-- The pipeline half is D108's rule, and it is the one that costs real money if
-- wrong: dropping a stage on merge silently loses a workspace's win rate.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/tag_governance.test.sql
--
-- One transaction, rolled back. Fixtures use a '53' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('53000000-0000-4000-8000-00000000000a'::uuid, 'tags-a@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('53000000-0000-4000-8000-0000000000c1'::uuid, 'Tag Plumbing',
   '53000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164)
values
  ('53000000-0000-4000-8000-0000000000f1'::uuid,
   '53000000-0000-4000-8000-0000000000c1'::uuid, 'active', 'test', 'US',
   '+14155550300');

insert into public.contacts (id, company_id, phone_e164) values
  ('53000000-0000-4000-8000-0000000000d1'::uuid,
   '53000000-0000-4000-8000-0000000000c1'::uuid, '+14155550301'),
  ('53000000-0000-4000-8000-0000000000d2'::uuid,
   '53000000-0000-4000-8000-0000000000c1'::uuid, '+14155550302'),
  ('53000000-0000-4000-8000-0000000000d3'::uuid,
   '53000000-0000-4000-8000-0000000000c1'::uuid, '+14155550303');

insert into public.conversations (id, company_id, contact_id, phone_number_id) values
  ('53000000-0000-4000-8000-0000000000e1'::uuid,
   '53000000-0000-4000-8000-0000000000c1'::uuid,
   '53000000-0000-4000-8000-0000000000d1'::uuid,
   '53000000-0000-4000-8000-0000000000f1'::uuid),
  ('53000000-0000-4000-8000-0000000000e2'::uuid,
   '53000000-0000-4000-8000-0000000000c1'::uuid,
   '53000000-0000-4000-8000-0000000000d2'::uuid,
   '53000000-0000-4000-8000-0000000000f1'::uuid),
  ('53000000-0000-4000-8000-0000000000e3'::uuid,
   '53000000-0000-4000-8000-0000000000c1'::uuid,
   '53000000-0000-4000-8000-0000000000d3'::uuid,
   '53000000-0000-4000-8000-0000000000f1'::uuid);

-- "Warranty" and "warranty claim": the sprawl, as it actually happens.
insert into public.tags (id, company_id, name) values
  ('53000000-0000-4000-8000-0000000000a1'::uuid,
   '53000000-0000-4000-8000-0000000000c1'::uuid, 'Warranty'),
  ('53000000-0000-4000-8000-0000000000a2'::uuid,
   '53000000-0000-4000-8000-0000000000c1'::uuid, 'warranty claim');

insert into public.conversation_tags (conversation_id, tag_id, created_at) values
  -- e1 carries only the survivor.
  ('53000000-0000-4000-8000-0000000000e1'::uuid,
   '53000000-0000-4000-8000-0000000000a1'::uuid, now() - interval '10 days'),
  -- e2 carries only the loser.
  ('53000000-0000-4000-8000-0000000000e2'::uuid,
   '53000000-0000-4000-8000-0000000000a2'::uuid, now() - interval '5 days'),
  -- e3 carries BOTH: the row a naive UPDATE crashes on, and the loser's stamp
  -- is the EARLIER one.
  ('53000000-0000-4000-8000-0000000000e3'::uuid,
   '53000000-0000-4000-8000-0000000000a1'::uuid, now() - interval '2 days'),
  ('53000000-0000-4000-8000-0000000000e3'::uuid,
   '53000000-0000-4000-8000-0000000000a2'::uuid, now() - interval '9 days');

-- ===========================================================================
-- TG-1. Usage is visible: a count and a last-used date per tag.
-- ===========================================================================
do $$
declare r record;
begin
  select * into r from public.api_tag_usage('53000000-0000-4000-8000-0000000000c1'::uuid)
   where tag_id = '53000000-0000-4000-8000-0000000000a1'::uuid;
  if r.uses <> 2 then
    raise exception 'TG-1: Warranty used %, expected 2', r.uses;
  end if;
  if r.last_used is null then
    raise exception 'TG-1: a used tag reported no last-used date';
  end if;
end $$;

-- ===========================================================================
-- TG-2. THE MERGE. Nothing is lost, including the conversation on both.
-- ===========================================================================
do $$
declare
  v_result jsonb;
  v_left   integer;
  v_on_e3  integer;
  v_stamp  timestamptz;
begin
  v_result := public.api_merge_tags(
    '53000000-0000-4000-8000-0000000000c1'::uuid,
    '53000000-0000-4000-8000-0000000000a2'::uuid,   -- from: the duplicate
    '53000000-0000-4000-8000-0000000000a1'::uuid);  -- into: the survivor

  if v_result->>'outcome' <> 'merged' then
    raise exception 'TG-2: outcome was %', v_result->>'outcome';
  end if;

  -- All three conversations now carry the survivor, and only once each.
  select count(*) into v_left from public.conversation_tags
   where tag_id = '53000000-0000-4000-8000-0000000000a1'::uuid;
  if v_left <> 3 then
    raise exception 'TG-2: survivor carries % conversations, expected 3', v_left;
  end if;

  select count(*) into v_on_e3 from public.conversation_tags
   where conversation_id = '53000000-0000-4000-8000-0000000000e3'::uuid;
  if v_on_e3 <> 1 then
    raise exception 'TG-2: the both-tagged thread has % rows, expected 1', v_on_e3;
  end if;

  -- "Since when" stays true: the EARLIER of the two stamps survives.
  select created_at into v_stamp from public.conversation_tags
   where conversation_id = '53000000-0000-4000-8000-0000000000e3'::uuid;
  if v_stamp > now() - interval '8 days' then
    raise exception 'TG-2: the merge lost the earlier tagging date';
  end if;

  -- And the duplicate is gone.
  if exists (select 1 from public.tags
              where id = '53000000-0000-4000-8000-0000000000a2'::uuid) then
    raise exception 'TG-2: the merged-away tag still exists';
  end if;
end $$;

-- ===========================================================================
-- TG-3. A pipeline stage MOVES to the survivor rather than being dropped.
--
-- D108. Dropping it would silently lose a workspace's win rate to a tidy-up,
-- which is the expensive direction to be wrong in.
-- ===========================================================================
do $$
declare
  v_result jsonb;
  v_stage  text;
begin
  insert into public.tags (id, company_id, name, pipeline_stage) values
    ('53000000-0000-4000-8000-0000000000a3'::uuid,
     '53000000-0000-4000-8000-0000000000c1'::uuid, 'Won', 'won');
  insert into public.tags (id, company_id, name) values
    ('53000000-0000-4000-8000-0000000000a4'::uuid,
     '53000000-0000-4000-8000-0000000000c1'::uuid, 'Closed won');

  -- Merge the STAGE tag into the ordinary one: the stage must travel.
  v_result := public.api_merge_tags(
    '53000000-0000-4000-8000-0000000000c1'::uuid,
    '53000000-0000-4000-8000-0000000000a3'::uuid,
    '53000000-0000-4000-8000-0000000000a4'::uuid);

  if v_result->>'outcome' <> 'merged' then
    raise exception 'TG-3: outcome was %', v_result->>'outcome';
  end if;
  select pipeline_stage into v_stage from public.tags
   where id = '53000000-0000-4000-8000-0000000000a4'::uuid;
  if v_stage <> 'won' then
    raise exception 'TG-3: the stage was dropped, survivor has %', v_stage;
  end if;
end $$;

-- ===========================================================================
-- TG-4. Two stages refuse to merge.
--
-- The survivor can only carry one, and choosing silently throws away the
-- other's history. The unique index already refuses a second tag on one stage,
-- which is what stops a merge from doubling every count.
-- ===========================================================================
do $$
declare v_result jsonb;
begin
  insert into public.tags (id, company_id, name, pipeline_stage) values
    ('53000000-0000-4000-8000-0000000000a5'::uuid,
     '53000000-0000-4000-8000-0000000000c1'::uuid, 'Lost', 'lost');

  v_result := public.api_merge_tags(
    '53000000-0000-4000-8000-0000000000c1'::uuid,
    '53000000-0000-4000-8000-0000000000a5'::uuid,
    '53000000-0000-4000-8000-0000000000a4'::uuid);

  if v_result->>'outcome' <> 'two_stages' then
    raise exception 'TG-4: two stages merged, outcome %', v_result->>'outcome';
  end if;
  -- Both survive the refusal.
  if not exists (select 1 from public.tags
                  where id = '53000000-0000-4000-8000-0000000000a5'::uuid) then
    raise exception 'TG-4: a refused merge still deleted a tag';
  end if;
end $$;

-- ===========================================================================
-- TG-5. A tag from another workspace is not found, not merged.
-- ===========================================================================
do $$
declare v_result jsonb;
begin
  v_result := public.api_merge_tags(
    '53000000-0000-4000-8000-0000000000c9'::uuid,   -- a company that is not ours
    '53000000-0000-4000-8000-0000000000a1'::uuid,
    '53000000-0000-4000-8000-0000000000a4'::uuid);
  if v_result->>'outcome' <> 'not_found' then
    raise exception 'TG-5: a cross-tenant merge returned %', v_result->>'outcome';
  end if;
end $$;

-- ===========================================================================
-- TG-6. Merging a tag into itself is refused rather than deleting it.
-- ===========================================================================
do $$
declare v_result jsonb;
begin
  v_result := public.api_merge_tags(
    '53000000-0000-4000-8000-0000000000c1'::uuid,
    '53000000-0000-4000-8000-0000000000a1'::uuid,
    '53000000-0000-4000-8000-0000000000a1'::uuid);
  if v_result->>'outcome' <> 'same_tag' then
    raise exception 'TG-6: self-merge returned %', v_result->>'outcome';
  end if;
  if not exists (select 1 from public.tags
                  where id = '53000000-0000-4000-8000-0000000000a1'::uuid) then
    raise exception 'TG-6: a self-merge deleted the tag';
  end if;
end $$;

-- ===========================================================================
-- TG-7. Tag creation is open by default.
-- ===========================================================================
do $$
declare v_locked boolean;
begin
  select tags_locked into v_locked from public.companies
   where id = '53000000-0000-4000-8000-0000000000c1'::uuid;
  if v_locked then
    raise exception 'TG-7: tag creation is locked by default';
  end if;
end $$;

-- ===========================================================================
-- TG-8. The lock refuses a NEW tag and still returns an existing one.
--
-- The distinction the whole setting rests on: a tech who cannot categorise a
-- thread does not categorise it in the notes instead, they leave it
-- uncategorised. So the restriction is on INVENTING a tag, never on using one.
-- ===========================================================================
do $$
declare r record;
begin
  update public.companies set tags_locked = true
   where id = '53000000-0000-4000-8000-0000000000c1'::uuid;

  -- A member (may_create false) inventing something new: refused.
  select * into r from public.api_find_or_create_tag(
    '53000000-0000-4000-8000-0000000000c1'::uuid, 'Brand new', false);
  if not r.refused then
    raise exception 'TG-8: a locked workspace let a member invent a tag';
  end if;
  if exists (select 1 from public.tags
              where company_id = '53000000-0000-4000-8000-0000000000c1'::uuid
                and lower(name) = 'brand new') then
    raise exception 'TG-8: the refused tag was created anyway';
  end if;

  -- The same member attaching one that EXISTS: allowed, case-insensitively.
  select * into r from public.api_find_or_create_tag(
    '53000000-0000-4000-8000-0000000000c1'::uuid, 'warranty', false);
  if r.refused then
    raise exception 'TG-8: a locked workspace refused an EXISTING tag';
  end if;
  if r.id <> '53000000-0000-4000-8000-0000000000a1'::uuid then
    raise exception 'TG-8: the existing tag was not returned';
  end if;

  -- An owner/admin (may_create true) is unaffected by the lock.
  select * into r from public.api_find_or_create_tag(
    '53000000-0000-4000-8000-0000000000c1'::uuid, 'Owner made this', true);
  if r.refused then
    raise exception 'TG-8: the lock applied to somebody who may create';
  end if;
end $$;

-- ===========================================================================
-- TG-9: the ceiling refuses with a REASON, and never blocks an existing tag.
--
-- #298 asks for "a sane ceiling, high enough that nobody legitimate hits it and
-- low enough to catch runaway automation". A crew at 200 tags has an
-- integration, not a taxonomy — but it still has to be able to file things, so
-- the refusal must be on INVENTING only, exactly like the lock.
-- ===========================================================================
do $$
declare
  r record;
  i int;
begin
  update public.companies set tags_locked = false
   where id = '53000000-0000-4000-8000-0000000000c1'::uuid;

  -- Fill to the ceiling. The fixtures above already hold a handful, so this
  -- tops up rather than assuming an empty table.
  for i in 1..300 loop
    exit when (select count(*) from public.tags
                where company_id = '53000000-0000-4000-8000-0000000000c1'::uuid) >= 200;
    insert into public.tags (company_id, name)
    values ('53000000-0000-4000-8000-0000000000c1'::uuid, 'Filler ' || i);
  end loop;

  -- Even an owner is refused: the ceiling is a runaway guard, not a permission.
  select * into r from public.api_find_or_create_tag(
    '53000000-0000-4000-8000-0000000000c1'::uuid, 'One too many', true);
  if not r.refused then
    raise exception 'TG-9: the ceiling let a 201st tag through';
  end if;
  if r.reason is distinct from 'at_ceiling' then
    raise exception 'TG-9: the refusal did not say WHY (got %)', r.reason;
  end if;

  -- Attaching one that already exists is untouched by the ceiling: a workspace
  -- that cannot file anything is a workspace that stops tagging entirely.
  select * into r from public.api_find_or_create_tag(
    '53000000-0000-4000-8000-0000000000c1'::uuid, 'Filler 1', true);
  if r.refused then
    raise exception 'TG-9: the ceiling refused an EXISTING tag';
  end if;
end $$;

-- ===========================================================================
-- TG-10: a description says what a tag MEANS, and rides along with the usage
-- list where the decision to merge is actually made.
-- ===========================================================================
do $$
declare r record;
begin
  update public.tags
     set description = 'Work we are going back to fix for free.'
   where id = '53000000-0000-4000-8000-0000000000a1'::uuid;

  select * into r from public.api_tag_usage(
    '53000000-0000-4000-8000-0000000000c1'::uuid)
   where tag_id = '53000000-0000-4000-8000-0000000000a1'::uuid;
  if r.description is distinct from 'Work we are going back to fix for free.' then
    raise exception 'TG-10: the usage list dropped the description';
  end if;
  if r.last_used is null then
    raise exception 'TG-10: a used tag reported no last-used date';
  end if;

  -- The length guard is the one thing the column promises. Over it, the write
  -- must fail rather than silently truncate somebody's sentence.
  begin
    update public.tags set description = repeat('x', 201)
     where id = '53000000-0000-4000-8000-0000000000a1'::uuid;
    raise exception 'TG-10: a 201-character description was accepted';
  exception
    when check_violation then null;
  end;
end $$;

rollback;
