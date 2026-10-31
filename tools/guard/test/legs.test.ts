import { LEG_REGISTRY_TTL_MS } from "@loonext/rig-protocol";
import { describe, expect, it } from "vitest";

import { charge } from "../src/state/ledger";
import { EDGE, ready, registerViaEdge, ruleOf } from "./support";

describe("leg registry", () => {
  it("lets the edge register a leg on a nonprod connection", async () => {
    const h = await ready();
    const response = await registerViaEdge(h, "ccid-1", "conn-webrtc", "webrtc");
    expect(response.status).toBe(200);
    expect((await h.call("/telnyx/v2/calls/ccid-1/actions/answer", { body: {} })).status).toBe(200);
  });

  it("refuses a production connection, and a via that does not match the connection", async () => {
    const h = await ready();
    expect(await ruleOf(await registerViaEdge(h, "ccid-p", "conn-prod-voice", "voice"))).toBe(
      "legs.connection_not_nonprod",
    );
    expect(await ruleOf(await registerViaEdge(h, "ccid-v", "conn-voice", "robot"))).toBe("legs.via_mismatch");
    expect(await ruleOf(await h.call("/telnyx/v2/calls/ccid-p/actions/hangup", { body: {} }))).toBe(
      "leg.not_registered",
    );
  });

  it("refuses a command on a leg nobody registered, without asking Telnyx", async () => {
    const h = await ready();
    expect(await ruleOf(await h.call("/telnyx/v2/calls/ccid-unknown/actions/hangup", { body: {} }))).toBe(
      "leg.not_registered",
    );
    expect(h.telnyx.writes()).toEqual([]);
  });

  it("expires a leg six hours after it was registered", async () => {
    const h = await ready();
    await registerViaEdge(h, "ccid-1");
    h.advance(LEG_REGISTRY_TTL_MS - 1000);
    expect((await h.call("/telnyx/v2/calls/ccid-1/actions/speak", { body: { payload: "hi" } })).status).toBe(200);
    h.advance(2000);
    expect(await ruleOf(await h.call("/telnyx/v2/calls/ccid-1/actions/speak", { body: { payload: "hi" } }))).toBe(
      "leg.not_registered",
    );
  });

  it("does not let a re-registration move a leg to another connection", async () => {
    const h = await ready();
    await registerViaEdge(h, "ccid-1", "conn-robot", "robot");
    await registerViaEdge(h, "ccid-1", "conn-voice", "voice");
    const entry = await h.store.get<{ connection_id: string }>("leg:ccid-1");
    expect(entry?.connection_id).toBe("conn-robot");
  });

  it("refuses body fields that reach past the leg", async () => {
    const h = await ready();
    await registerViaEdge(h, "ccid-1");
    const refused = [
      { stream_url: "wss://somewhere.example/audio" },
      { webhook_url: "https://somewhere.example/hook" },
      { webhook_urls: { "call.answered": "https://somewhere.example/hook" } },
      { assistant: { id: "a1" } },
      { billing_group_id: "bg-production" },
      { link_to: "ccid-production" },
    ];
    for (const body of refused) {
      expect(await ruleOf(await h.call("/telnyx/v2/calls/ccid-1/actions/answer", { body })), JSON.stringify(body)).toBe(
        "leg.field_refused",
      );
    }
    expect((await h.call("/telnyx/v2/calls/ccid-1/actions/answer", { body: { webhook_url: `${EDGE}/t/v` } })).status).toBe(
      200,
    );
  });

  it("still hangs up at the red tier, and refuses anything else", async () => {
    const h = await ready();
    await registerViaEdge(h, "ccid-1");
    await charge(h.ctx, 40);
    expect(await ruleOf(await h.call("/telnyx/v2/calls/ccid-1/actions/speak", { body: { payload: "hi" } }))).toBe(
      "budget.tier_red",
    );
    expect((await h.call("/telnyx/v2/calls/ccid-1/actions/hangup", { body: {} })).status).toBe(200);
    const entry = await h.store.get<{ ended_at?: number }>("leg:ccid-1");
    expect(entry?.ended_at).toBeDefined();
  });

  it("deletes a recording only when its leg is registered", async () => {
    const h = await ready();
    h.telnyx.lists.recordings.push(
      { id: "rec-rig", call_control_id: "ccid-1", connection_id: "conn-voice" },
      { id: "rec-prod", call_control_id: "ccid-prod", connection_id: "conn-prod-voice" },
    );
    await registerViaEdge(h, "ccid-1");
    expect(await ruleOf(await h.call("/telnyx/v2/recordings/rec-prod", { method: "DELETE" }))).toBe(
      "leg.recording_not_registered",
    );
    expect(h.telnyx.requests("DELETE")).toEqual([]);
    expect((await h.call("/telnyx/v2/recordings/rec-rig", { method: "DELETE" })).status).toBe(200);
    expect(h.telnyx.requests("DELETE").map((entry) => entry.path)).toEqual(["/v2/recordings/rec-rig"]);
  });
});

