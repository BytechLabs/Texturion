-- #348 — the access model is complete and entirely invisible.
--
-- #106's precedence is well designed, documented, and has exactly one
-- implementation (D88). What it has never had is a way to ASK IT WHY. An owner
-- cannot see, for a given member, which numbers they reach, at what level, and
-- WHICH RULE decided it — and three principal kinds interact by precedence, so
-- "why" is a real question with a non-obvious answer.
--
-- #348 puts it plainly: *"A permission model that cannot be inspected is one
-- nobody trusts, and one where a misconfiguration is found by a customer rather
-- than by the person who made it."*
--
-- ---------------------------------------------------------------------------
-- THE SHAPE OF THIS CHANGE, AND WHY IT IS NOT A SECOND IMPLEMENTATION.
--
-- The obvious way to answer "which rule decided" is to read `number_access` and
-- rank the rows. That IS the precedence rule, so writing it anywhere else would
-- be a second copy of the one security decision D79 and D88 exist to prevent —
-- and `number-access-surfaces.test.ts` fails the moment `principal_kind`
-- appears in production TypeScript, which is exactly right.
--
-- So the explanation is added to the ONE implementation, and the existing entry
-- point delegates to it. After this migration:
--
--   member_number_access_explained   the rule, and its reason. One copy.
--   member_number_levels             a projection of it. Computes nothing.
--   member_number_level (singular)   already a lookup into the plural.
--   number_member_levels             already a lookup into the singular.
--
-- The contract of `member_number_levels` is preserved EXACTLY, because six call
-- sites and an RLS policy depend on it: restricted numbers only, empty for an
-- owner or admin, explicit `none` rows for a non-member. `member_number_level.
-- test.sql` (NL-1..NL-7) is what proves that, and it is unchanged.
--
-- ---------------------------------------------------------------------------
-- THE EXPLAINER RETURNS EVERY NUMBER, and that difference is deliberate.
--
-- `member_number_levels` deliberately omits the boring cases — an unruled number
-- and an owner's blanket access are absent because a caller asking "what is
-- restricted for this person" does not want them. An owner asking "what can this
-- person see" wants precisely those rows, because "nothing is restricting this
-- number" and "I have not looked at this number" are different answers and only
-- one of them is reassuring.

create or replace function public.member_number_access_explained(
  p_user_id uuid,
  p_company_id uuid
)
returns table (
  phone_number_id uuid,
  level text,
  -- Why this level, in a fixed vocabulary the clients render:
  --   'user'         a rule naming this person
  --   'role'         a rule naming their role
  --   'all'          a rule for everyone
  --   'no-match'     the number has rules and none of them match → hidden
  --   'unruled'      the number has no rules at all → open to everyone
  --   'role-override' owner or admin, who always have full access (#106)
  --   'not-a-member' not in this company, or deactivated → everything hidden
  decided_by text,
  -- The matched rule's principal, for the two kinds where it says something a
  -- reader could not already know: the role name for a 'role' match. Null
  -- everywhere else — a 'user' match's principal is the person being asked
  -- about, and repeating it would be noise.
  principal text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_role text;
begin
  select cm.role into v_role
  from public.company_members cm
  where cm.user_id = p_user_id
    and cm.company_id = p_company_id
    and cm.deactivated_at is null;

  -- Not a member, or deactivated. Every number hidden, said explicitly — the
  -- same reasoning as the plural's: an empty set reads as "unrestricted", which
  -- is the correct answer for an owner and the exact opposite for a stranger.
  if v_role is null then
    return query
      select pn.id, 'none'::text, 'not-a-member'::text, null::text
      from public.phone_numbers pn
      where pn.company_id = p_company_id;
    return;
  end if;

  -- Owners and admins manage the rules, so they are never subject to them
  -- (#106, no self-lockout). Named as an override rather than silently full
  -- access: an owner reading this screen should see WHY they see everything,
  -- or they will wonder whether the rules are working at all.
  if v_role in ('owner', 'admin') then
    return query
      select pn.id, 'text'::text, 'role-override'::text, v_role
      from public.phone_numbers pn
      where pn.company_id = p_company_id;
    return;
  end if;

  -- THE SPECIFICITY RULE, and still the only copy. Each CASE matches at most one
  -- row per number — the (phone_number_id, principal_kind, principal) unique
  -- guarantees it for 'user' and 'all', and only the caller's own role matches
  -- the 'role' arm — so each aggregate collapses a single value rather than
  -- choosing between several.
  --
  -- `decided_by` is computed from the SAME aggregates as `level`, in the same
  -- coalesce order. That is what keeps the reason honest: it cannot disagree
  -- with the level, because a disagreement would require two different orders
  -- and there is only one written down.
  return query
    with matched as (
      select
        na.phone_number_id as pid,
        max(case
              when na.principal_kind = 'user' and na.principal = p_user_id::text
              then na.level
            end) as by_user,
        max(case
              when na.principal_kind = 'role' and na.principal = v_role
              then na.level
            end) as by_role,
        max(case when na.principal_kind = 'all' then na.level end) as by_all
      from public.number_access na
      where na.company_id = p_company_id
      group by na.phone_number_id
    )
    select
      pn.id,
      coalesce(m.by_user, m.by_role, m.by_all, 'none')::text,
      case
        when m.pid is null then 'unruled'
        when m.by_user is not null then 'user'
        when m.by_role is not null then 'role'
        when m.by_all is not null then 'all'
        else 'no-match'
      end::text,
      case when m.by_user is null and m.by_role is not null then v_role end::text
    from public.phone_numbers pn
    left join matched m on m.pid = pn.id
    where pn.company_id = p_company_id;
end;
$function$;

comment on function public.member_number_access_explained(uuid, uuid) is
  '#348: every number in the company for one caller, with the effective level '
  'AND the rule that decided it. The ONE implementation of the #106 precedence '
  'rule (D88) — member_number_levels is a projection of this and computes '
  'nothing.';

revoke all on function public.member_number_access_explained(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.member_number_access_explained(uuid, uuid)
  to service_role;

-- The existing entry point, now a projection. Its contract is unchanged and
-- `member_number_level.test.sql` is what proves it: restricted numbers only
-- (so an unruled number and an owner's blanket access are both absent), and a
-- non-member's explicit `none` rows kept.
--
-- GRANTS ARE UNCHANGED, and NL-7 is why this comment exists. The plural is
-- service_role ONLY — it enumerates a company's restricted numbers, which is
-- not something an end-user role needs to ask for directly. The realtime topic
-- policy calls the SINGULAR as `authenticated`, and the singular is
-- `security definer`, so it reaches the plural without the caller having any
-- grant on it. I widened this to `authenticated` on the first pass, reasoning
-- from the policy without checking which function the policy calls; NL-7
-- rejected it immediately, which is exactly the job of a grant assertion.
create or replace function public.member_number_levels(
  p_user_id uuid,
  p_company_id uuid
)
returns table (phone_number_id uuid, level text)
language sql
stable
security definer
set search_path = ''
as $function$
  select e.phone_number_id, e.level
  from public.member_number_access_explained(p_user_id, p_company_id) e
  where e.decided_by in ('user', 'role', 'all', 'no-match', 'not-a-member')
$function$;

comment on function public.member_number_levels(uuid, uuid) is
  '#480/#348: every RESTRICTED number for one caller in one company, with the '
  'effective level. A projection of member_number_access_explained, which holds '
  'the only copy of the #106 precedence rule. An absent number is unrestricted; '
  'a non-member gets explicit none rows.';

revoke all on function public.member_number_levels(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.member_number_levels(uuid, uuid) to service_role;
