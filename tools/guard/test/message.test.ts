import { HEADER } from "@loonext/rig-protocol";
import { describe, expect, it } from "vitest";

import { charge } from "../src/state/ledger";
import { recordSignal } from "../src/state/signals";
import { messageCostUsd, smsParts } from "../src/telnyx/message";
import { EDGE, N, ready, ruleOf, type Harness } from "./support";

const TEXT = { from: N.devW1, to: N.robot1, text: "hello" };

function send(h: Harness, body: Record<string, unknown> = TEXT, headers: Record<string, string> = {}) {
  return h.call("/telnyx/v2/messages", { body, headers });
}

describe("messages", () => {
  it("sends between two owned numbers on nonprod profiles", async () => {
    const h = await ready();
    expect((await send(h)).status).toBe(200);
    expect(h.telnyx.requests("POST", "/v2/messages")).toHaveLength(1);
    expect(await h.store.get("count:texts:2026-11-02")).toBe(1);
  });

  it("needs an owned from and an owned to", async () => {
    const h = await ready();
    expect(await ruleOf(await send(h, { ...TEXT, from: N.notOwned }))).toBe("message.from_not_owned");
    expect(await ruleOf(await send(h, { ...TEXT, from: N.production }))).toBe("message.from_not_owned");
    expect(await ruleOf(await send(h, { ...TEXT, to: N.notOwned }))).toBe("message.to_not_owned");
    expect(await ruleOf(await send(h, { ...TEXT, to: N.production }))).toBe("message.to_not_owned");
    expect(await ruleOf(await send(h, { ...TEXT, to: [N.robot1, N.notOwned] }))).toBe("message.to_not_owned");
    expect(h.telnyx.requests("POST", "/v2/messages")).toEqual([]);
  });

  it("refuses a production messaging profile, named or bound to the sender", async () => {
    const h = await ready();
    expect(await ruleOf(await send(h, { ...TEXT, messaging_profile_id: "prof-prod" }))).toBe(
      "message.profile_not_nonprod",
    );
    const number = h.telnyx.numbers.find((item) => item.id === "num-devw2");
    if (number) number.messaging_profile_id = "prof-prod";
    await h.store.delete("partition:owned");
    expect(await ruleOf(await send(h, { ...TEXT, from: N.devW2 }))).toBe("message.profile_not_nonprod");
  });

  it("keeps delivery webhooks on the edge", async () => {
    const h = await ready();
    expect(await ruleOf(await send(h, { ...TEXT, webhook_url: "https://somewhere.example/hook" }))).toBe(
      "message.field_refused",
    );
    expect((await send(h, { ...TEXT, webhook_url: `${EDGE}/t/m` })).status).toBe(200);
  });

  it("caps texts at 20 a day and 300 a month", async () => {
    const h = await ready();
    await h.store.put("count:texts:2026-11-02", 20);
    expect(await ruleOf(await send(h))).toBe("budget.texts_day");
    await h.store.put("count:texts:2026-11-02", 0);
    await h.store.put("count:texts-month:2026-11", 300);
    expect(await ruleOf(await send(h))).toBe("budget.texts_month");
    // The day's take is given back when the month refuses.
    expect(await h.store.get("count:texts:2026-11-02")).toBe(0);
  });

  it("sends at amber only for a core scenario, and never at red", async () => {
    const h = await ready();
    await charge(h.ctx, 2);
    expect(await ruleOf(await send(h))).toBe("budget.tier_amber");
    expect((await send(h, TEXT, { [HEADER.scenario]: "S20" })).status).toBe(200);
    await charge(h.ctx, 40);
    expect(await ruleOf(await send(h, TEXT, { [HEADER.scenario]: "S20" }))).toBe("budget.tier_red");
  });

  it("stops during an account-signal halt", async () => {
    const h = await ready();
    await recordSignal(h.ctx, { signal: "Messaging Suspicious Traffic", notice_id: null, corroborated_by: "notification_event" });
    expect(await ruleOf(await send(h))).toBe("signal.halted");
  });

  it("gives everything back when Telnyx refuses outright", async () => {
    const h = await ready();
    h.telnyx.failNext = { method: "POST", path: "/v2/messages", status: 400 };
    expect((await send(h)).status).toBe(400);
    expect(await h.store.get("count:texts:2026-11-02")).toBe(0);
    expect((await h.store.get<{ usage_usd: number }>("money:month:2026-11"))?.usage_usd).toBe(0);
  });
});

describe("text cost", () => {
  it("counts GSM-7 and UCS-2 parts", () => {
    expect(smsParts("a".repeat(160))).toBe(1);
    expect(smsParts("a".repeat(161))).toBe(2);
    expect(smsParts("é".repeat(70))).toBe(1);
    expect(smsParts("é".repeat(71))).toBe(2);
    expect(smsParts("{")).toBe(1);
  });

  it("prices an MMS above a text", () => {
    expect(messageCostUsd({ text: "hi" })).toBeCloseTo(0.0226);
    expect(messageCostUsd({ text: "hi", media_urls: ["https://x.example/a.png"] })).toBeGreaterThan(0.0226 * 3);
  });
});