describe("stranger rejection and detach", () => {
  it("rejects a stranger's call on a nonprod connection, without registering the leg", async () => {
    const h = await ready();
    const response = await h.call("/reject", {
      caller: "edge",
      body: { call_control_id: "ccid-s", connection_id: "conn-voice", via: "voice" },
    });
    expect(await response.json()).toEqual({ rejected: 200 });
    expect(h.telnyx.requests("POST", "/v2/calls/ccid-s/actions/reject")).toHaveLength(1);
    expect(await ruleOf(await h.call("/telnyx/v2/calls/ccid-s/actions/answer", { body: {} }))).toBe("leg.not_registered");
  });

  it("will not reject a call on production's connection, or one whose via disagrees", async () => {
    const h = await ready();
    const production = await h.call("/reject", {
      caller: "edge",
      body: { call_control_id: "ccid-p", connection_id: "conn-prod-voice", via: "voice" },
    });
    expect(await ruleOf(production)).toBe("legs.connection_not_nonprod");
    const mismatched = await h.call("/reject", {
      caller: "edge",
      body: { call_control_id: "ccid-p", connection_id: "conn-voice", via: "webrtc" },
    });
    expect(await ruleOf(mismatched)).toBe("legs.via_mismatch");
    expect(h.telnyx.writes()).toEqual([]);
  });

  it("detaches a number strangers flood on the edge's word, standing or not, once", async () => {
    const h = await ready();
    const detach = () =>
      h.call("/detach", { caller: "edge", body: { e164: "+14165550111", strangers: 25, window_ms: 3_600_000 } });
    expect(await (await detach()).json()).toEqual({ outcome: "detached" });
    const number = h.telnyx.numbers.find((item) => item.id === "num-devw1");
    expect(number?.connection_id).toBe("");
    expect(number?.messaging_profile_id).toBe("");
    expect(await (await detach()).json()).toEqual({ outcome: "already_detached" });
    expect(h.telnyx.requests("PATCH")).toHaveLength(2);
  });

  it("detaches nothing outside the partition", async () => {
    const h = await ready();
    const response = await h.call("/detach", {
      caller: "edge",
      body: { e164: "+14165550160", strangers: 25, window_ms: 3_600_000 },
    });
    expect(await ruleOf(response)).toBe("provisioning.number_not_owned");
    expect(await ruleOf(await h.call("/detach", { caller: "edge", body: { e164: "+14165550111" } }))).toBe(
      "request.body_invalid",
    );
    expect(h.telnyx.writes()).toEqual([]);
  });

  it("restores a detached standing number through the admin's reattach", async () => {
    const h = await ready();
    await h.store.put("partition:standing", { "DEV-W1": { role: "DEV-W1", phone_number: "+14165550111" } });
    await h.call("/detach", { caller: "edge", body: { e164: "+14165550111", strangers: 25, window_ms: 3_600_000 } });
    const response = await h.call("/admin/numbers/reattach", { caller: "admin", method: "POST" });
    expect(await response.json()).toEqual({ reattached: ["DEV-W1"] });
    const number = h.telnyx.numbers.find((item) => item.id === "num-devw1");
    expect(number).toMatchObject({ connection_id: "conn-voice", messaging_profile_id: "prof-qa-w" });
  });
});
