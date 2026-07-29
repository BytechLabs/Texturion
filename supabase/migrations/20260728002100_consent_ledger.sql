-- ===========================================================================
-- [#226] We record opt-OUT properly and have no timeline for opt-IN.
--
-- That is the wrong half to have. Opt-out protects the customer; **opt-in
-- protects the business owner**, and they are our user. Three parties
-- eventually ask a trade business to prove somebody agreed to be texted: a
-- TCPA plaintiff (consent is an affirmative defence — no record, no defence),
-- a carrier during a 10DLC audit, and CASL in Canada. In all three the
-- customer wears it, while using our product.
--
-- WHAT ALREADY EXISTED, because most of this was here under other names:
--
--   `contacts.consent_source / consent_at / consent_attested_by` — the CURRENT
--   basis. Set automatically on a first inbound (`inbound_sms`), by the §5
--   attestation checkbox, and now by CSV import (#226, edfa044).
--
--   `conversation_events` of type `consent_attested`, `opted_out` and
--   `opt_out_revoked` — an append-only timeline, but keyed on a CONVERSATION.
--
-- WHY A CONTACT-LEVEL TABLE IS STILL NEEDED, and this is the whole argument:
-- `conversation_events` has no `contact_id`. Consent is a property of a
-- PERSON, not of a thread — an imported contact has no conversation at all,
-- and an attestation from the contact panel has no natural thread either. So
-- the two highest-volume ways consent is established could not be recorded in
-- the timeline that records the others.
--
-- THIS IS A RECORD, NOT A SECOND SOURCE OF TRUTH. The columns stay the current
-- state and every gate keeps reading them; this is the evidence chain behind
-- them. Append-only, so a revocation and a later re-consent are two rows
-- rather than one column overwritten twice — precisely the history a demand
-- letter asks for and a single column cannot answer.
-- ===========================================================================

create table if not exists public.contact_consent_events (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid        not null references public.companies(id) on delete cascade,
  contact_id   uuid        not null references public.contacts(id)  on delete cascade,
  -- What this event establishes. `implied` is the trades common case (they
  -- texted us first); `express` is somebody vouching; `revoked` is a STOP.
  state        text        not null check (state in ('implied', 'express', 'revoked')),
  -- HOW it was established. Mirrors `contacts.consent_source` where one
  -- applies, plus the opt-out sources, so the ledger can hold the whole
  -- timeline rather than only its opt-in half.
  source       text        not null check (source in (
    'inbound_sms', 'attested', 'import', 'stop_keyword', 'start_keyword',
    'carrier', 'manual'
  )),
  captured_at  timestamptz not null default now(),
  -- The member who vouched, where a member vouched. Null for machine-derived
  -- events (an inbound text, a carrier STOP); NOT NULL would be a lie about
  -- who is answerable for those.
  captured_by  uuid,
  -- Whatever makes the row provable later: the message id for an inbound, the
  -- keyword for a STOP. Free-form on purpose — good evidence differs by
  -- source, and a rigid column set would push the useful part into a blob.
  evidence     jsonb       not null default '{}'::jsonb
);

comment on table public.contact_consent_events is
  '#226: append-only consent ledger, per CONTACT. contacts.consent_* stays the current state and the gates keep reading it; this is the evidence chain behind it.';

create index if not exists contact_consent_events_contact_idx
  on public.contact_consent_events (contact_id, captured_at desc);
create index if not exists contact_consent_events_company_idx
  on public.contact_consent_events (company_id, captured_at desc);

-- Service-role only, like every other ledger here.
alter table public.contact_consent_events enable row level security;

-- ---------------------------------------------------------------------------
-- APPEND-ONLY, ENFORCED BY THE DATABASE.
--
-- #226 asks for append-only, and that is a property somebody must be UNABLE to
-- break rather than a convention. A ledger that can be UPDATEd is one a future
-- handler can quietly rewrite — exactly what an evidence chain must not
-- permit, and how "we cannot show you that" happens.
--
-- DELETE stays allowed only so `on delete cascade` works when a contact is
-- genuinely purged (D48 closure, #346 account deletion). Nothing in the API
-- deletes these rows directly.
-- ---------------------------------------------------------------------------
create or replace function public.contact_consent_events_no_update()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'contact_consent_events is append-only (#226): record a new row instead of rewriting %',
    old.id;
end $$;

drop trigger if exists contact_consent_events_immutable on public.contact_consent_events;
create trigger contact_consent_events_immutable
  before update on public.contact_consent_events
  for each row execute function public.contact_consent_events_no_update();

-- ---------------------------------------------------------------------------
-- THE LEDGER WRITES ITSELF, and that is the point.
--
-- The obvious implementation is to call a recorder from each place that
-- establishes consent — the threading RPC, the attestation route, the CSV
-- import. That is three call sites today and four the moment somebody adds a
-- web widget (#232) or a public booking page (#335), and the failure mode is
-- silent: consent recorded on the contact, absent from the evidence file,
-- discovered when a lawyer asks.
--
-- A trigger on the transition makes it structural. `contacts.consent_at` going
-- from NULL to a value IS the act of establishing consent — every path already
-- performs it, including the two that had no timeline before — so the ledger
-- cannot be forgotten by a future writer who does not know this table exists.
--
-- Only the NULL → value transition fires. The threading RPC coalesces so a
-- first inbound sets it once and later ones do not, and this mirrors that: a
-- contact consents once, and a re-consent after a STOP is a different event
-- with its own source (recorded by the opt-out path, not here).
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
    (company_id, contact_id, state, source, captured_by, captured_at, evidence)
  values (
    new.company_id,
    new.id,
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

drop trigger if exists contacts_consent_ledger on public.contacts;
create trigger contacts_consent_ledger
  after insert or update of consent_at on public.contacts
  for each row execute function public.contacts_record_consent();

-- ---------------------------------------------------------------------------
-- Backfill, so the ledger is not empty for every contact that already exists.
--
-- Every contact currently carrying a consent basis got it from one of the
-- paths above; the evidence chain should start where the consent did, not
-- where this migration ran. `captured_at` is the recorded `consent_at` for
-- exactly that reason.
--
-- destructive-ok: inserts only, into a table created moments ago.
-- ---------------------------------------------------------------------------
insert into public.contact_consent_events
  (company_id, contact_id, state, source, captured_by, captured_at, evidence)
select
  c.company_id,
  c.id,
  case when c.consent_source = 'inbound_sms' then 'implied' else 'express' end,
  c.consent_source::text,
  c.consent_attested_by,
  c.consent_at,
  jsonb_build_object('backfilled', true, 'created_by_user_id', c.created_by_user_id)
from public.contacts c
where c.consent_at is not null
  and c.consent_source is not null;
