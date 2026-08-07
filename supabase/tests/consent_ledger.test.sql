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
  if n is distinct from 1 then
    raise exception 'CL-1 FAILED: expected exactly one ledger row, got %', n;
  end if;

  select * into r from public.contact_consent_events where contact_id = ct;
  -- An inbound text is IMPLIED consent: they contacted us.
  if r.state is distinct from 'implied' then
    raise exception 'CL-1 FAILED: state = % (want implied)', r.state;
  end if;
  if r.source is distinct from 'inbound_sms' then
    raise exception 'CL-1 FAILED: source = %', r.source;
  end if;
  -- captured_at is WHEN CONSENT HAPPENED, not when the row was written.
  if r.captured_at is distinct from '2026-07-28T10:00:00Z' then
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
  if r.state is distinct from 'express' then
    raise exception 'CL-2 FAILED: a member vouching must be express, got %', r.state;
  end if;
  if r.captured_by is distinct from usr then
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
  if n is distinct from 1 then
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
  if r.state is distinct from 'implied' or r.source is distinct from 'inbound_sms' then
    raise exception 'CL-6 FAILED: got %/%', r.state, r.source;
  end if;

  -- A duplicate delivery must not add a second consent row for one act.
  perform public.thread_inbound_message(
    co, num, '+12125559009', 'do you do gutters?', 'consent-test-msg-1');
  if (select count(*) from public.contact_consent_events where contact_id = ct) is distinct from 1 then
    raise exception 'CL-6 FAILED: a duplicate webhook doubled the consent record';
  end if;
end $$;


-- ===========================================================================
-- CL-7. A STOP is a ledger event, and so is coming back from one.
--
--       This is the half a demand letter is usually about: "they told you to
--       stop on the 3rd and you texted them on the 9th". Answering that has to
--       be a row, not a join somebody remembers to write.
-- ===========================================================================
do $$
declare
  co uuid := '22600000-0000-4000-8000-000000000002';
  ct uuid;
  n  int;
  r  public.contact_consent_events%rowtype;
begin
  select id into ct from public.contacts
   where company_id = co and phone_e164 = '+12125559001';

  insert into public.opt_outs (company_id, phone_e164, source)
  values (co, '+12125559001', 'stop_keyword');

  select count(*) into n from public.contact_consent_events
   where contact_id = ct and state = 'revoked';
  if n is distinct from 1 then
    raise exception 'CL-7 FAILED: a STOP recorded % revocation rows', n;
  end if;

  select * into r from public.contact_consent_events
   where contact_id = ct and state = 'revoked';
  if r.source is distinct from 'stop_keyword' then
    raise exception 'CL-7 FAILED: revocation source = %', r.source;
  end if;

  -- START: the customer comes back. A second row, never an edit of the first.
  update public.opt_outs set revoked_at = now()
   where company_id = co and phone_e164 = '+12125559001';

  select count(*) into n from public.contact_consent_events where contact_id = ct;
  if n is distinct from 3 then
    raise exception 'CL-7 FAILED: expected implied + revoked + re-consent, got % rows', n;
  end if;
  if not exists (
    select 1 from public.contact_consent_events
     where contact_id = ct and source = 'start_keyword' and state = 'express')
  then
    raise exception 'CL-7 FAILED: coming back from a STOP was not recorded';
  end if;
end $$;

-- ===========================================================================
-- CL-8. A STOP from a number with no contact is still honoured by the gate and
--       simply has no ledger row — there is no person to record it against.
--       Asserted so a future change does not "fix" it by inventing a contact.
-- ===========================================================================
do $$
declare
  co uuid := '22600000-0000-4000-8000-000000000002';
  before_n int;
  after_n  int;
begin
  select count(*) into before_n from public.contact_consent_events;
  insert into public.opt_outs (company_id, phone_e164, source)
  values (co, '+12125559999', 'stop_keyword');
  select count(*) into after_n from public.contact_consent_events;

  if after_n is distinct from before_n then
    raise exception 'CL-8 FAILED: a STOP with no contact wrote % ledger row(s)',
      after_n - before_n;
  end if;
  -- The opt-out itself must still exist: the gate does not depend on a contact.
  if not exists (
    select 1 from public.opt_outs
     where company_id = co and phone_e164 = '+12125559999' and revoked_at is null)
  then
    raise exception 'CL-8 FAILED: the opt-out itself was not recorded';
  end if;
end $$;

-- ===========================================================================
-- CL-9. The evidence file names a PERSON and reads in order. Its reader is a
--       lawyer or a carrier reviewer, not us, so a row of foreign keys is not
--       an answer.
-- ===========================================================================
do $$
declare
  co  uuid := '22600000-0000-4000-8000-000000000002';
  rep jsonb;
  row jsonb;
