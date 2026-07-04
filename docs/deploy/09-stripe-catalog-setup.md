# 09 — Stripe Setup (Catalog, Webhook, Tax, Dunning)

Everything the operator does on the Stripe side, in dependency order. Every fact
cites `file:line`. The catalog is created by a **checked-in idempotent script**,
not by hand in the dashboard — the dashboard work is limited to Tax, the webhook
endpoint, and confirming dunning defaults.

Run the whole Stripe setup **once per Stripe mode** (test, then live) — the
script, the webhook endpoint, and Tax are all per-mode
(`apps/api/scripts/stripe-setup.ts:4-6`).

---

## Step 1 — Get an API key with catalog-write

The setup script reads `STRIPE_SECRET_KEY` from its own process env and exits 1
if it is unset (`apps/api/scripts/stripe-setup.ts:28-35`). It creates Products,
Prices, and a Billing Meter, so the key must have **write** on all three.

- Simplest: run the script with a full secret key `sk_live_...`
  (`apps/api/scripts/stripe-setup.ts:6,32`).
- The **runtime** key the Worker uses (`STRIPE_SECRET_KEY` secret) can be a
  narrower **restricted key** `rk_live_...` — see the scope note in
  [env-and-secrets.md](./env-and-secrets.md) §Stripe. The catalog script and the
  runtime Worker read the same env var name but do not have to be the same key.

Source: `apps/api/src/billing/stripe.ts:25` constructs the client from
`env.STRIPE_SECRET_KEY`.

## Step 2 — Run the catalog script

From the repo, with the key in the environment:

```
STRIPE_SECRET_KEY=sk_live_... pnpm --filter @jobtext/api stripe:setup
```

(Exact invocation from the script header: `apps/api/scripts/stripe-setup.ts:6`.)

The script is **find-or-create idempotent** — reruns reuse existing objects and
just reprint the ids (`apps/api/scripts/stripe-setup.ts:16-19`). Idempotency
keys:
- Meter keyed by `event_name` (`stripe-setup.ts:44`).
- Products keyed by `metadata.jobtext_catalog` (`stripe-setup.ts:68`).
- Prices keyed by `lookup_key` (`stripe-setup.ts:86-90`).

### What it creates

**One Billing Meter** (`apps/api/scripts/stripe-setup.ts:49-55`):

| Field | Value | Source |
|---|---|---|
| `display_name` | `SMS segments` | `stripe-setup.ts:50` |
| `event_name` | `sms_segments` | `stripe-setup.ts:23,51` |
| `default_aggregation.formula` | `sum` | `stripe-setup.ts:52` |
| `customer_mapping` | `by_id`, payload key `stripe_customer_id` | `stripe-setup.ts:53` |
| `value_settings` | payload key `value` | `stripe-setup.ts:54` |

The meter's payload keys are load-bearing: the usage reporter sends exactly
`{ stripe_customer_id, value }` under event name `sms_segments`
(`apps/api/src/billing/meter.ts:33-40`).

**Three Products**, each with SaaS tax code `txcd_10103000`
(`apps/api/scripts/stripe-setup.ts:26,73-77`):

| catalog key | name | Source |
|---|---|---|
| `starter` | `JobText Starter` | `stripe-setup.ts:102` |
| `pro` | `JobText Pro` | `stripe-setup.ts:103` |
| `us_registration` | `US texting registration` | `stripe-setup.ts:104-107` |

**Six Prices** (all `tax_behavior: exclusive` — tax added on top):

| lookup_key | Product | Shape | Source |
|---|---|---|---|
| `jobtext_starter_licensed` | Starter | $29.00/mo flat (`unit_amount: 2900`, recurring monthly) | `stripe-setup.ts:110-116` |
| `jobtext_starter_overage` | Starter | metered, graduated: 0–500 @ $0, then $0.03/seg (`unit_amount: 3`); bound to the meter | `stripe-setup.ts:119-130` |
| `jobtext_pro_licensed` | Pro | $79.00/mo flat (`unit_amount: 7900`) | `stripe-setup.ts:133-139` |
| `jobtext_pro_overage` | Pro | metered, graduated: 0–2,500 @ $0, then $0.025/seg (`unit_amount_decimal: "2.5"`); bound to the meter | `stripe-setup.ts:144-155` |
| `jobtext_us_registration` | US registration | $29.00 one-time (`unit_amount: 2900`, no recurring) | `stripe-setup.ts:158-163` |

