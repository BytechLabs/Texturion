/**
 * Write `apps/api/.dev.vars` for a LOCAL-ONLY run of the Worker (#320).
 *
 * The theme audit's authenticated half needs the real app talking to the real
 * Worker: the browser logs in against local Supabase, the web app calls
 * `/v1/...`, and the Worker validates that token against Supabase's own JWKS.
 * `wrangler dev` reads its secrets from `.dev.vars`, which is gitignored —
 * correctly, because a developer's copy points at real vendors.
 *
 * So CI needs one it can trust, and this writes it. Every value is either
 * resolved from the local Supabase stack or a visibly fake literal lifted from
 * `apps/api/e2e/harness.ts`, which has run the same Worker against the same
 * database on every commit for months.
 *
 * SAFE BY CONSTRUCTION, and deliberately so rather than by convention:
 *   - the Supabase URL/key come from `supabase status`, which only ever
 *     describes the local docker stack;
 *   - it REFUSES to run against anything that is not localhost, so a stray
 *     invocation on a machine pointed at production writes nothing;
 *   - it refuses to overwrite an existing `.dev.vars`, so running it by
 *     accident on a developer's box cannot destroy their real one.
 *
 * IT ALSO DERIVES A CI WRANGLER CONFIG, and that part exists because the first
 * attempt at this job failed in CI with "Failed to start the remote proxy
 * session". The assumption was that `wrangler dev` runs fully offline because
 * the Worker's only bindings are `unsafe.bindings` rate limiters, which
 * wrangler emulates. That was wrong: `"ai": { "binding": "AI" }` is Workers AI,
 * which has NO local emulation, so wrangler opens a remote proxy for it and
 * needs account credentials to do so.
 *
 * Dropping that one binding is safe and already proven — `env.ts` declares
 * `AI: workersAiSchema.optional()`, and the e2e harness has run this same
 * Worker against this same database with no AI binding at all on every commit
 * for months. The audit opens pages and reads computed styles; it never
 * enriches anything.
 *
 * The CI config is DERIVED from the real one rather than copied, so the two
 * cannot drift. A duplicate config is a file that is correct on the day it is
 * written and wrong by the next binding change.
 *
 * Usage: node scripts/ci-dev-vars.mjs
 */
import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TARGET = fileURLToPath(new URL("../apps/api/.dev.vars", import.meta.url));

const FALLBACK_URL = "http://127.0.0.1:54321";
// The supabase CLI's published default local secret key. Not a real secret —
// it is the same literal `dev-seed.mjs` and the e2e harness already carry.
const FALLBACK_SECRET = "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

function resolveSupabase() {
  try {
    const out = execFileSync("npx", ["supabase", "status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: process.platform === "win32",
    });
    const parsed = JSON.parse(out);
    const url = parsed.API_URL ?? parsed.api_url;
    const secret = parsed.SECRET_KEY ?? parsed.secret_key ?? parsed.SERVICE_ROLE_KEY;
    if (url && secret) return { url, secret };
  } catch {
    // fall through
  }
  return { url: FALLBACK_URL, secret: FALLBACK_SECRET };
}

if (existsSync(TARGET)) {
  console.log(`ci-dev-vars: ${TARGET} already exists — leaving it alone.`);
  process.exit(0);
}

/** A P-256 pair in the raw base64url shape the web-push spec expects. */
function vapidPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const priv = privateKey.export({ format: "jwk" });
  const raw = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]);
  return {
    VAPID_PUBLIC_KEY: raw.toString("base64url"),
    VAPID_PRIVATE_KEY: priv.d,
  };
}

const { url, secret } = resolveSupabase();

const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error(
    `ci-dev-vars: refusing to write. Supabase resolved to ${url}, which is not ` +
      `local. This script only ever describes a docker stack on this machine.`,
  );
  process.exit(1);
}

/**
 * Vendor secrets are visibly fake. The audit never sends a text, charges a
 * card or emails anybody — it opens pages and reads computed styles — so these
 * exist only to satisfy the Worker's env validation at boot.
 */
