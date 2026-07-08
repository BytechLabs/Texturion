/**
 * Resend client suite: the real REST call over the stubbed fetch edge.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendEmail } from "./resend";
import { endpoint, makeHarness } from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";

const env = completeEnv();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendEmail", () => {
  it("POSTs the Resend payload with the env sender and bearer auth", async () => {
    const harness = makeHarness([
      endpoint("POST", /^https:\/\/api\.resend\.com\/emails$/, () => ({
        id: "4ef2b1d0-1111-4222-8333-444455556666",
      })),
    ]);
    stubFetch(harness.route);

    const result = await sendEmail(env, {
      to: "owner@example.com",
      subject: "Hello",
      html: "<p>Hi there</p>",
      text: "Hi there",
    });
    expect(result).toEqual({ id: "4ef2b1d0-1111-4222-8333-444455556666" });

    const calls = harness.callsTo("POST", /api\.resend\.com/);
    expect(calls).toHaveLength(1);
    expect(calls[0].json()).toEqual({
      from: env.RESEND_FROM,
      to: ["owner@example.com"],
      subject: "Hello",
      html: "<p>Hi there</p>",
      text: "Hi there",
    });
  });

  it("passes multiple recipients through as-is", async () => {
    const harness = makeHarness([
      endpoint("POST", /api\.resend\.com\/emails/, () => ({ id: "em_1" })),
    ]);
    stubFetch(harness.route);
    await sendEmail(env, {
      to: ["a@example.com", "b@example.com"],
      subject: "s",
      html: "<p>h</p>",
      text: "t",
    });
    expect(
      (harness.callsTo("POST", /emails/)[0].json() as { to: string[] }).to,
    ).toEqual(["a@example.com", "b@example.com"]);
  });

  it("throws on a non-2xx response, surfacing the status", async () => {
    const harness = makeHarness([
      endpoint(
        "POST",
        /api\.resend\.com\/emails/,
        () =>
          new Response(
            JSON.stringify({ name: "validation_error", message: "bad from" }),
            { status: 422 },
          ),
      ),
    ]);
    stubFetch(harness.route);
    await expect(
      sendEmail(env, { to: "x@example.com", subject: "s", html: "h", text: "t" }),
    ).rejects.toThrow(/HTTP 422/);
  });

  it("throws when the response carries no email id", async () => {
    const harness = makeHarness([
      endpoint("POST", /api\.resend\.com\/emails/, () => ({})),
    ]);
    stubFetch(harness.route);
    await expect(
      sendEmail(env, { to: "x@example.com", subject: "s", html: "h", text: "t" }),
    ).rejects.toThrow(/no email id/);
  });

  it("sends no reply_to and no headers when neither env nor input set them", async () => {
    const harness = makeHarness([
      endpoint("POST", /api\.resend\.com\/emails/, () => ({ id: "em_1" })),
    ]);
    stubFetch(harness.route);
    await sendEmail(env, { to: "x@example.com", subject: "s", html: "h", text: "t" });
    const body = harness.callsTo("POST", /emails/)[0].json() as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty("reply_to");
    expect(body).not.toHaveProperty("headers");
  });

  it("stamps env.RESEND_REPLY_TO as reply_to on every send (P0: replies must land somewhere)", async () => {
    const replyEnv = {
      ...completeEnv(),
      RESEND_REPLY_TO: "Loonext Support <support@loonext.com>",
    };
    const harness = makeHarness([
      endpoint("POST", /api\.resend\.com\/emails/, () => ({ id: "em_1" })),
    ]);
    stubFetch(harness.route);
    await sendEmail(replyEnv, {
      to: "x@example.com",
      subject: "s",
      html: "h",
      text: "t",
    });
    expect(
      (harness.callsTo("POST", /emails/)[0].json() as { reply_to: string })
        .reply_to,
    ).toBe("Loonext Support <support@loonext.com>");
  });

  it("a per-send replyTo overrides the env default (contact form → submitter)", async () => {
    const replyEnv = {
      ...completeEnv(),
      RESEND_REPLY_TO: "support@loonext.com",
    };
    const harness = makeHarness([
      endpoint("POST", /api\.resend\.com\/emails/, () => ({ id: "em_1" })),
    ]);
    stubFetch(harness.route);
    await sendEmail(replyEnv, {
      to: "support@loonext.com",
      subject: "s",
      html: "h",
      text: "t",
      replyTo: "customer@example.com",
    });
    expect(
      (harness.callsTo("POST", /emails/)[0].json() as { reply_to: string })
        .reply_to,
    ).toBe("customer@example.com");
  });

  it("passes custom headers through (List-Unsubscribe on recurring alerts)", async () => {
    const harness = makeHarness([
      endpoint("POST", /api\.resend\.com\/emails/, () => ({ id: "em_1" })),
    ]);
    stubFetch(harness.route);
    await sendEmail(env, {
      to: "x@example.com",
      subject: "s",
      html: "h",
      text: "t",
      headers: {
        "List-Unsubscribe": "<https://app.loonext.com/settings/notifications>",
      },
    });
    expect(
      (
        harness.callsTo("POST", /emails/)[0].json() as {
          headers: Record<string, string>;
        }
      ).headers,
    ).toEqual({
      "List-Unsubscribe": "<https://app.loonext.com/settings/notifications>",
    });
  });
});