begin
  rep := public.api_consent_evidence(co);
  if jsonb_typeof(rep) is distinct from 'array' or jsonb_array_length(rep) = 0 then
    raise exception 'CL-9 FAILED: empty evidence file: %', rep;
  end if;

  select value into row from jsonb_array_elements(rep)
   where value->>'phone_e164' = '+12125559001'
     and value->>'state' = 'revoked';
  if row is null then
    raise exception 'CL-9 FAILED: the revocation is missing from the evidence file';
  end if;
  if not (row ? 'captured_at') or not (row ? 'source') then
    raise exception 'CL-9 FAILED: a row without when-and-how is not evidence: %', row;
  end if;
end $$;

-- ===========================================================================
-- CL-10. #248: THE CONTACT ARRIVING SECOND IS STILL A REVOCATION.
--
--        Round one of #248 made the importer write restrictions first — the
--        right order, because whichever prefix of a half-finished import lands
--        has to be the safe half. It silently switched the ledger off:
--        `opt_outs_record_consent` resolves phone → contact and returns early
--        when there is no contact, so every phone an import CREATED got no
--        revocation row at all. Permanently — a re-run writes nothing, because
--        the state change it watches already happened.
-- ===========================================================================
do $$
declare
  co uuid := '22600000-0000-4000-8000-000000000002';
  ct uuid;
  n  int;
  r  public.contact_consent_events%rowtype;
begin
  -- The order an import produces: the opt-out, then the person.
  insert into public.opt_outs (company_id, phone_e164, source, created_at)
  values (co, '+12125559010', 'import', '2026-08-01T09:00:00Z');

  insert into public.contacts (company_id, phone_e164)
  values (co, '+12125559010')
  returning id into ct;

  select count(*) into n from public.contact_consent_events
   where contact_id = ct and state = 'revoked';
  if n is distinct from 1 then
    raise exception
      'CL-10 FAILED: a contact created under a standing opt-out has % revocation rows', n;
  end if;

  select * into r from public.contact_consent_events
   where contact_id = ct and state = 'revoked';
  if r.source is distinct from 'import' then
    raise exception 'CL-10 FAILED: revocation source = % (want the opt-out''s own)', r.source;
  end if;
  -- WHEN THEY SAID STOP, not when the row describing them arrived.
  if r.captured_at is distinct from '2026-08-01T09:00:00Z' then
    raise exception 'CL-10 FAILED: captured_at = % (want the opt-out''s created_at)', r.captured_at;
  end if;
end $$;

-- ===========================================================================
-- CL-11. ...and exactly once, whichever order the two rows arrive in.
--
--        Two triggers now watch the same fact from opposite sides. Each
--        observes the SECOND half of the pair, so a doubled row would mean one
--        of them is firing on a half it does not own — and an evidence file
--        that says a customer revoked twice is one somebody has to explain.
-- ===========================================================================
do $$
declare
  co uuid := '22600000-0000-4000-8000-000000000002';
  ct uuid;
  n  int;
begin
  -- The other order: the person first, then the STOP.
  insert into public.contacts (company_id, phone_e164)
  values (co, '+12125559011')
  returning id into ct;

  insert into public.opt_outs (company_id, phone_e164, source)
  values (co, '+12125559011', 'stop_keyword');

  select count(*) into n from public.contact_consent_events
   where contact_id = ct and state = 'revoked';
  if n is distinct from 1 then
    raise exception 'CL-11 FAILED: the person-then-STOP order recorded % rows', n;
  end if;

  -- And a REVOKED opt-out is not a revocation: that customer texted START and
  -- came back. Recording one against them would make the import the one path
  -- that never lets anybody back in.
  insert into public.opt_outs (company_id, phone_e164, source, revoked_at)
  values (co, '+12125559012', 'stop_keyword', now());
  insert into public.contacts (company_id, phone_e164)
  values (co, '+12125559012')
  returning id into ct;

  select count(*) into n from public.contact_consent_events where contact_id = ct;
  if n is distinct from 0 then
    raise exception 'CL-11 FAILED: a lifted opt-out recorded % revocation rows', n;
  end if;
end $$;

-- ===========================================================================
-- CL-12. #248: the index behind "have we already announced this opt-out?".
--
--        The importer answers that question per import, for up to 2000 phones,
--        to decide which timeline events a re-run still owes. Without the
--        partial index it is a scan of the workspace's whole event history
--        inside one Worker request — which is not a check that ships, it is a
--        check that times out and gets deleted.
-- ===========================================================================
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'conversation_events'
       and indexname = 'conversation_events_opted_out_phone_idx')
  then
    raise exception 'CL-12 FAILED: the opted_out announcement index is missing';
  end if;
