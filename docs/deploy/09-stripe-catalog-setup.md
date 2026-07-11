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
if it is unset (`apps/api/scripts/stripe-setup.ts:46-53`). It creates Products,
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
STRIPE_SECRET_KEY=sk_live_... pnpm --filter @loonext/api stripe:setup
```

(Exact invocation from the script header: `apps/api/scripts/stripe-setup.ts:6`.)

The script is **find-or-create idempotent** — reruns reuse existing objects and
just reprint the ids (`apps/api/scripts/stripe-setup.ts:16-19`). Idempotency
keys:
- Meter keyed by `event_name` (`stripe-setup.ts:62`).
- Products keyed by `metadata.loonext_catalog` (`stripe-setup.ts:86`).
- Prices keyed by `lookup_key` (`stripe-setup.ts:104-108`).

### What it creates

**One Billing Meter** (`apps/api/scripts/stripe-setup.ts:67-73`):

| Field | Value | Source |
|---|---|---|
| `display_name` | `SMS segments` | `stripe-setup.ts:68` |
| `event_name` | `sms_segments` | `stripe-setup.ts:23,69` |
| `default_aggregation.formula` | `sum` | `stripe-setup.ts:70` |
| `customer_mapping` | `by_id`, payload key `stripe_customer_id` | `stripe-setup.ts:71` |
| `value_settings` | payload key `value` | `stripe-setup.ts:72` |

The meter's payload keys are load-bearing: the usage reporter sends exactly
`{ stripe_customer_id, value }` under event name `sms_segments`
(`apps/api/src/billing/meter.ts:33-40`).

**Seven Products**, each with SaaS tax code `txcd_10103000`
(`apps/api/scripts/stripe-setup.ts:26,91-95`):

| catalog key | name | Source |
|---|---|---|
| `starter` | `Loonext Starter` | `stripe-setup.ts:120` |
| `pro` | `Loonext Pro` | `stripe-setup.ts:121` |
| `us_registration` | `US texting registration` | `stripe-setup.ts:122-125` |
| `module_mms` | `Loonext — Picture messages` | `stripe-setup.ts:40,186-190` |
| `module_voice` | `Loonext — Calling` | `stripe-setup.ts:41,186-190` |
| `module_extra_storage` | `Loonext — Extra storage` | `stripe-setup.ts:42,186-190` |
| `module_regions_ca` | `Loonext — Canada numbers` | `stripe-setup.ts:43,186-190` |

**Ten Prices** (all `tax_behavior: exclusive` — tax added on top):

| lookup_key | Product | Shape | Source |
|---|---|---|---|
| `loonext_starter_licensed` | Starter | $29.00/mo flat (`unit_amount: 2900`, recurring monthly) | `stripe-setup.ts:128-134` |
| `loonext_starter_overage` | Starter | metered, graduated: 0–500 @ $0, then $0.03/seg (`unit_amount: 3`); bound to the meter | `stripe-setup.ts:137-148` |
| `loonext_pro_licensed` | Pro | $79.00/mo flat (`unit_amount: 7900`) | `stripe-setup.ts:151-157` |
| `loonext_pro_overage` | Pro | metered, graduated: 0–2,500 @ $0, then $0.025/seg (`unit_amount_decimal: "2.5"`); bound to the meter | `stripe-setup.ts:162-173` |
| `loonext_us_registration` | US registration | $29.00 one-time (`unit_amount: 2900`, no recurring) | `stripe-setup.ts:176-181` |
| `loonext_module_mms_licensed` | Picture messages | $5.00/mo flat (`unit_amount: 500`) | `stripe-setup.ts:40,191-197` |
| `loonext_module_voice_licensed` | Calling | $8.00/mo flat (`unit_amount: 800`) | `stripe-setup.ts:41,191-197` |
| `loonext_module_extra_storage_licensed` | Extra storage | $5.00/mo flat (`unit_amount: 500`) | `stripe-setup.ts:42,191-197` |
| `loonext_module_regions_ca_licensed` | Canada numbers | $5.00/mo flat (`unit_amount: 500`) | `stripe-setup.ts:43,191-197` |

The metered prices use `usage_type: metered` + `meter: <meter.id>` and carry
**no quantity** at checkout — the metered line item is added with no `quantity`
(`apps/api/src/routes/billing.ts:172-177`, comment "Metered price: NO
quantity"). Plan limits (500 / 2,500 included segments, $0.03 / $0.025 overage)
are mirrored in code at `apps/api/src/billing/plans.ts:25-34`. The module price
list must stay in sync with `MODULE_CATALOG` in
`apps/api/src/billing/modules.ts:51-90` (`stripe-setup.ts:29-33`, comment).

## Step 3 — Capture the ten env ids the script prints

The script prints exactly these lines to **stdout** (the `console.log` calls;
progress goes to stderr) — `apps/api/scripts/stripe-setup.ts:201-210`:

```
STRIPE_SMS_METER_EVENT_NAME=sms_segments
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_STARTER_OVERAGE_PRICE_ID=price_...
STRIPE_PRO_OVERAGE_PRICE_ID=price_...
STRIPE_US_FEE_PRICE_ID=price_...
STRIPE_MODULE_MMS_PRICE_ID=price_...
STRIPE_MODULE_VOICE_PRICE_ID=price_...
STRIPE_MODULE_EXTRA_STORAGE_PRICE_ID=price_...
STRIPE_MODULE_REGIONS_CA_PRICE_ID=price_...
```

These become **ten of the API Worker's encrypted secrets**. The env schema
*requires* the six plan/meter ids (`apps/api/src/env.ts:53-57,69`) and accepts
the four `STRIPE_MODULE_*` ids as schema-optional (`apps/api/src/env.ts:64-67` —
optional only so the Worker boots before the catalog exists). **Set all ten**:
an unset module id makes that add-on unsellable — checkout and the module
toggle refuse it with "isn't available yet"
(`apps/api/src/routes/billing.ts:190-200,553-559`,
`apps/api/src/billing/modules.ts:103-114`). Map them:

- `STRIPE_STARTER_PRICE_ID` / `STRIPE_PRO_PRICE_ID` → the licensed price for each
  plan; also the key `planForLicensedPrice` matches to detect which plan a
  subscription carries (`apps/api/src/billing/plans.ts:127,140`).
- `STRIPE_STARTER_OVERAGE_PRICE_ID` / `STRIPE_PRO_OVERAGE_PRICE_ID` → the metered
  half of each subscription (`apps/api/src/billing/plans.ts:127`).
- `STRIPE_US_FEE_PRICE_ID` → the one-time fee line added at checkout when a
  company owes US registration and has never paid it
  (`apps/api/src/routes/billing.ts:180-182`), and the id the checkout handler
  matches to stamp `registration_fee_paid_at`
  (`apps/api/src/webhooks/stripe.ts:318-322`).
- `STRIPE_MODULE_MMS_PRICE_ID` / `STRIPE_MODULE_VOICE_PRICE_ID` /
  `STRIPE_MODULE_EXTRA_STORAGE_PRICE_ID` / `STRIPE_MODULE_REGIONS_CA_PRICE_ID`
  → the flat monthly licensed price of each #12 opt-in add-on ($5 / $8 / $5 /
  $5), added as a checkout line item per selected module
  (`apps/api/src/routes/billing.ts:184-200`) and matched back to the module on
  subscription sync (`apps/api/src/billing/modules.ts:117-122`). `regions_ca`
  is catalog-listed but **not sellable yet** regardless of its id — the API
  reports it `available: false` (coming soon) and refuses to sell it until
  multi-region provisioning ships
  (`apps/api/src/billing/company-modules.ts:26-33`).
- `STRIPE_SMS_METER_EVENT_NAME` → the meter event name used by the usage
  reporter (`apps/api/src/billing/meter.ts:34`). Fixed value `sms_segments`.

## Step 4 — Enable Stripe Tax

Automatic tax is turned on **per checkout session in code**
(`automatic_tax: { enabled: true }` — `apps/api/src/routes/billing.ts:211`), and
every price is `tax_behavior: exclusive`. For that to actually compute tax,
**Stripe Tax must be activated** on the account (Dashboard → Tax → enable, set
the origin address and registrations). The SaaS tax code `txcd_10103000` is
already set on every product by the script (`stripe-setup.ts:26,93`), so no
per-product tax-code entry is needed in the dashboard.

## Step 5 — Register the webhook endpoint

This can only be done once the API custom domain exists (the `API_ORIGIN` value
— see [runbook.md](./runbook.md) §1/§6). The endpoint URL is:

```
https://api.loonext.com/webhooks/stripe
```

The route is mounted at `/webhooks/stripe`, outside the JWT/CORS chain — the
Stripe signature is the authentication (`apps/api/src/index.ts:128`,
`apps/api/src/webhooks/stripe.ts:37-48`).

**Events to enable** on the endpoint — the handler switches on exactly this set
and no-ops anything else (`apps/api/src/webhooks/stripe.ts:139-158`,
`SPEC.md:1005-1010`):

| Event | Why it's needed | Source |
|---|---|---|
| `checkout.session.completed` | activate company, provision number, submit 10DLC, stamp fee, write module enablement | `webhooks/stripe.ts:140-141,256` |
| `customer.subscription.created` | mirror status/plan/period | `webhooks/stripe.ts:142,144` |
| `customer.subscription.updated` | mirror status/plan/period, `cancel_at_period_end` | `webhooks/stripe.ts:143-144` |
| `customer.subscription.deleted` | → canceled, suspend numbers, start grace | `webhooks/stripe.ts:146-147,630` |
| `invoice.paid` | → active, clear dunning; enable-us fee branch | `webhooks/stripe.ts:148-149,670` |
| `invoice.payment_failed` | → past_due, block outbound, email | `webhooks/stripe.ts:150-151,704` |
| `invoice.payment_action_required` | SCA email with hosted invoice link | `webhooks/stripe.ts:152-153,749` |

After creating the endpoint, copy its **Signing secret** (`whsec_...`) into the
API Worker secret `STRIPE_WEBHOOK_SECRET` (`apps/api/src/env.ts:36`). It is
verified over the raw body with `constructEventAsync` + WebCrypto
(`apps/api/src/webhooks/stripe.ts:59-68`, `apps/api/src/billing/stripe.ts:43`) —
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
  (`apps/api/src/routes/billing.ts:202-218`).
- **Billing Portal** sessions are created on demand with `return_url` under
  `APP_ORIGIN` (`apps/api/src/routes/billing.ts:291-294`) — but the portal is
  used for payment methods / invoices / cancellation only; **plan switching is
  in-app**, so you do NOT need to build a portal product-catalog configuration
  for upgrades/downgrades (`apps/api/src/routes/billing.ts:298-304`, comment).
- **Meter events** are posted by the usage pipeline
  (`apps/api/src/billing/meter.ts:33-40`).
