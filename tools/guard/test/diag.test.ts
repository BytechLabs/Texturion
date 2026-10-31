import { describe, expect, it } from "vitest";

import { redact, redactString } from "../src/vendors/redact";
import { harness, N, ruleOf } from "./support";

describe("diag class", () => {
  it("reads only GETs, on the listed production paths", async () => {
    const h = harness();
    expect(await ruleOf(await h.call("/diag/v2/webhook_deliveries", { caller: "diag", method: "POST", body: {} }))).toBe(
      "diag.method",
    );
    for (const path of ["/v2/phone_numbers", "/v2/messages/m1", "/v2/recordings", "/v2/balance", "/v2/calls/c1"]) {
      expect(await ruleOf(await h.call(`/diag${path}`, { caller: "diag" })), path).toBe("diag.path_refused");
    }
    expect(h.telnyx.log).toEqual([]);
  });

  it("needs a leg filter on call events and a record type on detail records", async () => {
    const h = harness();
    expect(await ruleOf(await h.call("/diag/v2/call_events", { caller: "diag" }))).toBe("diag.filter_required");
    expect(await ruleOf(await h.call("/diag/v2/detail_records", { caller: "diag" }))).toBe("diag.filter_required");
    expect((await h.call("/diag/v2/call_events?filter[leg_id]=leg-1", { caller: "diag" })).status).toBe(200);
    expect((await h.call("/diag/v2/detail_records?filter[record_type]=call-control", { caller: "diag" })).status).toBe(200);
  });

  it("redacts numbers, bodies, recordings and credentials from what it returns", async () => {
    const h = harness();
    h.telnyx.lists.webhook_deliveries.push({
      id: "wd-1",
      status: "failed",
      webhook: {
        event_type: "message.received",
        payload: { from: { phone_number: N.robot1 }, to: [{ phone_number: N.devW1 }], text: "a private message" },
      },
    });
    h.telnyx.lists.credential_connections.push({
      id: "1521916448077776306",
      connection_name: "loonext-webrtc",
      password: "sip-password",
      webhook_event_url: "https://api.loonext.com/webhooks/telnyx",
    });
    const deliveries = JSON.stringify(await (await h.call("/diag/v2/webhook_deliveries", { caller: "diag" })).json());
    expect(deliveries).not.toContain(N.robot1);
    expect(deliveries).not.toContain("a private message");
    expect(deliveries).toContain("***0101");
    const settings = JSON.stringify(await (await h.call("/diag/v2/credential_connections", { caller: "diag" })).json());
    expect(settings).not.toContain("sip-password");
    // Ids and webhook URLs are what PW01 compares; they survive.
    expect(settings).toContain("1521916448077776306");
    expect(settings).toContain("https://api.loonext.com/webhooks/telnyx");
  });

  it("fails closed without the Telnyx key", async () => {
    const h = harness({ env: { TELNYX_API_KEY: "" } });
    expect(await ruleOf(await h.call("/diag/v2/webhook_deliveries", { caller: "diag" }))).toBe("telnyx.key_missing");
  });
});

describe("redaction", () => {
  it("cuts numbers to their last four digits wherever a + marks them", () => {
    expect(redactString(`call from ${N.robot1} to sip:${N.devW1}@sip.telnyx.com`, false)).toBe(
      "call from ***0101 to sip:***0111@sip.telnyx.com",
    );
  });

  it("cuts bare digit runs only in number fields", () => {
    expect(redact({ to: "14165550111", id: "1521916448077776306" })).toEqual({ to: "***0111", id: "1521916448077776306" });
  });

  it("removes bodies, recording URLs and secrets at any depth", () => {
    expect(
      redact({
        data: [
          {
            text: "hi",
            subject: "s",
            media: [{ url: "https://x.example/m.jpg" }],
            recording_urls: { mp3: "https://x.example/r.mp3" },
            download_urls: { wav: "https://x.example/r.wav" },
            public_recording_urls: {},
            v1_secret: "s",
            sip_password: "p",
            payload: "spoken words",
            kept: { status: "delivered", payload: { type: "SMS", text: "nested body" } },
          },
        ],
      }),
    ).toEqual({ data: [{ kept: { status: "delivered", payload: { type: "SMS" } } }] });
  });
});