const VARS = {
  SUPABASE_URL: url,
  SUPABASE_SECRET_KEY: secret,
  SUPABASE_JWKS_URL: `${url}/auth/v1/.well-known/jwks.json`,
  TELNYX_API_KEY: "KEY_LOCAL_THEME_AUDIT",
  TELNYX_PUBLIC_KEY: "bG9jYWwtdGhlbWUtYXVkaXQtcHVibGljLWtleQ==",
  TELNYX_VOICE_CONNECTION_ID: "2000000000000000001",
  STRIPE_SECRET_KEY: "sk_test_local_theme_audit",
  STRIPE_WEBHOOK_SECRET: "whsec_local_theme_audit",
  RESEND_API_KEY: "re_local_theme_audit",
  // Required and validated as a URL. Nothing is ever sent to it: the audit
  // opens pages, and a DSN on a domain that does not resolve simply drops.
  SENTRY_DSN: "https://local@o000001.ingest.sentry.io/0000001",
  APP_ORIGIN: "http://localhost:3100",
  API_ORIGIN: "http://127.0.0.1:8787",
  RESEND_FROM: "Loonext <notifications@loonext.local>",
  STRIPE_STARTER_PRICE_ID: "price_starter_licensed_0001",
  STRIPE_PRO_PRICE_ID: "price_pro_licensed_0001",
  STRIPE_STARTER_OVERAGE_PRICE_ID: "price_starter_overage_0001",
  STRIPE_PRO_OVERAGE_PRICE_ID: "price_pro_overage_0001",
  STRIPE_US_FEE_PRICE_ID: "price_us_registration_0001",
  STRIPE_STARTER_YEAR_PRICE_ID: "price_starter_year_0001",
  STRIPE_PRO_YEAR_PRICE_ID: "price_pro_year_0001",
  STRIPE_PREPAID_YEAR_COUPON_ID: "loonext_prepaid_year",
  STRIPE_SMS_METER_EVENT_NAME: "sms_segments",
  // Generated per run rather than committed. A VAPID key in the repository is
  // how a test-only key ended up in a PUBLIC repo's history once already; the
  // Worker only needs a well-formed pair to boot.
  ...vapidPair(),
};

const body =
  "# Generated by scripts/ci-dev-vars.mjs for a LOCAL run. Never commit this.\n" +
  Object.entries(VARS)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") +
  "\n";

writeFileSync(TARGET, body);
console.log(`ci-dev-vars: wrote ${Object.keys(VARS).length} local vars for ${url}`);

/* ------------------------------------------------------------------------- */

const CONFIG = fileURLToPath(new URL("../apps/api/wrangler.jsonc", import.meta.url));
const CI_CONFIG = fileURLToPath(new URL("../apps/api/wrangler.ci.jsonc", import.meta.url));

const original = readFileSync(CONFIG, "utf8");
// One targeted removal, matched exactly, so a config change that moves or
// renames this line fails here instead of silently producing a config that
// still needs credentials.
const AI_BINDING = /^\s*"ai":\s*\{\s*"binding":\s*"AI"\s*\},?\s*$/m;
if (!AI_BINDING.test(original)) {
  console.error(
    `ci-dev-vars: could not find the "ai" binding in wrangler.jsonc. ` +
      `Either it is gone (delete this block) or it moved (update the pattern). ` +
      `Guessing would produce a config that opens a remote proxy session and ` +
      `fails in CI with no account credentials.`,
  );
  process.exit(1);
}
writeFileSync(
  CI_CONFIG,
  original.replace(
    AI_BINDING,
    [
      "  // Removed by scripts/ci-dev-vars.mjs: Workers AI has no local",
      "  // emulation, so its presence makes `wrangler dev` open a remote proxy",
      "  // session that needs account credentials. env.ts declares AI optional",
      "  // and the e2e harness has always run without it.",
      "",
    ].join("\n"),
  ),
);
console.log(`ci-dev-vars: derived wrangler.ci.jsonc without the AI binding`);
