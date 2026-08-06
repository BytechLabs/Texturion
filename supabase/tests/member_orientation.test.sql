-- [#286] Member orientation — assertion suite for
-- supabase/migrations/20260804460000_member_orientation.sql.
--
-- "An invited member sees a short, skippable, member-specific orientation on
-- first sign-in." The one piece of a member's first-run state that cannot be
-- derived from rows they wrote, so it is the one that can drift.
--
-- One transaction, rolled back. Fixtures use an 'ao' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a'::uuid, 'orient-owner@test.local'),
  ('a0000000-0000-4000-8000-00000000000b'::uuid, 'orient-tech@test.local'),
  ('a0000000-0000-4000-8000-00000000000c'::uuid, 'orient-other@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('a0000000-0000-4000-8000-0000000000c1'::uuid, 'Orient Co',
   'a0000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now()),
  -- A second crew, so "per membership" can be asserted rather than assumed.
  ('a0000000-0000-4000-8000-0000000000c2'::uuid, 'Second Crew',
   'a0000000-0000-4000-8000-00000000000c'::uuid, 'US', '415', now());

do $$
declare
  v_tech uuid := 'a0000000-0000-4000-8000-00000000000b'::uuid;
  v_co1  uuid := 'a0000000-0000-4000-8000-0000000000c1'::uuid;
  v_co2  uuid := 'a0000000-0000-4000-8000-0000000000c2'::uuid;
  v      jsonb;
  v_at   timestamptz;
  v_then timestamptz;
begin
  -- ==========================================================================
  -- A NEW MEMBERSHIP HAS SEEN NOTHING.
  --
  -- The column is nullable with no default, and this is why: a default would
  -- stamp the people this feature is FOR at the exact moment their row is
  -- created, which is when they have seen nothing at all.
  -- ==========================================================================
  insert into public.company_members (company_id, user_id, role)
  values (v_co1, v_tech, 'member');

  v := public.api_member_firsts(v_co1, v_tech);
  if (v ->> 'oriented')::boolean then
    raise exception 'a brand new member has not been oriented: %', v;
  end if;

  -- ==========================================================================
  -- FINISHING IT AND SKIPPING IT ARE THE SAME WRITE.
  --
  -- Skipping is not a lesser outcome to be re-asked later. #286 promises a
  -- skippable flow, and a skip that gets re-asked tomorrow is not one.
  -- ==========================================================================
  v := public.api_mark_oriented(v_co1, v_tech);
  if not (v ->> 'oriented')::boolean or not (v ->> 'marked')::boolean then
    raise exception 'the first mark must take: %', v;
  end if;

  v := public.api_member_firsts(v_co1, v_tech);
  if not (v ->> 'oriented')::boolean then
    raise exception 'the mark must be visible to the read: %', v;
  end if;

  -- ==========================================================================
  -- IDEMPOTENT, AND THE TIMESTAMP DOES NOT MOVE.
  --
  -- Two devices can race this: the same person finishes on a phone while the
  -- laptop's copy of the flow is still open. The second write must not
  -- overwrite the first, because the timestamp is also the record of WHEN
  -- somebody joined the product properly.
  -- ==========================================================================
  select oriented_at into v_at
    from public.company_members
   where company_id = v_co1 and user_id = v_tech;

  perform pg_sleep(0.01);
  v := public.api_mark_oriented(v_co1, v_tech);
  if (v ->> 'marked')::boolean then
    raise exception 'the second mark must report that it changed nothing: %', v;
  end if;
  -- …but still answers "you are oriented", because that is true. A client
  -- retrying after a dropped response must not be handed an error for
  -- succeeding twice.
  if not (v ->> 'oriented')::boolean then
    raise exception 'a repeat call still says oriented: %', v;
  end if;

  select oriented_at into v_then
    from public.company_members
   where company_id = v_co1 and user_id = v_tech;
  if v_then is distinct from v_at then
    raise exception 'the timestamp moved on a repeat call: % -> %', v_at, v_then;
  end if;

  -- ==========================================================================
  -- PER MEMBERSHIP, NOT PER USER.
  --
  -- Somebody who works for two companies through this product joins each crew
  -- separately: different numbers, a different owner, a different set of
  -- people. The second one is not a repeat of the first.
  -- ==========================================================================
  insert into public.company_members (company_id, user_id, role)
  values (v_co2, v_tech, 'member');

  v := public.api_member_firsts(v_co2, v_tech);
  if (v ->> 'oriented')::boolean then
    raise exception 'the second crew is its own joining: %', v;
  end if;

  -- And marking one does not mark the other.
  perform public.api_mark_oriented(v_co2, v_tech);
  v := public.api_member_firsts(v_co1, v_tech);
  if not (v ->> 'oriented')::boolean then
    raise exception 'the first crew must stay oriented: %', v;
  end if;

  -- ==========================================================================
  -- A CALLER WITH NO MEMBERSHIP IS NEVER SHOWN A JOINING FLOW.
  --
  -- Nothing reaches these functions without the company middleware vouching
  -- for the caller. The fallback is for the day something does: the failure we
  -- can afford is a member missing an orientation, not a stranger being walked
  -- through one.
  -- ==========================================================================
  v := public.api_member_firsts(v_co1, 'a0000000-0000-4000-8000-00000000000c'::uuid);
  if not (v ->> 'oriented')::boolean then
    raise exception 'a non-member must not be offered the flow: %', v;
  end if;

  v := public.api_mark_oriented(v_co1, 'a0000000-0000-4000-8000-00000000000c'::uuid);
  if (v ->> 'marked')::boolean then
    raise exception 'a non-member must not be markable: %', v;
  end if;

  -- ==========================================================================
  -- THE THREE DERIVED SIGNALS STILL WORK.
  --
  -- `oriented` was folded into the existing read rather than given a route of
  -- its own; the point of folding is that the other three are untouched.
  -- ==========================================================================
  if (v ->> 'replied') is not null then
    raise exception 'mark_oriented does not answer the firsts question: %', v;
  end if;
  v := public.api_member_firsts(v_co1, v_tech);
  if (v ->> 'replied')::boolean or (v ->> 'noted')::boolean
     or (v ->> 'marked_done')::boolean then
    raise exception 'orientation is not activity: %', v;
  end if;

  raise notice 'member orientation (#286): all assertions passed';
end $$;

-- ---------------------------------------------------------------------------
-- Everybody who was already here is already oriented.
--
-- The backfill in the migration, asserted from the other side: a membership
-- created before this shipped has weeks of the product behind it, and a
-- joining flow aimed at their first sign-in would be an interruption.
do $$
declare
  v_stale bigint;
begin
  select count(*) into v_stale
    from public.company_members
   where oriented_at is null
     and created_at < now() - interval '1 minute';
  if v_stale > 0 then
    raise exception '% pre-existing memberships were left un-oriented', v_stale;
  end if;
end $$;

-- Service-role only: both read and write one person's state inside a
-- workspace, and the write is the record of their joining.
do $$
begin
  if has_function_privilege('authenticated', 'public.api_mark_oriented(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.api_mark_oriented(uuid, uuid)', 'execute') then
    raise exception 'api_mark_oriented must be service_role only';
  end if;
end $$;

rollback;
