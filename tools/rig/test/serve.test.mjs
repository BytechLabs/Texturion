import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { STRIPE_EVENTS } from "../src/serve.mjs";

test("the Stripe listener forwards exactly the events the API handles", () => {
  const source = readFileSync(new URL("../../../apps/api/src/webhooks/stripe.ts", import.meta.url), "utf8");
  const handled = [...source.matchAll(/case "([a-z_]+(?:\.[a-z_]+)+)":/g)].map((match) => match[1]);
  assert.ok(handled.length > 0, "found no event in the webhook handler");
  assert.deepEqual([...STRIPE_EVENTS].sort(), [...new Set(handled)].sort());
});
