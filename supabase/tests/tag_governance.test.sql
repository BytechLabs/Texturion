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

rollback;
