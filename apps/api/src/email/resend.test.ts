/**
 * Resend client suite: the real REST call over the stubbed fetch edge.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { emailTextFooter } from "./html";
import { sendEmail } from "./resend";
import { endpoint, makeHarness } from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";
import { stripComments } from "../test/source-tree";
import type { Env } from "../env";

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

/**
 * #252 — stream separation.
 *
 * "Critical account mail should not share a sending reputation with routine
 * notification volume. Losing the second must not take down the first."
 *
 * SS-3 is the reason this ships before the DNS does. The judgement — WHICH
 * messages are the ones a customer cannot afford to miss — is the part that
 * needed deciding, and it is decided and asserted here. The separation itself
 * is one secret away, and until it is set nothing changes at all.
 */
describe("#252 the critical stream", () => {
  function sender(env: Env, critical?: boolean) {
    const sent: Record<string, unknown>[] = [];
    stubFetch(async (url, request) => {
      if (url.href !== "https://api.resend.com/emails") return undefined;
      sent.push((await request.clone().json()) as Record<string, unknown>);
      return Response.json({ id: "email_1" });
    });
    return { sent, critical };
  }

  it("SS-1: routine mail stays on the ordinary address even when a second exists", async () => {
    // The second sender is CONFIGURED here on purpose. Without it both
    // branches resolve to the same address and the test cannot tell a working
    // split from one that routes everything through the critical stream —
    // which is exactly what the break sweep showed.
    const env = { ...completeEnv(), RESEND_FROM_CRITICAL: "billing@send2.loonext.com" };
    const w = sender(env);
    await sendEmail(env, {
      to: ["owner@example.com"],
      subject: "A customer texted you",
      text: "Open Loonext to reply.",
      html: "<p>Open Loonext to reply.</p>",
    });
    expect(w.sent[0].from).toBe(env.RESEND_FROM);
    expect(w.sent[0].from).not.toBe("billing@send2.loonext.com");
  });

  it("SS-2: critical mail uses the separate sender when one exists", async () => {
    const env = { ...completeEnv(), RESEND_FROM_CRITICAL: "billing@send2.loonext.com" };
    const w = sender(env);
    await sendEmail(env, {
      to: ["owner@example.com"],
      subject: "Your number is released in 3 days",
      text: "Resubscribe to keep it.",
      html: "<p>Resubscribe to keep it.</p>",
      critical: true,
    });
    expect(w.sent[0].from).toBe("billing@send2.loonext.com");
  });

  it("SS-3: with no second sender configured, nothing changes", async () => {
    // The seam ships before the DNS. An environment without the second
    // authenticated subdomain must behave exactly as it did — otherwise this
    // change is a a silent outage waiting for the first critical send.
    const env = completeEnv();
    expect(env.RESEND_FROM_CRITICAL).toBeUndefined();
    const w = sender(env);
    await sendEmail(env, {
      to: ["owner@example.com"],
      subject: "Your number is released in 3 days",
      text: "Resubscribe to keep it.",
      html: "<p>Resubscribe to keep it.</p>",
      critical: true,
    });
    expect(w.sent[0].from).toBe(env.RESEND_FROM);
  });
});

/**
 * #252 — the classification itself, which is the part that needed judgement.
 *
 * The seam is one line. Deciding WHICH messages a customer cannot afford to
 * miss is the work, and a decision recorded only in a `critical: true` buried
 * in a send call is one that quietly stops being true when somebody
 * refactors the call.
 *
 * So the roster is here, and it fails if a named send loses its flag. It is
 * deliberately short: marking everything critical separates nothing, and a
 * "critical" stream carrying routine volume is the ordinary stream with a
 * different name on it.
 */
describe("#252 which mail is critical", () => {
  const CRITICAL_SENDS: readonly { file: string; sends: number; why: string }[] = [
    {
      file: "billing/grace.ts",
      // FOUR rungs, and the count is the assertion. Written first as "the
      // file contains critical: true", which passed with one of the two sends
      // declassified — the released notice could have quietly rejoined the
      // routine stream.
      sends: 2,
      why:
        "Every rung of the release ladder — day 1, 15, 27, and the released " +
        "notice. Each is a deadline after which the business number is gone.",
    },
    {
      file: "billing/cancellation-notice.ts",
      sends: 1,
      why:
        "The first warning, with thirty days of runway. If this is the one " +
        "filtered, the next one is already too late.",
    },
  ];

  it("SS-4: every send on the release ladder is still marked critical", () => {
    const missing: string[] = [];
    for (const send of CRITICAL_SENDS) {
      const path = join(process.cwd(), "src", send.file);
      const code = stripComments(readFileSync(path, "utf8"));
      const found = (code.match(/critical:\s*true/g) ?? []).length;
      if (found < send.sends) {
        missing.push(
          `${send.file} — ${found} of ${send.sends} sends still critical. ${send.why}`,
        );
      }
    }

    expect(
      missing,
      "These sends carry a deadline after which a customer loses their " +
        "business number, and they are no longer on the critical stream. If " +
        "the stream was retired, remove them from this roster too rather " +
        "than leaving a rule with nothing under it: " + missing.join("; "),
    ).toEqual([]);
  });

  it("SS-5: the roster names files that exist", () => {
    // A roster entry pointing at a moved file passes forever while the send it
    // was meant to cover goes out on the ordinary stream.
    for (const send of CRITICAL_SENDS) {
      expect(
        existsSync(join(process.cwd(), "src", send.file)),
        `${send.file} is in the critical roster and does not exist`,
      ).toBe(true);
    }
  });
});
