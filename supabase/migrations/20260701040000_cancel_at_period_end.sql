-- SPEC §9 (`customer.subscription.created`/`updated` row): "handle
-- cancel_at_period_end display". A pending Stripe cancellation is mirrored
-- onto the company so the billing settings screen can say "Your plan ends on
-- {current_period_end}" while the subscription is still active. Synced by
-- apps/api/src/webhooks/stripe.ts (syncSubscription + checkout/deleted
-- handlers) and exposed through the company view (GET /v1/company, GET /v1/me).
alter table public.companies
  add column cancel_at_period_end boolean not null default false;
