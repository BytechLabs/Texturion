-- #317 — a crew member can pull a file back for EVERYONE, not just for themselves.
--
-- The scan (D101) runs on ingest and stops what it can recognise. It is not
-- antivirus and its own header says so: a novel payload inside a well-formed
-- document still lands. When that happens the person who notices is a tech
-- looking at a file that does not smell right, and the only useful thing they
-- can do about it has to affect the whole workspace — the file is already in
-- the office manager's inbox too.
--
-- WHY A FLAG AND NOT A DELETE. Deleting destroys the evidence and is
-- irreversible by a member acting on a hunch. Quarantine is reversible by an
-- owner, keeps the row for the audit trail, and — because every download in
-- this product goes through a signed-URL MINT the Worker performs — a flag the
-- mint honours is a hard stop rather than an advisory one. There is no
-- pre-existing URL to invalidate: mints are short-lived by construction (D19
-- §2.5), so the exposure window closes on its own.
--
-- BOTH TABLES, because both are reachable from the same `/v1/attachments/:id`
-- routes and a customer's MMS photo is exactly as likely to be the problem as
-- an uploaded document. Same three columns, same meaning, so the route can
-- resolve either arm without branching on shape.

alter table public.attachments
  add column if not exists quarantined_at         timestamptz,
  add column if not exists quarantined_by_user_id uuid references public.profiles(user_id) on delete set null,
  -- The reporter's own words, bounded. Free text from a MEMBER (not from the
  -- public), shown to the owner deciding whether to release it. Bounded
  -- because it renders in a timeline: 280 is a sentence, not a payload.
  add column if not exists quarantine_note        text check (char_length(quarantine_note) <= 280);

alter table public.message_attachments
  add column if not exists quarantined_at         timestamptz,
  add column if not exists quarantined_by_user_id uuid references public.profiles(user_id) on delete set null,
  add column if not exists quarantine_note        text check (char_length(quarantine_note) <= 280);

-- The gallery and the mint both filter on "not quarantined", and both are
-- already company-scoped. Partial indexes on the QUARANTINED rows keep the
-- common path (everything is clean) paying nothing while making the owner's
-- "what has been reported?" view cheap.
create index if not exists attachments_quarantined_idx
  on public.attachments (company_id, quarantined_at desc)
  where quarantined_at is not null;

create index if not exists message_attachments_quarantined_idx
  on public.message_attachments (company_id, quarantined_at desc)
  where quarantined_at is not null;

comment on column public.attachments.quarantined_at is
  '#317: set when a member reports the file. The signed-URL mint refuses while '
  'this is non-null, so quarantine stops downloads for the whole workspace.';
comment on column public.message_attachments.quarantined_at is
  '#317: set when a member reports the file. The signed-URL mint refuses while '
  'this is non-null, so quarantine stops downloads for the whole workspace.';
