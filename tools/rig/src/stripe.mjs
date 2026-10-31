/**
 * The rig's Stripe: the `loonext-rig` sandbox and nothing else. Every place
 * that hands the key to something reads it through stripeSandboxKey, so a
 * live key in the store stops the rig before Stripe is contacted at all.
 */
import { join } from "node:path";

import { run } from "./exec.mjs";
import { TOOLING_ROOT } from "./layout.mjs";

const SANDBOX_KEY = /^(?:sk|rk)_test_[A-Za-z0-9]+$/;

export function stripeSandboxKey(store) {
  const key = store.read("stripe-secret-key");
  if (!SANDBOX_KEY.test(key)) {
    throw new Error("rig: stripe-secret-key is not a test-mode key (sk_test_ or rk_test_); the rig holds only the loonext-rig sandbox key");
  }
  return key;
}

/** What `stripe listen` signs with for this key: the store's copy, or the CLI's answer. */
export function stripeWebhookSecret(store) {
  return (
    store.readOptional("stripe-webhook-secret") ??
    run("stripe", ["listen", "--print-secret"], { env: { STRIPE_API_KEY: stripeSandboxKey(store) } }).stdout.trim()
  );
}

/** The `{{catalog:NAME}}` sources a template cannot render without. */
export function requiredCatalogKeys(template) {
  return [...template.matchAll(/\{\{\s*catalog:([A-Za-z0-9_.-]+)\s*\}\}/g)].map((match) => match[1]);
}

/** The `STRIPE_...=<id>` lines stripe-setup prints, as an object. */
export function parseCatalogOutput(stdout) {
  const catalog = {};
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(STRIPE_[A-Z0-9_]+)=(\S+)$/.exec(line.trim());
    if (match) catalog[match[1]] = match[2];
  }
  return catalog;
}

/**
 * The sandbox's price and coupon ids. FA5 leaves the catalog to the agent, so
 * when the store's copy lacks an id the template needs, the repository's own
 * idempotent setup script (apps/api/scripts/stripe-setup.ts) runs against the
 * sandbox: it finds or creates each object and prints the ids.
 */
export function ensureStripeCatalog({ store, required, log, runSetup = runStripeSetup }) {
  const stored = store.has("stripe-catalog.json") ? store.readJson("stripe-catalog.json") : {};
  const missing = required.filter((key) => !stored[key]);
  if (missing.length === 0) return stored;
  log(`stripe: the sandbox catalog lacks ${missing.length} id(s); running stripe-setup against the sandbox`);
  const catalog = parseCatalogOutput(runSetup(stripeSandboxKey(store)));
  const still = required.filter((key) => !catalog[key]);
  if (still.length > 0) throw new Error(`rig: stripe-setup printed no ${still.join(", ")}`);
  store.write("stripe-catalog.json", catalog);
  return catalog;
}

function runStripeSetup(key) {
  const apiDir = join(TOOLING_ROOT, "apps", "api");
  return run(process.execPath, ["--experimental-strip-types", join("scripts", "stripe-setup.ts")], {
    cwd: apiDir,
    env: { STRIPE_SECRET_KEY: key },
  }).stdout;
}
