import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManualClock } from "@loonext/rig-robot/test-support";
import { afterEach, describe, expect, it } from "vitest";
import {
  infraFingerprint,
  parseDsn,
  parseEnvelope,
  type RelayLimits,
  SentryRelay,
  syntheticFingerprint,
} from "./sentry-relay.ts";
import { fakeFetch } from "./test-support.ts";

const SYNTHETIC = parseDsn("https://publickey1@o1.ingest.sentry.example/101");
const RIG = parseDsn("https://publickey2@o1.ingest.sentry.example/102");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(limits: Partial<RelayLimits> = {}, start = Date.UTC(2026, 9, 1, 5)) {
  const dir = mkdtempSync(join(tmpdir(), "rig-relay-"));
  dirs.push(dir);
  const { fetch, requests } = fakeFetch({ POST: () => new Response("{}") });
  const clock = new ManualClock(start);
  const relay = new SentryRelay({ statePath: join(dir, "relay.json"), alertDsn: SYNTHETIC, fetch, clock, limits });
  const events = () =>
    requests.map((r) => {
      const { items } = parseEnvelope(new TextEncoder().encode(r.body ?? ""));
      return { url: r.url, auth: r.headers["x-sentry-auth"], event: JSON.parse(items[0]!.payload) as Record<string, unknown> };
    });
  return { relay, requests, clock, events };
}

describe("parseDsn", () => {
  it("finds the envelope endpoint and the public key, and refuses what is not a DSN", () => {
    expect(SYNTHETIC).toMatchObject({ publicKey: "publickey1", projectId: "101", envelopeUrl: "https://o1.ingest.sentry.example/api/101/envelope/" });
    expect(parseDsn("http://k@127.0.0.1:7312/102").envelopeUrl).toBe("http://127.0.0.1:7312/api/102/envelope/");
    expect(() => parseDsn("https://o1.ingest.sentry.example/101")).toThrow(/not a DSN/);
  });
});

describe("the relay", () => {
  it("sends one event by DSN with the synthetic fingerprint, and no API token", async () => {
    const { relay, events } = setup();
    const decision = await relay.send(SYNTHETIC, {
      fingerprint: syntheticFingerprint("S02", "robot_did_not_hear_member"),
      message: "S02 failed",
      runId: "S02-1",
      tags: { scenario: "S02" },
    });
    expect(decision.sent).toBe(true);
    const [sent] = events();
    expect(sent!.url).toBe(SYNTHETIC.envelopeUrl);
    expect(sent!.auth).toMatch(/sentry_key=publickey1/);
    expect(sent!.event).toMatchObject({ fingerprint: ["synthetic", "S02", "robot_did_not_hear_member"], tags: { scenario: "S02", run_id: "S02-1" } });
  });

  it("suppresses a repeated fingerprint for 6 hours", async () => {
    const { relay, clock, requests } = setup();
    const event = { fingerprint: infraFingerprint("pixel"), message: "Pixel offline" };
    expect((await relay.send(SYNTHETIC, event)).sent).toBe(true);
    clock.advance(6 * 60 * 60 * 1000 - 1);
    expect(await relay.send(SYNTHETIC, event)).toEqual({ sent: false, reason: "suppressed" });
    clock.advance(1);
    expect((await relay.send(SYNTHETIC, event)).sent).toBe(true);
    expect(requests).toHaveLength(2);
  });

  it("caps a run at 50 events", async () => {
    const { relay } = setup();
    const decisions = [];
    for (let i = 0; i < 52; i++) decisions.push(await relay.send(SYNTHETIC, { fingerprint: ["synthetic", "S01", `c${i}`], message: "x", runId: "run-1" }));
    expect(decisions.filter((d) => d.sent)).toHaveLength(50);
    expect(decisions.at(-1)).toEqual({ sent: false, reason: "run_cap" });
  });

  it("alerts once at 70% of the day, then holds the daily cap of 100", async () => {
    const { relay, events, clock } = setup({ perRun: 1_000 });
    for (let i = 0; i < 120; i++) await relay.send(SYNTHETIC, { fingerprint: ["synthetic", "S01", `c${i}`], message: "x" });
    const sent = events();
    expect(sent).toHaveLength(100);
    const alerts = sent.filter((e) => (e.event.fingerprint as string[])[1] === "sentry-relay");
    expect(alerts).toHaveLength(1);
    // The 70th event crosses the line; the alert goes out just before it.
    expect(sent.indexOf(alerts[0]!)).toBe(69);
    expect(await relay.send(SYNTHETIC, { fingerprint: ["synthetic", "S01", "next"], message: "x" })).toEqual({ sent: false, reason: "daily_cap" });
    clock.advance(24 * 60 * 60 * 1000);
    expect((await relay.send(SYNTHETIC, { fingerprint: ["synthetic", "S01", "tomorrow"], message: "x" })).sent).toBe(true);
  });

  it("holds the monthly cap across days", async () => {
    const { relay, clock } = setup({ daily: 1_000, monthly: 30, perRun: 1_000 });
    let sent = 0;
    for (let i = 0; i < 40; i++) {
      if ((await relay.send(SYNTHETIC, { fingerprint: ["synthetic", "S01", `c${i}`], message: "x" })).sent) sent++;
      if (i % 10 === 9) clock.advance(24 * 60 * 60 * 1000);
    }
    // 30 in the month, of which one was the relay's own 70% alert.
    expect(sent).toBe(29);
  });

  it("forwards only the error events of an SDK envelope, to the rig project", async () => {
    const { relay, requests } = setup();
    const attachment = "line one\nline two";
    const envelope = [
      JSON.stringify({ event_id: "a".repeat(32), dsn: "http://k@127.0.0.1:7312/102" }),
      JSON.stringify({ type: "transaction" }),
      JSON.stringify({ type: "transaction", spans: [] }),
      JSON.stringify({ type: "attachment", length: Buffer.byteLength(attachment) }),
      attachment,
      JSON.stringify({ type: "event" }),
      JSON.stringify({ exception: { values: [{ type: "TypeError", value: "x is undefined" }] } }),
      "",
    ].join("\n");
    expect((await relay.forwardEnvelope(RIG, new TextEncoder().encode(envelope))).sent).toBe(true);
    const { header, items } = parseEnvelope(new TextEncoder().encode(requests[0]!.body!));
    expect(JSON.parse(header).dsn).toBe(RIG.raw);
    expect(items.map((i) => i.type)).toEqual(["event"]);
    expect(requests[0]!.url).toBe(RIG.envelopeUrl);
    expect(await relay.forwardEnvelope(RIG, new TextEncoder().encode(envelope))).toEqual({ sent: false, reason: "suppressed" });
  });

  it("parses an envelope whose attachment holds newlines", () => {
    const body = `{"event_id":"x"}\n{"type":"attachment","length":5}\na\nb\nc\n{"type":"event"}\n{"message":"m"}\n`;
    const { items } = parseEnvelope(new TextEncoder().encode(body));
    expect(items).toEqual([
      { type: "attachment", payload: "a\nb\nc" },
      { type: "event", payload: '{"message":"m"}' },
    ]);
  });
});
