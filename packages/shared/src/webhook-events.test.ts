import { describe, expect, it } from "vitest";

import {
  WEBHOOK_AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES,
  WEBHOOK_ENDPOINT_CAP,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_SCHEDULE_SECONDS,
  isDeliverableWebhookUrl,
  isWebhookEventType,
  parseWebhookSignatureHeader,
  webhookEventLabelKey,
  webhookRetryDelaySeconds,
  webhookSignatureHeader,
  webhookSignaturePayload,
  webhookUrlRejection,
  webhookUrlRejectionKey,
} from "./webhook-events";

describe("the event vocabulary", () => {
  it("names exactly the events #243 asked for", () => {
    // Set equality in BOTH directions. A one-way containment check passes when
    // a name is added that nobody meant to promise, and every name here is a
    // permanent commitment to somebody else's code.
    expect([...WEBHOOK_EVENT_TYPES].sort()).toEqual(
      [
        "call.completed",
        "contact.created",
        "message.failed",
        "message.received",
        "message.sent",
        "task.completed",
        "task.created",
        "voicemail.received",
      ].sort(),
    );
  });

  it("recognises its own names and refuses near-misses", () => {
    for (const type of WEBHOOK_EVENT_TYPES) expect(isWebhookEventType(type)).toBe(true);
    expect(isWebhookEventType("message.delivered")).toBe(false);
    expect(isWebhookEventType("Message.Received")).toBe(false);
    expect(isWebhookEventType("")).toBe(false);
  });

  it("derives a label key per event, and they are all distinct", () => {
    expect(webhookEventLabelKey("message.received")).toBe("webhooks.event.messageReceived");
    expect(webhookEventLabelKey("voicemail.received")).toBe("webhooks.event.voicemailReceived");
    const keys = WEBHOOK_EVENT_TYPES.map(webhookEventLabelKey);
    expect(new Set(keys).size).toBe(WEBHOOK_EVENT_TYPES.length);
  });
});

describe("signing", () => {
  it("puts the timestamp inside the signed material", () => {
    // The property the whole scheme rests on: change only the timestamp and
    // the bytes being signed change too, so a captured body cannot be replayed
    // under a fresh clock reading.
    const body = '{"event":"message.received"}';
    expect(webhookSignaturePayload(1_700_000_000, body)).toBe(`1700000000.${body}`);
    expect(webhookSignaturePayload(1_700_000_001, body)).not.toBe(
      webhookSignaturePayload(1_700_000_000, body),
    );
  });

  it("round-trips the header it formats", () => {
    const header = webhookSignatureHeader(1_700_000_000, "abc123");
    expect(header).toBe("t=1700000000,v1=abc123");
    expect(parseWebhookSignatureHeader(header)).toEqual({
      timestampSeconds: 1_700_000_000,
      v1: "abc123",
    });
  });

  it("reads a header whose parts arrive in another order, or with a scheme it does not know", () => {
    // A receiver written against v1 must keep working the day a v2 is added
    // alongside it — that is what makes the version marker worth carrying.
    expect(parseWebhookSignatureHeader("v1=deadbeef, t=1700000000")).toEqual({
      timestampSeconds: 1_700_000_000,
      v1: "deadbeef",
    });
    expect(parseWebhookSignatureHeader("t=1700000000,v1=aa,v2=bb")).toEqual({
      timestampSeconds: 1_700_000_000,
      v1: "aa",
    });
  });

  it("refuses a header that is missing half of itself", () => {
    expect(parseWebhookSignatureHeader("t=1700000000")).toBeNull();
    expect(parseWebhookSignatureHeader("v1=abc")).toBeNull();
    expect(parseWebhookSignatureHeader("t=nope,v1=abc")).toBeNull();
    expect(parseWebhookSignatureHeader("t=1700000000,v1=")).toBeNull();
    expect(parseWebhookSignatureHeader("")).toBeNull();
  });
});

describe("the retry schedule", () => {
  it("gives up after the schedule runs out, and says so with null", () => {
    expect(webhookRetryDelaySeconds(1)).toBe(30);
    expect(webhookRetryDelaySeconds(2)).toBe(120);
    expect(webhookRetryDelaySeconds(WEBHOOK_RETRY_SCHEDULE_SECONDS.length)).toBe(21_600);
    expect(webhookRetryDelaySeconds(WEBHOOK_MAX_ATTEMPTS)).toBeNull();
    expect(webhookRetryDelaySeconds(99)).toBeNull();
  });

  it("backs off monotonically", () => {
    const gaps = [...WEBHOOK_RETRY_SCHEDULE_SECONDS];
    for (let i = 1; i < gaps.length; i += 1) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]!);
  });

  it("keeps the caps meaningful rather than decorative", () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(6);
    expect(WEBHOOK_ENDPOINT_CAP).toBe(10);
    // The auto-disable has to be reachable — a threshold above what the retry
    // schedule can ever produce is a cost cap that never fires.
    expect(WEBHOOK_AUTO_DISABLE_AFTER_CONSECUTIVE_FAILURES).toBeGreaterThan(0);
  });
});

