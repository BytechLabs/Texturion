-- #386 — email deliverability: suppression and the domain-level rates.
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/email_deliverability.test.sql
-- The whole suite runs in one transaction and ROLLS BACK.
--
-- The asymmetry that drives every case: suppressing too EAGERLY silences a
-- paying customer's crew over a full mailbox or a greylist, and they would
-- never know why their notifications stopped. Suppressing too LATE accumulates
-- bounces against our sending domain, which degrades delivery for every
-- customer at once. Both are bad; they are bad in different directions, and
-- the tests below pin the line between them.

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- ED-1. The webhook ledger admits Resend.
--       Without this the route's very first insert fails a CHECK and every
--       bounce is dropped on the floor — silently, since the ledger insert is
--       what the endpoint acks on.
-- ===========================================================================
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def
    from pg_constraint where conname = 'webhook_events_provider_check';

  if def is null then
    raise exception 'ED-1 FAILED: webhook_events_provider_check is gone';
  end if;
  if def not like '%resend%' then
    raise exception 'ED-1 FAILED: provider check does not admit resend: %', def;
  end if;
  if def not like '%stripe%' or def not like '%telnyx%' then
    raise exception 'ED-1 FAILED: widening the check dropped an existing provider: %', def;
  end if;

  raise notice 'ED-1 PASSED: the ledger takes resend alongside stripe and telnyx';
end $$;

-- ===========================================================================
-- ED-2. A PERMANENT bounce suppresses. A TRANSIENT one does not.
--
--       This is the load-bearing line in the whole feature. A transient bounce
--       is a full mailbox or a greylist — a bad week, not a dead address — and
--       suppressing on it would silence a real crew member permanently, with
--       no error anywhere and nothing for them to see.
-- ===========================================================================
do $$
declare r jsonb;
begin
  r := public.record_email_event('Transient@Example.COM', 'bounced', now(), 'Transient', 're_1', 'New text');
  if (r->>'suppressed')::boolean then
    raise exception 'ED-2 FAILED: a transient bounce suppressed the address';
  end if;
  if exists (select 1 from public.email_suppressions where email = 'transient@example.com') then
    raise exception 'ED-2 FAILED: a transient bounce wrote a suppression row';
  end if;

  r := public.record_email_event('Dead@Example.COM', 'bounced', now(), 'Permanent', 're_2', 'New text');
  if not (r->>'suppressed')::boolean then
    raise exception 'ED-2 FAILED: a permanent bounce did not suppress';
  end if;
  if (r->>'reason') is distinct from 'hard_bounce' then
    raise exception 'ED-2 FAILED: permanent bounce recorded reason %', r->>'reason';
  end if;

  -- Addresses are matched case-insensitively and trimmed, or the same mailbox
  -- typed two ways is two rows and the suppression silently misses.
  if not exists (select 1 from public.email_suppressions where email = 'dead@example.com') then
    raise exception 'ED-2 FAILED: the address was not normalised to lower case';
  end if;

  raise notice 'ED-2 PASSED: permanent bounces suppress, transient ones do not';
end $$;

-- ===========================================================================
-- ED-3. A complaint is permanent, outranks a bounce, and re-arms a cleared
--       row. Somebody who pressed "spam" does not get mail again because they
--       once fixed a typo — continuing to write to them is the fastest route
--       to a blocklist there is.
-- ===========================================================================
do $$
declare r jsonb; row_reason text; row_cleared timestamptz;
begin
  -- A hard bounce that the owner then cleared (the fixable case).
  perform public.record_email_event('mixed@example.com', 'bounced', now(), 'Permanent', 're_3', null);
  update public.email_suppressions set cleared_at = now() where email = 'mixed@example.com';

  -- Then they report us as spam.
  r := public.record_email_event('mixed@example.com', 'complained', now(), null, 're_4', null);
  if not (r->>'suppressed')::boolean then
    raise exception 'ED-3 FAILED: a complaint did not suppress';
  end if;

  select reason, cleared_at into row_reason, row_cleared
    from public.email_suppressions where email = 'mixed@example.com';
  if row_reason is distinct from 'complaint' then
    raise exception 'ED-3 FAILED: complaint did not outrank the bounce (reason %)', row_reason;
  end if;
  if row_cleared is not null then
    raise exception 'ED-3 FAILED: a complaint left the row cleared — we would keep mailing them';
  end if;

  raise notice 'ED-3 PASSED: a complaint is permanent and re-arms a cleared row';