end $$;

-- ===========================================================================
-- CL-13. #248: DELETING THE CONTACT DOES NOT ERASE THE REVOCATION.
--
--        The ledger was append-only against UPDATE and wide open to DELETE:
--        `contact_consent_events_immutable` is BEFORE UPDATE only, no DELETE
--        trigger exists, and the contact FK was ON DELETE CASCADE. So the one
--        row a carrier audit or a demand letter is actually about — "they told
--        you to stop on the 3rd" — went away with the contact.
--
--        And not hypothetically: `purge_workspace_step` deletes `contacts`,
--        while docs/DELETION.md lists this table as one of the two things that
--        deliberately outlive a workspace. The schema was quietly winning that
--        argument.
--
--        A revocation belongs to the person who sent it, exactly as `opt_outs`
--        does — which is why the row detaches and keeps the number rather than
--        the delete being blocked. Blocking was never available: the same
--        trigger would fire on the purge and make a closed workspace
--        impossible to erase.
-- ===========================================================================
do $$
declare
  co uuid := '22600000-0000-4000-8000-000000000002';
  ct uuid;
  r  public.contact_consent_events%rowtype;
  n  int;
begin
  insert into public.opt_outs (company_id, phone_e164, source, created_by)
  values (co, '+12125559013', 'stop_keyword',
          '22600000-0000-4000-8000-000000000001');
  insert into public.contacts (company_id, phone_e164)
  values (co, '+12125559013')
  returning id into ct;

  select * into r
    from public.contact_consent_events
   where contact_id = ct and state = 'revoked';
  if r.id is null then
    raise exception 'CL-13 FAILED: no revocation row to begin with';
  end if;
  -- The number is ON THE ROW, not only inside `evidence`: after the delete it
  -- is the only handle left on who this was.
  --
  -- `is distinct from`, NOT `<>`, and this assertion was decorative until it
  -- was: dropping `phone_e164` from this writer left the column NULL, and
  -- `NULL <> '+1…'` is NULL rather than true, so `if` took the false branch and
  -- the check waved through the exact defect it exists to catch. Proved by
  -- breaking the writer — it survived, twice, before this line changed. The
  -- migration's own trigger warns about the same trap one file over.
  if r.phone_e164 is distinct from '+12125559013' then
    raise exception 'CL-13 FAILED: phone_e164 = % (want the contact''s number)',
      coalesce(r.phone_e164, '(null)');
  end if;

  -- The purge's own operative statement, and the ops erasure path. Wrapped so
  -- a REFUSED delete is named too: the first version of the detach collided
  -- with the append-only trigger and deleting a contact simply failed, which is
  -- a different defect from the one below and has to read as one.
  begin
    delete from public.contacts where id = ct;
  exception when others then
    raise exception 'CL-13 FAILED: deleting the contact was refused outright: %',
      sqlerrm;
  end;

  select count(*) into n
    from public.contact_consent_events
   where id = r.id;
  if n is distinct from 1 then
    raise exception 'CL-13 FAILED: deleting the contact erased the revocation';
  end if;

  select * into r from public.contact_consent_events where id = r.id;
  -- Detached, not dangling: a ledger row pointing at a contact that no longer
  -- exists would be worse evidence than one that says so.
  if r.contact_id is not null then
    raise exception 'CL-13 FAILED: contact_id survived the delete as %', r.contact_id;
  end if;
  if r.phone_e164 is distinct from '+12125559013' then
    raise exception 'CL-13 FAILED: the surviving row lost its number';
  end if;
  if r.captured_at is null or r.source is distinct from 'stop_keyword' then
    raise exception 'CL-13 FAILED: the surviving row lost when or how';
  end if;
end $$;

-- ===========================================================================
-- CL-13b. The detach is the ONLY update the ledger now permits.
--
--         `ON DELETE SET NULL` is an UPDATE, so making the row survive the
--         contact meant teaching the append-only trigger one exception — and an
--         exception in an immutability rule is exactly the kind of thing that
--         quietly widens. It is narrow by construction: contact_id from a value
--         to NULL, every other column byte-identical. An update that performs
--         the detach and edits something else in the same statement is still
--         refused, which is what stops "detach" becoming a way to rewrite.
-- ===========================================================================
do $$
declare
  co  uuid := '22600000-0000-4000-8000-000000000002';
  ct  uuid;
  eid uuid;
  ok  boolean := false;
