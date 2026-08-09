-- #573 / #545 — signing a device out stops its softphone too.
--
-- `api_revoke_sessions` ended the API session, deleted the device's push token and
-- deleted the GoTrue session and refresh tokens — and never touched the member's
-- Telnyx telephony credential. That credential is durable (no `expires_at`), and
-- the login token minted from it stays valid, so a handset that had already
-- registered kept ringing and could ANSWER a customer as the business after being
-- signed out. It is the one control that exists for a lost phone.
--
-- ## The decision this encodes: per MEMBER, not per device
--
-- A push token is addressed per device, so revocation deletes exactly the one that
-- was signed out — the existing comment says why that matters ("sign out my old
-- tablet" must not unsubscribe the laptop in front of them).
--
-- A telephony credential cannot work that way. There is one per membership, and its
-- `sip_username` IS the member's inbound ring target: `resolveRingTargets`
-- (apps/api/src/calls/runtime.ts) maps exactly one per member and fans an inbound
-- call out to those addresses. Making it per device would multiply the dial legs of
-- every incoming call by however many devices each person carries — a change to how
-- ringing works and what it costs, arriving as a side effect of a security fix.
--
-- So the credential is swept for the whole person. "Sign this device out" therefore
-- ends voice on that person's other devices too, until each re-proves itself. That
-- is a real cost and it is the right trade: the scenario this control exists for is
-- a handset somebody else is holding.
--
-- It is also self-healing rather than an outage. A client whose token dies gets an
-- SDK error and runs its own recovery, which re-mints a token and re-registers
-- within seconds — `SoftphoneCore.scheduleRecover` on Android, with twins on the
-- other two clients. A signed-out device cannot re-mint, because minting needs a
-- live session. Healing for everyone else, permanent for the device that was
-- revoked.
--
-- The Telnyx-side delete is the API's job (SQL cannot make an HTTP call), so the
-- ids are returned rather than merely counted — a failure there should name the
-- credential, not a number.
--
-- Body extracted verbatim from 20260729000100_active_sessions.sql with three
-- insertions, all marked #573; diffed against the original with zero removed lines.
-- `create or replace` preserves the existing ACL, so no grant is restated.

create or replace function public.api_revoke_sessions(
  p_user_id     uuid,
  p_session_ids uuid[] default null,
  p_except      uuid   default null,
  p_actor       uuid   default null,
  p_reason      text   default 'self'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_targets uuid[];
  v_devices int := 0;
  v_subs    int := 0;
  -- #573: the Telnyx credential ids this revocation orphaned. Returned so the
  -- API can delete them at Telnyx — SQL cannot make that call.
  v_voice   text[] := '{}';
  v_n       int := 0;
  v_whole   boolean := (p_session_ids is null and p_except is null);
begin
  if p_user_id is null then
    raise exception 'api_revoke_sessions: p_user_id is required';
  end if;

  -- Resolve targets against OUR table first, so a caller can only ever revoke
  -- sessions belonging to the user they named.
  select coalesce(array_agg(s.session_id), '{}'::uuid[])
    into v_targets
    from public.user_sessions s
   where s.user_id = p_user_id
     and s.revoked_at is null
     and (p_session_ids is null or s.session_id = any(p_session_ids))
     and (p_except is null or s.session_id <> p_except);

  -- A session GoTrue knows about that we have never seen (minted before this
  -- shipped, never used since) still has to die on a sign-out-everywhere.
  -- Adopt those rows so the mark lands on them too.
  if p_session_ids is null then
    insert into public.user_sessions (session_id, user_id, client, user_agent, first_seen_at, last_seen_at)
    select a.id, a.user_id, 'unknown', a.user_agent, a.created_at, coalesce(a.refreshed_at, a.created_at)
      from auth.sessions a
     where a.user_id = p_user_id
       and (p_except is null or a.id <> p_except)
       and not exists (select 1 from public.user_sessions s where s.session_id = a.id)
    on conflict (session_id) do nothing;

    select coalesce(array_agg(s.session_id), '{}'::uuid[])
      into v_targets
      from public.user_sessions s
     where s.user_id = p_user_id
       and s.revoked_at is null
       and (p_except is null or s.session_id <> p_except);
  end if;

  if array_length(v_targets, 1) is null then
    return jsonb_build_object('sessions', 0, 'devices', 0);
  end if;

  update public.user_sessions s
     set revoked_at = now(), revoked_by = p_actor, revoke_reason = p_reason
   where s.session_id = any(v_targets);
  get diagnostics v_n = row_count;

  -- The device stops being reachable. Legacy rows with no session_id are only
  -- swept when the whole person is being revoked — otherwise "sign out my old
  -- tablet" would silently unsubscribe the laptop in front of them.
  with gone as (
    delete from public.device_push_tokens d
     where d.session_id = any(v_targets)
        or (v_whole and d.user_id = p_user_id)
    returning 1
  ) select count(*) into v_devices from gone;
  with gone as (
    delete from public.push_subscriptions p
     where p.session_id = any(v_targets)
        or (v_whole and p.user_id = p_user_id)
    returning 1
  ) select count(*) into v_subs from gone;

  -- #573: and the softphone stops ringing.
  --
  -- Unlike a push token this is NOT session-keyed and cannot be: one credential
  -- per membership, whose `sip_username` IS the member's inbound ring target
  -- (calls/runtime.ts resolveRingTargets maps one per member). Per-device
  -- credentials would mean fanning every inbound call out to N legs per person.
  --
  -- So this sweeps the member rather than the device, which is a DIFFERENT rule
  -- from the push sweep above and deliberately so. The push comment explains why
  -- it stays per-device — "sign out my old tablet" must not unsubscribe the laptop
  -- in front of them — and that reasoning does not carry here, because there is no
  -- per-device credential to delete. Signing one device out therefore ends voice
  -- on all of that person's devices until each re-proves itself.
  --
  -- The cost is bounded and self-healing: a client whose token dies raises an SDK
  -- error and calls its own recover path, which re-mints and re-registers within
  -- seconds (SoftphoneCore's scheduleRecover). A device that no longer has a
  -- session cannot re-mint, which is the entire point.
  with gone as (
    delete from public.member_telephony_credentials m
     where m.user_id = p_user_id
    returning m.telnyx_credential_id
  ) select coalesce(array_agg(telnyx_credential_id), '{}') into v_voice from gone;

  delete from auth.sessions a where a.id = any(v_targets);
  -- refresh_tokens cascade from sessions in GoTrue's schema; delete them
  -- explicitly too, since older rows can predate the session FK (those carry
  -- no session_id, so they are only reachable when the whole person is being
  -- revoked — never when one device is).
  delete from auth.refresh_tokens r
   where r.user_id = p_user_id::text
     and ((v_whole and r.session_id is null)
          or r.session_id = any(v_targets));

  return jsonb_build_object(
    'sessions', v_n,
    'devices', v_devices + v_subs,
    -- #573: the caller deletes these at Telnyx. Returned rather than counted so a
    -- failure there names the credential instead of a number.
    'voice_credentials', to_jsonb(v_voice)
  );
end $$;
