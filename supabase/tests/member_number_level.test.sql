-- [#480] Effective number access in SQL — assertion suite for
-- supabase/migrations/20260730030000_member_number_level.sql.
--
-- This is a security boundary, so what this suite mostly pins is the ways it
-- could silently OPEN. A resolver that answers 'text' when it should answer
-- 'none' does not fail loudly anywhere: the member simply sees a number they
-- were denied, and nobody finds out until the customer does.
--
-- The cases that would do that, in order of how easy they are to write by
-- accident: a non-member reading as unrestricted (an empty result set is
-- indistinguishable from "nothing is restricted"), a deactivated member keeping
-- their access, precedence resolved the wrong way round so a broad 'all' row
-- overrides a specific denial, and a malformed topic string either authorizing
-- or raising instead of refusing.
--
-- One transaction, rolled back. Fixtures use a '4a' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('4a000000-0000-4000-8000-00000000000a'::uuid, 'na-owner@test.local'),
  ('4a000000-0000-4000-8000-00000000000b'::uuid, 'na-admin@test.local'),
  ('4a000000-0000-4000-8000-00000000000c'::uuid, 'na-member@test.local'),
  ('4a000000-0000-4000-8000-00000000000d'::uuid, 'na-other@test.local'),
  ('4a000000-0000-4000-8000-00000000000e'::uuid, 'na-gone@test.local'),
  ('4a000000-0000-4000-8000-00000000000f'::uuid, 'na-stranger@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status)
values
  ('4a000000-0000-4000-8000-0000000000c1'::uuid, 'Access Co',
   '4a000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 'active');

insert into public.company_members (company_id, user_id, role, deactivated_at)
values
  ('4a000000-0000-4000-8000-0000000000c1'::uuid,
   '4a000000-0000-4000-8000-00000000000a'::uuid, 'owner', null),
  ('4a000000-0000-4000-8000-0000000000c1'::uuid,
   '4a000000-0000-4000-8000-00000000000b'::uuid, 'admin', null),
  ('4a000000-0000-4000-8000-0000000000c1'::uuid,
   '4a000000-0000-4000-8000-00000000000c'::uuid, 'member', null),
  ('4a000000-0000-4000-8000-0000000000c1'::uuid,
   '4a000000-0000-4000-8000-00000000000d'::uuid, 'member', null),
  -- Offboarded. Their row survives for audit; their access must not.
  ('4a000000-0000-4000-8000-0000000000c1'::uuid,
   '4a000000-0000-4000-8000-00000000000e'::uuid, 'member', now());

insert into public.phone_numbers
  (id, company_id, number_e164, status, country, provisioning_key)
values
  -- Un-ruled: open to everyone, which is the product's default.
  ('4a000000-0000-4000-8000-0000000000f1'::uuid,
   '4a000000-0000-4000-8000-0000000000c1'::uuid, '+14155550301', 'active', 'US', 'na-1'),
  -- Restricted to one person by a 'user' row, with a broader 'all' row present.
  ('4a000000-0000-4000-8000-0000000000f2'::uuid,
   '4a000000-0000-4000-8000-0000000000c1'::uuid, '+14155550302', 'active', 'US', 'na-2'),
  -- Ruled, and nobody matches: hidden from every plain member.
  ('4a000000-0000-4000-8000-0000000000f3'::uuid,
   '4a000000-0000-4000-8000-0000000000c1'::uuid, '+14155550303', 'active', 'US', 'na-3'),
  -- Role-ruled at note level.
  ('4a000000-0000-4000-8000-0000000000f4'::uuid,
   '4a000000-0000-4000-8000-0000000000c1'::uuid, '+14155550304', 'active', 'US', 'na-4');

insert into public.number_access
  (company_id, phone_number_id, principal_kind, principal, level)
values
  -- f2: a 'user' grant for the member, and an 'all' row that must NOT win.
  ('4a000000-0000-4000-8000-0000000000c1'::uuid,
   '4a000000-0000-4000-8000-0000000000f2'::uuid, 'user',
   '4a000000-0000-4000-8000-00000000000c', 'text'),
  ('4a000000-0000-4000-8000-0000000000c1'::uuid,
   '4a000000-0000-4000-8000-0000000000f2'::uuid, 'all', null, 'note'),
  -- f3: a 'user' row for somebody else only. Everyone else is hidden.
  ('4a000000-0000-4000-8000-0000000000c1'::uuid,
   '4a000000-0000-4000-8000-0000000000f3'::uuid, 'user',
   '4a000000-0000-4000-8000-00000000000d', 'text'),
  -- f4: members get notes only.
  ('4a000000-0000-4000-8000-0000000000c1'::uuid,
   '4a000000-0000-4000-8000-0000000000f4'::uuid, 'role', 'member', 'note');

create or replace function pg_temp.lvl(p_user uuid, p_number uuid)
returns text language sql as $$
  select public.member_number_level(p_user, p_number);
$$;

-- ===========================================================================
-- NL-1. The precedence rule, in the order #106 states it.
-- ===========================================================================
do $$
declare v text;
begin
  -- An un-ruled number is open. The default is OPEN, and a resolver that got
  -- this backwards would hide every number in every workspace that has never
  -- configured access — which is nearly all of them.
  v := pg_temp.lvl('4a000000-0000-4000-8000-00000000000c'::uuid,
                   '4a000000-0000-4000-8000-0000000000f1'::uuid);
  if v <> 'text' then
    raise exception 'NL-1 FAILED: un-ruled number reads % (want text)', v;
  end if;

  -- A 'user' row beats a broader 'all' row. Both exist on f2; the specific one
  -- wins. Resolved the other way round, a blanket rule would quietly override
  -- every individual grant.
  v := pg_temp.lvl('4a000000-0000-4000-8000-00000000000c'::uuid,
                   '4a000000-0000-4000-8000-0000000000f2'::uuid);
  if v <> 'text' then
    raise exception 'NL-1 FAILED: user row lost to all row (% )', v;
  end if;

  -- Somebody with no 'user' row on f2 falls through to the 'all' row.
  v := pg_temp.lvl('4a000000-0000-4000-8000-00000000000d'::uuid,
                   '4a000000-0000-4000-8000-0000000000f2'::uuid);
  if v <> 'note' then
    raise exception 'NL-1 FAILED: fallthrough to all row reads % (want note)', v;
  end if;

  -- A 'role' row applies to the caller's role.
  v := pg_temp.lvl('4a000000-0000-4000-8000-00000000000c'::uuid,
                   '4a000000-0000-4000-8000-0000000000f4'::uuid);
  if v <> 'note' then
    raise exception 'NL-1 FAILED: role row reads % (want note)', v;
  end if;

  -- Ruled, and nothing matches → hidden. This is the whole point of the
  -- feature, and the one answer that must never soften to 'note'.
  v := pg_temp.lvl('4a000000-0000-4000-8000-00000000000c'::uuid,
                   '4a000000-0000-4000-8000-0000000000f3'::uuid);
  if v <> 'none' then
    raise exception 'NL-1 FAILED: ruled-and-unmatched reads % (want none)', v;
  end if;

  raise notice 'NL-1 PASSED: user beats role beats all, unmatched is hidden';
end $$;

-- ===========================================================================
-- NL-2. Owners and admins are never locked out, and never pay for the lookup.
-- ===========================================================================
do $$
declare v text; n int;
begin
  for v in select unnest(array[
    '4a000000-0000-4000-8000-00000000000a',
    '4a000000-0000-4000-8000-00000000000b'])
  loop
    if pg_temp.lvl(v::uuid, '4a000000-0000-4000-8000-0000000000f3'::uuid) <> 'text' then
      raise exception 'NL-2 FAILED: % is denied a number they administer', v;
    end if;
  end loop;

  -- And the plural returns NOTHING for them — the restricted set is empty, which
  -- is what lets the Worker skip building a deny list at all.
  select count(*) into n
  from public.member_number_levels(
    '4a000000-0000-4000-8000-00000000000a'::uuid,
    '4a000000-0000-4000-8000-0000000000c1'::uuid);
  if n <> 0 then
    raise exception 'NL-2 FAILED: owner has % restricted numbers (want 0)', n;
  end if;

  raise notice 'NL-2 PASSED: owner and admin keep full access, and skip the lookup';
end $$;

-- ===========================================================================
-- NL-3. A NON-MEMBER AND A DEACTIVATED MEMBER SEE NOTHING.
--
-- The failure this exists for: an empty result set from the plural is
-- indistinguishable from "nothing is restricted for this caller", which is the
-- correct answer for an owner and the exact opposite for a stranger. If the
-- plural returned nothing for a non-member, the singular's absent-means-'text'
-- default would hand them every number in the workspace.
-- ===========================================================================
do $$
declare v text; n int; bad int;
begin
  foreach v in array array[
    '4a000000-0000-4000-8000-00000000000f',   -- never a member
    '4a000000-0000-4000-8000-00000000000e']   -- offboarded
  loop
    -- Every number, including the un-ruled one that is open to the whole crew.
    if pg_temp.lvl(v::uuid, '4a000000-0000-4000-8000-0000000000f1'::uuid) <> 'none' then
      raise exception 'NL-3 FAILED: % reads an un-ruled number as visible', v;
    end if;
    if pg_temp.lvl(v::uuid, '4a000000-0000-4000-8000-0000000000f2'::uuid) <> 'none' then
      raise exception 'NL-3 FAILED: % reads a ruled number as visible', v;
    end if;

    -- And the plural says so explicitly for every number rather than returning
    -- an empty set.
    select count(*) into n
    from public.member_number_levels(
      v::uuid, '4a000000-0000-4000-8000-0000000000c1'::uuid);
    if n <> 4 then
      raise exception 'NL-3 FAILED: % gets % rows (want 4 explicit none rows)', v, n;
    end if;
    select count(*) into bad
    from public.member_number_levels(
      v::uuid, '4a000000-0000-4000-8000-0000000000c1'::uuid) l
    where l.level <> 'none';
    if bad <> 0 then
      raise exception 'NL-3 FAILED: % has % non-none rows', v, bad;
    end if;
  end loop;

  raise notice 'NL-3 PASSED: a stranger and an offboarded member see nothing';
end $$;

-- ===========================================================================
-- NL-4. The singular fails CLOSED on input it cannot place.
--
-- It authorizes a realtime topic, so "I cannot resolve this" must not answer
-- 'text'. Note this deliberately differs from the Worker's levelFor(null),
-- which answers 'text' for a conversation with no number — a different question
-- about rows outside the rule's domain.
-- ===========================================================================
do $$
begin
  if public.member_number_level(
       '4a000000-0000-4000-8000-00000000000c'::uuid, null) <> 'none' then
    raise exception 'NL-4 FAILED: a null number is not refused';
  end if;
  -- A well-formed uuid that is not a number in any company.
  if public.member_number_level(
       '4a000000-0000-4000-8000-00000000000c'::uuid,
       '4a000000-0000-4000-8000-0000000000ff'::uuid) <> 'none' then
    raise exception 'NL-4 FAILED: an unknown number is not refused';
  end if;
  raise notice 'NL-4 PASSED: null and unknown ids fail closed';
end $$;

-- ===========================================================================
-- NL-5. The plural lists exactly the RESTRICTED numbers, and nothing else.
--
-- The Worker turns this into a deny list, so an un-ruled number appearing here
-- would hide a number that is open to everyone.
-- ===========================================================================
do $$
declare n int; v text;
begin
  -- The plain member: f2 text (user grant), f3 none, f4 note. f1 is un-ruled and
  -- must be ABSENT — an un-ruled number is not a restriction.
  select count(*) into n
  from public.member_number_levels(
    '4a000000-0000-4000-8000-00000000000c'::uuid,
    '4a000000-0000-4000-8000-0000000000c1'::uuid);
  if n <> 3 then
    raise exception 'NL-5 FAILED: member has % restricted rows (want 3)', n;
  end if;

  select l.level into v
  from public.member_number_levels(
    '4a000000-0000-4000-8000-00000000000c'::uuid,
    '4a000000-0000-4000-8000-0000000000c1'::uuid) l
  where l.phone_number_id = '4a000000-0000-4000-8000-0000000000f1'::uuid;
  if v is not null then
    raise exception 'NL-5 FAILED: the un-ruled number appears as % ', v;
  end if;

  raise notice 'NL-5 PASSED: only ruled numbers are listed';
end $$;

-- ===========================================================================
-- NL-6. The topic policy: shapes, and the malformed ones.
--
-- `is_company_topic_member` reads auth.uid(), which is null in this suite, so
-- what is asserted here is the part that must hold WITHOUT a caller: a malformed
-- per-number topic must return false rather than RAISE. A cast of arbitrary text
-- to uuid throws, and this function runs inside an RLS predicate — a client
-- joining `company:{id}:number:garbage` would get a database error instead of a
-- refusal.
-- ===========================================================================
do $$
declare v boolean;
begin
  -- None of these may raise, and all must be false with no authenticated user.
  v := public.is_company_topic_member('company:not-a-uuid:number:also-not-one');
  if v is not false then
    raise exception 'NL-6 FAILED: garbage topic returned %', v;
  end if;
  v := public.is_company_topic_member(
    'company:4a000000-0000-4000-8000-0000000000c1:number:garbage');
  if v is not false then
    raise exception 'NL-6 FAILED: malformed number id returned %', v;
  end if;
  v := public.is_company_topic_member(
    'company:4a000000-0000-4000-8000-0000000000c1:number:');
  if v is not false then
    raise exception 'NL-6 FAILED: empty number id returned %', v;
  end if;
  -- A near-miss uuid: right shape, one character too few.
  v := public.is_company_topic_member(
    'company:4a000000-0000-4000-8000-0000000000c1:number:'
    || '4a000000-0000-4000-8000-0000000000f');
  if v is not false then
    raise exception 'NL-6 FAILED: short uuid returned %', v;
  end if;
  v := public.is_company_topic_member('');
  if v is not false then
    raise exception 'NL-6 FAILED: empty topic returned %', v;
  end if;

  raise notice 'NL-6 PASSED: malformed topics refuse rather than raise';
end $$;

-- ===========================================================================
-- NL-6b. #302's presence topic is the number topic's sibling, not a new door.
--
-- Presence names a CONVERSATION in its payload, so who may join is an access
-- question. The suffix inherits the number's rule exactly — same uuid, same
-- `member_number_level` test — and what must be pinned is that a `:presence`
-- suffix is the ONLY thing admitted beside the bare topic.
--
-- THIS IS ASSERTED AGAINST THE PATTERN, NOT THROUGH THE FUNCTION, and the
-- reason is worth writing down. `is_company_topic_member` reads auth.uid(),
-- which is null in this suite, so it returns false for EVERY input here —
-- including inputs it would wrongly accept for a real caller. Calling it with
-- `:anything` and asserting false looks like a test and proves nothing at all.
-- So the pattern is lifted out of the shipped function definition and exercised
-- directly: if the anchor is ever dropped, this fails.
-- ===========================================================================
do $$
declare
  src     text;
  pattern text;
  base    text := 'company:4a000000-0000-4000-8000-0000000000c1'
                  || ':number:4a000000-0000-4000-8000-0000000000f1';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'is_company_topic_member'
  limit 1;
  if src is null then
    raise exception 'NL-6b FAILED: is_company_topic_member is missing';
  end if;

  -- The anchored topic pattern, reconstructed the way the function builds it.
  -- Extracted from the source rather than retyped, so a change to the shipped
  -- rule reaches this assertion instead of leaving it agreeing with itself.
  if position('(:presence)?$' in src) = 0 then
    raise exception
      'NL-6b FAILED: the topic pattern is not anchored after (:presence). '
      'Without the anchor, `:presence` opens the door to `:anything`.';
  end if;
  if position('^company:' in src) = 0 then
    raise exception 'NL-6b FAILED: the topic pattern is not anchored at the start';
  end if;

  pattern := '^company:4a000000-0000-4000-8000-0000000000c1'
             || ':number:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
             || '(:presence)?$';

  if not (base ~* pattern) then
    raise exception 'NL-6b FAILED: the bare number topic no longer matches';
  end if;
  if not ((base || ':presence') ~* pattern) then
    raise exception 'NL-6b FAILED: the presence topic does not match';
  end if;
  if (base || ':anything') ~* pattern then
    raise exception 'NL-6b FAILED: an arbitrary suffix matches the topic pattern';
  end if;
  if (base || ':presence:more') ~* pattern then
    raise exception 'NL-6b FAILED: a suffix past :presence matches';
  end if;
  if ('company:4a000000-0000-4000-8000-0000000000c1:number:garbage:presence') ~* pattern then
    raise exception 'NL-6b FAILED: a malformed uuid matches with the suffix';
  end if;

  -- And the function itself still REFUSES rather than raising on the malformed
  -- shapes, which is NL-6's property extended to the new suffix: a cast of
  -- arbitrary text to uuid throws, and this runs inside an RLS predicate.
  if public.is_company_topic_member(
       'company:4a000000-0000-4000-8000-0000000000c1:number:garbage:presence'
     ) is not false then
    raise exception 'NL-6b FAILED: malformed presence topic did not refuse';
  end if;

  raise notice 'NL-6b PASSED: presence is the number topic''s sibling, nothing else is';
end $$;

-- ===========================================================================
-- NL-7. Grants. The policy calls the singular as `authenticated`; the plural
--       enumerates a company's restrictions and stays service-role only.
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
    and p.proname = 'member_number_levels'
    and a.privilege_type = 'EXECUTE'
    and r.rolname in ('public', 'anon', 'authenticated');
  if leaked is not null then
    raise exception 'NL-7 FAILED: member_number_levels EXECUTE leaked to %', leaked;
  end if;

  select string_agg(distinct r.rolname, ',') into leaked
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(p.proacl) a
  join pg_roles r on r.oid = a.grantee
  where n.nspname = 'public'
    and p.proname = 'member_number_level'
    and a.privilege_type = 'EXECUTE'
    and r.rolname in ('public', 'anon');
  if leaked is not null then
    raise exception 'NL-7 FAILED: member_number_level EXECUTE leaked to %', leaked;
  end if;

  -- And it MUST be executable by authenticated, or the topic policy denies
  -- every per-number join and realtime silently stops working for everyone.
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(p.proacl) a
    join pg_roles r on r.oid = a.grantee
    where n.nspname = 'public'
      and p.proname = 'member_number_level'
      and a.privilege_type = 'EXECUTE'
      and r.rolname = 'authenticated'
  ) then
    raise exception 'NL-7 FAILED: authenticated cannot execute member_number_level';
  end if;

  raise notice 'NL-7 PASSED: singular is authenticated-callable, plural is not';
end $$;


-- ===========================================================================
-- NL-8 (#348). The rule can be asked WHY, and the reason cannot disagree with
-- the level.
--
-- #348: "A permission model that cannot be inspected is one nobody trusts, and
-- one where a misconfiguration is found by a customer rather than by the person
-- who made it." Three principal kinds interact by precedence, so "why" is a
-- real question with a non-obvious answer.
--
-- The property that matters most is the LAST one asserted here: every row the
-- explainer returns for a restricted number must agree with what
-- member_number_levels says. They cannot drift, because the plural is now a
-- projection of the explainer rather than a second implementation — and this is
-- what proves that stayed true.
-- ===========================================================================
do $$
declare
  v_row       record;
  v_seen      int;
begin
  -- A 'user' rule beats the 'role' rule on the same number (NL-1's fixture).
  select level, decided_by, principal into v_row
  from public.member_number_access_explained(
    '4a000000-0000-4000-8000-00000000000c'::uuid,
    '4a000000-0000-4000-8000-0000000000c1'::uuid)
  where phone_number_id = '4a000000-0000-4000-8000-0000000000f2'::uuid;
  if v_row.decided_by is distinct from 'user' then
    raise exception 'NL-8 FAILED: expected a user rule to decide, got % (%)',
      v_row.decided_by, v_row.level;
  end if;
  -- A 'user' match names nobody: the principal IS the person being asked about,
  -- and repeating it back would be noise on the screen.
  if v_row.principal is not null then
    raise exception 'NL-8 FAILED: a user match named a principal (%)', v_row.principal;
  end if;

  -- An unruled number is reported as unruled rather than omitted. "Nothing is
  -- restricting this number" and "I have not looked at this number" are
  -- different answers, and only one of them is reassuring.
  select count(*) into v_seen
  from public.member_number_access_explained(
    '4a000000-0000-4000-8000-00000000000c'::uuid,
    '4a000000-0000-4000-8000-0000000000c1'::uuid)
  where decided_by = 'unruled';
  if v_seen = 0 then
    raise exception 'NL-8 FAILED: no unruled number reported — the explainer must return every number';
  end if;

  -- An owner sees everything, and is told WHY. Silent full access would leave
  -- an owner wondering whether the rules work at all.
  select level, decided_by into v_row
  from public.member_number_access_explained(
    '4a000000-0000-4000-8000-00000000000a'::uuid,
    '4a000000-0000-4000-8000-0000000000c1'::uuid)
  limit 1;
  if v_row.decided_by is distinct from 'role-override' or v_row.level is distinct from 'text' then
    raise exception 'NL-8 FAILED: owner should be text/role-override, got %/%',
      v_row.level, v_row.decided_by;
  end if;

  -- A stranger is told they are a stranger, on every number.
  select count(*) into v_seen
  from public.member_number_access_explained(
    '4a000000-0000-4000-8000-00000000000f'::uuid,
    '4a000000-0000-4000-8000-0000000000c1'::uuid)
  where decided_by <> 'not-a-member' or level <> 'none';
  if v_seen <> 0 then
    raise exception 'NL-8 FAILED: a non-member got % non-stranger row(s)', v_seen;
  end if;

  -- THE ONE THAT MATTERS. The reason and the level are computed from the same
  -- coalesce order, so for every restricted number the explainer and the plural
  -- must return the identical level. A mismatch means two implementations again.
  select count(*) into v_seen
  from public.member_number_access_explained(
    '4a000000-0000-4000-8000-00000000000c'::uuid,
    '4a000000-0000-4000-8000-0000000000c1'::uuid) e
  join public.member_number_levels(
    '4a000000-0000-4000-8000-00000000000c'::uuid,
    '4a000000-0000-4000-8000-0000000000c1'::uuid) l
    on l.phone_number_id = e.phone_number_id
  where l.level is distinct from e.level;
  if v_seen <> 0 then
    raise exception 'NL-8 FAILED: % number(s) where the reason and the rule disagree', v_seen;
  end if;

  raise notice 'NL-8 PASSED: the rule explains itself, and cannot disagree with itself';
end $$;

rollback;
