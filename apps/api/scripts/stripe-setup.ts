/**
 * Idempotent Stripe catalog setup (SPEC §9: "created by a checked-in setup
 * script, ids stored as env config"). Run by the operator, once per Stripe
 * mode (test/live):
 *
 *   STRIPE_SECRET_KEY=sk_... pnpm --filter @loonext/api stripe:setup
 *
 * Finds-or-creates, exactly per SPEC §2/§9:
 *   - Billing Meter `sms_segments` (sum aggregation, customer mapping by
 *     stripe_customer_id, value from `value`)
 *   - Products: Loonext Starter, Loonext Pro (SaaS tax code on both),
 *     US texting registration
 *   - Prices: $29/mo + $79/mo licensed; graduated metered overage
 *     (0–500 / 0–2,500 at $0, then $0.03 / $0.025 via unit_amount_decimal);
 *     $29 one-time US registration. All tax-exclusive.
 *
 * Idempotency: the meter is keyed by `event_name`, products by
 * `metadata.loonext_catalog`, prices by `lookup_key` — reruns reuse existing
 * objects and only print the ids. Prints the exact env lines the Worker needs.
 */
import Stripe from "stripe";

const METER_EVENT_NAME = "sms_segments";

/** Stripe Tax: "Software as a service (SaaS) - business use" (SPEC §2). */
const SAAS_TAX_CODE = "txcd_10103000";

/**
 * #12 plan-builder modules: one flat monthly licensed price each (the module
 * unlocks a capability that is itself cap-protected — no per-use metering yet).
 * MUST stay in sync with MODULE_CATALOG in src/billing/modules.ts (id, monthly
 * price, env key); this operator script is standalone so the list is inlined.
 * (#103: `mms` is retired — never provision it again. If a price was created
 * before retirement, KEEP its STRIPE_MODULE_MMS_PRICE_ID env var set so the
 * daily reconcile can strip stale items off live subscriptions.)
 */
const MODULE_PRICES: {
  id: string;
  label: string;
  monthlyCents: number;
  envKey: string;
}[] = [
  { id: "voice", label: "Call forwarding", monthlyCents: 800, envKey: "STRIPE_MODULE_VOICE_PRICE_ID" },
  { id: "extra_storage", label: "Extra storage", monthlyCents: 500, envKey: "STRIPE_MODULE_EXTRA_STORAGE_PRICE_ID" },
  { id: "regions_ca", label: "Canada numbers", monthlyCents: 500, envKey: "STRIPE_MODULE_REGIONS_CA_PRICE_ID" },
];

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  console.error(
    "STRIPE_SECRET_KEY is not set.\n" +
      "Usage: STRIPE_SECRET_KEY=sk_... pnpm --filter @loonext/api stripe:setup",
  );
  process.exit(1);
}

const stripe = new Stripe(secretKey);

async function ensureMeter(): Promise<Stripe.Billing.Meter> {
  for await (const meter of stripe.billing.meters.list({
    status: "active",
    limit: 100,
  })) {
    if (meter.event_name === METER_EVENT_NAME) {
      console.error(`meter: reusing ${meter.id} (${meter.event_name})`);
      return meter;
    }
  }
  const meter = await stripe.billing.meters.create({
    display_name: "SMS segments",
    event_name: METER_EVENT_NAME,
    default_aggregation: { formula: "sum" },
    customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
    value_settings: { event_payload_key: "value" },
  });
  console.error(`meter: created ${meter.id} (${meter.event_name})`);
  return meter;
}

async function ensureProduct(
  catalogKey: string,
  name: string,
): Promise<Stripe.Product> {
  for await (const product of stripe.products.list({
    active: true,
    limit: 100,
  })) {
    if (product.metadata.loonext_catalog === catalogKey) {
      console.error(`product: reusing ${product.id} (${catalogKey})`);
      return product;
    }
  }
  const product = await stripe.products.create({
    name,
    tax_code: SAAS_TAX_CODE,
    metadata: { loonext_catalog: catalogKey },
  });
  console.error(`product: created ${product.id} (${catalogKey})`);
  return product;
}

