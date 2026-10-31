import { ROBOT_TOKEN_HEADER } from "@loonext/rig-robot";
import { describe, expect, it } from "vitest";
import { RIG_PATH_HEADER, webhookForwarder } from "./forward.ts";
import type { LateDelivery } from "./late.ts";
import { fakeFetch } from "./test-support.ts";
import type { WebhookFrame } from "./uplink.ts";

const NOW = Date.UTC(2026, 9, 31, 5, 0, 0);

const frame = (kind: WebhookFrame["kind"], path = "/t/v", signedSecondsAgo = 2): WebhookFrame => ({
  t: "webhook",
  id: "e1",
  kind,
  path,
  headers: {
    "telnyx-signature-ed25519": "sig",
    "telnyx-timestamp": String(Math.floor(NOW / 1000) - signedSecondsAgo),
    "content-type": "application/json",
  },
  body: '{"data":{}}',
  attempt: 3,
});

function setup(status = 200, late: LateDelivery[] = []) {
  const { fetch, requests } = fakeFetch({
    "POST http://127.0.0.1:8787/webhooks/telnyx": () => new Response(status === 200 ? "ok" : "bad", { status }),
    "POST http://127.0.0.1:7311": () => new Response("{}"),
  });
  const forward = webhookForwarder({
    apiBase: "http://127.0.0.1:8787",
    robotBase: "http://127.0.0.1:7311",
    robotToken: "local",
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
    expect(requests[0]!.headers).toMatchObject({ "telnyx-signature-ed25519": "sig" });
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

  it("answers 503 when the local side cannot be reached, so Telnyx retries", async () => {
    const fetch = (async () => {
      throw new TypeError("connect ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    const forward = webhookForwarder({ apiBase: "http://127.0.0.1:8787", robotBase: "http://127.0.0.1:7311", robotToken: "r", fetch });
    expect(await forward(frame("call"))).toEqual({ status: 503 });
  });

  it("counts a text refused because its signature aged past five minutes, and marks it late", async () => {
    const { forward, late } = setup(400);
    expect(await forward(frame("message", "/t/m", 301))).toMatchObject({ status: 400, late: true });
    expect(late).toEqual([{ at: NOW, frame_id: "e1", path: "/t/m", attempt: 3, age_s: 301 }]);
  });

  it("leaves a fresh signature refusal as a refusal: that is a real fault", async () => {
    const { forward, late } = setup(400);
    expect(await forward(frame("message", "/t/m", 30))).toEqual({ status: 400, body: "bad" });
    expect(await forward(frame("call", "/t/v", 900))).toEqual({ status: 400, body: "bad" });
    expect(late).toEqual([]);
  });
});
