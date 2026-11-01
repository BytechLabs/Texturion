import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  dotenvValue,
  dummyServiceAccount,
  firebaseProjectId,
  generateVapidPair,
  parseDevVars,
  relayDsn,
  renderDevVars,
  seams,
} from "../src/dev-vars.mjs";
import { WITHHELD_SENTRY_DSN } from "../src/deploy.mjs";
import { edgeOrigin, recordStanding, rigEndpoints, standingNumbers } from "../src/guard.mjs";
import { TOOLING_ROOT } from "../src/layout.mjs";
import { secretStore } from "../src/secrets.mjs";
import { STUB_STANDING, stubPartition } from "./support/stub-guard.mjs";

const TEMPLATE = readFileSync(join(TOOLING_ROOT, "tools", "rig", "templates", "api.dev.vars.rig"), "utf8");

function withStore(fill, body) {
  const dir = mkdtempSync(join(tmpdir(), "rig-store-"));
  try {
    const store = secretStore(dir);
    fill(store);
    return body(store);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function fillStore(store) {
  store.write("guard-token-rig-api", "rig-test-caller-token");
  store.write("telnyx-public-key", "dGVzdA==");
  store.write("resend-from", "Loonext Rig <rig@loonext.invalid>");
  store.write("stripe-secret-key", "sk_test_rig");
}

const CATALOG = {
  STRIPE_STARTER_PRICE_ID: "price_a",
  STRIPE_PRO_PRICE_ID: "price_b",
  STRIPE_STARTER_OVERAGE_PRICE_ID: "price_c",
  STRIPE_PRO_OVERAGE_PRICE_ID: "price_d",
  STRIPE_US_FEE_PRICE_ID: "price_e",
};

function context(store, overrides = {}) {
  const partition = stubPartition();
  const standing = standingNumbers(partition, store);
  return {
    store,
    catalog: CATALOG,
    partition,
    edge: "https://edge.rig.invalid",
    rig: { supabaseUrl: "https://db.rig.internal", appOrigin: "https://app.rig.internal" },
    supabase: { secretKey: "sb_secret_local" },
    deploy: { sha: "a".repeat(40) },
    derived: {
      fcmServiceAccount: '{"project_id":"p"}',
      stripeSecretKey: "sk_test_rig",
      stripeWebhookSecret: "whsec_rig",
      sentryDsn: "http://k@127.0.0.1:8790/1",
      vapidPublicKey: "pub",
      vapidPrivateKey: "priv",
      rigOwnedE164: rigEndpoints(standing).join(","),
    },
    ...overrides,
  };
}

/** The keys the API's env schema declares, read from apps/api/src/env.ts. */
function apiEnvKeys() {
  const source = readFileSync(join(TOOLING_ROOT, "apps", "api", "src", "env.ts"), "utf8");
  const schema = source.slice(source.indexOf("const envSchema = z.object({"));
  return new Set([...schema.matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)].map((match) => match[1]));
}

test("the template only names variables the API declares", () => {
  const declared = apiEnvKeys();
  assert.ok(declared.size > 40, "read the schema");
  const named = TEMPLATE.split(/\r?\n/)
    .filter((line) => /^[A-Z]/.test(line))
    .map((line) => line.slice(0, line.indexOf("=")));
  const unknown = named.filter((key) => !declared.has(key));
  assert.deepEqual(unknown, []);
  for (const required of ["DEPLOY_ENV", "RIG_OWNED_E164", "RIG_ROBOT_WEBHOOK_ORIGIN", "TELNYX_BILLING_GROUP_ID", "FCM_OAUTH_TOKEN_URL"]) {
    assert.ok(named.includes(required), `${required} is in the template`);
  }
  assert.ok(!named.includes("LOCAL_DEV"), "LOCAL_DEV would silence the rig's crash reports");
});

test("rendering resolves every source and points every seam at the edge", () => {
  withStore(fillStore, (store) => {
    const vars = parseDevVars(renderDevVars(TEMPLATE, context(store)));
    assert.equal(vars.DEPLOY_ENV, "rig");
    assert.equal(vars.TELNYX_API_BASE, "https://edge.rig.invalid/g/telnyx");
    assert.equal(vars.TELNYX_WEBHOOK_URL, "https://edge.rig.invalid/t/m");
    assert.equal(vars.TELNYX_MEDIA_PUBLIC_BASE, "https://edge.rig.invalid/m");
    assert.equal(vars.RESEND_API_BASE, "https://edge.rig.invalid/g/resend");
    assert.equal(vars.FCM_API_BASE, "https://edge.rig.invalid/g/fcm");
    assert.equal(vars.FCM_OAUTH_TOKEN_URL, "https://edge.rig.invalid/g/fcm-token");
    assert.equal(vars.TELNYX_API_KEY, "rig-test-caller-token");
    assert.equal(vars.RESEND_API_KEY, "rig-test-caller-token");
    assert.equal(vars.TELNYX_BILLING_GROUP_ID, "stub-billing-group");
    assert.equal(vars.TELNYX_VOICE_CONNECTION_ID, "stub-voice");
    assert.equal(vars.RESEND_FROM, "Loonext Rig <rig@loonext.invalid>");
    assert.equal(vars.SUPABASE_JWKS_URL, "https://db.rig.internal/auth/v1/.well-known/jwks.json");
    assert.equal(vars.RIG_ROBOT_WEBHOOK_ORIGIN, "https://edge.rig.invalid");
    assert.equal(vars.STRIPE_PRO_YEAR_PRICE_ID, undefined, "an absent optional is left out");
    for (const value of Object.values(vars)) assert.doesNotMatch(value, /\{\{/);
  });
});

test("RIG_OWNED_E164 is the standing numbers: a number held for a scenario is left out", () => {
  withStore(fillStore, (store) => {
    const partition = stubPartition();
    const monthly = "+14165550199";
    const withMonthly = { ...partition, owned_e164: [...partition.owned_e164, monthly].sort() };
    const endpoints = rigEndpoints(standingNumbers(withMonthly, store));
    assert.ok(!endpoints.includes(monthly));
    assert.equal(endpoints.length, STUB_STANDING.length - 1);
  });
});

test("RIG_OWNED_E164 leaves STRANGER-1 out", () => {
  withStore(fillStore, (store) => {
    const vars = parseDevVars(renderDevVars(TEMPLATE, context(store)));
    const owned = vars.RIG_OWNED_E164.split(",");
    const stranger = STUB_STANDING.find((entry) => entry.role === "STRANGER-1").e164;
    assert.equal(owned.length, STUB_STANDING.length - 1);
    assert.ok(!owned.includes(stranger));
  });
});

test("a missing required source stops the render and is named", () => {
  withStore(fillStore, (store) => {
    assert.throws(() => renderDevVars(TEMPLATE, context(store, { catalog: {} })), /STRIPE_STARTER_PRICE_ID/);
  });
  withStore(
    (store) => store.write("guard-token-rig-api", "t"),
    (store) => assert.throws(() => renderDevVars(TEMPLATE, context(store)), /TELNYX_PUBLIC_KEY/),
  );
});

test("a live Stripe key or a raw Telnyx key is never written", () => {
  withStore(fillStore, (store) => {
    const live = context(store);
    live.derived = { ...live.derived, stripeSecretKey: "sk_live_abcdef" };
    assert.throws(() => renderDevVars(TEMPLATE, live), /live Stripe key into STRIPE_SECRET_KEY/);
  });
  withStore(
    (store) => {
      fillStore(store);
      store.write("guard-token-rig-api", "KEY0123456789ABCDEF0123_abc");
    },
    (store) => assert.throws(() => renderDevVars(TEMPLATE, context(store)), /raw Telnyx key/),
  );
});

test("values survive quoting", () => {
  const json = dummyServiceAccount("rig-project");
  for (const value of ["plain", "Name <a@b.invalid>", json, "with space"]) {
    assert.equal(parseDevVars(`K=${dotenvValue(value)}`).K, value);
  }
  const parsed = JSON.parse(json);
  assert.equal(parsed.project_id, "rig-project");
  assert.match(parsed.private_key, /BEGIN PRIVATE KEY/);
});

test("the relay DSN keeps the key and project and swaps the host", () => {
  assert.equal(relayDsn("https://abc@o123.ingest.sentry.io/456", "http://127.0.0.1:8790"), "http://abc@127.0.0.1:8790/456");
});

test("with the DSN withheld, the API still gets a URL, one that names no project and points at the relay", () => {
  assert.equal(relayDsn(WITHHELD_SENTRY_DSN, "http://127.0.0.1:8790"), "http://withheld@127.0.0.1:8790/0");
});

test("seams come from the shared contract", () => {
  const s = seams("https://e.invalid");
  assert.equal(s.guardAiUrl, "https://e.invalid/g/ai");
});

test("a VAPID pair is a raw uncompressed point and a 32-byte scalar", () => {
  const { publicKey, privateKey } = generateVapidPair();
  assert.equal(Buffer.from(publicKey, "base64url").length, 65);
  assert.equal(Buffer.from(privateKey, "base64url").length, 32);
});

test("standing numbers must be in the live listing, on nonprod profiles, every role once", () => {
  withStore(fillStore, (store) => {
    const partition = stubPartition();
    assert.equal(standingNumbers(partition, store).size, 8);
    assert.throws(() => standingNumbers({ ...partition, owned_e164: partition.owned_e164.slice(1) }, store), /live listing/);
    assert.throws(
      () => standingNumbers({ ...partition, standing: partition.standing.map((e) => ({ ...e, messaging_profile_id: "other" })) }, store),
      /not a nonprod profile/,
    );
    assert.throws(() => standingNumbers({ ...partition, standing: partition.standing.slice(1) }, store), /no number for ROBOT-1/);
    const withoutRoles = { ...partition };
    delete withoutRoles.standing;
    assert.throws(() => standingNumbers(withoutRoles, store), /STRANGER-1 cannot be told apart/);
    store.write("standing-numbers.json", partition.standing);
    assert.equal(standingNumbers(withoutRoles, store).size, 8);
    assert.throws(
      () => standingNumbers({ ...partition, standing_e164: partition.standing_e164.slice(1) }, store),
      /ROBOT-1 is not one of the guard's standing numbers/,
    );
  });
});

test("the store's standing-numbers.json is rewritten from the checked partition", () => {
  withStore(
    () => {},
    (store) => {
      const standing = standingNumbers(stubPartition(), store);
      assert.equal(recordStanding(store, standing), true);
      assert.equal(recordStanding(store, standing), false, "an unchanged list is not rewritten");
      const written = store.readJson("standing-numbers.json");
      assert.deepEqual(
        written.map((entry) => entry.role),
        ["ROBOT-1", "ROBOT-2", "STRANGER-1", "DEV-W1", "DEV-W2", "DEV-A1", "DEV-C1", "DEV-E1"],
      );
      assert.deepEqual(Object.keys(written[0]).sort(), ["e164", "messaging_profile_id", "role", "telnyx_phone_number_id"]);
    },
  );
});

test("the Firebase project comes from the nonprod google-services.json unless set", () => {
  withStore(
    (store) => store.write("android-nonprod-google-services.json", { project_info: { project_id: "rig-firebase" } }),
    (store) => {
      assert.equal(firebaseProjectId(store), "rig-firebase");
      store.write("firebase-project-id", "override");
      assert.equal(firebaseProjectId(store), "override");
    },
  );
  withStore(
    () => {},
    (store) => assert.throws(() => firebaseProjectId(store), /android-nonprod-google-services\.json is not in the store/),
  );
});

test("the edge origin must be bare https, or loopback http for a stub", () => {
  withStore(
    (store) => store.write("edge-origin", "https://edge.rig.invalid/"),
    (store) => assert.equal(edgeOrigin(store), "https://edge.rig.invalid"),
  );
  for (const bad of ["http://edge.rig.invalid", "https://edge.rig.invalid/g", "https://edge.rig.invalid?x=1"]) {
    withStore(
      (store) => store.write("edge-origin", bad),
      (store) => assert.throws(() => edgeOrigin(store), /bare https/),
    );
  }
  withStore(
    (store) => store.write("edge-origin", "http://127.0.0.1:8899"),
    (store) => assert.equal(edgeOrigin(store), "http://127.0.0.1:8899"),
  );
});

test("the store writes owner-only files and never names a value in an error", () => {
  withStore(
    () => {},
    (store) => {
      store.write("a-secret", "value-that-must-not-leak");
      if (process.platform !== "win32") assert.equal(statSync(join(store.dir, "a-secret")).mode & 0o777, 0o600);
      assert.equal(store.read("a-secret"), "value-that-must-not-leak");
      store.write("broken.json", "{");
      assert.throws(() => store.readJson("broken.json"), (error) => !String(error.message).includes("{"));
      assert.throws(() => store.read("absent"), /absent is not in the store/);
      assert.throws(() => store.read("../escape"), /not a secret name/);
      assert.deepEqual(store.ensureJson("made.json", () => ({ n: 1 })), { n: 1 });
      assert.deepEqual(store.ensureJson("made.json", () => ({ n: 2 })), { n: 1 });
    },
  );
});
