# 03 — Stripe

Create the billing catalog with the checked-in setup script, wire the webhook,
enable Tax, and configure the customer portal. **Everything here is done once per
Stripe mode — run it in test first, then live.**

---

## 1. Enable Stripe Tax

The checkout flow sets `automatic_tax.enabled = true` in code
(`apps/api/src/routes/billing.ts:211`) and the catalog script assigns SaaS tax
codes to every product (`apps/api/scripts/stripe-setup.ts:26,93`). Stripe Tax must
be **activated on the account** or checkout will fail:

- Stripe dashboard → **Settings → Tax** → complete the origin address / activate
  Stripe Tax.

---

## 2. Create the catalog with `stripe:setup`

The catalog (1 meter, 7 products, 10 prices — plans, US fee, and the four #12
opt-in module add-ons) is created by a **checked-in, idempotent** setup script —
not by hand in the dashboard (`apps/api/scripts/stripe-setup.ts:1-20`). Run it
once per mode with a **secret key** (`sk_...`, needs Products/Prices/Meters
write):

```bash
# test mode
STRIPE_SECRET_KEY=sk_test_... pnpm --filter @loonext/api stripe:setup

# live mode (do this when going to production)
STRIPE_SECRET_KEY=sk_live_... pnpm --filter @loonext/api stripe:setup
```

(The script is `node --experimental-strip-types scripts/stripe-setup.ts`,
`apps/api/package.json:13`.) It is **find-or-create**: the meter is keyed by
`event_name`, products by `metadata.loonext_catalog`, prices by `lookup_key`, so
re-running is safe and only reprints IDs (`apps/api/scripts/stripe-setup.ts:57-116`).

### What it creates

**Billing Meter** (`apps/api/scripts/stripe-setup.ts:67-73`):

- `display_name = "SMS segments"`, `event_name = "sms_segments"`
- `default_aggregation.formula = "sum"`
- `customer_mapping = { type: "by_id", event_payload_key: "stripe_customer_id" }`
- `value_settings.event_payload_key = "value"`

> These payload keys are load-bearing: the runtime usage reporter posts meter
> events with payload `{ stripe_customer_id, value: String(value) }`
> (`apps/api/src/billing/meter.ts:33-40`). The mapping above must match.

**Products** — all with SaaS tax code `txcd_10103000`
(`apps/api/scripts/stripe-setup.ts:26,91-95,120-125,186-190`):

| Product | Catalog key |
|---------|-------------|
| `Loonext Starter` | `starter` |
| `Loonext Pro` | `pro` |
| `US texting registration` | `us_registration` |
| `Loonext — Picture messages` | `module_mms` |
| `Loonext — Calling` | `module_voice` |
| `Loonext — Extra storage` | `module_extra_storage` |
| `Loonext — Canada numbers` | `module_regions_ca` |

**Prices** — all `tax_behavior: exclusive`
(`apps/api/scripts/stripe-setup.ts:128-199`; module list `:34-44`):

| Price | Shape | Amount |
|-------|-------|--------|
| Starter licensed | recurring monthly | $29.00 (`unit_amount 2900`) |
| Starter overage | graduated metered, bound to meter | tiers: 0–500 @ $0, then $0.03/segment (`unit_amount 3`) |
| Pro licensed | recurring monthly | $79.00 (`unit_amount 7900`) |
| Pro overage | graduated metered, bound to meter | tiers: 0–2,500 @ $0, then $0.025/segment (`unit_amount_decimal 2.5`) |
| US registration fee | one-time (non-recurring) | $29.00 (`unit_amount 2900`) |
| Picture messages module | recurring monthly | $5.00 (`unit_amount 500`) |
| Calling module | recurring monthly | $8.00 (`unit_amount 800`) |
| Extra storage module | recurring monthly | $5.00 (`unit_amount 500`) |
| Canada numbers module | recurring monthly | $5.00 (`unit_amount 500`) |

### Capture the printed env lines

The script prints **exactly these 13 lines** to stdout
(`apps/api/scripts/stripe-setup.ts:201-210`) — copy them into the API Worker
secrets. **All 13 matter**: the `STRIPE_MODULE_*` ids are what make the
opt-in add-ons purchasable — skip them and every module is refused at checkout
as "isn't available yet" (`apps/api/src/routes/billing.ts:190-200`):

```
STRIPE_SMS_METER_EVENT_NAME=sms_segments
STRIPE_VOICE_METER_EVENT_NAME=voice_seconds
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_STARTER_OVERAGE_PRICE_ID=price_...
STRIPE_PRO_OVERAGE_PRICE_ID=price_...
STRIPE_STARTER_VOICE_OVERAGE_PRICE_ID=price_...
STRIPE_PRO_VOICE_OVERAGE_PRICE_ID=price_...
STRIPE_US_FEE_PRICE_ID=price_...
STRIPE_MODULE_MMS_PRICE_ID=price_...
STRIPE_MODULE_VOICE_PRICE_ID=price_...
STRIPE_MODULE_EXTRA_STORAGE_PRICE_ID=price_...
STRIPE_MODULE_REGIONS_CA_PRICE_ID=price_...
```

