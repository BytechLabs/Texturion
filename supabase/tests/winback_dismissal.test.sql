-- #277 follow-up — the dismissal, and the one property it exists for.
--
-- The suppression rule is not a column, it is a COMPARISON:
--
--     show the offer while  canceled_at is not null
--                     and  (winback_dismissed_at is null
--                            or winback_dismissed_at < canceled_at)
--
-- and everything that can go wrong with it goes wrong in the database rather
-- than in TypeScript. The cheap wrong version — a boolean `winback_dismissed` —
-- passes every unit test on the day it ships and fails silently a year later,
-- when a returning customer cancels a second time and is met with silence
-- because of a button they pressed about a different cancellation. That defect
-- is only observable in what the rows hold across a resubscribe, which is what
-- this suite reproduces.

begin;

do $$
declare
  v_owner   uuid;
  v_company uuid;
  v_first   timestamptz := '2026-03-01T00:00:00Z';
  v_second  timestamptz := '2027-01-04T00:00:00Z';
  v_visible boolean;
  v_reason  text;
  v_count   int;
begin
  insert into auth.users (id, email)
  values (gen_random_uuid(), 'winback-test@example.com')
  returning id into v_owner;

  insert into public.companies
    (name, owner_user_id, country, requested_area_code, aup_accepted_at)
  values ('Winback Test Co', v_owner, 'US', '512', now())
  returning id into v_company;

  -- W-1: nobody has dismissed anything. A default of now() here would mean
  -- every workspace in the table has already declined an offer it never saw.
  select winback_dismissed_at is null into v_visible
    from public.companies where id = v_company;
  if v_visible is distinct from true then
    raise exception 'W-1 FAILED: winback_dismissed_at defaulted to a value, so '
      'every existing workspace reads as having already dismissed the offer';
  end if;
  raise notice 'W-1 PASSED: a workspace has dismissed nothing until it does';

  -- The first cancellation.
  update public.companies
     set subscription_status = 'canceled', canceled_at = v_first
   where id = v_company;

  select (canceled_at is not null
          and (winback_dismissed_at is null or winback_dismissed_at < canceled_at))
    into v_visible from public.companies where id = v_company;
  if v_visible is distinct from true then
    raise exception 'W-2 FAILED: the offer is hidden on a fresh cancellation';
  end if;
  raise notice 'W-2 PASSED: a fresh cancellation shows the offer';

  -- W-3: dismissing hides it, and keeps hiding it. This is the part a boolean
  -- also gets right, which is exactly why it is not the interesting case.
  update public.companies
     set winback_dismissed_at = v_first + interval '2 days'
   where id = v_company;

  select (canceled_at is not null
          and (winback_dismissed_at is null or winback_dismissed_at < canceled_at))
    into v_visible from public.companies where id = v_company;
  if v_visible is distinct from false then
    raise exception 'W-3 FAILED: the offer survived being dismissed';
  end if;
  raise notice 'W-3 PASSED: a dismissal hides the offer for this cancellation';

  -- W-4: THE PROPERTY THIS SHAPE EXISTS FOR. Resubscribe, then cancel again a
  -- year later, and the offer comes back — with nothing clearing the dismissal.
  -- The checkout activation claim nulls canceled_at, so a second cancellation
  -- stamps a canceled_at LATER than the old dismissal and the comparison flips
  -- by itself. A boolean fails here, silently, and only in production.
  update public.companies
     set subscription_status = 'active', canceled_at = null
   where id = v_company;
  update public.companies
     set subscription_status = 'canceled', canceled_at = v_second
   where id = v_company;

  select (canceled_at is not null
          and (winback_dismissed_at is null or winback_dismissed_at < canceled_at))
    into v_visible from public.companies where id = v_company;
  if v_visible is distinct from true then
    raise exception 'W-4 FAILED: a SECOND cancellation is still silenced by a '
      'dismissal made about the first one, a year earlier';
  end if;
  -- And the stale dismissal is genuinely still sitting there: the property is
  -- that nothing had to clean it up, not that something did.
  select count(*) into v_count from public.companies
   where id = v_company and winback_dismissed_at = v_first + interval '2 days';
  if v_count is distinct from 1 then
    raise exception 'W-4 FAILED: the old dismissal was cleared by something, so '
      'this suite is no longer testing the self-ageing property';
  end if;
  raise notice 'W-4 PASSED: a later cancellation revives the offer with nothing to clear';

  -- W-5: while there is no cancellation at all, there is no offer, whatever the
  -- dismissal says. The route stamps unconditionally on purpose, so a stamp with
  -- no cancellation behind it must be inert rather than load-bearing.
  update public.companies
     set subscription_status = 'active', canceled_at = null
   where id = v_company;
  select (canceled_at is not null
          and (winback_dismissed_at is null or winback_dismissed_at < canceled_at))
    into v_visible from public.companies where id = v_company;
  if v_visible is distinct from false then
    raise exception 'W-5 FAILED: an active workspace is being offered a win-back';
  end if;
  raise notice 'W-5 PASSED: no cancellation means no offer, whatever was dismissed';

  -- W-6: the column takes null again, so "I dismissed that by accident" stays
  -- expressible. A NOT NULL would make a misclick permanent for that
  -- cancellation, with support as the only way back.
  update public.companies set winback_dismissed_at = null where id = v_company;
  raise notice 'W-6 PASSED: a dismissal can be undone';