begin
  insert into public.contacts (company_id, phone_e164, consent_source, consent_at)
  values (co, '+12125559016', 'attested', now())
  returning id into ct;
  select id into eid
    from public.contact_consent_events where contact_id = ct limit 1;

  -- (1) An ordinary rewrite: still refused.
  begin
    update public.contact_consent_events set state = 'implied' where id = eid;
    raise exception 'CL-13b FAILED: an ordinary rewrite was accepted';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
    ok := true;
  end;
  if not ok then
    raise exception 'CL-13b FAILED: the rewrite guard did not fire';
  end if;

  -- (2) A detach that ALSO edits the row: refused, because it is a rewrite
  --     wearing the exception's clothes.
  ok := false;
  begin
    update public.contact_consent_events
       set contact_id = null, source = 'manual'
     where id = eid;
    raise exception 'CL-13b FAILED: a detach carrying an edit was accepted';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
    ok := true;
  end;
  if not ok then
    raise exception 'CL-13b FAILED: the smuggled edit was not caught';
  end if;

  -- (3) The detach alone: permitted, because it removes a pointer to a row
  --     that no longer exists and asserts nothing.
  update public.contact_consent_events set contact_id = null where id = eid;

  -- (4) And re-attaching is not a thing: null → a value is a rewrite.
  ok := false;
  begin
    update public.contact_consent_events set contact_id = ct where id = eid;
    raise exception 'CL-13b FAILED: a detached row was re-attached';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
    ok := true;
  end;
  if not ok then
    raise exception 'CL-13b FAILED: re-attachment was not caught';
  end if;
end $$;

-- ===========================================================================
-- CL-14. ...and the company still cascades, so erasure is not weakened.
--
--        The row outliving one CONTACT is the point; outliving the COMPANY row
--        would be a different promise from the one DELETION.md makes. (The
--        workspace teardown anonymises `companies` rather than deleting it, so
--        in practice the ledger reaches its three-year floor — this asserts the
--        boundary is still there for a genuine company delete.)
-- ===========================================================================
do $$
declare
  own uuid := '22600000-0000-4000-8000-000000000003';
  co  uuid := '22600000-0000-4000-8000-000000000004';
  ct  uuid;
  n   int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          created_at, updated_at, aud, role)
  values (own, 'consent-cascade@test.local', '', now(), now(), now(),
          'authenticated', 'authenticated')
  on conflict (id) do nothing;
  insert into public.companies
    (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
     subscription_status, plan)
  values (co, 'Consent Cascade Co', own, 'US', '212', now(), 'active', 'pro');

  insert into public.contacts (company_id, phone_e164, consent_source, consent_at)
  values (co, '+12125559014', 'attested', now())
  returning id into ct;

  select count(*) into n
    from public.contact_consent_events where company_id = co;
  if n is distinct from 1 then
    raise exception 'CL-14 FAILED: expected one ledger row, got %', n;
  end if;

  -- The purge's order: contacts first (contacts.company_id does NOT cascade),
  -- which detaches the ledger row and leaves it holding the company.
  delete from public.contacts where id = ct;
  select count(*) into n
    from public.contact_consent_events
   where company_id = co and contact_id is null;
  if n is distinct from 1 then
    raise exception 'CL-14 FAILED: the row did not survive the contact detached';
  end if;

  delete from public.companies where id = co;

  select count(*) into n
    from public.contact_consent_events where company_id = co;
  if n is distinct from 0 then
    raise exception 'CL-14 FAILED: % ledger row(s) outlived the company', n;
  end if;
end $$;

-- ===========================================================================
-- CL-15. Every writer records the number, not just the one that was easy.
--
--        Three triggers write this ledger — the contact's own basis, the
--        opt-out transition, and the contact-arrives-second mirror — and a
--        column only some of them fill is a column nobody can rely on. Each is
--        exercised through its real path.
-- ===========================================================================
do $$
declare
  co uuid := '22600000-0000-4000-8000-000000000002';
  ct uuid;
  n  int;
begin
  -- (1) contacts_record_consent: a basis written with the contact.
  insert into public.contacts (company_id, phone_e164, consent_source, consent_at)
  values (co, '+12125559015', 'attested', now())
  returning id into ct;
  -- (2) opt_outs_record_consent: the STOP arriving after the contact.
  insert into public.opt_outs (company_id, phone_e164, source, created_by)
  values (co, '+12125559015', 'stop_keyword',
          '22600000-0000-4000-8000-000000000001');

  select count(*) into n
    from public.contact_consent_events
   where contact_id = ct and phone_e164 = '+12125559015';
  if n is distinct from 2 then
    raise exception 'CL-15 FAILED: % of 2 rows carry the number', n;
  end if;
