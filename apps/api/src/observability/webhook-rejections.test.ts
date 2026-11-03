/**
 * #308: the webhooks we receive and throw away, as `webhook_rejected` events.
 *
 *   - a rejection is only reported when the request LOOKS like a real
 *     delivery, which bounds what a scanner on a public route can send and
 *     keeps the signal from being diluted by traffic that says nothing about
 *     our secret;
 *   - a flood of them sends one event per provider per window, so a script on a
 *     public route cannot spend the month's event quota;
 *   - reporting can never turn a 400 into a 500, because that would make the
 *     provider retry a request we are never going to accept.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Context } from "hono";

import type { AppEnv } from "../context";
import { eventsCaptured, resetCaptures } from "../test/capture-mock";
import { completeEnv } from "../test/support";
import {
  countWebhookRejection,
  rejectionGate,
  type WebhookProvider,
} from "./webhook-rejections";

vi.mock("./capture", async () => (await import("../test/capture-mock")).captureModuleMock());

const env = completeEnv();

const signed = (header: string) =>
  new Request("https://api.example/webhooks/x", {
    method: "POST",
    headers: { [header]: "v1,abc" },
  });

const unsigned = () => new Request("https://api.example/webhooks/x", { method: "POST" });

function context(request: Request, waitUntil?: (promise: Promise<unknown>) => void): Context<AppEnv> {
  return {
    env: { ...env },
    req: { raw: request },
    get executionCtx() {
      if (waitUntil === undefined) throw new Error("This context has no ExecutionContext");
      return { waitUntil };
    },
  } as unknown as Context<AppEnv>;
}

const providers = () =>
  eventsCaptured("webhook_rejected").map((event) => event.properties.provider as WebhookProvider);

beforeEach(() => {
  resetCaptures();
  rejectionGate.reset();
  vi.useRealTimers();
});

describe("countWebhookRejection", () => {
  it("reports a rejection that carries the provider's signature header", () => {
    const deferred: Promise<unknown>[] = [];
    countWebhookRejection(
      context(signed("telnyx-signature-ed25519"), (promise) => deferred.push(promise)),
      "telnyx",
    );

    expect(eventsCaptured("webhook_rejected")).toEqual([
      { event: "webhook_rejected", distinctId: "loonext-api", properties: { provider: "telnyx" } },
    ]);
  });

  it("ignores a request with no signature header at all", () => {
    countWebhookRejection(context(unsigned(), () => {}), "telnyx");
    expect(providers()).toEqual([]);
  });

  it("keys each provider off its own header", () => {
    // A single hardcoded header would silently report nothing for two of the
    // three providers, which is the failure this whole issue is about.
    countWebhookRejection(context(signed("stripe-signature"), () => {}), "stripe");
    countWebhookRejection(context(signed("svix-signature"), () => {}), "resend");
    countWebhookRejection(context(signed("telnyx-signature-ed25519"), () => {}), "stripe");

    expect(providers()).toEqual(["stripe", "resend"]);
  });

  it("sends one event per provider per five minutes, however many requests refuse", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T10:00:00Z"));
    const flood = (provider: WebhookProvider, header: string) => {
      for (let n = 0; n < 500; n += 1) {
        countWebhookRejection(context(signed(header), () => {}), provider);
      }
    };

    flood("stripe", "stripe-signature");
    flood("telnyx", "telnyx-signature-ed25519");
    expect(providers()).toEqual(["stripe", "telnyx"]);

    vi.advanceTimersByTime(5 * 60 * 1000 - 1);
    flood("stripe", "stripe-signature");
    expect(providers()).toEqual(["stripe", "telnyx"]);

    vi.advanceTimersByTime(1);
    flood("stripe", "stripe-signature");
    expect(providers()).toEqual(["stripe", "telnyx", "stripe"]);
  });

  it("still reports, and does not throw, when no execution context is bound", () => {
    // The first version reached for c.executionCtx directly and turned every
    // signature rejection into a 500.
    expect(() =>
      countWebhookRejection(context(signed("telnyx-signature-ed25519")), "telnyx"),
    ).not.toThrow();
    expect(providers()).toEqual(["telnyx"]);
  });
});