end $$;

-- ===========================================================================
-- ED-4. api_email_suppression_state answers the member-facing question, and
--       distinguishes what they can fix from what they cannot.
-- ===========================================================================
do $$
declare s jsonb;
begin
  s := public.api_email_suppression_state('DEAD@example.com');
  if s is null then
    raise exception 'ED-4 FAILED: a suppressed address reported no state';
  end if;
  if (s->>'reason') is distinct from 'hard_bounce' or not (s->>'fixable')::boolean then
    raise exception 'ED-4 FAILED: a hard bounce should be fixable by its owner: %', s;
  end if;

  s := public.api_email_suppression_state('mixed@example.com');
  if (s->>'fixable')::boolean then
    raise exception 'ED-4 FAILED: a complaint was offered as fixable — it is not ours to undo';
  end if;

  -- A healthy address has nothing to say, and must not be reported as a
  -- problem: a false "we cannot reach you" banner is worse than none.
  if public.api_email_suppression_state('healthy@example.com') is not null then
    raise exception 'ED-4 FAILED: a healthy address reported a suppression state';
  end if;

  raise notice 'ED-4 PASSED: the member-facing state separates fixable from permanent';
end $$;

-- ===========================================================================
-- ED-5. api_email_health reports rates, and reports NULL rather than zero on
--       an empty window.
--
--       Zero would read as "perfectly healthy" on a day we sent nothing at
--       all, which is the same lie as a silent failure — and this whole
--       feature exists because that lie is expensive.
-- ===========================================================================
do $$
declare h jsonb;
begin
  delete from public.email_events;

  h := public.api_email_health(now(), 24);
  if (h->>'bounce_rate') is not null or (h->>'complaint_rate') is not null then
    raise exception 'ED-5 FAILED: an empty window reported a rate: %', h;
  end if;

  -- 8 delivered, 2 bounced → 20%.
  for i in 1..8 loop
    perform public.record_email_event(format('ok%s@example.com', i), 'delivered', now(), null, null, null);
  end loop;
  perform public.record_email_event('b1@example.com', 'bounced', now(), 'Permanent', null, null);
  perform public.record_email_event('b2@example.com', 'bounced', now(), 'Permanent', null, null);

  h := public.api_email_health(now(), 24);
  if (h->>'total')::int is distinct from 10 then
    raise exception 'ED-5 FAILED: total was %, expected 10', h->>'total';
  end if;
  if (h->>'bounce_rate')::numeric is distinct from 0.2 then
    raise exception 'ED-5 FAILED: bounce_rate was %, expected 0.2', h->>'bounce_rate';
  end if;

  -- Outside the window is outside the number.
  update public.email_events set occurred_at = now() - interval '3 days';
  h := public.api_email_health(now(), 24);
  if (h->>'total')::int is distinct from 0 then
    raise exception 'ED-5 FAILED: events outside the window were counted: %', h;
  end if;

  raise notice 'ED-5 PASSED: rates are windowed, and empty means null rather than healthy';
end $$;

-- ===========================================================================
-- ED-6. Grants and RLS. These tables hold every address the product has ever
--       written to, across every tenant. One company being able to enumerate
--       another's crew emails would be a cross-tenant leak of exactly the kind
--       #106 exists to prevent elsewhere.
-- ===========================================================================
do $$
declare bad text; n int;
begin
  select string_agg(format('%s→%s', p.proname, g.grantee), ', ') into bad
    from information_schema.role_routine_grants g
    join pg_proc p on p.proname = g.routine_name
   where g.routine_schema = 'public'
     and p.proname in ('record_email_event', 'api_email_health', 'api_email_suppression_state')
     and g.grantee in ('PUBLIC', 'anon', 'authenticated');
  if bad is not null then
    raise exception 'ED-6 FAILED: deliverability functions are reachable: %', bad;
  end if;

  select count(*) into n from pg_class
   where oid in ('public.email_events'::regclass, 'public.email_suppressions'::regclass)
     and relrowsecurity;
  if n is distinct from 2 then
    raise exception 'ED-6 FAILED: only % of 2 deliverability tables have RLS on', n;
  end if;

  raise notice 'ED-6 PASSED: the address ledger is service_role only, RLS on';
