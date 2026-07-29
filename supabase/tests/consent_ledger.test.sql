-- #226 — the consent ledger: append-only, and it writes itself.
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/consent_ledger.test.sql
-- Rolls back; self-contained fixtures with their own id prefix.
--   owner   = 22600000-0000-4000-8000-000000000001
--   company = 22600000-0000-4000-8000-000000000002

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                        created_at, updated_at, aud, role)
values ('22600000-0000-4000-8000-000000000001', 'consent@test.local', '', now(),
        now(), now(), 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan)
values ('22600000-0000-4000-8000-000000000002', 'Consent Test Co',
        '22600000-0000-4000-8000-000000000001', 'US', '212', now(), 'active', 'pro');

insert into public.company_members (company_id, user_id, role)
values ('22600000-0000-4000-8000-000000000002',
        '22600000-0000-4000-8000-000000000001', 'owner');

-- ===========================================================================
-- CL-1. A contact created WITH a basis records one row, without anybody
--       calling a recorder.
--
--       This is the whole design. The obvious implementation calls a recorder
--       from each path that establishes consent — three today, four the moment
--       #232's web widget or #335's booking page lands — and the failure mode
--       is silent: consent on the contact, absent from the evidence file,
--       discovered when a lawyer asks. The transition IS the act, so the
--       ledger cannot be forgotten by somebody who does not know it exists.
-- ===========================================================================
do $$
declare
  co uuid := '22600000-0000-4000-8000-000000000002';
  ct uuid;
  n  int;
  r  public.contact_consent_events%rowtype;
begin
  insert into public.contacts (company_id, phone_e164, consent_source, consent_at)
  values (co, '+12125559001', 'inbound_sms', '2026-07-28T10:00:00Z')
  returning id into ct;

  select count(*) into n from public.contact_consent_events where contact_id = ct;
  if n <> 1 then
    raise exception 'CL-1 FAILED: expected exactly one ledger row, got %', n;
  end if;

  select * into r from public.contact_consent_events where contact_id = ct;
  -- An inbound text is IMPLIED consent: they contacted us.
  if r.state <> 'implied' then
    raise exception 'CL-1 FAILED: state = % (want implied)', r.state;
  end if;
  if r.source <> 'inbound_sms' then
    raise exception 'CL-1 FAILED: source = %', r.source;
  end if;
  -- captured_at is WHEN CONSENT HAPPENED, not when the row was written.
  if r.captured_at <> '2026-07-28T10:00:00Z' then
    raise exception 'CL-1 FAILED: captured_at = % (want the consent_at)', r.captured_at;
  end if;
end $$;

-- ===========================================================================
-- CL-2. A member vouching is EXPRESS, not implied — the distinction a demand
--       letter turns on. Recorded when consent lands by UPDATE, which is the
--       §5 attestation path.
-- ===========================================================================
do $$
declare
  co uuid := '22600000-0000-4000-8000-000000000002';
  usr uuid := '22600000-0000-4000-8000-000000000001';
  ct uuid;
  r  public.contact_consent_events%rowtype;
begin
  insert into public.contacts (company_id, phone_e164)
  values (co, '+12125559002')
  returning id into ct;

  -- No basis yet → no ledger row yet.
  if exists (select 1 from public.contact_consent_events where contact_id = ct) then
    raise exception 'CL-2 FAILED: a contact with no consent has a ledger row';
  end if;

  update public.contacts
     set consent_source = 'attested',
         consent_at = '2026-07-28T11:00:00Z',
         consent_attested_by = usr
   where id = ct;

  select * into r from public.contact_consent_events where contact_id = ct;
  if r.state <> 'express' then
    raise exception 'CL-2 FAILED: a member vouching must be express, got %', r.state;
  end if;
  if r.captured_by <> usr then
    raise exception 'CL-2 FAILED: captured_by = % (want the attesting member)', r.captured_by;
  end if;
end $$;

