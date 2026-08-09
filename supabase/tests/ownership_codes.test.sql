-- #537 — the one-time handover code.
--
-- This is the thing an attacker with a stolen session does not have, so every
-- property below is load-bearing: single use, expiry, an attempt ceiling, and a
-- scope that stops an offer code from accepting.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('c0de1111-0000-4000-8000-000000000001', 'code-owner@example.test')
  on conflict do nothing;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('c0de2222-0000-4000-8000-000000000002', 'Code Co',
        'c0de1111-0000-4000-8000-000000000001', 'US', '415', now());

-- 1. A fresh code is six digits, and it works exactly once.
do $$
declare v_code text; begin
  v_code := public.api_issue_ownership_code(
    'c0de2222-0000-4000-8000-000000000002',
    'c0de1111-0000-4000-8000-000000000001', 'offer');
  if v_code !~ '^[0-9]{6}$' then
    raise exception 'a code should be six digits, got %', v_code;
  end if;
  if not public.api_use_ownership_code(
       'c0de2222-0000-4000-8000-000000000002',
       'c0de1111-0000-4000-8000-000000000001', 'offer', v_code) then
    raise exception 'the right code was refused';
  end if;
  -- THE ONE THAT MATTERS MOST. A replayable code is not a second factor.
  if public.api_use_ownership_code(
       'c0de2222-0000-4000-8000-000000000002',
       'c0de1111-0000-4000-8000-000000000001', 'offer', v_code) then
    raise exception 'a spent code was accepted a second time';
  end if;
end $$;

-- 2. The plaintext is never stored. A table that can tell you somebody's code is
--    not a confirmation mechanism.
do $$
declare v_code text; v_hash text; begin
  v_code := public.api_issue_ownership_code(
    'c0de2222-0000-4000-8000-000000000002',
    'c0de1111-0000-4000-8000-000000000001', 'offer');
  select code_hash into v_hash from public.ownership_confirmations
   where company_id = 'c0de2222-0000-4000-8000-000000000002';
  if v_hash like '%' || v_code || '%' then
    raise exception 'the code is recoverable from the stored row';
  end if;
end $$;

-- 3. A wrong code is refused, and five wrong guesses kill it — even if the sixth
--    guess is right. Six digits is one-in-a-million per try; unbounded tries is
--    a million tries.
do $$
declare v_code text; i int; begin
  v_code := public.api_issue_ownership_code(
    'c0de2222-0000-4000-8000-000000000002',
    'c0de1111-0000-4000-8000-000000000001', 'claim');
  for i in 1..5 loop
    if public.api_use_ownership_code(
         'c0de2222-0000-4000-8000-000000000002',
         'c0de1111-0000-4000-8000-000000000001', 'claim', '000000') then
      raise exception 'a guess of 000000 was accepted on try %', i;
    end if;
  end loop;
  if public.api_use_ownership_code(
       'c0de2222-0000-4000-8000-000000000002',
       'c0de1111-0000-4000-8000-000000000001', 'claim', v_code) then
    raise exception 'the right code still worked after five wrong guesses';
  end if;
end $$;

-- 4. A code for one step cannot satisfy another. Offering and accepting are
--    opposite decisions made by different people.
do $$
declare v_code text; begin
  v_code := public.api_issue_ownership_code(
    'c0de2222-0000-4000-8000-000000000002',
    'c0de1111-0000-4000-8000-000000000001', 'offer');
  if public.api_use_ownership_code(
       'c0de2222-0000-4000-8000-000000000002',
       'c0de1111-0000-4000-8000-000000000001', 'accept', v_code) then
    raise exception 'an offer code was accepted for accept';
  end if;
end $$;

-- 5. An expired code is refused.
do $$
declare v_code text; begin
  v_code := public.api_issue_ownership_code(
    'c0de2222-0000-4000-8000-000000000002',
    'c0de1111-0000-4000-8000-000000000001', 'accept');
  update public.ownership_confirmations
     set expires_at = now() - interval '1 minute'
   where company_id = 'c0de2222-0000-4000-8000-000000000002'
     and action = 'accept';
  if public.api_use_ownership_code(
       'c0de2222-0000-4000-8000-000000000002',
       'c0de1111-0000-4000-8000-000000000001', 'accept', v_code) then
    raise exception 'an expired code was accepted';
  end if;
end $$;

-- 6. Asking again REPLACES the live code rather than adding one, so a flood of
--    requests cannot leave a pile of valid codes behind.
do $$
declare v_first text; v_second text; v_rows int; begin
  v_first := public.api_issue_ownership_code(
    'c0de2222-0000-4000-8000-000000000002',
    'c0de1111-0000-4000-8000-000000000001', 'offer');
  v_second := public.api_issue_ownership_code(
    'c0de2222-0000-4000-8000-000000000002',
    'c0de1111-0000-4000-8000-000000000001', 'offer');
  select count(*) into v_rows from public.ownership_confirmations
   where company_id = 'c0de2222-0000-4000-8000-000000000002'
     and action = 'offer';
  if v_rows is distinct from 1 then
    raise exception 'two live offer codes exist at once (% rows)', v_rows;
  end if;
  if v_first is distinct from v_second
     and public.api_use_ownership_code(
           'c0de2222-0000-4000-8000-000000000002',
           'c0de1111-0000-4000-8000-000000000001', 'offer', v_first) then
    raise exception 'the superseded code still worked';
  end if;
end $$;

-- 7. Guessing at a code nobody asked for is a miss, not an error. Somebody who
--    never requested one must get the same answer as somebody who guessed wrong.
do $$
begin
  if public.api_use_ownership_code(
       '00000000-0000-4000-8000-000000000999',
       'c0de1111-0000-4000-8000-000000000001', 'offer', '123456') then
    raise exception 'a code was accepted for a workspace with no row';
  end if;