end $$;

-- ===========================================================================
-- CL-16. #248: THE DETACH IS THE ONLY UPDATE, AND THE MIGRATION'S OWN
--        EXEMPTION DID NOT SURVIVE IT.
--
--        20260806100000 has to run an UPDATE (`phone_e164` on rows written
--        before that column existed) against a table whose trigger refuses
--        every UPDATE. It widens the rule, back fills, then narrows it again —
--        and "narrows it again" is one `create or replace` that a later edit,
--        a merge, or a copy-paste of the wrong half quietly loses. Nothing
--        would fail: the ledger would simply accept a phone rewrite forever,
--        which is a ledger whose subject can be changed after the fact.
--
--        Discovered by running the migration against a database that HAS rows.
--        `supabase db reset` applies migrations to an empty one, so the
--        backfill loop matched nothing, exited, and the collision was
--        invisible — green locally, dead on the first deploy. Which is why
--        this asserts the SHIPPED rule rather than trusting the file.
-- ===========================================================================
do $$
declare
  co uuid := '22600000-0000-4000-8000-000000000002';
  ct uuid;
  r  public.contact_consent_events%rowtype;
  ok boolean;
begin
  insert into public.contacts (company_id, phone_e164, consent_source, consent_at)
  values (co, '+12125559116', 'attested', now())
  returning id into ct;
  select * into r from public.contact_consent_events where contact_id = ct;
  if r.id is null then
    raise exception 'CL-16 FAILED: no ledger row to begin with';
  end if;

  -- (1) A phone rewrite is refused.
  ok := false;
  begin
    update public.contact_consent_events
       set phone_e164 = '+12125550000'
     where id = r.id;
  exception when others then
    ok := true;
  end;
  if not ok then
    raise exception 'CL-16 FAILED: the ledger accepted a phone rewrite';
  end if;

  -- (1b) AND SO IS FILLING A NULL ONE, which is the shape the exemption
  --      actually had — `old.phone_e164 is null and new.phone_e164 is not
  --      null`. Testing only the rewrite above left this open: keeping both
  --      rules instead of sequencing them ("we might need the backfill again")
  --      passed (1) and (2) untouched, because neither row's phone was ever
  --      null. Proved by writing that merge and watching this file accept it.
  --
  --      The rows this reaches are real: the migration cannot back fill a row
  --      whose contact was already deleted, so production keeps null-phone
  --      rows forever, and a standing exemption would let anyone point one at
  --      a number of their choosing. The pre-migration shape is rebuilt here
  --      with the trigger off, which is the only way to get one now.
  alter table public.contact_consent_events disable trigger contact_consent_events_immutable;
  update public.contact_consent_events set phone_e164 = null where id = r.id;
  alter table public.contact_consent_events enable trigger contact_consent_events_immutable;
  ok := false;
  begin
    update public.contact_consent_events
       set phone_e164 = '+12125550000'
     where id = r.id;
  exception when others then
    ok := true;
  end;
  if not ok then
    raise exception
      'CL-16 FAILED: the ledger filled a null phone — the migration''s temporary exemption is still in force';
  end if;
  alter table public.contact_consent_events disable trigger contact_consent_events_immutable;
  update public.contact_consent_events set phone_e164 = '+12125559116' where id = r.id;
  alter table public.contact_consent_events enable trigger contact_consent_events_immutable;

  -- (2) So is filling a NULL one, which is the exact shape of the backfill.
  ok := false;
  begin
    update public.contact_consent_events
       set phone_e164 = null, state = 'express'
     where id = r.id;
  exception when others then
    ok := true;
  end;
  if not ok then
    raise exception 'CL-16 FAILED: the ledger accepted a rewrite of two columns';
  end if;

  -- (3) And the detach still passes, so (1) and (2) are a narrow rule rather
  --     than a blanket refusal that would make a contact undeletable.
  begin
    delete from public.contacts where id = ct;
  exception when others then
    raise exception 'CL-16 FAILED: the detach was refused too: %', sqlerrm;
  end;
  select * into r from public.contact_consent_events where id = r.id;
  if r.id is null or r.contact_id is not null then
    raise exception 'CL-16 FAILED: the row did not survive detached';
  end if;
  if r.phone_e164 is distinct from '+12125559116' then
    raise exception 'CL-16 FAILED: the detached row lost its number';
  end if;
end $$;

\echo 'consent_ledger.test.sql: CL-1..CL-16 PASSED'

rollback;
