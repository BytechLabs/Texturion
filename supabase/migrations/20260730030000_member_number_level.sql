-- #480 (D85, split from #349) — effective number access, in ONE place, callable
-- from SQL.
--
-- ===========================================================================
-- WHY THIS EXISTS
-- ===========================================================================
--
-- Realtime topics are `company:{company_id}`, and #106 makes access per NUMBER,
-- so a member denied a number still receives every id-only event for
-- conversations on it — existence, direction, timing, no content. D85 accepted
-- that and said why.
--
-- The obvious fix (a per-number topic) could not be done safely, and reaching
-- for it would have REDUCED security while appearing to increase it. Joining a
-- topic is authorized by `is_company_topic_member`, which matched
-- `company:{company_id}` exactly. Leave it alone and a per-number topic is
-- denied — realtime silently stops working. Extend it to keep checking only
-- company membership and any member may join any number's topic: a boundary
-- that looks like one and enforces nothing, which is strictly worse than a
-- coarse topic that honestly matches what it checks.
--
-- Making it a real boundary needs the effective-access rule callable from the
-- policy, and that rule lived in TypeScript (`resolveNumberAccess` /
-- `levelFromRules` in apps/api/src/auth/number-access.ts). The #106 migration
-- said so in as many words: "Owners and admins ALWAYS have full access to every
-- number ... enforced in the Worker, not here."
--
-- Writing a second copy in SQL for the policy would be two implementations of
-- one security rule — the drift class D79 exists to prevent, on the worst
-- possible surface. So the rule moves here and the Worker calls it.
--
-- ===========================================================================
-- THE RULE, VERBATIM FROM #106
-- ===========================================================================
--
--   'text' — full use: send texts, post notes, read.
--   'note' — read + internal notes only, no outbound texts.
--   'none' — hidden: the number and its conversations are not enumerable.
--
-- Per number, a 'user' row for the caller beats a 'role' row beats an 'all'
-- row. Rules exist for a number and none match the caller → 'none'. No rules at
-- all for a number → 'text' (the default is open). Owners and admins always have
-- full access to every number, because they manage the rules and must not be
-- able to lock themselves out.
--
-- ===========================================================================
-- WHY TWO FUNCTIONS, AND WHY THAT IS STILL ONE IMPLEMENTATION
-- ===========================================================================
--
-- The policy needs ONE number's level. The Worker needs EVERY restricted number
-- for a caller in one round trip — it resolves access once per request and hands
-- a deny list to the SQL-side conversation filters, so a per-number call would
-- turn one query into N on the hottest read path in the product.
--
-- So `member_number_levels` (plural) holds the specificity rule, and
-- `member_number_level` (singular) is a thin lookup into it. The singular
-- computes nothing: if the precedence order ever changes, there is exactly one
-- place it can change.
--
-- A NON-MEMBER GETS EXPLICIT 'none' ROWS for every number in the company rather
-- than an empty set. Empty means "nothing is restricted for this caller", which
-- is the correct answer for an owner and the exact opposite of the correct
-- answer for a stranger. Returning nothing for both would make the singular's
-- absent-means-'text' default into a hole.

