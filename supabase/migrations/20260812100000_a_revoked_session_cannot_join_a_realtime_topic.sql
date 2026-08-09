-- #581 — a revoked session cannot join a realtime topic.
--
-- `is_company_topic_member` is the SOLE gate on every realtime topic: all three
-- policies on `realtime.messages` (`company_topic_read`, and #302's
-- `presence_topic_read` / `presence_topic_write`) call nothing else. It tested
-- for a non-deactivated `company_members` row and never once consulted
-- `user_sessions.revoked_at` — the table D66 built so that revocation lands "on
-- the request, not waited out on the token".
--
-- So the two halves of #236 disagreed. After a successful revoke that device's
-- unexpired access token still authorized `phx_join` — including BRAND-NEW joins
-- opened after the revoke — while every `/v1` call 401'd and its push
-- registrations were already deleted. The owner had been told the device was
-- off. It could also WRITE: `presence_topic_write` is the one client-writable
-- policy in the system, so a revoked handset could still announce itself as
-- present on a customer's conversation.
--
-- ---------------------------------------------------------------------------
-- AN ABSENT CLAIM IS ADMITTED, and that is D66's rule rather than a shortcut.
--
-- D66: "`session_id` lives inside the signed access token, so a caller cannot
-- remove it to skip the check — its absence only ever means a token minted
-- before GoTrue emitted the claim. That is why an absent claim is admitted
-- rather than rejected: failing those closed would sign out every existing
-- customer to defend against something nobody can do."
--
-- `api_authorize_request` encodes exactly that (`if p_session_id is not null`),
-- and this gate must not be stricter than the request path it is catching up
-- with — a realtime topic that refused what `/v1` admits would be a silent
-- outage for every un-refreshed token, which is the failure #480 warns about in
-- the other direction.
--
-- THE LOOKUP IS BY session_id ALONE, not by (user_id, session_id), for the same
-- reason `api_authorize_request` is: the claim is inside a signed token, so it
-- cannot name a session its bearer does not hold, and a revoked row found under
-- any user is a refusal either way. Matching the request path exactly is worth
-- more here than a redundant predicate — two spellings of one security question
-- is the drift class D79 exists to prevent.
--
-- WHY THE CLAIM IS EXTRACTED BY PATTERN RATHER THAN CAST. A cast of arbitrary
-- text to uuid RAISES, and this function runs inside an RLS predicate, where a
-- database error is a worse failure than a refusal and a much noisier one — the
-- reasoning already written down for the topic's own uuid.
--
-- So this borrows the technique the topic uuid already uses, which is NULL rather
-- than an `and`-ordered guard: `regexp_match(...)[1]` there and
-- `substring(... from <anchored pattern>)` here both yield NULL when the text does
-- not match, so each cast is null-safe by construction. It does not matter which
-- qual the planner reaches first, and `and` promises nothing about that.
-- `s.session_id = null` then finds no row.
--
-- `lower()` first because the pattern reuses the same lowercase hex class as the
-- topic rule below it, and GoTrue's claim is canonical — a hex class that
-- disagreed with the claim's case would silently turn every revocation back into
-- an admission, which is the one failure here that looks like success.
--
-- A malformed claim therefore lands where an absent one does: admitted. Both
-- mean "this token names no session I can place", and per D66 that must not be
-- a lockout.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES NOT CLOSE, stated here because it belongs next to the fix.
--
-- Realtime authorization is a JOIN-TIME handshake. A channel that was already
-- joined when the revoke landed is not re-authorized, and it will not be:
-- re-authorization happens when a refreshed JWT is pushed down the socket, and a
-- revoked session cannot refresh (`api_revoke_sessions` deletes the GoTrue row).
-- So a device that was already listening keeps receiving events on that channel
-- until its socket drops or its access token expires — a residual window of up
-- to the access-token lifetime.
--
-- What changes is the part that was indefensible: a revoked device can no longer
-- open a NEW subscription, cannot re-join after any reconnect, and cannot write
-- presence. The remainder needs an entry in docs/ACCEPTED-RISKS.md, which is not
-- in this change's scope to edit — it is called out in the #581 report instead so
-- it is not lost.
--
-- ---------------------------------------------------------------------------
-- Definition extracted verbatim from 20260731010000_presence_topic.sql with one
-- insertion (the `not exists` gate) and the two existing `exists` blocks
-- re-indented by two spaces, because an `and` over an `or` chain needs the
-- parentheses. Zero removed lines; nothing inside either block changed.
-- `create or replace` preserves the existing ACL, so no grant is restated —
-- `presence_topic.test.sql` PT-7 asserts `proacl` rather than trusting that.

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
  'session_id claim is admitted, per D66.';
