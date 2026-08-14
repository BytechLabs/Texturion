-- #232 — how a website visitor's consent is recorded, which is neither of the
-- two kinds this product already had.
--
-- `consent_source_t` was ('inbound_sms', 'attested'):
--
--   inbound_sms  they texted us first. IMPLIED consent, and the weakest kind
--                the rules recognise.
--   attested     a member said the customer agreed. Express, and only as good
--                as the member's memory of a conversation nobody recorded.
--
-- A widget opt-in is neither, and it is STRONGER than both. The customer typed
-- their own number into a form on the business's website, read the words beside
-- the button, and then proved they hold the handset by answering a code we
-- texted to it. #232 calls that "the cleanest possible ledger entry, far
-- stronger than a member typing the number in", and it is right: it is the only
-- one of the three where the customer's own action is recorded rather than
-- somebody's account of it.
--
-- Recording it as `inbound_sms` would be a lie about a legal record — implied
-- consent for something that was express — and recording it as `attested` would
-- credit a member with an attestation they never made.

alter type public.consent_source_t add value if not exists 'widget_form';

-- The express/implied mapping needs nothing: both existing sites read
-- `case when consent_source = 'inbound_sms' then 'implied' else 'express' end`,
-- so a widget opt-in is express by construction. That is the correct answer and
-- it is worth stating here, because the next reader will look for the branch
-- and not find one.

-- ---------------------------------------------------------------------------
-- The LEDGER keeps its own list, and it has to learn the word too.
--
-- `contact_consent_events.source` is a text column with its own closed check
-- constraint rather than the enum — deliberately, because the ledger records
-- events the enum has no member for (`stop_keyword`, `carrier`, `import`).
-- The cost of that is a second list, and the constraint refused the first run
-- of this migration by name, which is the list doing its job.
--
-- Rewritten wholesale rather than patched: a check constraint cannot be
-- extended in place, and naming the full set here means the next reader sees
-- what a consent event may say without cross-referencing two migrations.
-- ---------------------------------------------------------------------------
alter table public.contact_consent_events
  drop constraint if exists contact_consent_events_source_check;

alter table public.contact_consent_events
  add constraint contact_consent_events_source_check check (source in (
    'inbound_sms', 'attested', 'import', 'stop_keyword', 'start_keyword',
    'carrier', 'manual',
    -- #232: the customer typed their own number into a form on the business's
    -- website and then answered a code we texted to it.
    'widget_form'
  ));
