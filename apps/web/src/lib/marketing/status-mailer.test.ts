/**
 * #477 — the marketing worker's mailer.
 *
 * Two things matter here and neither is about email formatting: it must be
 * ABSENT rather than broken when the secrets are missing (that absence is what
 * keeps the subscribe form off an unconfigured deploy), and it must put the
 * one-click unsubscribe headers on every message it does send.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildMailer } from "./status-mailer";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("buildMailer", () => {
  it("is null unless BOTH secrets are set", () => {
    // The gate the subscribe card reads. Half-configured is not configured: a
    // key with no From address sends nothing, and a form that renders anyway
    // would take addresses it can never mail.
    expect(buildMailer(undefined)).toBeNull();
    expect(buildMailer({})).toBeNull();
    expect(buildMailer({ RESEND_API_KEY: "re_x" })).toBeNull();
    expect(buildMailer({ RESEND_FROM: "status@loonext.com" })).toBeNull();
    expect(
      buildMailer({ RESEND_API_KEY: "re_x", RESEND_FROM: "status@loonext.com" }),
    ).not.toBeNull();
  });

  it("sends one-click unsubscribe headers with a list message", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        body = JSON.parse(init.body);
        return new Response("{}", { status: 200 });
      }),
    );
    const mailer = buildMailer({
      RESEND_API_KEY: "re_x",
      RESEND_FROM: "status@loonext.com",
    })!;

    expect(
      await mailer.send({
        to: "sam@example.com",
        subject: "Loonext service incident",
        text: "Texting is delayed",
        listUnsubscribeUrl: "https://loonext.com/api/status/unsubscribe?token=abc",
      }),
    ).toBe(true);
    // Gmail and Yahoo require these of bulk senders, and they are the right
    // behaviour regardless of who is enforcing them.
    expect(body.headers).toEqual({
      "List-Unsubscribe":
        "<https://loonext.com/api/status/unsubscribe?token=abc>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("reports failure without leaking the recipient into a log", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line) => {
      logged.push(String(line));
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("sam@example.com is suppressed", { status: 422 })),
    );
    const mailer = buildMailer({
      RESEND_API_KEY: "re_x",
      RESEND_FROM: "status@loonext.com",
    })!;

    expect(
      await mailer.send({
        to: "sam@example.com",
        subject: "s",
        text: "t",
      }),
    ).toBe(false);
    // A provider's error body can echo the address back. The log gets the
    // status code and nothing else.
    expect(logged.join("\n")).toContain("422");
    expect(logged.join("\n")).not.toContain("sam@example.com");
  });

  it("does not throw when the network does", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    const mailer = buildMailer({
      RESEND_API_KEY: "re_x",
      RESEND_FROM: "status@loonext.com",
    })!;
    await expect(
      mailer.send({ to: "sam@example.com", subject: "s", text: "t" }),
    ).resolves.toBe(false);
  });
});
