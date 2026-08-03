/**
 * Resend client suite: the real REST call over the stubbed fetch edge.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { emailTextFooter } from "./html";
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
      // #252: the body as given, plus the footer this layer appends so the two
      // MIME parts cannot disagree. Asserted whole rather than with `toContain`
      // because this is the one test that pins the ENTIRE payload shape.
      text: "Hi there" + emailTextFooter(),
      reply_to: "support@loonext.com",
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

  it("#252: falls back to the support address when the secret is unset, never to nothing", async () => {
    // This assertion is the inverse of the one that used to be here ("sends no
    // reply_to"), and the old behaviour is the defect. With no Reply-To a
    // customer's reply goes to the `notifications@` SENDER, which nobody reads
    // — while five customer-facing emails tell them to "reply to this email",
    // two of those being the only stated way to undo an irreversible workspace
    // deletion. Whether that instruction was true depended on an optional
    // secret, and nothing failed or warned when it was missing.
    //
    // A default cannot be wrong in a way that hurts: the worst case is a reply
    // reaching a monitored address the operator did not configure.
    const harness = makeHarness([
      endpoint("POST", /api\.resend\.com\/emails/, () => ({ id: "em_1" })),
    ]);
    stubFetch(harness.route);
    await sendEmail(env, { to: "x@example.com", subject: "s", html: "h", text: "t" });
    const body = harness.callsTo("POST", /emails/)[0].json() as Record<
      string,
      unknown
    >;
    expect(body.reply_to).toBe("support@loonext.com");
    expect(body).not.toHaveProperty("headers");
  });

  it("#252: the text part carries the same footer as the html part", async () => {
    // Appended centrally, so a builder cannot ship a text body without it.
    const harness = makeHarness([
      endpoint("POST", /api\.resend\.com\/emails/, () => ({ id: "em_1" })),
    ]);
    stubFetch(harness.route);
    await sendEmail(env, {
      to: "x@example.com",
      subject: "s",
      html: "h",
      text: "Your workspace closes in 30 days.",
    });
    const body = harness.callsTo("POST", /emails/)[0].json() as Record<
      string,
      unknown
    >;
    expect(body.text).toContain("Your workspace closes in 30 days.");
    expect(body.text).toContain("support@loonext.com");
    expect(body.text).toContain("Replying reaches a person");
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


describe("suppression (#386)", () => {
  /** A Resend endpoint plus a suppression list holding `blocked`. */
  function world(blocked: string[]) {
    const sent: Record<string, unknown>[] = [];
    const routes = [
      async (url: URL) => {
        if (url.pathname !== "/rest/v1/email_suppressions") return undefined;
        return Response.json(blocked.map((email) => ({ email })));
      },
      async (url: URL, request: Request) => {
        if (url.href !== "https://api.resend.com/emails") return undefined;
        sent.push((await request.clone().json()) as Record<string, unknown>);
        return Response.json({ id: "re_ok" });
      },
    ];
    return { sent, routes };
  }

  it("drops a suppressed recipient and still mails the rest", async () => {
    // The shared-fate fix. One dead mailbox in one workspace otherwise bounces
    // every notification forever, and those bounces land against OUR sending
    // domain rather than that customer's — degrading delivery for everyone.
    const w = world(["dead@example.com"]);
    stubFetch(...w.routes);

    await sendEmail(env, {
      to: ["dead@example.com", "alive@example.com"],
      subject: "New text",
      text: "hi",
      html: "<p>hi</p>",
    });

    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].to).toEqual(["alive@example.com"]);
  });

  it("makes no request at all when every recipient is suppressed", async () => {
    // Not an error and nothing to retry: the addresses are gone. Throwing here
    // would fail a webhook or a cron over a mailbox we already know is dead.
    const w = world(["dead@example.com"]);
    stubFetch(...w.routes);

    const result = await sendEmail(env, {
      to: ["dead@example.com"],
      subject: "New text",
      text: "hi",
      html: "<p>hi</p>",
    });

    expect(w.sent).toHaveLength(0);
    expect(result.id).toBeNull();
  });

  it("matches case-insensitively, because a mailbox is not two mailboxes", async () => {
    const w = world(["dead@example.com"]);
    stubFetch(...w.routes);

    await sendEmail(env, { to: ["DEAD@Example.COM"], subject: "s", text: "t", html: "<p>t</p>" });

    expect(w.sent).toHaveLength(0);
  });

  it("SENDS ANYWAY when the suppression lookup fails", async () => {
    // Fail open, deliberately. The list protects domain reputation over a long
    // horizon; a database blip must not be the reason a customer never learns
    // their payment failed. Failing open costs a few bounces, failing closed
    // costs the message.
    const sent: Record<string, unknown>[] = [];
    stubFetch(
      async (url) =>
        url.pathname === "/rest/v1/email_suppressions"
          ? new Response("boom", { status: 500 })
          : undefined,
      async (url, request) => {
        if (url.href !== "https://api.resend.com/emails") return undefined;
        sent.push((await request.clone().json()) as Record<string, unknown>);
        return Response.json({ id: "re_ok" });
      },
    );

    await sendEmail(env, { to: ["someone@example.com"], subject: "s", text: "t", html: "<p>t</p>" });

    expect(sent).toHaveLength(1);
  });
});
