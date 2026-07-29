-- #393 — first-message sender identification, as a setting that is OFF.
--
-- D4 auto-appended `— {Business name}. Reply STOP to opt out` to the first
-- outbound message to a contact, and the owner had it removed in 2026-07: on a
-- text to somebody who just phoned you, a footer reads as marketing. That
-- decision is not reversed here. This column DEFAULTS FALSE, so no company
-- gains a footer and no message anybody sends today changes.
--
-- WHAT THIS UNBLOCKS. #393 asked for a "default-on setting the owner can switch
-- off" and said explicitly that nothing should be built until a lawyer answers
-- whether CASL s.6(2) requires the identification (tracked as L1). That coupling
-- conflated two separate questions:
--
--   * whether identification is REQUIRED — statutory, unanswerable here, and it
--     decides this column's DEFAULT;
--   * whether the capability should EXIST — which is a deliverability question,
--     and ours.
--
-- The second changed on 2026-07-29. #379 established there is no CA→CA
-- registration to obtain and that Canadian carriers filter long-code A2P at
-- their own discretion, by their own statement, permanently. With registration
-- unavailable as a remedy, what is left is toll-free (#329) and the content
-- signals carriers score — and an unidentified first message from an
-- unrecognised long code is exactly what spam heuristics flag.
--
-- So the code ships defaulted off, and L1's answer becomes a default flip
-- rather than a three-client build on the critical path. Turning it ON is a
-- deliberate act by an owner, which is the property #393 wanted.
--
-- contacts.first_identification_sent_at already exists. D4's reversal stopped
-- writing it but deliberately kept the column; this makes it live again as the
-- once-per-contact ledger, so the text lands for a stranger and never again.

alter table public.companies
  add column if not exists first_message_identification boolean not null default false;

comment on column public.companies.first_message_identification is
  'When true, the first outbound message to a contact gets "— {Business name}. Reply STOP to opt out" appended server-side (#393, D4). Default FALSE: D4''s 2026-07 reversal removed the enforced footer and this does not undo it. Once per contact, tracked by contacts.first_identification_sent_at. Turning it on is an owner decision; the CASL s.6(2) question that would change the default is L1.';

comment on column public.contacts.first_identification_sent_at is
  'When this contact was first sent sender-identification text (#393). Non-null suppresses the suffix on every later send — the point is telling a stranger who is texting, and after one message they are not a stranger. Written only while companies.first_message_identification is on. Was vestigial between D4''s 2026-07 reversal and #393.';
