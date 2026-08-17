import { describe, expect, it, vi } from "vitest";

import type { PushDelivery } from "../notifications/deliver";

/**
 * #228 — the notices a workspace cannot afford to miss, in the reader's
 * language, and with words in them at all.
 *
 * ## Why this file exists
 *
 * `pushConsequentialNotice` composes its own payload on behalf of four callers
 * — the grace-period warnings, the release notice, the cancellation notice and
 * the held-numbers notice. When the payload became a function of the reader's
 * language, this helper was the one file no group owned, and two of them handed
 * it `(locale) => string` while it still declared `string`.
 *
 * The type error was the visible half. The invisible half is what this file is
 * really for: a function left sitting in `PushPayload.title` is not a runtime
 * error, it is a field `JSON.stringify` silently DROPS. Every one of these
 * notices would have gone out with no title and no body — in English too — and
 * the only English-language symptom would have been a blank notification about
 * losing a phone number.
 *
 * Nothing caught it. `grace.test.ts` passes 22 tests and asserts nothing about
 * the push title; the helper swallows its own failures by design, so the
 * delivery is silent either way; and vitest does not typecheck. So the guard
 * has to be an assertion on the DELIVERED PAYLOAD, in both languages.
 */

const deliveries: PushDelivery[] = [];

vi.mock("../notifications/deliver", () => ({
  deliverPush: (_env: unknown, _db: unknown, delivery: PushDelivery) => {
    deliveries.push(delivery);
    return Promise.resolve();
  },
}));

const { pushConsequentialNotice } = await import("./consequential-push");

const env = { APP_ORIGIN: "https://app.test" } as never;

/** Owners and admins, which is the audience this helper selects. */
const db = {
  from: () => ({
    select: () => ({
      eq: () => ({
        is: () => ({
          in: () => Promise.resolve({ data: [{ user_id: "u1" }], error: null }),
        }),
      }),
    }),
  }),
} as never;

async function deliver() {
  deliveries.length = 0;
  await pushConsequentialNotice(env, db, {
    companyId: "c1",
    title: (locale) => (locale === "fr-CA" ? "Titre" : "Title"),
    body: (locale) => (locale === "fr-CA" ? "Corps" : "Body"),
    path: "/settings/billing",
    collapseKey: "grace:day-1",
  });
  expect(deliveries).toHaveLength(1);
  return deliveries[0]!;
}

describe("#228 a consequential notice survives serialization", () => {
  it("puts real words in the payload, not the function that makes them", async () => {
    // THE REGRESSION THIS FILE WAS WRITTEN FOR. Composing the payload without
    // invoking the copy functions type-checks nowhere but fails silently
    // everywhere: JSON.stringify drops a function-valued property, so the
    // notice arrives blank rather than in the wrong language.
    const delivery = await deliver();
    const payload = delivery.web("en");

    expect(typeof payload.title).toBe("string");
    expect(typeof payload.body).toBe("string");
    // The real proof: what actually goes on the wire.
    const wire = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    expect(wire.title).toBe("Title");
    expect(wire.body).toBe("Body");
  });

  it("forwards the reader's language rather than swallowing it", async () => {
    // The helper takes a locale and composes its own payload, so it is a place
    // the argument can be quietly dropped without any caller noticing — which
    // is exactly what it did before this issue: `web: () => ({ ... })`.
    const delivery = await deliver();

    expect(delivery.web("fr-CA").title).toBe("Titre");
    expect(delivery.web("fr-CA").body).toBe("Corps");
    expect(delivery.web("en").title).toBe("Title");
  });

  it("keeps the deep link out of the translated half", async () => {
    // A URL is not copy. It must be identical in both languages, or the two
    // renderings would coalesce as different notifications.
    const delivery = await deliver();

    expect(delivery.web("fr-CA").url).toBe(delivery.web("en").url);
    expect(delivery.web("en").url).toBe("https://app.test/settings/billing");
  });

  it("keeps one collapse identity across languages", async () => {
    // Two translations of one notice must REPLACE each other rather than
    // stack: a workspace with an English owner and a French admin is one
    // deadline, not two.
    const delivery = await deliver();

    expect(delivery.collapseKey).toBe("grace:day-1");
    expect(delivery.category).toBe("operational");
  });
});
