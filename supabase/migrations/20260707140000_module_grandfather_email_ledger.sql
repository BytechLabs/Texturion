-- #17 / #52 billing lifecycle hardening.
--
-- 1) company_modules.grandfathered — the module mirror now RECONCILES to the
--    Stripe subscription's actual module line items (webhooks + the daily
--    reconcile), disabling any billable module that has no paid item. The
--    20260704160000/20260704170000 seeds granted live pre-#12 companies their
--    exercised capabilities WITHOUT a paid line item; those rows must survive
--    reconciliation, so they get an explicit flag instead of a fragile
--    timestamp heuristic. The flag self-heals: the first sync that sees a PAID
--    line item for the module clears it (the company pays now, so from then on
--    the subscription is the truth), and every new enablement (checkout or the
--    module toggle) writes grandfathered = false.
--
-- 2) email_ledger — insert-first idempotency for one-shot customer emails sent
--    from webhook processing (the port-documents nudge, per-attempt dunning).
--    The webhook_events ledger dedupes duplicate DELIVERIES, but the sweeper
--    replays a partially-failed handler WHOLE — without a per-email stamp a
--    transient Telnyx failure after the send re-sends the same email on every
--    retry. Same shape as grace_notices: claim the PK first, send only when
--    the insert landed.

alter table public.company_modules
  add column grandfathered boolean not null default false;

comment on column public.company_modules.grandfathered is
  'Seeded pre-#12 capability with no paid line item — exempt from the #17 subscription reconcile; cleared the moment the module is actually paid for.';

-- Backfill: every row still enabled at this point predates reconciliation and
-- is either a grandfather seed or an early purchase. Marking both is safe —
-- an early PURCHASE has its price on the live subscription, so the very next
-- subscription sync clears the flag again; a seed keeps it, which is the point.
-- Explicitly-disabled rows stay unflagged (they carry no capability to protect).
update public.company_modules
   set grandfathered = true
 where disabled_at is null;

create table public.email_ledger (              -- one-shot webhook-tail email idempotency (#52)
  company_id uuid not null references public.companies(id) on delete cascade,
  email_key  text not null,                     -- e.g. 'port_documents_needed:<port id>', 'invoice_payment_failed:<invoice id>:<attempt>'
  sent_at    timestamptz not null default now(),
  primary key (company_id, email_key)
);

-- Service-role only (like the rest of the billing substrate); the rls.sql
-- default-privilege revoke already strips anon/authenticated from new tables.
alter table public.email_ledger enable row level security;
