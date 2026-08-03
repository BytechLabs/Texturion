-- #303 — the enforcement ladder gets a switch.
--
-- `/legal/aup` §8 publicly commits to a graduated response — ask, rate-limit,
-- suspend, terminate — and docs/AUP-ENFORCEMENT.md records that none of the
-- middle two existed anywhere but in prose. A policy promising a proportionate
-- step, with no way to take it, leaves exactly one real option when a carrier
-- complaint arrives: terminate the workspace. That is the outcome the ladder
-- was written to avoid.
--
-- ── WHY ITS OWN COLUMN, AND NOT phone_numbers.status ──────────────────────
--
-- The runbook is explicit and it is the most important line in this file:
-- `phone_numbers.status = 'suspended'` is the NON-PAYMENT path, and the Stripe
-- webhook clears it when an invoice is paid. Routing abuse enforcement through
-- it would mean a suspended spammer lifts their own suspension by paying a
-- bill — silently, with no human involved, through a code path whose author
-- never knew abuse existed. Enforcement needs a state nothing else writes.
--
-- ── WHY THE REASON IS NOT NULLABLE-BY-CONVENTION ──────────────────────────
--
-- §8 promises we say what happened and why, including when we skip straight to
-- suspension for a carrier or a court. A row that records a suspension with no
-- note is one nobody can honour that promise from three weeks later, when the
-- dispute arrives and the person who acted has forgotten. The constraint below
-- makes the note a condition of the state rather than a habit.

alter table public.companies
  add column if not exists aup_enforcement text not null default 'none',
  add column if not exists aup_enforcement_at timestamptz,
  add column if not exists aup_enforcement_note text;

alter table public.companies
  drop constraint if exists companies_aup_enforcement_check;
alter table public.companies
  add constraint companies_aup_enforcement_check
  check (aup_enforcement in ('none', 'rate_limited', 'suspended'));

-- Acting on a workspace means recording WHEN and WHY. 'none' carries neither,
-- so lifting genuinely clears the record rather than leaving a stale reason
-- attached to a workspace in good standing.
alter table public.companies
  drop constraint if exists companies_aup_enforcement_evidence;
alter table public.companies
  add constraint companies_aup_enforcement_evidence
  check (
    (aup_enforcement = 'none'
       and aup_enforcement_at is null
       and aup_enforcement_note is null)
    or (aup_enforcement <> 'none'
       and aup_enforcement_at is not null
       and length(coalesce(aup_enforcement_note, '')) >= 10)
  );

comment on column public.companies.aup_enforcement is
  'The #303 ladder step in force. NOT phone_numbers.status, which is the '
  'non-payment path the Stripe webhook clears — an abuse suspension must '
  'never be liftable by paying an invoice. ''rate_limited'' caps outbound; '
  '''suspended'' stops it while inbound, history and the number stay theirs.';

-- Ops reads "who is under enforcement right now", never the whole table.
create index if not exists companies_aup_enforcement_idx
  on public.companies (aup_enforcement)
  where aup_enforcement <> 'none';