create or replace function public.member_number_levels(
  p_user_id uuid,
  p_company_id uuid
)
returns table (phone_number_id uuid, level text)
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

  -- Not a member (or deactivated): everything in this company is hidden. Said
  -- explicitly, per the header — an empty set would read as "unrestricted".
  if v_role is null then
    return query
      select pn.id, 'none'::text
      from public.phone_numbers pn
      where pn.company_id = p_company_id;
    return;
  end if;

  -- Owners and admins: nothing is restricted, and the lookup is skipped
  -- entirely so the common path costs nothing (#106).
  if v_role in ('owner', 'admin') then
    return;
  end if;

  -- THE SPECIFICITY RULE, and the only copy of it. Each CASE can match at most
  -- one row per number — the (phone_number_id, principal_kind, principal) unique
  -- guarantees it for 'user' and 'all', and only the caller's own role matches
  -- the 'role' arm — so the aggregate is collapsing a single value, not choosing
  -- between several. `coalesce` then reads exactly as #106 states the precedence:
  -- user beats role beats all, and a ruled number that matches nothing is hidden.
  return query
    select
      na.phone_number_id,
      coalesce(
        max(case
              when na.principal_kind = 'user' and na.principal = p_user_id::text
              then na.level
            end),
        max(case
              when na.principal_kind = 'role' and na.principal = v_role
              then na.level
            end),
        max(case when na.principal_kind = 'all' then na.level end),
        'none'
      )
    from public.number_access na
    where na.company_id = p_company_id
    group by na.phone_number_id;
end;
$function$;

comment on function public.member_number_levels(uuid, uuid) is
  '#480: every RESTRICTED number for one caller in one company, with the '
  'effective level. The only implementation of the #106 precedence rule. An '
  'absent number is unrestricted; a non-member gets explicit none rows.';

create or replace function public.member_number_level(
  p_user_id uuid,
  p_phone_number_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_company uuid;
  v_level text;
begin
  -- Fail closed on a missing or unknown number. This function authorizes a
  -- realtime topic, so "I cannot place this id" must not answer 'text'.
  --
  -- Note this differs from the Worker's `levelFor(null)`, which answers 'text'
  -- for a conversation with NO number — deliberately, and it is not the same
  -- question. That is a convenience about rows outside the rule's domain; this
  -- is an authorization decision about a named number.
  if p_phone_number_id is null then
    return 'none';
  end if;

  select pn.company_id into v_company
  from public.phone_numbers pn
  where pn.id = p_phone_number_id;
  if v_company is null then
    return 'none';
  end if;

  select l.level into v_level
  from public.member_number_levels(p_user_id, v_company) l
  where l.phone_number_id = p_phone_number_id;

  -- Absent from the restricted set means unrestricted. A non-member cannot
  -- reach this branch: they get an explicit 'none' row for every number.
  return coalesce(v_level, 'text');
end;
$function$;

comment on function public.member_number_level(uuid, uuid) is
  '#480: one caller''s effective level for one number. A thin lookup into '
  'member_number_levels — it computes nothing, so the precedence rule has one '
  'home. Fails closed (none) for a null or unknown number.';

-- The policy calls the singular as the authenticated role, so that one is
-- grantable to `authenticated`. The plural is the Worker's and stays
-- service-role only: it enumerates a company's restricted numbers, which is not
-- something an end-user role needs to be able to ask for directly.
revoke all on function public.member_number_levels(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.member_number_levels(uuid, uuid) to service_role;

revoke all on function public.member_number_level(uuid, uuid) from public, anon;
grant execute on function public.member_number_level(uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The topic policy, now a real boundary for per-number topics.
-- ---------------------------------------------------------------------------
--
-- Two shapes are authorized:
--
--   company:{company_id}                          — as before, unchanged.
--   company:{company_id}:number:{phone_number_id} — only when the caller's
--                                                   effective level is not
--                                                   'none'.
--
-- THE UUID IS VALIDATED BEFORE IT IS CAST. A cast of arbitrary text to uuid
-- RAISES, and this function runs inside an RLS predicate: a client joining
-- `company:{id}:number:garbage` would get a database error rather than a
-- refusal, which is a worse failure than a denial and a needlessly noisy one.
-- The regex makes a malformed topic simply not match.
--
-- `search_path = ''` is kept, so every reference is schema-qualified.

create or replace function public.is_company_topic_member(topic_text text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.company_members cm
      where cm.user_id = auth.uid()
        and cm.deactivated_at is null
        and topic_text = 'company:' || cm.company_id::text
    )
    or exists (
      select 1
      from public.company_members cm
      where cm.user_id = auth.uid()
        and cm.deactivated_at is null
        and topic_text like 'company:' || cm.company_id::text || ':number:%'
        and substring(topic_text from ':number:(.*)$') ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and public.member_number_level(
              auth.uid(),
              substring(topic_text from ':number:(.*)$')::uuid
            ) <> 'none'
    );
$$;

revoke execute on function public.is_company_topic_member(text) from public, anon;
grant execute on function public.is_company_topic_member(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The inverse question, asked by the notification fan-out.
-- ---------------------------------------------------------------------------
--
-- `listConversationViewers` in the Worker asks the rule BACKWARDS: given a
-- number, which members may see it? It answered that by reading the rules and
-- applying the precedence itself, member by member, with its own copy of the
-- owner/admin override — a THIRD place the rule was written down, and the one
-- that decides who gets told about a customer's message.
--
-- Expressed here it delegates to `member_number_level`, so the precedence order
-- still has exactly one home.
--
-- COST. This evaluates the resolver once per member rather than once per number,
-- and each evaluation scans the company's `number_access` rows (indexed on
-- (company_id, phone_number_id)). For the crews this product is for — three to
-- ten people, a handful of rules — that is a few index scans on a path that
-- already reads the member list and then sends push notifications. Not worth a
-- second implementation to avoid.
--
-- A NULL number is the caller's business, not this function's: a conversation
-- with no number restricts nobody, and the Worker returns every member without
-- asking. Passing null here would return nobody, which is why the Worker's
-- early return stays.

create or replace function public.number_member_levels(p_phone_number_id uuid)
returns table (user_id uuid, role text, level text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    cm.user_id,
    cm.role,
    public.member_number_level(cm.user_id, p_phone_number_id)
  from public.company_members cm
  join public.phone_numbers pn on pn.id = p_phone_number_id
  where cm.company_id = pn.company_id
    and cm.deactivated_at is null;
$$;

comment on function public.number_member_levels(uuid) is
  '#480: every active member of the number''s company with their effective '
  'level. The #106 rule asked backwards, for the three paths that need it that '
  'way. Returns the LEVEL rather than a filtered list because the three want '
  'different cuts: the notification audience wants everyone not hidden, the ring '
  'and transfer paths want text only.';

revoke all on function public.number_member_levels(uuid)
  from public, anon, authenticated;
grant execute on function public.number_member_levels(uuid) to service_role;