end $$;

-- 8. The #537 AUDIT widened this beyond the handover: closing the workspace,
--    releasing a number, and lowering the crew's two-factor requirement are all
--    confirmable now. Each has to be ACCEPTED, or the gate on that route can never
--    be satisfied and the action becomes impossible.
do $$
declare v_code text; v_action text; begin
  foreach v_action in array array['close_workspace', 'release_number', 'relax_mfa']
  loop
    v_code := public.api_issue_ownership_code(
      'c0de2222-0000-4000-8000-000000000002',
      'c0de1111-0000-4000-8000-000000000001', v_action);
    if v_code is null or length(v_code) is distinct from 6 then
      raise exception 'no code was issued for %', v_action;
    end if;
    if not public.api_use_ownership_code(
         'c0de2222-0000-4000-8000-000000000002',
         'c0de1111-0000-4000-8000-000000000001', v_action, v_code) then
      raise exception 'a good code for % was refused', v_action;
    end if;
  end loop;
end $$;

-- 9. And the scoping still holds across the new set: a code minted to close the
--    business must not release a number. Opposite decisions, one of which is a
--    stolen code away from being the other.
do $$
declare v_code text; begin
  v_code := public.api_issue_ownership_code(
    'c0de2222-0000-4000-8000-000000000002',
    'c0de1111-0000-4000-8000-000000000001', 'close_workspace');
  if public.api_use_ownership_code(
       'c0de2222-0000-4000-8000-000000000002',
       'c0de1111-0000-4000-8000-000000000001', 'release_number', v_code) then
    raise exception 'a close-workspace code released a number';
  end if;
end $$;

-- 10. An action nobody defined is refused by the database, not silently stored.
--     The check constraint is what makes property 9 mean anything: an unconstrained
--     column would accept a typo as a brand-new scope that nothing can satisfy.
do $$
begin
  begin
    insert into public.ownership_confirmations
      (company_id, user_id, action, code_hash, expires_at)
    values ('c0de2222-0000-4000-8000-000000000002',
            'c0de1111-0000-4000-8000-000000000001',
            'sell_the_company', 'deadbeef', now() + interval '10 minutes');
    raise exception 'an undefined action was stored';
  exception when check_violation then
    null;
  end;
end $$;

-- 9 (#574). A REISSUE does not buy more guesses.
--
--    Test 3 above proves five guesses kill one code. It was the whole ceiling, and
--    a mint reset it: `api_issue_ownership_code` upserts `attempts = 0` on conflict,
--    and minting was unrestricted. So the real ceiling was five guesses per request
--    and requests were free — six digits against unlimited batches of five.
--
--    Ten failures inside a 24-hour window now refuse regardless of how many codes
--    were issued, and the counter is not something a mint can clear.
do $$
declare
  co    uuid := 'c0de2222-0000-4000-8000-000000000002';
  us    uuid := 'c0de1111-0000-4000-8000-000000000001';
  v_code text;
  i     int;
  round int;
begin
  -- Start clean: earlier blocks in this transaction have already spent guesses.
  delete from public.ownership_confirmations where company_id = co and user_id = us;

  -- Two rounds of five wrong guesses, with a fresh code minted in between. Before
  -- this fix the second round was as good as the first, forever.
  for round in 1..2 loop
    v_code := public.api_issue_ownership_code(co, us, 'claim');
    for i in 1..5 loop
      if public.api_use_ownership_code(co, us, 'claim', '000000') then
        raise exception 'a guess of 000000 was accepted (round %, try %)', round, i;
      end if;
    end loop;
  end loop;

  -- Ten failures are on the board. A fresh code must now be refused even when the
  -- guess is RIGHT — which is the property the old ceiling lost at every reissue.
  v_code := public.api_issue_ownership_code(co, us, 'claim');
  if public.api_use_ownership_code(co, us, 'claim', v_code) then
    raise exception
      'the right code worked after ten failures across two reissues — the ceiling '
      'still resets when a code is reissued';
  end if;

  -- And the counter is genuinely the thing refusing, not the per-code attempts:
  -- that code was freshly minted, so its own `attempts` is 0.
  if (select attempts from public.ownership_confirmations
       where company_id = co and user_id = us and action = 'claim') is distinct from 1
  then
    raise exception 'expected the fresh code to have exactly one recorded attempt';
  end if;
  if (select failed_total from public.ownership_confirmations
       where company_id = co and user_id = us and action = 'claim') < 10 then
    raise exception 'failed_total did not survive the reissues';
  end if;
end $$;

-- 10 (#574). The window reopens, so a fumbling owner is not locked out for ever.
--
--     A permanent lock would be worse than the bug for the person it protects: the
--     owner IS the party confirming, so there is nobody above them to appeal to.
do $$
declare
  co    uuid := 'c0de2222-0000-4000-8000-000000000002';
  us    uuid := 'c0de1111-0000-4000-8000-000000000001';
  v_code text;
begin
  -- Age the window past 24 hours, the way tomorrow would.
  update public.ownership_confirmations
     set window_started_at = now() - interval '25 hours'
   where company_id = co and user_id = us and action = 'claim';

  v_code := public.api_issue_ownership_code(co, us, 'claim');
  if not public.api_use_ownership_code(co, us, 'claim', v_code) then
    raise exception 'the window never reopens — a fumbled code locks an owner out';
  end if;

  -- A success clears the window, so a later handover step does not inherit it.
  if (select coalesce(failed_total, 0) from public.ownership_confirmations
       where company_id = co and user_id = us and action = 'claim') is distinct from 0
  then
    raise exception 'a successful use did not clear the failure window';
  end if;
end $$;

rollback;