The metered prices use `usage_type: metered` + `meter: <meter.id>` and carry
**no quantity** at checkout — the metered line item is added with no `quantity`
(`apps/api/src/routes/billing.ts:150-154`, comment "Metered price: NO
quantity"). Plan limits (500 / 2,500 included segments, $0.03 / $0.025 overage)
are mirrored in code at `apps/api/src/billing/plans.ts:25-34`.

## Step 3 — Capture the six env ids the script prints

The script prints exactly these lines to **stdout** (the `console.log` calls;
progress goes to stderr) — `apps/api/scripts/stripe-setup.ts:165-171`:

```
STRIPE_SMS_METER_EVENT_NAME=sms_segments
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_STARTER_OVERAGE_PRICE_ID=price_...
STRIPE_PRO_OVERAGE_PRICE_ID=price_...
STRIPE_US_FEE_PRICE_ID=price_...
```

These become **six of the API Worker's encrypted secrets** — the Worker's env
schema requires all six (`apps/api/src/env.ts:32-38`). Map them:

- `STRIPE_STARTER_PRICE_ID` / `STRIPE_PRO_PRICE_ID` → the licensed price for each
  plan; also the key `planForLicensedPrice` matches to detect which plan a
  subscription carries (`apps/api/src/billing/plans.ts:42-59`).
- `STRIPE_STARTER_OVERAGE_PRICE_ID` / `STRIPE_PRO_OVERAGE_PRICE_ID` → the metered
  half of each subscription (`apps/api/src/billing/plans.ts:42-52`).
- `STRIPE_US_FEE_PRICE_ID` → the one-time fee line added at checkout when a
  company owes US registration and has never paid it
  (`apps/api/src/routes/billing.ts:157-159`), and the id the checkout handler
  matches to stamp `registration_fee_paid_at`
  (`apps/api/src/webhooks/stripe.ts:238-240`).
- `STRIPE_SMS_METER_EVENT_NAME` → the meter event name used by the usage
  reporter (`apps/api/src/billing/meter.ts:34`). Fixed value `sms_segments`.

## Step 4 — Enable Stripe Tax

Automatic tax is turned on **per checkout session in code**
(`automatic_tax: { enabled: true }` — `apps/api/src/routes/billing.ts:170`), and
every price is `tax_behavior: exclusive`. For that to actually compute tax,
**Stripe Tax must be activated** on the account (Dashboard → Tax → enable, set
the origin address and registrations). The SaaS tax code `txcd_10103000` is
already set on every product by the script (`stripe-setup.ts:26,75`), so no
per-product tax-code entry is needed in the dashboard.

## Step 5 — Register the webhook endpoint

This can only be done once the API custom domain exists (the `API_ORIGIN` value
— see [runbook.md](./runbook.md) §1/§6). The endpoint URL is:

```
https://api.jobtext.app/webhooks/stripe
```

The route is mounted at `/webhooks/stripe`, outside the JWT/CORS chain — the
Stripe signature is the authentication (`apps/api/src/index.ts:129`,
`apps/api/src/webhooks/stripe.ts:22-33`).

**Events to enable** on the endpoint — the handler switches on exactly this set
and no-ops anything else (`apps/api/src/webhooks/stripe.ts:124-143`,
`SPEC.md:1005-1010`):

| Event | Why it's needed | Source |
|---|---|---|
| `checkout.session.completed` | activate company, provision number, submit 10DLC, stamp fee | `webhooks/stripe.ts:125-126,187` |
| `customer.subscription.created` | mirror status/plan/period | `webhooks/stripe.ts:127,129` |
| `customer.subscription.updated` | mirror status/plan/period, `cancel_at_period_end` | `webhooks/stripe.ts:128-129` |
| `customer.subscription.deleted` | → canceled, suspend numbers, start grace | `webhooks/stripe.ts:131-132` |
| `invoice.paid` | → active, clear dunning; enable-us fee branch | `webhooks/stripe.ts:133-134` |
| `invoice.payment_failed` | → past_due, block outbound, email | `webhooks/stripe.ts:135-136` |
| `invoice.payment_action_required` | SCA email with hosted invoice link | `webhooks/stripe.ts:137-138` |

After creating the endpoint, copy its **Signing secret** (`whsec_...`) into the
API Worker secret `STRIPE_WEBHOOK_SECRET` (`apps/api/src/env.ts:15`). It is
verified over the raw body with `constructEventAsync` + WebCrypto
(`apps/api/src/webhooks/stripe.ts:44-50`, `apps/api/src/billing/stripe.ts:43`) —
the WebCrypto provider is mandatory on Workers (`billing/stripe.ts:12-16`).

## Step 6 — Confirm dunning + retry defaults

The code assumes Stripe's own retry behavior — it does not configure retries.
Per `SPEC.md:1017`: **Smart Retries at defaults (8 retries over 2 weeks)** with
post-exhaustion action = **cancel subscription** (which flows into the
`customer.subscription.deleted` → grace path). Set Dashboard → Billing → Subscriptions
and emails → **Manage failed payments** so exhaustion cancels the subscription.

## Notes on what the Worker does, NOT operator setup

These are automated by the running Worker and need no dashboard action — listed
so you don't try to configure them by hand:

- **Checkout sessions** are created per request in subscription mode with
  `client_reference_id = company_id`, success/cancel URLs under `APP_ORIGIN`
  (`apps/api/src/routes/billing.ts:161-173`).
- **Billing Portal** sessions are created on demand with `return_url` under
  `APP_ORIGIN` (`apps/api/src/routes/billing.ts:197-201`) — but the portal is
  used for payment methods / invoices / cancellation only; **plan switching is
  in-app**, so you do NOT need to build a portal product-catalog configuration
  for upgrades/downgrades (`apps/api/src/routes/billing.ts:182-184`, comment).
- **Meter events** are posted by the usage pipeline
  (`apps/api/src/billing/meter.ts:33-40`).