end $$;

-- ===========================================================================
-- ED-7. The member-facing clear: a hard bounce is theirs to fix, a complaint
--       is not. This is the one write in the feature a member can trigger, and
--       letting it clear a complaint would restart mail to somebody who
--       reported us as spam — the fastest route to a blocklist there is.
-- ===========================================================================
do $$
declare uid uuid := '38600000-0000-4000-8000-000000000001';
        uid2 uuid := '38600000-0000-4000-8000-000000000002';
        r jsonb; st jsonb;
begin
  insert into auth.users (id, email) values
    (uid,  'bouncer@deliver.test'),
    (uid2, 'complainer@deliver.test');

  perform public.record_email_event('bouncer@deliver.test', 'bounced', now(), 'Permanent', null, null);
  perform public.record_email_event('complainer@deliver.test', 'complained', now(), null, null, null);

  -- The signed-in member sees their own state, resolved from the verified id
  -- rather than from anything the request could name.
  st := public.api_user_email_state(uid);
  if st is null or (st->>'reason') is distinct from 'hard_bounce' or not (st->>'fixable')::boolean then
    raise exception 'ED-7 FAILED: bounced member state wrong: %', st;
  end if;

  r := public.api_clear_email_suppression(uid);
  if not (r->>'cleared')::boolean then
    raise exception 'ED-7 FAILED: a member could not clear their own hard bounce: %', r;
  end if;
  if public.api_user_email_state(uid) is not null then
    raise exception 'ED-7 FAILED: state persisted after clearing';
  end if;

  -- And the complaint cannot be cleared, by them or anybody.
  r := public.api_clear_email_suppression(uid2);
  if (r->>'cleared')::boolean then
    raise exception 'ED-7 FAILED: a complaint was cleared from the app';
  end if;
  if (r->>'reason') is distinct from 'complaint' then
    raise exception 'ED-7 FAILED: refusal did not name the reason: %', r;
  end if;

  -- Clearing nothing is a no-op rather than an error: they may have fixed it
  -- on another device a second earlier.
  r := public.api_clear_email_suppression(uid);
  if (r->>'cleared')::boolean or (r->>'reason') is distinct from 'not_suppressed' then
    raise exception 'ED-7 FAILED: clearing a healthy address was not a clean no-op: %', r;
  end if;

  raise notice 'ED-7 PASSED: a member fixes their own bounce and cannot undo a complaint';
end $$;

-- ===========================================================================
-- ED-8. api_email_delivery_state reports the LAST word about a message.
--       A delivered message can still be followed by a complaint, and the
--       complaint is the one a legal receipt has to reflect.
-- ===========================================================================
do $$
declare d jsonb;
begin
  perform public.record_email_event('receipt@deliver.test', 'delivered', now() - interval '2 hours', null, 're_legal', 'Your export');
  d := public.api_email_delivery_state('re_legal');
  if (d->>'event') is distinct from 'delivered' then
    raise exception 'ED-8 FAILED: delivery not reported: %', d;
  end if;

  perform public.record_email_event('receipt@deliver.test', 'complained', now(), null, 're_legal', 'Your export');
  d := public.api_email_delivery_state('re_legal');
  if (d->>'event') is distinct from 'complained' then
    raise exception 'ED-8 FAILED: the later event did not win: %', d;
  end if;

  -- No outcome yet is null, not a guess. An email sent four seconds ago has
  -- neither been delivered nor bounced.
  if public.api_email_delivery_state('re_never_seen') is not null then
    raise exception 'ED-8 FAILED: invented an outcome for an unseen message';
  end if;

  raise notice 'ED-8 PASSED: the last word wins, and no news is null';
end $$;

rollback;
