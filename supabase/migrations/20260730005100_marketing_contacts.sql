-- #312 — capture the prospects who leave, lawfully.
--
-- A visitor who reads /pricing or a comparison page and closes the tab is
-- invisible: no account, no email, no signal, no way to follow up. Everything
-- else in #312 turned out to be already shipped (the 30-day money-back guarantee
-- is the trial, and the contact form already lets somebody raise their hand).
-- This is the one thing that was genuinely missing.
--
-- ---------------------------------------------------------------------------
-- WHY THIS WAS LEFT OPEN, AND WHY IT IS NOW BUILT.
--
-- The previous pass declined to build it, on the grounds that storing a marketing
-- consent creates obligations rather than satisfying them: an unsubscribe
-- mechanism, record-keeping that outlives the message, and a lawful basis to
-- maintain. All three are true, and all three are engineering. Building them
-- commits nobody to sending a campaign — it makes capture lawful and reversible,
-- which is the only state from which the decision to send is even available.
--
-- ---------------------------------------------------------------------------
-- THE UNSUBSCRIBE DOES *NOT* GO IN `email_suppressions`, AND THAT IS THE MOST
-- IMPORTANT DECISION HERE. My first draft of this migration put it there, and it
-- would have been a serious bug.
--
-- `email_suppressions` (#386) is GLOBAL and has no purpose column, and
-- `sendEmail` consults it on every send in the product. So an unsubscribe written
-- there would also have stopped that person's **payment-failure notice, their
-- security email, and every inbound-text alert** — for a prospect who later became
-- a customer, unsubscribing from a comparison email would silently break their
-- billing mail. Opting out of commercial mail has never meant opting out of the
-- messages that keep an account working, and conflating them is worse than not
-- offering an unsubscribe at all.
--
-- So the permission lives with the consent instead: `marketing_contacts` IS the
-- list, and `unsubscribed_at` on it is the opt-out. A marketing send may only go
-- to an address with a live row, which makes the absence of a row the safe
-- default — nothing needs to remember a negative.
--
-- Bounces and complaints still stop marketing mail, for free and without touching
-- the shared table: they are in `email_suppressions`, and every marketing send
-- goes through the same `sendEmail` that already filters against it.
--
-- ---------------------------------------------------------------------------
-- WHAT A COMPLAINT MEANS HERE, because the two lists meet at exactly one point.
--
-- A complaint is the one global fact that must also block a NEW capture. Somebody
-- who reported us as spam has not asked to hear from us again because a checkbox
-- got ticked, so the claim below refuses them outright. A hard bounce does not
-- refuse — that is usually a typo, and the person retyping their address is the
-- fix. Same shape as the existing doctrine on that table, and the same principle
-- as an SMS opt-out only the customer can lift: applied where the customer's act
-- is unambiguous, and withheld where it is not.

-- ---------------------------------------------------------------------------
-- 1. The consent record.
--
-- Keyed on the lowercased address because one row per address IS the truth, and
-- a surrogate id would let two rows disagree about whether somebody consented.
--
-- `consent_text` stores the EXACT words shown beside the checkbox, snapshotted at
-- the moment of consent. That is the part people forget: proving consent means
-- proving what was agreed to, and the marketing copy will change. A consent
-- record that points at today's wording is not evidence about last year's.
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_contacts (
  email             text primary key,
  /** When they said yes. Never updated — a second submission is not a second
   *  first consent, and the earliest one is the record that matters. */
  consent_at        timestamptz not null default now(),
  /** Where the consent was given, so a complaint can be traced to a surface. */
  consent_source    text not null,
  /** The words they agreed to, verbatim, as shown at the time. */
  consent_text      text not null,
  /** Unguessable, and the only credential the unsubscribe link carries. */
  unsubscribe_token uuid not null default gen_random_uuid(),
  /** Nothing has been sent yet until this is set. Distinguishes a live contact
   *  from a capture nobody ever acted on, which retention below cares about. */
  last_sent_at      timestamptz,
  /** Set when they unsubscribe. The row survives briefly for the audit trail;
   *  the suppression entry is what actually stops sends. */
  unsubscribed_at   timestamptz,
  created_at        timestamptz not null default now()
);

comment on table public.marketing_contacts is
  '#312: prospects who explicitly asked to be emailed, with the words they agreed to. NOT customers and belonging to no workspace, which is why they are absent from every workspace deletion and export path — see docs/PERSONAL-DATA-INVENTORY.md.';

create unique index if not exists marketing_contacts_token_uq
  on public.marketing_contacts (unsubscribe_token);

-- Live contacts, for the count the daily cap needs and any future send.
create index if not exists marketing_contacts_live_idx
  on public.marketing_contacts (created_at desc)
  where unsubscribed_at is null;

alter table public.marketing_contacts enable row level security;
-- No policies, deliberately: this table is service-role only. A prospect is not
-- an authenticated user and has no session to scope a policy to, so there is no
-- legitimate `authenticated` read of anybody's consent record.

-- `public` as well as the two roles: default privileges in this project grant
-- more than they look like they do, so the revoke is restated exactly rather
-- than assumed (the same note contact_messages carries). schema.test.sql T3
-- checks this.
revoke all on table public.marketing_contacts from public, anon, authenticated;

-- Full DML to service_role. NOT append-only like contact_messages: retention
-- deletes rows and an unsubscribe updates them, so the blanket invariant in
-- service_role_grants.test.sql G1 applies here rather than needing an exemption.
grant select, insert, update, delete on table public.marketing_contacts
  to service_role;

/**
 * Record a consent, or refuse it, in one statement.
 *
 * Mirrors `api_claim_contact_message`: an advisory lock so a burst cannot beat
 * the cap check, and the cap itself is a GLOBAL daily ceiling rather than
 * per-address, because the cost being protected is our Resend bill and a bot
 * army uses a different address every time (the cost-protection mandate).
 *
 * Returns a jsonb verdict rather than raising, so the caller can answer a human
 * differently from a bot without the route needing to know the rules.
 */
create or replace function public.api_claim_marketing_contact(
  p_email        text,
  p_source       text,
  p_consent_text text,
  p_cap          int default 50
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email       text := lower(trim(p_email));
  v_today_count int;
  v_reason      text;
  v_token       uuid;
begin
  if v_email = '' or position('@' in v_email) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'validation_failed');
  end if;

  -- One writer at a time for the cap arithmetic. Keyed on a constant: the cap is
  -- global, so a per-address lock would not serialise the thing being counted.
  perform pg_advisory_xact_lock(hashtext('marketing_contact_claim'));

  -- A COMPLAINT is never cleared by a form. See the doctrine at the top: someone
  -- who reported us as spam has not asked to hear from us because a checkbox got
  -- ticked. Reported as accepted so a bot learns nothing from the difference.
  select reason into v_reason
    from public.email_suppressions
   where email = v_email
     and cleared_at is null
   limit 1;
  if v_reason = 'complaint' then
    return jsonb_build_object('ok', false, 'reason', 'suppressed');
  end if;

  select count(*) into v_today_count
    from public.marketing_contacts
   where created_at >= date_trunc('day', now() at time zone 'utc');
  if v_today_count >= greatest(p_cap, 1) then
    return jsonb_build_object('ok', false, 'reason', 'daily_cap');
  end if;

  -- A hard bounce is usually a typo, and somebody retyping their address is the
  -- fix — so their own fresh consent clears it. `cleared_at` is the existing
  -- mechanism for exactly this and keeps the history. A complaint was refused
  -- above and never reaches here.
  update public.email_suppressions
     set cleared_at = now()
   where email = v_email
     and cleared_at is null
     and reason = 'hard_bounce';

  insert into public.marketing_contacts
    (email, consent_source, consent_text)
  values (v_email, p_source, p_consent_text)
  on conflict (email) do update
     -- consent_at is deliberately NOT touched: the first yes is the record.
     set consent_source  = excluded.consent_source,
         consent_text    = excluded.consent_text,
         unsubscribed_at = null
  returning unsubscribe_token into v_token;

  return jsonb_build_object('ok', true, 'token', v_token);
end;
$$;

revoke execute on function public.api_claim_marketing_contact(text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.api_claim_marketing_contact(text, text, text, int)
  to service_role;

/**
 * Unsubscribe, by token, idempotently.
 *
 * ONE CLICK AND NO CONFIRMATION STEP. An unsubscribe that asks "are you sure"
 * is an unsubscribe that fails, and a link in an email is the one place a
 * destructive-looking action should be immediate — the whole point is that it
 * costs the person nothing.
 *
 * Idempotent because mail clients pre-fetch links: a second call must not error,
 * and must not report "you were not subscribed" to somebody who just was.
 */
create or replace function public.api_marketing_unsubscribe(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  select email into v_email
    from public.marketing_contacts
   where unsubscribe_token = p_token;

  if v_email is null then
    -- A token we do not know. Reported as done rather than as an error: the
    -- person clicking cannot fix it, and telling them "invalid token" reads as
    -- "you are still subscribed" — the opposite of reassuring.
    return jsonb_build_object('ok', true, 'known', false);
  end if;

  -- Stamping the row IS the opt-out: a marketing send may only go to an address
  -- with a live row, so this is what stops it. Deliberately NOT written to
  -- `email_suppressions` — that list is global and unscoped, and an entry there
  -- would also stop this person's billing and security email. See the header.
  update public.marketing_contacts
     set unsubscribed_at = coalesce(unsubscribed_at, now())
   where unsubscribe_token = p_token;

  return jsonb_build_object('ok', true, 'known', true);
end;
$$;

revoke execute on function public.api_marketing_unsubscribe(uuid)
  from public, anon, authenticated;
grant execute on function public.api_marketing_unsubscribe(uuid)
  to service_role;

/**
 * Retention (#340's lesson, applied before the data exists rather than after).
 *
 * TWO WINDOWS, for the same reason contact_messages has two: the rows mean
 * different things.
 *
 * A consent we are RELYING ON is the lawful basis for a send, so it lives as long
 * as the subscription does. Deleting it while still mailing somebody would be
 * worse than never recording it — the whole point is to be able to show what was
 * agreed to.
 *
 * A capture nobody ever acted on is different: if nothing was ever sent and the
 * consent is a year old, we are holding a stranger's email address for a
 * programme that never happened. Those go.
 *
 * An UNSUBSCRIBED row's plaintext goes at 30 days, and deleting it is SAFE rather
 * than risky, which is the neat consequence of keeping the permission in this
 * table: we only ever mail an address that has a live row here, so no row at all
 * is the same answer as an unsubscribed row. Nothing has to remember a negative.
 * Thirty days is simply long enough to answer "did you actually unsubscribe me?"
 *
 * (Had the opt-out been written to `email_suppressions` instead, pruning would
 * have been a live hazard — deleting the record of who asked us to stop is how a
 * later capture quietly re-adds them.)
 */
create or replace function public.api_prune_marketing_contacts(
  p_unsubscribed_days int default 30,
  p_never_sent_days   int default 365
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unsubscribed int;
  v_never_sent   int;
begin
  delete from public.marketing_contacts
   where unsubscribed_at is not null
     and unsubscribed_at < now() - make_interval(days => greatest(p_unsubscribed_days, 1));
  get diagnostics v_unsubscribed = row_count;

  delete from public.marketing_contacts
   where last_sent_at is null
     and unsubscribed_at is null
     and consent_at < now() - make_interval(days => greatest(p_never_sent_days, 1));
  get diagnostics v_never_sent = row_count;

  return jsonb_build_object(
    'unsubscribed_pruned', v_unsubscribed,
    'never_sent_pruned', v_never_sent
  );
end;
$$;

revoke execute on function public.api_prune_marketing_contacts(int, int)
  from public, anon, authenticated;
grant execute on function public.api_prune_marketing_contacts(int, int)
  to service_role;

comment on function public.api_prune_marketing_contacts is
  '#312: two windows. An unsubscribed contact loses its plaintext at 30 days (the suppression entry, not this row, is what stops sends). A consent that never produced a send goes at a year, because holding a stranger''s address for a programme that never happened is the #340 failure repeated.';
