-- ===========================================================================
-- [#248] The consent ledger must not depend on which row was written first.
--
-- Round one of #248 made the CSV importer write RESTRICTIONS FIRST: opt-outs
-- before contacts, so that whichever prefix of a half-finished import happens
-- to land, it is the safe half. That is the right order and it stays.
--
-- It silently switched off the revocation ledger. `opt_outs_record_consent`
-- (20260728002200) resolves phone → contact and RETURNS EARLY when no contact
-- exists — reasonably, since a STOP can arrive from a number this workspace
-- has no contact for. But an import creates the contact AFTER the opt-out, so
-- for every phone an import brings in for the first time, the ledger got
-- nothing at all.
--
-- And it was PERMANENT: re-running the import writes zero ledger rows, because
-- that trigger fires on a state change in `opt_outs` and the state change
-- already happened. The data recovers. The evidence chain does not.
--
-- WHY A SECOND TRIGGER RATHER THAN A THIRD WRITE ORDER. Ordering the importer's
-- statements so the contact exists first would fix this one caller and leave
-- the rule where it was: known to whoever wrote that route. `opt_outs` has five
-- writers today (inbound STOP/START, the manual route, the carrier reconcile,
-- CSV import, and the closure path), and `contacts` has more — every one of
-- them could produce the same pair in the same order. The gap is not "the
-- importer writes in the wrong order", it is "the ledger only watches one of
-- the two tables that make a revocation true of a person".
--
-- So it watches both. `opt_outs_record_consent` records a revocation when the
-- OPT-OUT arrives after the contact; this records it when the CONTACT arrives
-- after the opt-out. Exactly one of the two can fire for any pair, because each
-- observes the second half of it: an INSERT into `contacts` is by definition
-- the first time this (company, phone) has been a person here.
--
-- OPT-OUT REMAINS CARRIER TRUTH AND IS UNCHANGED. Nothing here can lift a STOP,
-- create one, or alter `opt_outs`; the gate in runPreSendGates reads that table
-- exactly as before. This only records what already happened.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- FAIL FAST RATHER THAN QUEUE. The way a migration takes a site down is not the
-- lock it holds, it is the lock it WAITS for: a DDL statement blocked behind
-- one long-running reader queues every subsequent reader behind itself, and the
-- table goes dark while nothing is actually happening.
--
-- Five seconds, so a deploy that cannot get its lock fails and is re-run rather
-- than pinning `conversation_events` behind a report somebody left open.
-- Session-scoped rather than `set local`: the statements in this file do not
-- share one transaction (the runner applies them individually, which is also
-- what lets CREATE INDEX CONCURRENTLY below work at all), so `set local` would
-- silently apply to nothing.
-- ---------------------------------------------------------------------------
set lock_timeout = '5s';

create or replace function public.contacts_record_standing_revocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opt public.opt_outs%rowtype;
begin
  -- Only an ACTIVE opt-out is a fact about today. A revoked row is a customer
  -- who came back, and its own revocation and re-consent were both recorded on
  -- `opt_outs` at the time they happened.
  select * into v_opt
    from public.opt_outs o
   where o.company_id = new.company_id
     and o.phone_e164 = new.phone_e164
     and o.revoked_at is null
   limit 1;
  if v_opt.id is null then
    return new;
  end if;

  insert into public.contact_consent_events
    (company_id, contact_id, state, source, captured_by, captured_at, evidence)
  values (
    new.company_id,
    new.id,
    'revoked',
    v_opt.source::text,
    v_opt.created_by,
    -- WHEN THEY SAID STOP, not when the row that describes them arrived. The
    -- question this ledger answers is "when were you told", and an import's
    -- clock is not the answer to it.
    coalesce(v_opt.created_at, now()),
    jsonb_build_object(
      'phone_e164', new.phone_e164,
      'opt_out_id', v_opt.id,
      'opt_out_source', v_opt.source::text,
      -- Says which of the two triggers wrote it, so a reader can tell "they
      -- opted out while we knew them" from "they were already opted out when
      -- this record arrived" — a real distinction in a demand letter.
      'recorded_on_contact_create', true)
  );
  return new;
end $$;

drop trigger if exists contacts_standing_revocation_ledger on public.contacts;
create trigger contacts_standing_revocation_ledger
  after insert on public.contacts
  for each row execute function public.contacts_record_standing_revocation();

comment on function public.contacts_record_standing_revocation() is
  '#248: records the revocation half of the ledger when the CONTACT arrives after the opt-out (an import writes restrictions first). The mirror of opt_outs_record_consent, which covers the other order.';

-- ---------------------------------------------------------------------------
-- Backfill, for the imports that already ran under round one's write order.
--
-- Every (contact, active opt-out) pair with no `revoked` ledger row is one the
-- ledger lost — either to the ordering above or to an opt-out recorded before
-- 20260728002200 existed. The evidence should start where the revocation did,
-- so captured_at is the opt-out's own created_at.
--
-- IN BOUNDED BATCHES, not one statement. The first draft was a single
-- `insert … select` over the whole join, which is the shape that reads fine on
-- a laptop and is a surprise on the day somebody's suppression list arrives:
-- one statement whose size nobody chose, holding its locks and writing its WAL
-- for as long as it takes. Batching does not shorten the transaction — this
-- runner does not permit COMMIT inside a DO block, which was checked rather
-- than assumed — but it does put a ceiling on every individual statement, and
-- it makes the work VISIBLE: the loop reports what it did and says so loudly if
-- it hits the cap, instead of a migration that mysteriously takes an hour.
--
-- Re-running is a no-op by construction (the anti-join is the filter), so
-- hitting the cap is a "run it again", never a broken state.
--
-- destructive-ok: inserts only, into an append-only ledger, for pairs that have
-- no row at all.
-- ---------------------------------------------------------------------------
do $$
declare
  v_batch    constant int := 1000;
  v_max_runs constant int := 1000;   -- a million pairs, then stop and say so
  v_runs     int := 0;
  v_done     int;
  v_total    int := 0;
begin
  loop
    insert into public.contact_consent_events
      (company_id, contact_id, state, source, captured_by, captured_at, evidence)
    select
      o.company_id,
      ct.id,
      'revoked',
      o.source::text,
      o.created_by,
      coalesce(o.created_at, now()),
      jsonb_build_object(
        'phone_e164', o.phone_e164,
        'opt_out_id', o.id,
        'opt_out_source', o.source::text,
        'backfilled', true)
    from (
      select o.*
        from public.opt_outs o
        join public.contacts c
          on c.company_id = o.company_id
         and c.phone_e164 = o.phone_e164
       where o.revoked_at is null
         and not exists (
           select 1
             from public.contact_consent_events e
            where e.contact_id = c.id
              and e.state = 'revoked')
       limit v_batch
    ) o
    join public.contacts ct
      on ct.company_id = o.company_id
     and ct.phone_e164 = o.phone_e164;

    get diagnostics v_done = row_count;
    v_total := v_total + v_done;
    v_runs := v_runs + 1;
    exit when v_done = 0;
    if v_runs >= v_max_runs then
      raise warning
        '[#248] consent ledger backfill stopped at the % row cap after % rows — re-run this statement; it is idempotent',
        v_batch * v_max_runs, v_total;
      exit;
    end if;
  end loop;
  raise notice '[#248] consent ledger backfill wrote % revocation row(s)', v_total;
end $$;

-- The index behind "have we already announced this opt-out?" is built by
-- 20260806090100, ALONE IN ITS OWN FILE. It has to be CREATE INDEX CONCURRENTLY
-- on one of the biggest tables we have, and the migration runner sends a file's
-- statements as one pipeline, which Postgres refuses to run CONCURRENTLY inside
-- ("cannot be executed within a pipeline", SQLSTATE 25001). A file with one
-- statement is not a pipeline. See that file for the whole argument.
