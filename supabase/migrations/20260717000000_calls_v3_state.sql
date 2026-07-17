-- Calls v3 (#170, docs/CALLS-V3.md §12.1 step 1) — the granular inbound-call
-- state column the CallSessionDO is the sole writer of, plus the two named
-- non-DO backstops (§7.6) and the additive read/broadcast extensions.
--
--   1. calls.state (text, NULLABLE per §3): the granular truth the DO mirrors
--      on every transition. NULL means "legacy or outbound" — every inbound
--      row is minted by api_claim_inbound_line with state NULL and mirrored
--      non-null only when T1 completes; every outbound row is NULL forever.
--      The CHECK permits NULL (§3 nullability — binding for every reader).
--   2. Backfill: historical rows stamped once from outcome/answered_at.
--   3. broadcast_call_change payload extended (§9.1) — additive: state,
--      answered_by_user_id, call_session_id. Still no PII (D44 bent only for
--      the state string + ids, deliberately).
--   4. api_list_calls projection gains state (§8.4, additive, nullable).
--   5. api_sweep_stale_calls also stamps state='ended_missed' where it flips
--      outcome (§7.6 — the 4h dead-DO last resort; the DO's own T16 janitor
--      fires first).
--
-- The legacy ring RPCs (api_claim_ring_answer / api_ring_leg_failed) are NOT
-- dropped here — that migration ships ONLY with the change that deletes the
-- kill switch (§12.1 step 5), never before it.

-- 1. The state column. NULLABLE by design; the CHECK permits NULL (§3).
alter table public.calls
  add column if not exists state text
  check (state is null or state in (
    'ringing', 'answered', 'voicemail_greeting', 'voicemail_recording',
    'ended_answered', 'ended_voicemail', 'ended_missed', 'ended_rejected'
  ));

-- 2. Backfill historical rows once (§7.6 migration backstop). Terminal rows
--    map from outcome; live inbound rows from answered_at; outbound rows and
--    rows with no signal stay NULL (derive-from-outcome at read time, §8.1).
update public.calls set state = case
    when outcome = 'answered'  then 'ended_answered'
    when outcome = 'voicemail' then 'ended_voicemail'
    when outcome = 'missed'    then 'ended_missed'
    when outcome is null and direction = 'inbound' and answered_at is not null
      then 'answered'
    when outcome is null and direction = 'inbound'
      then 'ringing'
    else null
  end
  where state is null;

-- Optional partial index for the line-busy scan (§3/§12.1): it EXCLUDES NULL
-- rows, so it must never replace the outcome-null scan as primary — it is only
-- a covering accelerator for the DO's own non-terminal lookups.
create index if not exists calls_live_state_idx
  on public.calls (phone_number_id)
  where state is not null and state not like 'ended%';

-- 3. Extend the company-topic broadcast (§9.1) — additive fields only. The
--    call_session_id disclosure to all members (incl. #106-hidden ones) is
--    acceptable ONLY because the §7.7 pending-record gate means a bare session
--    id buys an attacker nothing (review R2-m5).
create or replace function public.broadcast_call_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(
    jsonb_build_object('call_id', new.id,
                       'conversation_id', new.conversation_id,
                       'call_session_id', new.call_session_id,
                       'state', new.state,
                       'answered_by_user_id', new.answered_by_user_id),
    'call.updated', 'company:' || new.company_id::text, true);
  return null;
end $$;

-- 4. api_list_calls gains state in its projection (additive, nullable).
create or replace function public.api_list_calls(
  p_company_id         uuid,
  p_limit              int,
  p_outcome            text default null,
  p_cursor_ts          timestamptz default null,
  p_cursor_id          uuid default null,
  p_hidden_number_ids  uuid[] default null
) returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'call_session_id', c.call_session_id,
    'caller_e164', c.caller_e164,
    'contact_id', c.contact_id,
    'contact_name', ct.name,
    'caller_name', c.caller_name,
    'phone_number_id', c.phone_number_id,
    'conversation_id', c.conversation_id,
    'outcome', c.outcome,
    'state', c.state,
    'direction', c.direction,
    'forward_seconds', c.forward_seconds,
    'screening_result', c.screening_result,
    'stir_attestation', c.stir_attestation,
    'voicemail_seconds', c.voicemail_seconds,
    'answered_by_user_id', c.answered_by_user_id,
    'started_at', c.started_at
  )
  from public.calls c
  left join public.contacts ct on ct.id = c.contact_id
  where c.company_id = p_company_id
    and (p_outcome is null or c.outcome = p_outcome)
    and (p_hidden_number_ids is null
         or c.phone_number_id is null
         or not (c.phone_number_id = any (p_hidden_number_ids)))
    and (p_cursor_ts is null
         or (c.started_at, c.id) < (p_cursor_ts, p_cursor_id))
  order by c.started_at desc, c.id desc
  limit greatest(p_limit, 0)
$$;

-- 5. The 4h stale sweeper also stamps state (§7.6) where it flips outcome. It
--    stamps outbound stale rows with the same inbound-vocabulary label — a
--    documented cosmetic consistency with today's outcome flip (nobody should
--    "fix" it into a new enum).
create or replace function public.api_sweep_stale_calls(
  p_stale_before timestamptz default null
) returns int
language sql
volatile
security definer
set search_path = ''
as $$
  with swept as (
    update public.calls
       set outcome = 'missed',
           state   = 'ended_missed'
     where outcome is null
       and started_at < coalesce(p_stale_before, now() - interval '4 hours')
    returning 1
  )
  select count(*)::int from swept
$$;

-- §9.2 / §8.5.4: the caps field on the per-user push channel tables. The v3
-- client writes ["call_end"] at (re)registration; the DO sends the call_end
-- revocation push ONLY to rows declaring the capability (no un-updated
-- subscription ever receives one — the fleet-ghost gate, review R2-B1).
alter table public.push_subscriptions
  add column if not exists caps text[] not null default '{}';
alter table public.device_push_tokens
  add column if not exists caps text[] not null default '{}';
