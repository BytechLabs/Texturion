-- #581 — `member_number_level` stops answering questions about other people.
--
-- The function takes a user id FROM ITS CALLER and was granted to
-- `authenticated`. Every signed-in browser holds a Supabase publishable key and
-- a session (`apps/web/src/lib/supabase/browser.ts`), so
-- `POST /rest/v1/rpc/member_number_level` with `p_user_id` set to a colleague's
-- id was one fetch away — and it is `security definer`, so it answers regardless
-- of RLS.
--
-- That reconstructs, one number at a time, precisely the lookup this repo
-- deliberately withheld. 20260730030000's own words about the plural: "it
-- enumerates a company's restricted numbers, which is not something an end-user
-- role needs to be able to ask for directly." A loop over `GET /v1/numbers`
-- rebuilds it from the singular, and what comes back is the access map of every
-- teammate — who is denied which line, at what level. In a product where the
-- deny list is how a crew keeps a domestic-abuse caller's thread away from most
-- of the office, that map is exactly what must not enumerate.
--
-- ---------------------------------------------------------------------------
-- THE GRANT WAS NEVER LOAD-BEARING, and the comment that justified it had the
-- call chain wrong.
--
-- 20260730110000 says: "The realtime topic policy calls the SINGULAR as
-- `authenticated`". It does not. The policies on `realtime.messages` call
-- `is_company_topic_member`, which is itself `security definer` — so inside it
-- every reference, `member_number_level` included, is privilege-checked against
-- the FUNCTION'S OWNER and not against the caller. Exactly the argument that
-- migration made one line later for why the plural needs no grant applies
-- unchanged to the singular; it just was not followed through.
--
-- `number_member_levels` reaches it the same way, and it is `security definer`
-- too. So nothing inside the database loses anything here.
--
-- ---------------------------------------------------------------------------
-- WHY REVOKED RATHER THAN PINNED TO auth.uid().
--
-- Answering only about `auth.uid()` was the other candidate, and it would break
-- both real callers while serving nobody. They are the Worker's, on the
-- service_role secret key, and both ask ABOUT SOMEBODY ELSE by design:
--
--   apps/api/src/calls/runtime.ts   resolveRingTargets — whose phone may ring
--   apps/api/src/routes/live-calls.ts  eligibleTarget — who a call may go to
--
-- A caller-scoped signature makes those two impossible and leaves the third
-- caller — a client — to justify the grant. There is no third caller: there is
-- not one `.rpc(` anywhere in apps/web, apps/android or apps/ios. Every client
-- reads access through `/v1`, where the Worker resolves it once per request
-- (`resolveNumberAccess`) and filters SQL-side.
--
-- So the honest fix is the boundary the plural already has: service_role only.
-- The signature keeps its caller-supplied user id, which is correct for a
-- service-role function and is the whole reason the plural was never handed out
-- either.
--
-- NO DROP/RECREATE. A bare `revoke` — the function keeps its oid, its
-- dependents, and its body, and cannot pick the default PUBLIC EXECUTE grant
-- back up on the way through. `member_number_level.test.sql` NL-7 asserts the
-- resulting `proacl` in both directions.

revoke all on function public.member_number_level(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.member_number_level(uuid, uuid) to service_role;

comment on function public.member_number_level(uuid, uuid) is
  '#480: one caller''s effective level for one number. A thin lookup into '
  'member_number_levels — it computes nothing, so the precedence rule has one '
  'home. Fails closed (none) for a null or unknown number. #581: service_role '
  'ONLY, like the plural — it takes the user id from its caller, so an '
  'authenticated grant let a member read a teammate''s access map over '
  'PostgREST. The realtime policies reach it through is_company_topic_member, '
  'which is security definer, so no end-user role needs the grant.';