-- ===========================================================================
-- CL-3. Consent is established ONCE. Later writes that do not change
--       consent_at add nothing.
--
--       The threading RPC coalesces so a first inbound sets the basis and
--       later ones do not; this mirrors it. Without the guard, every inbound
--       text from a known contact would append a consent row and the evidence
--       file would be mostly noise.
-- ===========================================================================
do $$
declare
  co uuid := '22600000-0000-4000-8000-000000000002';
  ct uuid;
  n  int;
begin
  select id into ct from public.contacts
   where company_id = co and phone_e164 = '+12125559001';

  update public.contacts set name = 'Renamed' where id = ct;
  update public.contacts set consent_at = '2026-07-28T12:00:00Z' where id = ct;

  select count(*) into n from public.contact_consent_events where contact_id = ct;
  if n <> 1 then
    raise exception 'CL-3 FAILED: consent re-recorded on a later write (% rows)', n;
  end if;
end $$;

-- ===========================================================================
-- CL-4. APPEND-ONLY IS ENFORCED, not merely intended.
--
--       A ledger that can be UPDATEd is one a future handler can quietly
--       rewrite — exactly what an evidence chain must not permit, and how "we
--       cannot show you that" happens.
-- ===========================================================================
do $$
declare
  ct uuid;
begin
  select contact_id into ct from public.contact_consent_events limit 1;

  begin
    update public.contact_consent_events set state = 'revoked' where contact_id = ct;
    raise exception 'CL-4 FAILED: a ledger row was rewritten';
  exception when raise_exception then
    -- Expected: the immutability trigger. Re-raise anything that is not it.
    if position('append-only' in sqlerrm) = 0 then
      raise;
    end if;
  end;
end $$;

-- ===========================================================================
-- CL-5. The ledger is reachable only by the Worker. These rows name customers
--       and are the evidence a lawyer would be shown; an end-user role has no
--       business reading them directly.
-- ===========================================================================
do $$
declare
  leaked text;
begin
  if not exists (
    select 1 from pg_tables
     where schemaname = 'public' and tablename = 'contact_consent_events'
       and rowsecurity)
  then
    raise exception 'CL-5 FAILED: RLS not enabled on contact_consent_events';
  end if;

  select string_agg(grantee, ', ') into leaked
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'contact_consent_events'
    and grantee in ('anon', 'authenticated');
  if leaked is not null then
    raise exception 'CL-5 FAILED: end-user grants present: %', leaked;
  end if;
end $$;

-- ===========================================================================
-- CL-6. A real inbound text writes the ledger row through the threading RPC,
--       with the message id as evidence — the acceptance criterion that
--       inbound-first auto-records with zero user action.
-- ===========================================================================
do $$
declare
  co  uuid := '22600000-0000-4000-8000-000000000002';
  num uuid;
  ct  uuid;
  r   public.contact_consent_events%rowtype;
begin
  insert into public.phone_numbers
    (company_id, provisioning_key, country, number_e164, status)
  values (co, 'consent-test', 'US', '+12125550001', 'active')
  returning id into num;

  perform public.thread_inbound_message(
    co, num, '+12125559009', 'do you do gutters?', 'consent-test-msg-1');

  select id into ct from public.contacts
   where company_id = co and phone_e164 = '+12125559009';
  if ct is null then
    raise exception 'CL-6 FAILED: the inbound did not create a contact';
  end if;

  select * into r from public.contact_consent_events where contact_id = ct;
  if r.id is null then
    raise exception 'CL-6 FAILED: an inbound text recorded no consent';
  end if;
  if r.state <> 'implied' or r.source <> 'inbound_sms' then
    raise exception 'CL-6 FAILED: got %/%', r.state, r.source;
  end if;

  -- A duplicate delivery must not add a second consent row for one act.
  perform public.thread_inbound_message(
    co, num, '+12125559009', 'do you do gutters?', 'consent-test-msg-1');
  if (select count(*) from public.contact_consent_events where contact_id = ct) <> 1 then
    raise exception 'CL-6 FAILED: a duplicate webhook doubled the consent record';
  end if;
end $$;

\echo 'consent_ledger.test.sql: CL-1..CL-6 PASSED'

rollback;
