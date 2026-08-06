-- [#312] Marketing contacts — assertion suite for
-- supabase/migrations/20260730005100_marketing_contacts.sql.
--
-- A prospect who reads a page and leaves is invisible. Capturing them lawfully
-- means the consent is provable, the unsubscribe actually stops every send, and
-- the data does not outlive its purpose. Each of those is one assertion here.
--
--   MC-1  consent is recorded with the words that were agreed to
--   MC-2  a second submission does not rewrite the first consent
--   MC-3  the global daily cap holds
--   MC-4  unsubscribing stops marketing WITHOUT touching global suppression
--   MC-5  unsubscribe is idempotent and safe for an unknown token
--   MC-6  a fresh consent reverses an unsubscribe but NEVER a complaint
--   MC-7  retention: two windows, and the live consent survives both
--
-- One transaction, rolled back. Fixtures use example.test addresses.

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- MC-1. The consent record is the words, not just the fact.
--
--       Proving consent means proving what was agreed to. Marketing copy
--       changes, so a record pointing at today's wording is not evidence about
--       last year's — the text is snapshotted at the moment of consent.
-- ===========================================================================
do $$
declare
  v_result jsonb;
  v_row    public.marketing_contacts%rowtype;
begin
  v_result := public.api_claim_marketing_contact(
    'Prospect@Example.test',
    'compare_page',
    'Email me these numbers. I can unsubscribe any time.'
  );
  if (v_result ->> 'ok')::boolean is not true then
    raise exception 'MC-1 FAILED: a valid consent was refused: %', v_result;
  end if;
  if (v_result ->> 'token') is null then
    raise exception 'MC-1 FAILED: no unsubscribe token was returned';
  end if;

  select * into v_row from public.marketing_contacts
   where email = 'prospect@example.test';
  if v_row.email is null then
    raise exception 'MC-1 FAILED: the address was not lowercased on store';
  end if;
  if v_row.consent_text is distinct from 'Email me these numbers. I can unsubscribe any time.' then
    raise exception 'MC-1 FAILED: consent_text = %', v_row.consent_text;
  end if;
  if v_row.consent_source is distinct from 'compare_page' then
    raise exception 'MC-1 FAILED: consent_source = %', v_row.consent_source;
  end if;
  if v_row.last_sent_at is not null then
    raise exception 'MC-1 FAILED: a capture claimed a send that never happened';
  end if;

  -- An address with no @ is not an address.
  if (public.api_claim_marketing_contact('nonsense', 'compare_page', 'x')
        ->> 'reason') is distinct from 'validation_failed' then
    raise exception 'MC-1 FAILED: a malformed address was accepted';
  end if;
  raise notice 'MC-1 PASSED: consent stored with its exact wording, lowercased';
end $$;

-- ===========================================================================
-- MC-2. A second submission is not a second first consent.
--
--       The earliest yes is the record that matters. Overwriting consent_at on
--       every resubmit would quietly move the date we would rely on if anybody
--       ever asked when they agreed.
-- ===========================================================================
do $$
declare
  v_first  timestamptz;
  v_second timestamptz;
begin
  select consent_at into v_first from public.marketing_contacts
   where email = 'prospect@example.test';

  perform pg_sleep(0.05);
  perform public.api_claim_marketing_contact(
    'prospect@example.test', 'pricing_page', 'Different wording this time.'
  );

  select consent_at into v_second from public.marketing_contacts
   where email = 'prospect@example.test';
  if v_second is distinct from v_first then
    raise exception 'MC-2 FAILED: consent_at moved from % to %', v_first, v_second;
  end if;

  -- The newest wording and surface ARE updated: that is what they most recently
  -- agreed to, and the source is how a complaint gets traced to a page.
  if (select consent_source from public.marketing_contacts
       where email = 'prospect@example.test') is distinct from 'pricing_page' then
    raise exception 'MC-2 FAILED: the latest consent source was not recorded';
  end if;
  raise notice 'MC-2 PASSED: first consent preserved, latest wording recorded';
end $$;

-- ===========================================================================
-- MC-3. The global daily cap.
--
--       Global rather than per-address, because the cost being protected is the
--       Resend bill and a bot army uses a different address every time. Same
--       reasoning as the contact form's cap.
-- ===========================================================================
do $$
declare
  v_result jsonb;
  v_ok     int := 0;
begin
  -- Cap of 3, and one row already exists from MC-1/MC-2.
  for i in 1..5 loop
    v_result := public.api_claim_marketing_contact(
      'cap' || i || '@example.test', 'compare_page', 'consent', 3
    );
    if (v_result ->> 'ok')::boolean then v_ok := v_ok + 1; end if;
  end loop;

  -- One row pre-existed, so exactly 2 more fit under a cap of 3.
  if v_ok is distinct from 2 then
    raise exception 'MC-3 FAILED: % claims succeeded under a cap of 3 with 1 row already present (want 2)', v_ok;
  end if;
  if (public.api_claim_marketing_contact('over@example.test', 'compare_page', 'c', 3)
        ->> 'reason') is distinct from 'daily_cap' then
    raise exception 'MC-3 FAILED: a claim over the cap was not reported as capped';
  end if;
  raise notice 'MC-3 PASSED: global daily cap holds at the boundary';
end $$;

-- ===========================================================================
-- MC-4. Unsubscribing stops marketing and NOTHING ELSE.
--
--       THE load-bearing assertion, and the one that caught a real defect in the
--       first draft of this migration. `email_suppressions` is global and has no
--       purpose column, and `sendEmail` consults it on every send in the product
--       — so writing an unsubscribe there would also have stopped this person's
--       payment-failure notice, their security email and every inbound-text
--       alert. Opting out of commercial mail has never meant opting out of the
--       messages that keep an account working.
--
--       So the permission lives on the consent row, and this asserts the global
--       list is left alone.
-- ===========================================================================
do $$
declare
  v_token uuid;
begin
  select unsubscribe_token into v_token from public.marketing_contacts
   where email = 'prospect@example.test';

  if (public.api_marketing_unsubscribe(v_token) ->> 'known')::boolean is not true then
    raise exception 'MC-4 FAILED: a known token was reported unknown';
  end if;

  -- Stamping the row IS the opt-out: a send may only go to a live row.
  if (select unsubscribed_at from public.marketing_contacts
       where email = 'prospect@example.test') is null then
    raise exception 'MC-4 FAILED: the contact row was not stamped unsubscribed';
  end if;

  -- And the global list must be untouched, or transactional mail breaks.
  if exists (
    select 1 from public.email_suppressions where email = 'prospect@example.test'
  ) then
    raise exception
      'MC-4 FAILED: a marketing unsubscribe wrote to email_suppressions. That '
      'list is global and unscoped, so this would also stop the person''s '
      'billing and security email.';
  end if;
  raise notice 'MC-4 PASSED: marketing stops, global suppression untouched';
end $$;

-- ===========================================================================
-- MC-5. Idempotent, and honest about an unknown token.
--
--       Mail clients pre-fetch links, so a second call must not error. And an
--       unknown token is reported as done rather than as a failure: the person
--       clicking cannot fix it, and "invalid token" reads as "you are still
--       subscribed", which is the opposite of what they need to hear.
-- ===========================================================================
do $$
declare
  v_token uuid;
  v_first timestamptz;
begin
  select unsubscribe_token, unsubscribed_at into v_token, v_first
    from public.marketing_contacts where email = 'prospect@example.test';

  perform pg_sleep(0.05);
  if (public.api_marketing_unsubscribe(v_token) ->> 'ok')::boolean is not true then
    raise exception 'MC-5 FAILED: a repeat unsubscribe errored';
  end if;
  -- The first unsubscribe time is the true one; a pre-fetch must not move it.
  if (select unsubscribed_at from public.marketing_contacts
       where email = 'prospect@example.test') is distinct from v_first then
    raise exception 'MC-5 FAILED: a repeat unsubscribe moved unsubscribed_at';
  end if;

  if (public.api_marketing_unsubscribe('00000000-0000-4000-8000-0000000000ff')
        ->> 'ok')::boolean is not true then
    raise exception 'MC-5 FAILED: an unknown token was reported as an error';
  end if;
  if (public.api_marketing_unsubscribe('00000000-0000-4000-8000-0000000000ff')
        ->> 'known')::boolean is not false then
    raise exception 'MC-5 FAILED: an unknown token was reported as known';
  end if;
  raise notice 'MC-5 PASSED: idempotent, and an unknown token reads as done';
end $$;

-- ===========================================================================
-- MC-6. A fresh consent reverses their own unsubscribe. It never reverses a
--       complaint.
--
--       Somebody submitting the form again IS them asking, so an unsubscribe
--       they made is theirs to undo. A complaint is different: they reported us
--       as spam, and they have not asked to hear from us because a checkbox got
--       ticked. Same principle as an SMS opt-out only the customer can lift,
--       applied where the customer's act is unambiguous and where it is not.
-- ===========================================================================
do $$
declare
  v_result jsonb;
begin
  -- Their own unsubscribe, reversed by a fresh explicit consent.
  v_result := public.api_claim_marketing_contact(
    'prospect@example.test', 'compare_page', 'Yes, email me again.', 500
  );
  if (v_result ->> 'ok')::boolean is not true then
    raise exception 'MC-6 FAILED: a re-consent after unsubscribing was refused';
  end if;
  if (select unsubscribed_at from public.marketing_contacts
       where email = 'prospect@example.test') is not null then
    raise exception 'MC-6 FAILED: the contact row is still marked unsubscribed';
  end if;

  -- A hard bounce IS cleared by a fresh consent: it is usually a typo, and
  -- somebody retyping their address is the fix.
  insert into public.marketing_contacts (email, consent_source, consent_text)
  values ('typo@example.test', 'compare_page', 'c');
  insert into public.email_suppressions (email, reason)
  values ('typo@example.test', 'hard_bounce');
  perform public.api_claim_marketing_contact(
    'typo@example.test', 'compare_page', 'consent', 500
  );
  if (select cleared_at from public.email_suppressions
       where email = 'typo@example.test') is null then
    raise exception 'MC-6 FAILED: a fresh consent did not clear a hard bounce';
  end if;

  -- A complaint is permanent.
  insert into public.email_suppressions (email, reason)
  values ('angry@example.test', 'complaint');
  v_result := public.api_claim_marketing_contact(
    'angry@example.test', 'compare_page', 'consent', 500
  );
  if (v_result ->> 'reason') is distinct from 'suppressed' then
    raise exception 'MC-6 FAILED: a complaint was reversed by a form submission (%)', v_result;
  end if;
  if exists (select 1 from public.marketing_contacts where email = 'angry@example.test') then
    raise exception 'MC-6 FAILED: a complained address was added as a contact anyway';
  end if;
  if (select cleared_at from public.email_suppressions
       where email = 'angry@example.test') is not null then
    raise exception 'MC-6 FAILED: the complaint suppression was cleared';
  end if;

  raise notice 'MC-6 PASSED: unsubscribe and bounce reversible, complaint is not';
end $$;

-- ===========================================================================
-- MC-7. Retention: two windows, and the live consent survives both.
--
--       A consent we are RELYING ON is the lawful basis for a send, so it lives
--       as long as the subscription. The two things that go are an unsubscribed
--       row's plaintext — safe to delete, because a send needs a LIVE row, so no
--       row is the same answer — and a capture that never produced a send, which
--       is #340's failure exactly: holding a stranger's address for a programme
--       that never happened.
-- ===========================================================================
do $$
declare
  v_pruned jsonb;
begin
  -- Live and recently sent to: must survive.
  insert into public.marketing_contacts
    (email, consent_source, consent_text, consent_at, last_sent_at)
  values ('live@example.test', 'compare_page', 'c',
          now() - interval '400 days', now() - interval '2 days');
  -- Unsubscribed long ago: plaintext goes.
  insert into public.marketing_contacts
    (email, consent_source, consent_text, unsubscribed_at)
  values ('gone@example.test', 'compare_page', 'c', now() - interval '60 days');
  -- Consented a year ago and never sent anything: goes.
  insert into public.marketing_contacts
    (email, consent_source, consent_text, consent_at)
  values ('stale@example.test', 'compare_page', 'c', now() - interval '400 days');

  v_pruned := public.api_prune_marketing_contacts();

  if exists (select 1 from public.marketing_contacts where email = 'gone@example.test') then
    raise exception 'MC-7 FAILED: an unsubscribed row survived past 30 days';
  end if;
  if exists (select 1 from public.marketing_contacts where email = 'stale@example.test') then
    raise exception 'MC-7 FAILED: a never-sent consent survived past a year';
  end if;
  if not exists (select 1 from public.marketing_contacts where email = 'live@example.test') then
    raise exception 'MC-7 FAILED: a live consent older than a year was deleted. '
      'That is the lawful basis for the sends we are still making.';
  end if;
  if (v_pruned ->> 'unsubscribed_pruned')::int is distinct from 1
     or (v_pruned ->> 'never_sent_pruned')::int is distinct from 1 then
    raise exception 'MC-7 FAILED: prune counts wrong: %', v_pruned;
  end if;

  -- Pruning must not resurrect anybody: an address with no row cannot be mailed,
  -- so deleting the unsubscribed row is safe rather than a way back in. Asserted
  -- by claiming nothing was left behind that a send could pick up.
  if exists (
    select 1 from public.marketing_contacts
     where email = 'gone@example.test' and unsubscribed_at is null
  ) then
    raise exception 'MC-7 FAILED: pruning left a LIVE row for an unsubscriber';
  end if;
  raise notice 'MC-7 PASSED: two windows, live consent kept, no resurrection';
end $$;

select 'marketing_contacts.test.sql: MC-1..MC-7 PASSED' as result;

rollback;