describe("where a webhook may point", () => {
  it("accepts an ordinary public https endpoint", () => {
    expect(webhookUrlRejection("https://hooks.example.com/loonext")).toBeNull();
    expect(isDeliverableWebhookUrl("https://example.co.uk:8443/a/b?c=d")).toBe(true);
    // Names that merely START like an IPv6 private range are ordinary names.
    expect(webhookUrlRejection("https://fda-updates.example.com/hook")).toBeNull();
    expect(webhookUrlRejection("https://fcbank.com/hook")).toBeNull();
    // 172.32 is outside 172.16/12 — the boundary a hand-written range check
    // gets wrong in one direction or the other.
    expect(webhookUrlRejection("https://172.32.0.1/hook")).toBeNull();
    expect(webhookUrlRejection("https://172.15.255.254/hook")).toBeNull();
  });

  it("refuses anything that is not https", () => {
    expect(webhookUrlRejection("http://hooks.example.com/x")).toBe("not-https");
    expect(webhookUrlRejection("ftp://hooks.example.com/x")).toBe("not-https");
    expect(webhookUrlRejection("javascript:alert(1)")).toBe("not-https");
  });

  it("refuses loopback in every spelling it arrives in", () => {
    expect(webhookUrlRejection("https://localhost/x")).toBe("loopback-host");
    expect(webhookUrlRejection("https://LOCALHOST/x")).toBe("loopback-host");
    expect(webhookUrlRejection("https://api.localhost/x")).toBe("loopback-host");
    expect(webhookUrlRejection("https://127.0.0.1/x")).toBe("loopback-host");
    expect(webhookUrlRejection("https://127.9.9.9/x")).toBe("loopback-host");
    expect(webhookUrlRejection("https://[::1]/x")).toBe("loopback-host");
    // A trailing dot is a fully-qualified name and resolves identically.
    expect(webhookUrlRejection("https://localhost./x")).toBe("loopback-host");
  });

  it("refuses private and link-local addresses, including cloud metadata", () => {
    expect(webhookUrlRejection("https://10.1.2.3/x")).toBe("private-host");
    expect(webhookUrlRejection("https://192.168.1.1/x")).toBe("private-host");
    expect(webhookUrlRejection("https://172.16.0.1/x")).toBe("private-host");
    expect(webhookUrlRejection("https://172.31.255.255/x")).toBe("private-host");
    // The one that turns an SSRF into a credential theft on every major cloud.
    expect(webhookUrlRejection("https://169.254.169.254/latest/meta-data/")).toBe("private-host");
    expect(webhookUrlRejection("https://[fd00::1]/x")).toBe("private-host");
    expect(webhookUrlRejection("https://[fe80::1]/x")).toBe("private-host");
    // An IPv4 address wearing an IPv6 hat reaches the same machine.
    expect(webhookUrlRejection("https://[::ffff:10.0.0.1]/x")).toBe("private-host");
    expect(webhookUrlRejection("https://[::ffff:127.0.0.1]/x")).toBe("loopback-host");
    expect(webhookUrlRejection("https://printer.local/x")).toBe("private-host");
  });

  it("refuses an endpoint aimed back at us", () => {
    expect(webhookUrlRejection("https://api.loonext.com/v1/messages")).toBe("our-own-host");
    expect(webhookUrlRejection("https://loonext.com/x")).toBe("our-own-host");
  });

  it("refuses credentials in the URL and absurd lengths", () => {
    expect(webhookUrlRejection("https://user:pass@hooks.example.com/x")).toBe("has-credentials");
    expect(webhookUrlRejection(`https://example.com/${"a".repeat(2100)}`)).toBe("too-long");
    expect(webhookUrlRejection("not a url at all")).toBe("not-a-url");
  });

  it("has a distinct catalogue key per rejection", () => {
    const reasons = [
      "not-a-url",
      "not-https",
      "private-host",
      "loopback-host",
      "our-own-host",
      "has-credentials",
      "too-long",
    ] as const;
    const keys = reasons.map(webhookUrlRejectionKey);
    expect(keys).toContain("webhooks.urlError.notHttps");
    expect(keys).toContain("webhooks.urlError.ourOwnHost");
    expect(new Set(keys).size).toBe(reasons.length);
  });
});
