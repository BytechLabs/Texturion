import { describe, expect, it } from "vitest";

import { buildEnvelope, parseDsn, sendProductionEvent } from "../src/sentry";
import { harness } from "./support";

describe("production Sentry events", () => {
  it("post to the DSN's envelope endpoint with the public key only", async () => {
    const h = harness();
    expect(await sendProductionEvent(h.ctx, { key: "telnyx-key-inventory", summary: "x" })).toBe(true);
    const [sent] = h.outbound;
    expect(sent.url).toBe("https://o1.ingest.sentry.example/api/12345/envelope/");
    expect(sent.headers.get("content-type")).toBe("application/x-sentry-envelope");
    expect(sent.headers.get("x-sentry-auth")).toContain("sentry_key=publickey");
    expect(sent.headers.get("authorization")).toBeNull();
  });

  it("group by the same ['ops', key] fingerprint production's own alerts use", () => {
    const lines = buildEnvelope("https://k@o1.ingest.sentry.example/12345", { key: "telnyx-account-signal", summary: "s", detail: "d", level: "error" }, 0)
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toEqual({ type: "event" });
    expect(lines[2]).toMatchObject({
      fingerprint: ["ops", "telnyx-account-signal"],
      level: "error",
      environment: "production",
      message: { formatted: "s" },
      extra: { detail: "d" },
    });
    expect(lines[0].event_id).toBe(lines[2].event_id);
  });

  it("parse a DSN with a path prefix, and reject anything that is not one", () => {
    expect(parseDsn("https://k@sentry.example/prefix/42")).toEqual({
      publicKey: "k",
      envelopeUrl: "https://sentry.example/prefix/api/42/envelope/",
    });
    for (const dsn of ["", "not a url", "http://k@sentry.example/42", "https://sentry.example/42", "https://k@sentry.example/x"]) {
      expect(parseDsn(dsn), dsn).toBeNull();
    }
  });

  it("never throw: no DSN, a refusing Sentry or a network failure is a logged false", async () => {
    expect(await sendProductionEvent(harness({ env: { SENTRY_PROD_DSN: "" } }).ctx, { key: "k", summary: "s" })).toBe(false);
    const h = harness();
    h.ctx.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await sendProductionEvent(h.ctx, { key: "k", summary: "s" })).toBe(false);
  });
});
