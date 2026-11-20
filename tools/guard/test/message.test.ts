import { describe, expect, it } from "vitest";

import { EDGE, N, ready, ruleOf } from './support';
import type { Harness } from './support';

const TEXT = { from: N.devW1, to: N.robot1, text: "hello" };

function send(h: Harness, body: Record<string, unknown> = TEXT, headers: Record<string, string> = {}) {
  return h.call("/telnyx/v2/messages", { body, headers });
}

describe("messages", () => {
  it("sends between two owned numbers on nonprod profiles", async () => {
    const h = await ready();
    expect((await send(h)).status).toBe(200);
    expect(h.telnyx.requests("POST", "/v2/messages")).toHaveLength(1);
  });

  it("needs an owned from and an owned to", async () => {
    const h = await ready();
    await expect(ruleOf(await send(h, { ...TEXT, from: N.notOwned }))).resolves.toBe("message.from_not_owned");
    await expect(ruleOf(await send(h, { ...TEXT, from: N.production }))).resolves.toBe("message.from_not_owned");
    await expect(ruleOf(await send(h, { ...TEXT, to: N.notOwned }))).resolves.toBe("message.to_not_owned");
    await expect(ruleOf(await send(h, { ...TEXT, to: N.production }))).resolves.toBe("message.to_not_owned");
    await expect(ruleOf(await send(h, { ...TEXT, to: [N.robot1, N.notOwned] }))).resolves.toBe("message.to_not_owned");
    expect(h.telnyx.requests("POST", "/v2/messages")).toEqual([]);
  });

  it("refuses a production messaging profile, named or bound to the sender", async () => {
    const h = await ready();
    await expect(ruleOf(await send(h, { ...TEXT, messaging_profile_id: "prof-prod" }))).resolves.toBe(
      "message.profile_not_nonprod",
    );
    const number = h.telnyx.numbers.find((item) => item.id === "num-devw2");
    if (number) number.messaging_profile_id = "prof-prod";
    await h.store.delete("partition:owned");
    await expect(ruleOf(await send(h, { ...TEXT, from: N.devW2 }))).resolves.toBe("message.profile_not_nonprod");
  });

  it("keeps delivery webhooks on the edge", async () => {
    const h = await ready();
    await expect(ruleOf(await send(h, { ...TEXT, webhook_url: "https://somewhere.example/hook" }))).resolves.toBe(
      "message.field_refused",
    );
    expect((await send(h, { ...TEXT, webhook_url: `${EDGE}/t/m` })).status).toBe(200);
  });

  it("forwards messages past the old daily allowance", async () => {
    const h = await ready();
    for (let count = 0; count < 21; count++) expect((await send(h)).status).toBe(200);
    expect(h.telnyx.requests("POST", "/v2/messages")).toHaveLength(21);
  });
});
