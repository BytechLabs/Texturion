-- #576 (1), second half — a password-only session cannot join a realtime topic
-- when its owner holds a second factor.
--
-- The first half (20260812100000) taught this predicate about revocation. The
-- issue asked for two things and that migration answered one: the topic gate
-- still admitted a session at `aal1` belonging to somebody who had enrolled a
-- factor, so a password-only login got the same live feed as a stepped-up one.
-- Every `/v1` call from that session is already refused — `api_authorize_request`
-- has consulted the posture since #496 — so the two halves of the same rule
-- disagreed, which is exactly the shape #236 and #581 were about.
--
-- ---------------------------------------------------------------------------
-- THE RULE IS #496's, NOT A NEW ONE.
--
-- Enrolment is the demand: a user who holds a VERIFIED factor must reach `aal2`,
-- regardless of any workspace policy. `user_has_verified_mfa` is that fact,
-- already written down, already indexed (`factor_id_created_at_idx` leads with
-- user_id), and already used on the hot path. Calling it here rather than
-- re-expressing it is the whole point — a rule spelled twice is a rule that
-- drifts, and this predicate is the third place it would have been spelled.
--
-- A user with NO factor is untouched. `aal1` is their normal, correct state and
-- refusing them would lock out most of the product to fix nothing.
--
-- ---------------------------------------------------------------------------
-- WHY THIS HALF FAILS CLOSED WHILE THE REVOCATION HALF FAILS OPEN.
--
-- A reader will notice the two clauses disagree about a missing claim, so:
--
--   session_id absent  -> ADMITTED. D66's decision. That claim is not carried by
--                         every token this system has ever issued, so treating
--                         its absence as revocation would sign out sessions
--                         nobody revoked.
--   aal absent         -> REFUSED, for a user with a factor. GoTrue puts `aal`
--                         on every access token it mints; `apps/api/src/auth/jwt.ts`
--                         reads it on every request and the whole step-up gate
--                         depends on it. A token reaching this function without
--                         one is not a token we issued, and the safe reading of
--                         an unsigned assurance is "not assured".
--
-- `is distinct from` rather than `<>`, deliberately: `NULL <> 'aal2'` is NULL,
-- which takes the false branch — the clause would admit precisely the tokens it
-- exists to refuse. That is #248's CL-13 in a new file, and it is why
-- `check-sql-null-blind.mjs` exists.
--
-- ---------------------------------------------------------------------------
-- `create or replace`, never drop-and-create: dropping a function hands the
-- replacement the default PUBLIC execute grant, which `anon` and `authenticated`
-- inherit. This body is unchanged apart from the new clause.
-- ---------------------------------------------------------------------------

create or replace function public.is_company_topic_member(topic_text text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- #581: the session that presented this token has not been revoked. An
    -- absent or unplaceable claim finds no row and is admitted (D66).
    not exists (
      select 1
      from public.user_sessions s
      where s.revoked_at is not null
        and s.session_id = substring(
              lower(auth.jwt() ->> 'session_id') from
              '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            )::uuid
    )
    -- #576: and it is as assured as its owner's enrolment demands.
    and not (
      public.user_has_verified_mfa(auth.uid())
      and (auth.jwt() ->> 'aal') is distinct from 'aal2'
    )
    and (
      exists (
        select 1
        from public.company_members cm
        where cm.user_id = auth.uid()
          and cm.deactivated_at is null
          and topic_text = 'company:' || cm.company_id::text
      )
      or exists (
        -- The number topic, and (#302) its `:presence` sibling. ONE anchored
        -- pattern decides both, and the uuid it extracts runs the same access
        -- test — so the two cannot drift apart into a topic that is readable but
        -- should not be.
        --
        -- Anchored end to end (`^…$`), which also tightens what came before: the
        -- old rule matched the prefix with LIKE and the tail with a regex, so
        -- nothing said the two had to be adjacent.
        select 1
        from public.company_members cm
        where cm.user_id = auth.uid()
          and cm.deactivated_at is null
          and topic_text ~* (
                '^company:' || cm.company_id::text ||
                ':number:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' ||
                '(:presence)?$'
              )
          and public.member_number_level(
                auth.uid(),
                (regexp_match(
                  topic_text,
                  ':number:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'
                ))[1]::uuid
              ) <> 'none'
      )
    );
$$;

comment on function public.is_company_topic_member(text) is
  'Realtime topic authorization. Admits company:{id}, company:{id}:number:{n} '
  '(D88) and company:{id}:number:{n}:presence (#302) — the last two share one '
  'access test so a presence topic can never outlive the number access it '
  'inherits. #581: a revoked session (user_sessions.revoked_at) is refused at '
  'join time, so revocation reaches realtime and not only /v1; an absent '
  'session_id claim is admitted, per D66. #576: a session at aal1 is refused '
  'when its owner holds a verified factor, mirroring the #496 rule the /v1 '
  'path already applies; an absent aal claim is refused for such a user, '
  'because GoTrue mints one on every token.';
