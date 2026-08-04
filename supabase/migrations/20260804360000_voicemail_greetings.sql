-- [#309] A recorded voicemail greeting, in the owner's own voice.
--
-- Today the greeting is a text string spoken by TTS. For most software that is
-- a detail; for this market it works against the product's own pitch. Our
-- customers are a two-person outfit competing with a franchise, and their whole
-- advantage is being a real, local, reachable person — so the first thing a new
-- caller hears from them should not be the sound that, in 2026, most people
-- associate with a robocall.
--
-- THIS MIGRATION IS ADDITIVE ONLY. TTS stays the zero-setup default and the
-- runtime fallback; nothing here changes what an existing workspace does. A
-- greeting is SELECTED, and until one is, `voicemail_greeting_id` is null on
-- every company and every number.

-- ---------------------------------------------------------------------------
-- The greetings themselves.
--
-- Multiple NAMED greetings per workspace — after hours, holiday, on another
-- job, vacation — because one string cannot cover four situations and #278's
-- routing work needs something to route TO.
-- ---------------------------------------------------------------------------
create table if not exists public.voicemail_greetings (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  -- What the owner calls it, in a picker: "After hours", "On the truck".
  name          text not null,
  -- voicemail-greetings/{company_id}/{uuid}.{ext}, same company-first shape as
  -- `attachments`, so one RLS predicate authorizes the whole tenant tree.
  storage_path  text not null,
  -- Shown in the list so an owner can tell a 4-second greeting from a 40-second
  -- one without playing it, and used to refuse an upload that would keep a
  -- caller waiting through a monologue.
  duration_ms   integer not null check (duration_ms > 0 and duration_ms <= 120000),
  mime_type     text not null,
  byte_size     integer not null check (byte_size > 0),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),

  -- Two greetings called "After hours" in one picker is a support ticket.
  constraint voicemail_greetings_name_unique unique (company_id, name),
  constraint voicemail_greetings_name_len check (char_length(btrim(name)) between 1 and 60)
);

create index if not exists voicemail_greetings_company_idx
  on public.voicemail_greetings (company_id, created_at desc);

-- RLS: deny by default. The Worker holds the service-role key and bypasses it;
-- nothing else may read this. A greeting is the business's own voice and the
-- storage path is a signed-URL target, so an unauthenticated read of this table
-- would be a read of every workspace's audio location.
alter table public.voicemail_greetings enable row level security;

comment on table public.voicemail_greetings is
  'Recorded voicemail greetings in the business own voice (#309). TTS remains the default and the runtime fallback.';

-- ---------------------------------------------------------------------------
-- Which greeting plays.
--
-- `on delete set null`, deliberately, on BOTH columns. Deleting a recording
-- must put the line back on TTS, not leave it pointing at an object that is
-- gone — a caller hearing silence is the one outcome #309 names as worse than
-- hearing a robot, and a dangling reference is exactly how that happens.
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists voicemail_greeting_id uuid
    references public.voicemail_greetings (id) on delete set null;

-- Per number, because #307 established that a service line and a sales line
-- are two businesses. Null means INHERIT the company's, the same rule as every
-- other identity column — not "no greeting".
alter table public.phone_numbers
  add column if not exists voicemail_greeting_id uuid
    references public.voicemail_greetings (id) on delete set null;

comment on column public.companies.voicemail_greeting_id is
  'Selected recorded greeting (#309). NULL = speak companies.voicemail_greeting with TTS.';
comment on column public.phone_numbers.voicemail_greeting_id is
  'Per-number recorded greeting (#309). NULL = inherit the company selection.';

-- ---------------------------------------------------------------------------
-- A private, company-scoped bucket of its own.
--
-- Distinct from `attachments` because the limits are different in both
-- directions: a greeting is audio only and small (2 MB covers two minutes of
-- speech at a sane bitrate), where `attachments` accepts 25 MB of documents.
-- Sharing one bucket would mean the looser limit governs both.
--
-- Distinct from voicemail RECORDINGS for a reason the issue makes explicitly:
-- a greeting is the BUSINESS's own voice, not a customer's, so it carries none
-- of the consent weight in #279. Keeping them in separate buckets keeps that
-- distinction structural rather than a comment somebody has to remember.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voicemail-greetings',
  'voicemail-greetings',
  false,
  2097152,  -- 2 MB
  array[
    -- What the three clients actually produce when asked to record:
    -- Safari/iOS gives mp4/aac, Chrome/Android gives webm/opus, and a phone
    -- recording arrives from Telnyx as mp3 or wav.
    'audio/mpeg','audio/mp3','audio/mp4','audio/aac','audio/x-m4a',
    'audio/webm','audio/ogg','audio/wav','audio/x-wav'
  ]::text[]
)
on conflict (id) do nothing;
