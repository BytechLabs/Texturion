import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROBOT_TOKEN_HEADER } from "@loonext/rig-robot";
import { describe, expect, it } from "vitest";
import { RIG_PATH_HEADER, webhookForwarder } from "./forward.ts";
import { LateDeliveries, textHash, type LateDelivery } from "./late.ts";
import { fakeFetch } from "./test-support.ts";
import type { WebhookFrame } from "./uplink.ts";

const NOW = Date.UTC(2026, 9, 31, 5, 0, 0);
const ROBOT_1 = "+14165550101";
const DEV_W1 = "+14165550111";
const telnyx = generateKeyPairSync("ed25519");
const forger = generateKeyPairSync("ed25519");

const text = (event: string, from: string, to: string, body = "Rig S20 outbound n0nce") =>
  JSON.stringify({ data: { event_type: event, payload: { text: body, from: { phone_number: from }, to: [{ phone_number: to }] } } });

const frame = (
  kind: WebhookFrame["kind"],
  path = "/t/v",
  signedSecondsAgo = 2,
  body = '{"data":{}}',
  key = telnyx.privateKey,
): WebhookFrame => {
  const timestamp = String(Math.floor(NOW / 1000) - signedSecondsAgo);
  return {
    t: "webhook",
    id: "e1",
    kind,
    path,
    headers: {
      "telnyx-signature-ed25519": sign(null, Buffer.from(`${timestamp}|${body}`), key).toString("base64"),
      "telnyx-timestamp": timestamp,
      "content-type": "application/json",
    },
    body,
    attempt: 3,
  };
};

function setup(status = 200, options: { key?: boolean } = {}) {
  const late: LateDelivery[] = [];
  const { fetch, requests } = fakeFetch({
    "POST http://127.0.0.1:8787/webhooks/telnyx": () => new Response(status === 200 ? "ok" : "bad", { status }),
    "POST http://127.0.0.1:7311": () => new Response("{}"),
  });
  const forward = webhookForwarder({
    apiBase: "http://127.0.0.1:8787",
    robotBase: "http://127.0.0.1:7311",
    robotToken: "local",
    robotNumber: (e164) => e164 === ROBOT_1,
    telnyxKey: () => (options.key === false ? undefined : telnyx.publicKey),
    onLate: (entry) => late.push(entry),
    fetch,
    now: () => NOW,
  });
  return { forward, requests, late };
}

describe("webhookForwarder", () => {
  it("sends call events and tenants' texts to the API's Telnyx route with the signature headers intact", async () => {
    const { forward, requests } = setup();
    expect(await forward(frame("call"))).toEqual({ status: 200, body: "ok" });
    await forward(frame("message", "/t/m"));
    expect(requests.map((r) => r.url)).toEqual(["http://127.0.0.1:8787/webhooks/telnyx", "http://127.0.0.1:8787/webhooks/telnyx"]);
    expect(requests[0]!.headers["telnyx-signature-ed25519"]).toBe(frame("call").headers["telnyx-signature-ed25519"]);
    expect(requests[0]!.headers[ROBOT_TOKEN_HEADER]).toBeUndefined();
    expect(requests[0]!.body).toBe('{"data":{}}');
  });

  it("sends the robot's call events, its own texts (on /t/r) and its sink deliveries to robotd", async () => {
    const { forward, requests } = setup();
    await forward(frame("robot-call", "/t/r"));
    await forward(frame("message", "/t/r"));
    await forward(frame("robot-webhook", "/w/voicemail?x=1"));
    expect(requests.map((r) => [r.url, r.headers[ROBOT_TOKEN_HEADER], r.headers[RIG_PATH_HEADER]])).toEqual([
      ["http://127.0.0.1:7311/telnyx", "local", "/t/r"],
      ["http://127.0.0.1:7311/telnyx", "local", "/t/r"],
      ["http://127.0.0.1:7311/sink", "local", "/w/voicemail?x=1"],
    ]);
  });

  it("knows the robot's texts on the shared /t/m path by the robot's end of them", async () => {
    const { forward, requests } = setup();
    await forward(frame("message", "/t/m", 2, text("message.received", DEV_W1, ROBOT_1)));
    await forward(frame("message", "/t/m", 2, text("message.sent", ROBOT_1, DEV_W1)));
    await forward(frame("message", "/t/m", 2, text("message.finalized", ROBOT_1, DEV_W1)));
    // The app's own side of the same texts stays the API's.
    await forward(frame("message", "/t/m", 2, text("message.sent", DEV_W1, ROBOT_1)));
    await forward(frame("message", "/t/m", 2, text("message.received", ROBOT_1, DEV_W1)));
    expect(requests.map((r) => r.url)).toEqual([
      "http://127.0.0.1:7311/telnyx",
      "http://127.0.0.1:7311/telnyx",
      "http://127.0.0.1:7311/telnyx",
      "http://127.0.0.1:8787/webhooks/telnyx",
      "http://127.0.0.1:8787/webhooks/telnyx",
    ]);
  });

  it("answers 503 when the local side cannot be reached, so Telnyx retries", async () => {
    const fetch = (async () => {
      throw new TypeError("connect ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    const forward = webhookForwarder({ apiBase: "http://127.0.0.1:8787", robotBase: "http://127.0.0.1:7311", robotToken: "r", fetch });
    expect(await forward(frame("call"))).toEqual({ status: 503 });
  });

  it("records a genuine text refused only for its age, by a hash of its body", async () => {
    const { forward, late } = setup(400);
    const body = text("message.received", ROBOT_1, DEV_W1, "STOP");
    expect(await forward(frame("message", "/t/m", 301, body))).toMatchObject({ status: 400, late: true });
    expect(late).toEqual([
      { at: NOW, frame_id: "e1", path: "/t/m", attempt: 3, age_s: 301, signed_at: NOW - 301_000, text_sha256: textHash("STOP") },
    ]);
  });

  it("lets a run claim only its own late texts, signed while it ran", () => {
    const dir = mkdtempSync(join(tmpdir(), "rig-late-"));
    try {
      const ledger = new LateDeliveries(join(dir, "late.jsonl"));
      const entry = (signedAt: number, text: string): LateDelivery => ({
        at: NOW,
        frame_id: "e",
        path: "/t/m",
        attempt: 1,
        age_s: 400,
        signed_at: signedAt,
        text_sha256: textHash(text),
      });
      ledger.record(entry(NOW - 400_000, "STOP"));
      ledger.record(entry(NOW - 3_600_000, "START"));
      ledger.record(entry(NOW - 400_000, "someone else"));
      const since = NOW - 450_000;
      expect(ledger.matching({ since, texts: new Set([textHash("STOP"), textHash("START")]) }).map((e) => e.text_sha256)).toEqual([
        textHash("STOP"),
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves every other refusal a refusal: a fresh one, a forged one, or one rigd cannot check", async () => {
    const { forward, late } = setup(400);
    expect(await forward(frame("message", "/t/m", 30))).toEqual({ status: 400, body: "bad" });
    expect(await forward(frame("call", "/t/v", 900))).toEqual({ status: 400, body: "bad" });
    expect(await forward(frame("message", "/t/m", 900, text("message.received", ROBOT_1, DEV_W1), forger.privateKey))).toEqual({
      status: 400,
      body: "bad",
    });
    expect(late).toEqual([]);
    const blind = setup(400, { key: false });
    expect(await blind.forward(frame("message", "/t/m", 900))).toEqual({ status: 400, body: "bad" });
    expect(blind.late).toEqual([]);
  });
});