async function ensurePrice(
  lookupKey: string,
  params: Stripe.PriceCreateParams,
): Promise<Stripe.Price> {
  const existing = await stripe.prices.list({
    lookup_keys: [lookupKey],
    limit: 1,
  });
  const found = existing.data[0];
  if (found) {
    console.error(`price: reusing ${found.id} (${lookupKey})`);
    return found;
  }
  const price = await stripe.prices.create({ ...params, lookup_key: lookupKey });
  console.error(`price: created ${price.id} (${lookupKey})`);
  return price;
}

try {
  const meter = await ensureMeter();
  const starterProduct = await ensureProduct("starter", "Loonext Starter");
  const proProduct = await ensureProduct("pro", "Loonext Pro");
  const registrationProduct = await ensureProduct(
    "us_registration",
    "US texting registration",
  );

  // Starter licensed: $29/mo flat, tax-exclusive (SPEC §2, §9).
  const starterLicensed = await ensurePrice("loonext_starter_licensed", {
    product: starterProduct.id,
    currency: "usd",
    unit_amount: 2900,
    recurring: { interval: "month" },
    tax_behavior: "exclusive",
  });

  // Starter metered overage: 0–500 at $0, then $0.03/segment (SPEC §9).
  const starterOverage = await ensurePrice("loonext_starter_overage", {
    product: starterProduct.id,
    currency: "usd",
    recurring: { interval: "month", usage_type: "metered", meter: meter.id },
    billing_scheme: "tiered",
    tiers_mode: "graduated",
    tiers: [
      { up_to: 500, unit_amount: 0 },
      { up_to: "inf", unit_amount: 3 },
    ],
    tax_behavior: "exclusive",
  });

  // Pro licensed: $79/mo flat.
  const proLicensed = await ensurePrice("loonext_pro_licensed", {
    product: proProduct.id,
    currency: "usd",
    unit_amount: 7900,
    recurring: { interval: "month" },
    tax_behavior: "exclusive",
  });

  // Pro metered overage: 0–2,500 at $0, then $0.025/segment — fractional
  // cents require unit_amount_decimal (SPEC §9); stripe v22 models decimal
  // params with its branded Decimal type.
  const proOverage = await ensurePrice("loonext_pro_overage", {
    product: proProduct.id,
    currency: "usd",
    recurring: { interval: "month", usage_type: "metered", meter: meter.id },
    billing_scheme: "tiered",
    tiers_mode: "graduated",
    tiers: [
      { up_to: 2500, unit_amount: 0 },
      { up_to: "inf", unit_amount_decimal: Stripe.Decimal.from("2.5") },
    ],
    tax_behavior: "exclusive",
  });

  // US registration: $29 one-time, at most once per company ever (SPEC §2).
  const usFee = await ensurePrice("loonext_us_registration", {
    product: registrationProduct.id,
    currency: "usd",
    unit_amount: 2900,
    tax_behavior: "exclusive",
  });

  // #12 plan-builder module add-ons: a product + flat monthly licensed price
  // per module, idempotent by the same lookup_key/catalog-metadata scheme.
  const modulePriceIds: { envKey: string; id: string }[] = [];
  for (const mod of MODULE_PRICES) {
    const product = await ensureProduct(
      `module_${mod.id}`,
      `Loonext — ${mod.label}`,
    );
    const price = await ensurePrice(`loonext_module_${mod.id}_licensed`, {
      product: product.id,
      currency: "usd",
      unit_amount: mod.monthlyCents,
      recurring: { interval: "month" },
      tax_behavior: "exclusive",
    });
    modulePriceIds.push({ envKey: mod.envKey, id: price.id });
  }

  console.error("\nCatalog ready. Worker env bindings:\n");
  console.log(`STRIPE_SMS_METER_EVENT_NAME=${METER_EVENT_NAME}`);
  console.log(`STRIPE_STARTER_PRICE_ID=${starterLicensed.id}`);
  console.log(`STRIPE_PRO_PRICE_ID=${proLicensed.id}`);
  console.log(`STRIPE_STARTER_OVERAGE_PRICE_ID=${starterOverage.id}`);
  console.log(`STRIPE_PRO_OVERAGE_PRICE_ID=${proOverage.id}`);
  console.log(`STRIPE_US_FEE_PRICE_ID=${usFee.id}`);
  for (const { envKey, id } of modulePriceIds) {
    console.log(`${envKey}=${id}`);
  }
} catch (error) {
  console.error(
    "Stripe catalog setup failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}
