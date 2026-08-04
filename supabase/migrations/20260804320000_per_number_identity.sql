-- #307 — a second number is a second business.
--
-- Greeting, hours, timezone, away reply and caller-ID name are all company-
-- scoped today. A workspace running a service line and a sales line gets one
-- identity across both: the same greeting, the same hours, the same away
-- message. For anybody who bought a second number precisely because it is a
-- different business, the product quietly makes it the same one.
--
-- ── NULL MEANS INHERIT, AND NEVER "EMPTY" ─────────────────────────────────
--
-- Every column below is nullable, and null is not "no greeting" — it is "use
-- the workspace's". That distinction is the whole migration: it makes the
-- deploy a no-op (every existing number is null, so every number keeps
-- behaving exactly as it does today) and it is what lets the UI honestly show
-- a value as INHERITED rather than as a blank somebody must fill in.
--
-- It also means clearing an override restores the workspace value rather than
-- silencing the line, which is the failure a NOT NULL default would have
-- baked in: an owner who empties a greeting field would get silence on a live
-- call instead of the greeting they started with.
--
-- ── WHAT IS NOT HERE ──────────────────────────────────────────────────────
--
-- No resolution logic. The precedence rule lives in TypeScript
-- (`packages/shared/src/number-identity.ts`) so the runtime, the API and all
-- three clients read one implementation — a rule this small, written twice,
-- is the drift #437 is about. The database's job is to record the override
-- and to be unable to represent "empty" by accident.

alter table public.phone_numbers
  -- The line's own name, and the reason the rest of this exists. "Reed
  -- Roofing Service" answering a service call and "Reed Roofing Sales"
  -- answering a sales one is the whole point of a second number.
  add column if not exists label text
    check (label is null or length(btrim(label)) between 1 and 60),
  add column if not exists voicemail_greeting text
    check (voicemail_greeting is null or length(voicemail_greeting) <= 1000),
  add column if not exists away_message text
    check (away_message is null or length(away_message) <= 1000),
  -- Tri-state on purpose: null inherits, true and false are real overrides.
  -- A boolean defaulting to false could not express "this line follows the
  -- workspace", which is what every existing number needs to keep doing.
  add column if not exists away_enabled boolean,
  add column if not exists timezone text,
  add column if not exists business_hours jsonb,
  add column if not exists business_hours_exceptions jsonb;

comment on column public.phone_numbers.label is
  '#307: this line''s own name. Null inherits the company name. Used by the '
  'greeting, the caller-ID name and the automated replies together, so a '
  'caller meets ONE identity rather than a different one per surface.';

comment on column public.phone_numbers.voicemail_greeting is
  '#307: null INHERITS companies.voicemail_greeting — it is not "no greeting". '
  'Clearing an override restores the workspace value rather than silencing '
  'the line, which is what a NOT NULL default would have made possible.';

-- Reading "which numbers override anything" is how the settings UI decides
-- what to mark inherited, and it is the only query these columns serve.
create index if not exists phone_numbers_identity_override_idx
  on public.phone_numbers (company_id)
  where label is not null
     or voicemail_greeting is not null
     or away_message is not null
     or away_enabled is not null
     or timezone is not null
     or business_hours is not null;
