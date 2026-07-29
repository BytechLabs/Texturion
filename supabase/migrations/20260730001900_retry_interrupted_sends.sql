-- #411 — retry the one send we can PROVE never reached the carrier.
--
-- Automatic retry of a text is genuinely dangerous, and the conservative
-- default was right. If we retry a send that actually succeeded and we simply
-- did not hear the response, the customer gets the same message twice — and
-- for a business texting its customers, double-sending is worse than
-- late-sending. It erodes trust in the tool immediately.
--
-- But there is exactly one case where that risk does not exist, and it is the
-- case this codebase already detects. STUCK is DEFINED as a send that crashed
-- BETWEEN the gate insert and the Telnyx call: `status='queued'`, no
-- `telnyx_message_id`, older than the safety window. By that definition Telnyx
-- was never reached and nothing was sent, so a retry cannot duplicate
-- anything, because there is nothing to duplicate.
--
-- That is the case we were failing out. It is the only retry we can perform
-- with a proof of safety, and we were declining to take it.
--
-- ---------------------------------------------------------------------------
-- WHY IT IS BOUNDED, AND WHY THE BOUND IS ONE.
--
-- A sweeper that retries without a ceiling turns a permanently-failing send
-- into a loop that runs every five minutes forever. One automatic attempt is
-- enough for the failure this addresses — a Worker that died mid-dispatch, a
-- transient partition — and anything that survives it is not transient.
--
-- The counter lives on the row rather than in the sweeper because the sweeper
-- has no memory between runs, and because "was this retried for you already"
-- is a question worth being able to answer afterwards.

alter table public.messages
  add column if not exists auto_retry_count smallint not null default 0;

comment on column public.messages.auto_retry_count is
  '#411: how many times the stuck-send sweeper has re-dispatched this row on '
  'its own. Bounded — see AUTO_RETRY_LIMIT. Only ever non-zero for a send '
  'that provably never reached the carrier.';

/**
 * Claim stuck sends for ONE automatic retry.
 *
 * Bumping the counter IS the claim, in the same statement that selects the
 * rows: two sweeper runs overlapping cannot both take the same message,
 * because the second one's `auto_retry_count < p_max_attempts` predicate no
 * longer holds by the time it reads.
 *
 * Rows already at the ceiling are deliberately NOT returned — they are left
 * for `fail_stuck_outbound_sends`, which runs in the same sweep and is the
 * unchanged fall-through this issue asks to preserve.
 *
 * ONE INTERACTION WORTH KNOWING, because it is not visible from here. The
 * `set_updated_at` trigger fires on this UPDATE, so bumping the counter also
 * refreshes `updated_at` and the row stops being "stuck" for another safety
 * window. That is the behaviour we want and it is load-bearing:
 *
 *   - if the retry dispatches, the row gets its telnyx_message_id and leaves
 *     the stuck predicate for good;
 *   - if the retry FAILS at Telnyx, dispatchOutbound writes status='failed' on
 *     the row immediately, so it never comes back here either;
 *   - and if the Worker dies AGAIN mid-retry, the row sits queued until the
 *     window passes, by which point `auto_retry_count` has reached the ceiling
 *     and `fail_stuck_outbound_sends` — not this function — takes it.
 *
 * So a message can be re-dispatched at most once automatically, and always
 * ends either sent or failed. Never queued forever, which was the state this
 * whole mechanism exists to prevent.
 */
create or replace function public.claim_stuck_sends_for_retry(
  p_stuck_after_seconds integer,
  p_max_attempts        integer,
  p_limit               integer
) returns table (
  id              uuid,
  company_id      uuid,
  conversation_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_stuck_after_seconds is null or p_stuck_after_seconds < 1 then
    raise exception 'claim_stuck_sends_for_retry: p_stuck_after_seconds must be positive';
  end if;
  if p_max_attempts is null or p_max_attempts < 1 then
    raise exception 'claim_stuck_sends_for_retry: p_max_attempts must be positive';
  end if;

  return query
  with claimed as (
    select m.id
      from public.messages m
     where m.direction = 'outbound'
       and m.status = 'queued'
       and m.telnyx_message_id is null
       and m.auto_retry_count < p_max_attempts
       and m.updated_at < now() - make_interval(secs => p_stuck_after_seconds)
     order by m.updated_at
     limit greatest(coalesce(p_limit, 50), 0)
     -- Another sweeper holding these rows means they are already being
     -- retried; skipping is correct, not a loss.
     for update skip locked
  )
  update public.messages m
     set auto_retry_count = m.auto_retry_count + 1
    from claimed
   where m.id = claimed.id
  returning m.id, m.company_id, m.conversation_id;
end;
$$;

revoke all on function public.claim_stuck_sends_for_retry(integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_stuck_sends_for_retry(integer, integer, integer)
  to service_role;
