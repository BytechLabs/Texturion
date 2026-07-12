-- #135 (D43) hardening round 2: the fix-verification pass caught that
-- api_claim_ring_answer's winning UPDATE, guarded only by a lock-free
-- NOT EXISTS, is not atomic against TWO DISTINCT member legs answering the
-- same session concurrently (write-skew under READ COMMITTED — each txn's
-- snapshot misses the other's uncommitted 'answered', both pass the guard,
-- both return 'won', stranding the second member's leg). Its sibling
-- api_ring_leg_failed already took a per-session advisory lock in the prior
-- migration; api_claim_ring_answer needs the SAME lock as its first act so
-- the second leg's transaction blocks until the first commits, then sees the
-- committed 'answered' and correctly returns 'lost'.

create or replace function public.api_claim_ring_answer(
  p_call_session_id text,
  p_call_control_id text
) returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  -- Serialise the claim per session — the same lock api_ring_leg_failed uses —
  -- so two distinct legs answering concurrently can never both win.
  perform pg_advisory_xact_lock(hashtextextended(p_call_session_id, 0));

  select state into v_state
    from public.call_member_legs
   where call_session_id = p_call_session_id
     and call_control_id = p_call_control_id
     and kind = 'ring';
  if v_state is null then
    return 'lost';
  end if;
  if v_state = 'answered' then
    return 'already';
  end if;

  update public.call_member_legs
     set state = 'answered'
   where call_session_id = p_call_session_id
     and call_control_id = p_call_control_id
     and kind = 'ring'
     and state = 'ringing'
     and not exists (
       select 1 from public.call_member_legs w
        where w.call_session_id = p_call_session_id
          and w.kind = 'ring'
          and w.state = 'answered'
     );
  if found then
    return 'won';
  end if;
  return 'lost';
end;
$$;
revoke execute on function public.api_claim_ring_answer(text, text)
  from public, anon, authenticated;
grant execute on function public.api_claim_ring_answer(text, text)
  to service_role;
