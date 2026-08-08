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

rollback;
