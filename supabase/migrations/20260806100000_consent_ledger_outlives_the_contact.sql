-- ===========================================================================
-- [#248] The consent ledger is only half append-only.
--
-- THE HOLE. `contact_consent_events_immutable` is BEFORE UPDATE only. There is
-- no DELETE trigger, and `contact_consent_events_contact_id_fkey` is
-- ON DELETE CASCADE. So the ledger cannot be rewritten and can be erased
-- outright: deleting one contact row takes their whole revocation history with
-- it — the "they told you to stop on the 3rd" row, which is the single record a
-- carrier audit or a demand letter is actually about.
--
-- IT IS NOT HYPOTHETICAL. `purge_workspace_step` (20260726000500, latest
-- definition 20260805160000) deletes `contacts`, so a workspace closure already
-- erases every consent event we hold — while
-- docs/PERSONAL-DATA-INVENTORY.md says `contact_consent_events` is kept for
-- three years, stripped, and docs/DELETION.md lists it as one of the two things
-- that deliberately outlive the workspace. The schema and the promise disagree,
-- and the schema is winning.
--
-- THE DECISION, and the argument for it.
--
--   BLOCKING THE DELETE is unavailable. A BEFORE DELETE trigger that raised
--   would fire on the workspace purge too — Postgres cannot tell a cascade from
--   a hand-written DELETE — so it would make a closed workspace impossible to
--   erase. #227 and D48 require the opposite, and a deletion feature that
--   cannot delete is a worse defect than the one being fixed.
--
--   DETACHING THE LEDGER FROM THE CONTACT is what the product already does one
--   table over. `opt_outs` is keyed on the PHONE, not the contact, and survives
--   a contact deletion today: DELETION.md's own words are "the phone number
--   *is* the record". The revocation ledger records the same fact about the
--   same person, so it belongs to the number for the same reason. A contact row
--   is this workspace's file about somebody; the fact that they said stop is
--   not.
--
-- So: `contact_id` becomes nullable and detaches on delete, and the row carries
-- the phone itself. Deleting a contact still erases the workspace's file on
-- them — the name, the address, the notes — and leaves the two facts that were
-- never the workspace's to erase: that this number was told to stop, and when.
--
-- WHAT THIS IS NOT. It does not weaken erasure. `company_id` still cascades, so
-- nothing here escapes a company delete; the ledger holds no name, no email, no
-- address and no message body (see the column comments in 20260728002100), and
-- what remains is exactly the minimum DELETION.md commits to keeping.
--
-- Nor does it weaken append-only: the detach is the ONE update this table now
-- permits, it is spelled out below, and it changes nothing the ledger asserts.
-- ===========================================================================

-- Fail fast rather than queue behind a long reader — see 20260806090000.
set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- The subject of the row, in the row.
--
-- Nullable, because it is unknowable for any pre-existing row whose contact has
-- already been deleted — and a NOT NULL we would have to invent a value for is
-- how a ledger starts telling small lies.
-- ---------------------------------------------------------------------------
alter table public.contact_consent_events
  add column if not exists phone_e164 text;

comment on column public.contact_consent_events.phone_e164 is
  '#248: the number this event is about. The ledger outlives the contact row (a deleted contact detaches rather than cascading), and after that this is the only handle on who it was — the same reason opt_outs is keyed on the phone.';

-- ---------------------------------------------------------------------------
-- THE BACKFILL IS AN UPDATE, AND THIS TABLE REFUSES UPDATES. Widen the rule
-- first, for the length of this file only.
--
-- Found by running it, not by reading it, and it is worth saying exactly how it
-- hid: `supabase db reset` applies migrations to an EMPTY database, so the loop
-- below matches zero rows on its first pass and exits. Green locally, dead on
-- the first deploy — every environment that has been running since #226 holds
-- ledger rows, and 20260806090000's own backfill inserts more of them one file
-- earlier. Probed against the live schema with a row present:
--
--   backfill under the rule as this file finds it  -> RAISED (append-only)
--   backfill under the narrowed rule installed below -> RAISED (append-only)
--
-- So MOVING the backfill below the new function would not have fixed it either:
-- the narrowed rule permits contact_id → NULL and nothing else, and this writes
-- `phone_e164`.
--
-- WHY WIDEN-THEN-NARROW RATHER THAN `DISABLE TRIGGER`. Switching the trigger off
-- around the backfill would permit EVERY rewrite for that window, including one
-- arriving from the application, which is the guarantee this table exists to
-- make. This permits exactly one more shape than the final rule — filling in a
-- column that did not exist when the row was written, with every other column
-- byte-identical — and it stops permitting it at the bottom of this file. A fill
-- is not a rewrite: the row asserted nothing about the phone before, because
-- there was nowhere to assert it.
--
-- The widened form is restated at the top so a re-run after the batch cap still
-- works: the recovery this file documents is running it again.
-- ---------------------------------------------------------------------------
create or replace function public.contact_consent_events_no_update()
returns trigger
language plpgsql
as $$
declare
  v_filled public.contact_consent_events%rowtype;
begin
  -- TEMPORARY, and narrowed at the bottom of this same file.
  if old.phone_e164 is null and new.phone_e164 is not null then
    v_filled := old;
    v_filled.phone_e164 := new.phone_e164;
    if to_jsonb(new) = to_jsonb(v_filled) then
      return new;
    end if;
  end if;
  raise exception
    'contact_consent_events is append-only (#226): record a new row instead of rewriting %',
    old.id;
end $$;

-- Backfill from the contacts still present, in bounded batches for the reason
-- given in 20260806090000: a single statement whose size nobody chose.
--
-- destructive-ok: writes one previously-absent column on rows that have no
-- value for it, and never overwrites one.
do $$
declare
  v_batch    constant int := 1000;
  v_max_runs constant int := 1000;
  v_runs     int := 0;
  v_done     int;
  v_total    int := 0;
begin
  loop
    update public.contact_consent_events e
       set phone_e164 = c.phone_e164
      from public.contacts c
     where c.id = e.contact_id
       and e.phone_e164 is null
       and e.id in (
         select e2.id
           from public.contact_consent_events e2
          where e2.phone_e164 is null
            and e2.contact_id is not null
          limit v_batch);
    get diagnostics v_done = row_count;
    v_total := v_total + v_done;
    v_runs := v_runs + 1;
    exit when v_done = 0;
    if v_runs >= v_max_runs then
      raise warning
        '[#248] consent ledger phone backfill stopped at the % row cap after % rows — re-run; it is idempotent',
        v_batch * v_max_runs, v_total;
      exit;
    end if;
  end loop;
  raise notice '[#248] consent ledger phone backfill wrote % row(s)', v_total;
end $$;

-- ---------------------------------------------------------------------------
-- Detach on delete.
--
-- The FK is replaced rather than dropped: while the contact exists, the ledger
-- should still point at it, and a dangling id would be worse evidence than a
-- null one. NOT VALID then VALIDATE, the deploy-safe two-step — adding a
-- validated FK in one statement takes SHARE ROW EXCLUSIVE on both tables for
-- the whole scan, and VALIDATE takes only SHARE UPDATE EXCLUSIVE.
-- ---------------------------------------------------------------------------
alter table public.contact_consent_events
  alter column contact_id drop not null;

-- ---------------------------------------------------------------------------
-- APPEND-ONLY HAD TO LEARN THE DIFFERENCE BETWEEN A REWRITE AND A DETACH.
--
-- `ON DELETE SET NULL` is an UPDATE, and `contact_consent_events_immutable`
-- (20260728002100) refuses every UPDATE — so the first version of this
-- migration made the two guarantees collide and deleting a contact simply
-- failed. Which was the right way to find out: the ledger's immutability is
-- doing its job, and the fix has to be a narrower rule rather than a hole.
--
-- THE ONE PERMITTED MUTATION is the detach, and only the detach: contact_id
-- going from a value to NULL with every other column byte-identical. It changes
-- nothing the ledger asserts — not the state, not the source, not when, not the
-- number — it removes a pointer to a row that no longer exists. Everything else
-- still raises, including an update that performs the detach and edits
-- something else in the same statement.
--
-- Compared through `to_jsonb` rather than row equality: `=` on composite values
-- yields NULL when any field is NULL, and half these columns are nullable, so a
-- row comparison would silently wave through the case it exists to catch.
--
-- THIS ALSO NARROWS THE BACKFILL'S PERMISSION BACK OUT. The version above this
-- one also allowed `phone_e164` NULL → value; from here on it does not, because
-- the fill was a one-time migration act and a permission kept "just in case" is
-- a permission somebody eventually uses.
-- ---------------------------------------------------------------------------
create or replace function public.contact_consent_events_no_update()
returns trigger
language plpgsql
as $$
declare
  v_detached public.contact_consent_events%rowtype;
begin
  if old.contact_id is not null and new.contact_id is null then
    v_detached := old;
    v_detached.contact_id := null;
    if to_jsonb(new) = to_jsonb(v_detached) then
      return new;
    end if;
  end if;
  raise exception
    'contact_consent_events is append-only (#226): record a new row instead of rewriting %',
    old.id;
end $$;

alter table public.contact_consent_events
  drop constraint if exists contact_consent_events_contact_id_fkey;

alter table public.contact_consent_events
  add constraint contact_consent_events_contact_id_fkey
  foreign key (contact_id) references public.contacts(id)
  on delete set null
  not valid;

alter table public.contact_consent_events
  validate constraint contact_consent_events_contact_id_fkey;

-- The handle a detached row is found by. `contact_consent_events_contact_idx`
-- answers "this person's history" only while the contact exists; after a delete
-- the phone is the question and there was no index for it.
--
-- NOT `CONCURRENTLY`, unlike 20260806090100, and the difference is the table
-- rather than a preference. That one is `conversation_events` — one of the
-- largest and hottest we have — so an ACCESS EXCLUSIVE build there is an
-- outage. This one is the consent ledger, which holds a handful of rows per
-- contact, and this very file already takes ACCESS EXCLUSIVE on it twice (the
-- ADD COLUMN and the constraint swap). A concurrent build would buy nothing
-- here and would cost this migration its ability to be one file.
create index if not exists contact_consent_events_phone_idx
  on public.contact_consent_events (company_id, phone_e164, captured_at desc);

-- ---------------------------------------------------------------------------
-- The three writers now record the phone.
--
-- `create or replace`, restating each WHOLE body, because a shipped migration is
-- never edited (D7/D14). The base copied is the LATEST definition of each — the
-- trap 20260805160000 wrote down after nearly dropping a table from a purge
-- list by copying the original: `contacts_record_consent` from 20260728002100,
-- `opt_outs_record_consent` from 20260728002200, and
-- `contacts_record_standing_revocation` from 20260806090000. The only change in
-- each is the new column.
-- ---------------------------------------------------------------------------
create or replace function public.contacts_record_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.consent_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.consent_at is not null then
    return new;
  end if;

  insert into public.contact_consent_events
    (company_id, contact_id, phone_e164, state, source, captured_by, captured_at, evidence)
  values (
    new.company_id,
    new.id,
    new.phone_e164,
    -- An inbound text is IMPLIED consent (they contacted us). A member
    -- vouching is EXPRESS — they are asserting the customer said yes.
    case when new.consent_source = 'inbound_sms' then 'implied' else 'express' end,
    coalesce(new.consent_source::text, 'manual'),
    new.consent_attested_by,
    new.consent_at,
    -- The contact's own creator, which for an import is the importer and for a
    -- by-hand add is the member. Enough to answer "who is answerable for this"
    -- without the trigger needing to know which route it was called from.
    jsonb_build_object('created_by_user_id', new.created_by_user_id)
  );
  return new;
end $$;

create or replace function public.opt_outs_record_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact_id uuid;
  v_revoking   boolean;
begin
  -- A revocation is: a new active row, or an existing one becoming active
  -- again. A re-consent is: an active row being revoked (START/undo).
  if tg_op = 'INSERT' then
    v_revoking := new.revoked_at is null;
  else
    if (old.revoked_at is null) = (new.revoked_at is null) then
      return new;   -- some other column moved; nothing about consent changed
    end if;
    v_revoking := new.revoked_at is null;
  end if;

  -- The ledger is per CONTACT and opt_outs is per PHONE. A STOP from a number
  -- we have no contact for is still honoured by the gate — it simply has no
  -- ledger row, because there is no person to record it against.
  select ct.id into v_contact_id
    from public.contacts ct
   where ct.company_id = new.company_id
     and ct.phone_e164 = new.phone_e164
   limit 1;
  if v_contact_id is null then
    return new;
  end if;

  insert into public.contact_consent_events
    (company_id, contact_id, phone_e164, state, source, captured_by, captured_at, evidence)
  values (
    new.company_id,
    v_contact_id,
    new.phone_e164,
    case when v_revoking then 'revoked' else 'express' end,
    case
      when v_revoking then new.source::text
      -- Coming back from a revocation. A customer texting START is the only
      -- way that happens on its own; anything else was a member undoing a
      -- record they made, which is `manual`.
      when new.source::text = 'stop_keyword' then 'start_keyword'
      else 'manual'
    end,
    new.created_by,
    coalesce(case when v_revoking then new.created_at else new.revoked_at end, now()),
    jsonb_build_object(
      'phone_e164', new.phone_e164,
      'opt_out_id', new.id,
      'opt_out_source', new.source::text)
  );
  return new;
end $$;

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
    (company_id, contact_id, phone_e164, state, source, captured_by, captured_at, evidence)
  values (
    new.company_id,
    new.id,
    new.phone_e164,
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

comment on table public.contact_consent_events is
  '#226/#248: append-only consent ledger, per PERSON. contacts.consent_* stays the current state and the gates keep reading it; this is the evidence chain behind it. It outlives the contact row — deleting a contact detaches it and leaves phone_e164 — because a revocation belongs to the person who sent it, exactly as opt_outs does.';