> **Redirect stdout only** — the human-readable log lines go to stderr, so
> `... stripe:setup > catalog.env` gives you a clean 10-line env file.

The US fee price is added as a one-time checkout line **only** when the company
owes US registration and has never paid it; the checkout webhook matches this
price ID to stamp `registration_fee_paid_at`
(`apps/api/src/routes/billing.ts:180-182`, `apps/api/src/webhooks/stripe.ts:318-322`).

Module prices become one flat licensed line item per selected add-on at checkout
(`apps/api/src/routes/billing.ts:184-200`). Note `regions_ca`: its price id is
created and should be set, but the module is **not sellable yet** — the API
refuses it at checkout and in the add-on toggle until multi-region provisioning
ships (`apps/api/src/billing/company-modules.ts:26-33`); it reads as coming-soon
(`available: false`) in `GET /v1/billing/modules`.

---

## 3. Create the webhook endpoint

Stripe dashboard → **Developers → Webhooks → Add endpoint**.

- **Endpoint URL:** `https://api.loonext.com/webhooks/stripe`
  (i.e. `${API_ORIGIN}/webhooks/stripe`, mounted at `apps/api/src/index.ts:128`,
  handled at `apps/api/src/webhooks/stripe.ts:48`). This route is **outside** the
  JWT/CORS chain — the HMAC signature is the authentication.
- **Events to enable — exactly these 7** (the handler no-ops anything else,
  `apps/api/src/webhooks/stripe.ts:139-158`):

  ```
  checkout.session.completed
  customer.subscription.created
  customer.subscription.updated
  customer.subscription.deleted
  invoice.paid
  invoice.payment_failed
  invoice.payment_action_required
  ```

- After saving, copy the endpoint's **Signing secret** (`whsec_...`) →
  `STRIPE_WEBHOOK_SECRET` (api secret). It's verified via `constructEventAsync`
  over the raw body with the WebCrypto provider
  (`apps/api/src/webhooks/stripe.ts:59-68`, `apps/api/src/billing/stripe.ts:12-16,43`).

> You can only get the final URL after the API Worker's custom domain is live
> ([05](./05-workers-deploy.md) §4). Create the endpoint then, and set
> `STRIPE_WEBHOOK_SECRET` **before** relying on webhook processing. In test mode,
> `stripe listen --forward-to https://api.loonext.com/webhooks/stripe` works too.

---

## 4. Configure the customer portal

The app opens a hosted Billing Portal session with `return_url =
${APP_ORIGIN}/settings/billing` (`apps/api/src/routes/billing.ts:291-294`). In the
portal, customers manage **payment methods, invoices, and cancellation only** —
plan switching happens in-app (`apps/api/src/routes/billing.ts:298-304`).

Stripe dashboard → **Settings → Billing → Customer portal**:

- Enable **payment method update** and **invoice history**.
- Enable **cancellation** (subscriptions).
- You can disable "switch plans" in the portal since the app drives plan changes
  itself.

---

## 5. Dunning (Smart Retries) — set the post-exhaustion action

Not configured by code — set in the dashboard (`SPEC.md:1017`). Stripe → **Settings
→ Billing → Subscriptions and emails → Manage failed payments**:

- Rely on **Smart Retries** defaults (~8 retries over 2 weeks).
- **After retries are exhausted → Cancel the subscription.** This produces
  `customer.subscription.deleted`, which the handler turns into the grace/release
  path (`apps/api/src/webhooks/stripe.ts:146-147,630`).

---

## 6. Runtime key scope (restricted key)

The **runtime** `STRIPE_SECRET_KEY` (the one you put on the Worker) may be a
**restricted key** (`rk_...`). It needs write on
(`apps/api/src/billing/stripe.ts:25`, `apps/api/src/routes/billing.ts:202,291`,
`apps/api/src/billing/meter.ts:33`):

- **Checkout Sessions** (write)
- **Billing Portal sessions** (write)
- **Customers / Subscriptions** (read + write)
- **Billing Meter Events** (write)

Webhook signature verification needs **no scope** (it's HMAC). Catalog creation
(`stripe:setup`, §2) needs **Products / Prices / Meters write** — use a full
`sk_...` for that one-time run, not the restricted runtime key.

---

## 7. What you now have

- 10 `STRIPE_*` price/meter IDs (from §2 — 6 plan/meter + 4 module add-on
  prices) → api Worker secrets.
- `STRIPE_WEBHOOK_SECRET` (from §3) → api Worker secret.
- `STRIPE_SECRET_KEY` (restricted runtime key) → api Worker secret.
- Stripe Tax active, portal configured, dunning → cancel.

Next: [04 — Telnyx](./04-telnyx.md).