end $$;

-- W-7: the reason the grace card reads is the OPEN one, and there is at most
-- one. The partial unique index is what makes that true, and the card would
-- otherwise answer a reason from a cancellation that ended years ago.
do $$
declare
  v_owner   uuid;
  v_company uuid;
  v_reason  text;
  v_count   int;
begin
  insert into auth.users (id, email)
  values (gen_random_uuid(), 'winback-reason@example.com')
  returning id into v_owner;

  insert into public.companies
    (name, owner_user_id, country, requested_area_code, aup_accepted_at)
  values ('Winback Reason Co', v_owner, 'US', '512', now())
  returning id into v_company;

  -- A cancellation from long ago that actually completed.
  insert into public.cancellation_reasons (company_id, reason, confirmed_at)
  values (v_company, 'switched', now() - interval '400 days');

  -- And the one happening now, still open.
  insert into public.cancellation_reasons (company_id, reason)
  values (v_company, 'seasonal');

  select reason into v_reason
    from public.cancellation_reasons
   where company_id = v_company and confirmed_at is null;
  if v_reason is distinct from 'seasonal' then
    raise exception 'W-7 FAILED: the open reason read as %, so the card would '
      'answer a cancellation that finished a year ago', v_reason;
  end if;

  select count(*) into v_count
    from public.cancellation_reasons
   where company_id = v_company and confirmed_at is null;
  if v_count is distinct from 1 then
    raise exception 'W-7 FAILED: % open statements exist, so "the" reason is '
      'ambiguous and the card would answer whichever row came back first',
      v_count;
  end if;
  raise notice 'W-7 PASSED: exactly one open reason, and it is the current one';

  -- W-8: and a confirmed row can never block a new open one, which is what
  -- makes the grace card work on a SECOND cancellation.
  update public.cancellation_reasons
     set confirmed_at = now()
   where company_id = v_company and confirmed_at is null;
  insert into public.cancellation_reasons (company_id, reason)
  values (v_company, 'too_expensive');
  select reason into v_reason
    from public.cancellation_reasons
   where company_id = v_company and confirmed_at is null;
  if v_reason is distinct from 'too_expensive' then
    raise exception 'W-8 FAILED: a new open statement read as %', v_reason;
  end if;
  raise notice 'W-8 PASSED: a confirmed statement never blocks the next one';
end $$;

rollback;
