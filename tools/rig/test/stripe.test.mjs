import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { TOOLING_ROOT } from "../src/layout.mjs";
import { secretStore } from "../src/secrets.mjs";
import { ensureStripeCatalog, parseCatalogOutput, requiredCatalogKeys, stripeSandboxKey } from "../src/stripe.mjs";

const TEMPLATE = readFileSync(join(TOOLING_ROOT, "tools", "rig", "templates", "api.dev.vars.rig"), "utf8");

function withStore(body) {
  const dir = mkdtempSync(join(tmpdir(), "rig-stripe-"));
  try {
    return body(secretStore(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("only a test-mode key leaves the store", () => {
  withStore((store) => {
    for (const key of ["sk_test_abc123", "rk_test_abc123"]) {
      store.write("stripe-secret-key", key);
      assert.equal(stripeSandboxKey(store), key);
    }
    for (const key of ["sk_live_abc123", "rk_live_abc123", "pk_test_abc123", "whsec_abc123", "sk_test_"]) {
      store.write("stripe-secret-key", key);
      assert.throws(() => stripeSandboxKey(store), (error) => /not a test-mode key/.test(error.message) && !error.message.includes("abc123"));
    }
  });
});

test("the catalog ids are the STRIPE_ lines stripe-setup prints", () => {
  const stdout = [
    "coupon loonext_prepaid_year: already exists",
    "STRIPE_SMS_METER_EVENT_NAME=sms_segments",
    "STRIPE_STARTER_PRICE_ID=price_a",
    "STRIPE_PRO_PRICE_ID=price_b",
    "not a line",
  ].join("\n");
  assert.deepEqual(parseCatalogOutput(stdout), {
    STRIPE_SMS_METER_EVENT_NAME: "sms_segments",
    STRIPE_STARTER_PRICE_ID: "price_a",
    STRIPE_PRO_PRICE_ID: "price_b",
  });
});

test("the template's required catalog ids are the ones without a question mark", () => {
  const required = requiredCatalogKeys(TEMPLATE);
  assert.ok(required.includes("STRIPE_STARTER_PRICE_ID"));
  assert.ok(!required.includes("STRIPE_PRO_YEAR_PRICE_ID"), "an optional id is not required");
});

test("stripe-setup runs only when the stored catalog lacks an id, and only with a sandbox key", () => {
  withStore((store) => {
    const runs = [];
    const runSetup = (key) => {
      runs.push(key);
      return "STRIPE_STARTER_PRICE_ID=price_a\nSTRIPE_PRO_PRICE_ID=price_b\n";
    };
    const required = ["STRIPE_STARTER_PRICE_ID", "STRIPE_PRO_PRICE_ID"];
    const liveShaped = "sk_live_abc123";
    store.write("stripe-secret-key", liveShaped);
    assert.throws(() => ensureStripeCatalog({ store, required, log: () => {}, runSetup }), /not a test-mode key/);
    assert.equal(runs.length, 0, "a live key never reaches the setup script");

    store.write("stripe-secret-key", "sk_test_abc123");
    assert.deepEqual(ensureStripeCatalog({ store, required, log: () => {}, runSetup }), {
      STRIPE_STARTER_PRICE_ID: "price_a",
      STRIPE_PRO_PRICE_ID: "price_b",
    });
    assert.deepEqual(runs, ["sk_test_abc123"]);
    ensureStripeCatalog({ store, required, log: () => {}, runSetup });
    assert.equal(runs.length, 1, "a complete stored catalog is used as it is");

    assert.throws(
      () => ensureStripeCatalog({ store, required: [...required, "STRIPE_US_FEE_PRICE_ID"], log: () => {}, runSetup }),
      /stripe-setup printed no STRIPE_US_FEE_PRICE_ID/,
    );
  });
});
