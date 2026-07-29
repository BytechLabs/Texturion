/**
 * #308 — the counter on the webhooks we receive and throw away.
 *
 * What this suite owns is the two judgement calls in the recorder, because the
 * arithmetic is one upsert and the alerting policy lives in the checker:
 *
 *   - a rejection is only counted when the request LOOKS like a real delivery,
 *     which both bounds the write path on a public unauthenticated route and
 *     keeps the signal from being diluted by traffic that says nothing about
 *     our secret;
 *   - the counter can never turn a 400 into a 500, because that would make the
 *     provider retry a request we are never going to accept.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Context } from "hono";

import type { AppEnv } from "../context";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import {
  countWebhookRejection,
  recordWebhookRejection,
} from "./webhook-rejections";

const env = completeEnv();

afterEach(() => {
  vi.unstubAllGlobals();
});

function world(options: { status?: number } = {}) {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/record_webhook_rejection", () =>
    options.status !== undefined
      ? new Response("boom", { status: options.status })
      : null,
  );
  return sb;
}

const signed = (header: string) =>
  new Request("https://api.example/webhooks/x", {
    method: "POST",
    headers: { [header]: "v1,abc" },
  });

const unsigned = () =>
  new Request("https://api.example/webhooks/x", { method: "POST" });

describe("recordWebhookRejection", () => {
  it("counts a rejection that carries the provider's signature header", async () => {
    const sb = world();
    stubFetch(sb.route);

    await recordWebhookRejection(
      env,
      signed("telnyx-signature-ed25519"),
      "telnyx",
    );

    const calls = sb.find("POST", "/rest/v1/rpc/record_webhook_rejection");
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ p_provider: "telnyx" });
  });

  it("ignores a request with no signature header at all", async () => {
    // These routes are public and unauthenticated — the signature IS the
    // authentication — so a scanner must not be able to drive a database write
    // per request. And a random POST is not evidence about our secret, so
    // counting it would only dilute the one signal this exists to produce.
    const sb = world();
    stubFetch(sb.route);

    await recordWebhookRejection(env, unsigned(), "telnyx");

    expect(sb.find("POST", "/rest/v1/rpc/record_webhook_rejection")).toEqual([]);
  });

  it("keys each provider off its own header", async () => {
    // Stripe signs with `stripe-signature`, Resend via svix. A single hardcoded
    // header would silently count nothing for two of the three providers,
    // which is the failure mode this whole issue is about.
    const sb = world();
    stubFetch(sb.route);

    await recordWebhookRejection(env, signed("stripe-signature"), "stripe");
    await recordWebhookRejection(env, signed("svix-signature"), "resend");
    // A Telnyx-shaped request must not be counted as Stripe.
    await recordWebhookRejection(env, signed("telnyx-signature-ed25519"), "stripe");

    const providers = sb
      .find("POST", "/rest/v1/rpc/record_webhook_rejection")
      .map((call) => (call.body as { p_provider: string }).p_provider);
    expect(providers).toEqual(["stripe", "resend"]);
  });

  it("never throws when the counter itself fails", async () => {
    // This runs on the failure path of a webhook that is already being
    // refused. If it could throw, the 400 would become a 500 and the provider
    // would retry a request we will never accept — strictly worse than losing
    // the count, which the checker notices one cadence later anyway.
    const sb = world({ status: 500 });
    stubFetch(sb.route);

    await expect(
      recordWebhookRejection(env, signed("telnyx-signature-ed25519"), "telnyx"),
    ).resolves.toBeUndefined();
  });
});

describe("countWebhookRejection", () => {
  /** A context whose `executionCtx` throws, as Hono's does when none is bound. */
  function contextWithout(request: Request): Context<AppEnv> {
    return {
      env: { ...env },
      req: { raw: request },
      get executionCtx(): never {
        throw new Error("This context has no ExecutionContext");
      },
    } as unknown as Context<AppEnv>;
  }

  it("does not throw when no execution context is bound", () => {
    // The regression this guard exists for, and it is not hypothetical: the
    // first version reached for c.executionCtx directly and turned every
    // signature rejection into a 500. A 500 makes the provider RETRY a request
    // we are never going to accept — strictly worse than losing the count.
    const sb = world();
    stubFetch(sb.route);

    expect(() =>
      countWebhookRejection(
        contextWithout(signed("telnyx-signature-ed25519")),
        "telnyx",
      ),
    ).not.toThrow();
  });

  it("still records the rejection when the context cannot defer it", async () => {
    // Losing the deferral must not mean losing the signal: the work is already
    // started before waitUntil is attempted.
    const sb = world();
    stubFetch(sb.route);

    countWebhookRejection(
      contextWithout(signed("telnyx-signature-ed25519")),
      "telnyx",
    );
    await vi.waitFor(() =>
      expect(
        sb.find("POST", "/rest/v1/rpc/record_webhook_rejection"),
      ).toHaveLength(1),
    );
  });
});
