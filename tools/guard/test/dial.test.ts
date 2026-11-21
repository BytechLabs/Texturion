import { HEADER, LEASE_MAX_MS } from "@loonext/rig-protocol";
import { describe, expect, it, vi } from "vitest";

import { recordSignal } from "../src/state/signals";
import { EDGE, harness, lease, MONDAY_0500, N, ready, registerViaEdge, ruleOf, seedAccount } from './support';
import type { Harness } from './support';
import { runSafetyChecks } from "../src/setup/safety";

const DIAL = {
  connection_id: "conn-robot",
  from: N.robot1,
  to: N.devW1,
  timeout_secs: 30,
};

async function dial(h: Harness, leaseId: string | null, body: Record<string, unknown> = DIAL, scenario?: string) {
  const headers: Record<string, string> = {};
  if (leaseId) headers[HEADER.lease] = leaseId;
  if (scenario) headers[HEADER.scenario] = scenario;
  return h.call("/telnyx/v2/calls", { caller: "robot", body, headers });
}

describe("dial", () => {
  it("places a call between owned numbers under a live lease, and registers the new leg", async () => {
    const h = await ready();
    const id = await lease(h);
    const response = await dial(h, id);
    expect(response.status).toBe(200);
    const ccid = (await response.json<{ data: { call_control_id: string } }>()).data.call_control_id;
    const entry = await h.store.get<{ connection_id: string; via: string }>(`leg:${ccid}`);
    expect(entry).toMatchObject({ connection_id: "conn-robot", via: "robot" });
  });

  it("needs a lease header naming the live lease", async () => {
    const h = await ready();
    await expect(ruleOf(await dial(h, null))).resolves.toBe("dial.lease_missing");
    await expect(ruleOf(await dial(h, "not-a-lease"))).resolves.toBe("dial.lease_not_live");
    const id = await lease(h);
    h.advance(LEASE_MAX_MS + 1);
    await expect(ruleOf(await dial(h, id))).resolves.toBe("dial.lease_not_live");
    expect(h.telnyx.requests("POST", "/v2/calls")).toEqual([]);
  });

  it("lets the app's own dial run under the live lease without the header, and only then", async () => {
    const h = await ready();
    const appDial = (headers: Record<string, string> = {}) =>
      h.call("/telnyx/v2/calls", {
        caller: "rig-api",
        body: { ...DIAL, connection_id: "conn-voice", from: N.devW1, to: "sip:gencredowner@sip.telnyx.com" },
        headers,
      });
    await expect(ruleOf(await appDial())).resolves.toBe("dial.lease_not_live");
    const id = await lease(h);
    expect((await appDial()).status).toBe(200);
    await expect(ruleOf(await appDial({ [HEADER.lease]: "another-lease" }))).resolves.toBe("dial.lease_not_live");
    expect((await appDial({ [HEADER.lease]: id })).status).toBe(200);
    // Test code names its lease.
    await expect(ruleOf(await dial(h, null))).resolves.toBe("dial.lease_missing");
  });

  it("admits no dial under a lease taken for a run that dials nothing", async () => {
    const h = await ready();
    const response = await h.call("/lease", { caller: "rig-api", body: { scenario: "S34", dials: false } });
    const id = (await response.json<{ lease_id: string }>()).lease_id;
    const appDial = h.call("/telnyx/v2/calls", {
      caller: "rig-api",
      body: { ...DIAL, connection_id: "conn-voice", from: N.devW1, to: "sip:gencredowner@sip.telnyx.com" },
    });
    await expect(ruleOf(await appDial)).resolves.toBe("dial.lease_not_live");
    await expect(ruleOf(await dial(h, id))).resolves.toBe("dial.lease_not_live");
    expect(h.telnyx.requests("POST", "/v2/calls")).toEqual([]);
  });

  it("refuses a released lease", async () => {
    const h = await ready();
    const id = await lease(h);
    expect((await h.call(`/lease/${id}`, { caller: "robot", method: "DELETE" })).status).toBe(200);
    await expect(ruleOf(await dial(h, id))).resolves.toBe("dial.lease_not_live");
  });

  it("dials only on the two nonprod Call Control apps", async () => {
    const h = await ready();
    const id = await lease(h);
    for (const connection_id of ["conn-prod-voice", "conn-webrtc", "conn-sentinel", undefined]) {
      await expect(ruleOf(await dial(h, id, { ...DIAL, connection_id }))).resolves.toBe(
        "dial.connection_not_nonprod",
      );
    }
  });

  it("needs an owned from", async () => {
    const h = await ready();
    const id = await lease(h);
    for (const from of [N.notOwned, N.production, "anonymous", undefined]) {
      await expect(ruleOf(await dial(h, id, { ...DIAL, from }))).resolves.toBe("dial.from_not_owned");
    }
  });

  it("needs an owned to, or a SIP user on nonprod-webrtc", async () => {
    const h = await ready();
    const id = await lease(h);
    for (const to of [
      N.notOwned,
      N.production,
      "sip:gencredprod@sip.telnyx.com",
      "sip:gencredsentinel@sip.telnyx.com",
      "sip:gencredowner@sip.elsewhere.example",
      "sip:nobody@sip.telnyx.com",
      [N.devW1, N.notOwned],
      [],
    ]) {
      await expect(ruleOf(await dial(h, id, { ...DIAL, to }))).resolves.toBe("dial.to_not_owned");
    }
    expect(h.telnyx.requests("POST", "/v2/calls")).toEqual([]);
    expect((await dial(h, id, { ...DIAL, connection_id: "conn-voice", to: "sip:gencredowner@sip.telnyx.com" })).status).toBe(
      200,
    );
  });

  it("limits the configured IVR to a voice dial by the app during S01", async () => {
    const ivr = "+18005550123";
    const h = await ready({ env: { RIG_QA_TOLL_FREE_CALL: ivr } });
    const hangups: Promise<unknown>[] = [];
    h.ctx.waitUntil = (work) => { hangups.push(work); };
    const sleep = vi.fn(async () => {});
    h.ctx.sleep = sleep;
    const body = { ...DIAL, connection_id: "conn-voice", from: N.devW1, to: ivr };
    const appDial = (extra: Record<string, unknown> = {}) =>
      h.call("/telnyx/v2/calls", { caller: "rig-api", body: { ...body, ...extra } });
    const wrongLease = await lease(h, "S02");
    await expect(ruleOf(await appDial())).resolves.toBe("dial.to_not_owned");
    await h.call(`/lease/${wrongLease}`, { caller: "robot", method: "DELETE" });
    const id = await lease(h, "S01");
    await expect(ruleOf(await dial(h, id, body))).resolves.toBe("dial.to_not_owned");
    await expect(ruleOf(await appDial({ to: N.notOwned }))).resolves.toBe("dial.to_not_owned");
    await expect(ruleOf(await appDial({ to: [ivr] }))).resolves.toBe("dial.to_not_owned");
    await expect(ruleOf(await appDial({ connection_id: "conn-robot" }))).resolves.toBe("dial.to_not_owned");
    await expect(ruleOf(await appDial({ from: N.notOwned }))).resolves.toBe("dial.from_not_owned");
    await expect(ruleOf(await appDial({ send_digits_on_answer: "0" }))).resolves.toBe("dial.field_refused");
    await expect(ruleOf(await h.call("/telnyx/v2/messages", {
      caller: "rig-api", body: { from: N.devW1, to: ivr, text: "Never sent" },
    }))).resolves.toBe("message.to_not_owned");
    expect(h.telnyx.requests("POST", "/v2/calls")).toHaveLength(0);

    const response = await appDial();
    expect(response.status).toBe(200);
    const ccid = (await response.json<{ data: { call_control_id: string } }>()).data.call_control_id;
    expect(h.telnyx.requests("POST", "/v2/calls")[0]?.body).toMatchObject({
      to: ivr, timeout_secs: 10, time_limit_secs: 30, retry_on_timeout: false, command_id: id,
    });
    expect(sleep).toHaveBeenCalledWith(15_000);
    await Promise.all(hangups);
    expect(h.telnyx.requests("POST", `/v2/calls/${ccid}/actions/hangup`)).toHaveLength(1);
    await expect(ruleOf(await h.call(`/telnyx/v2/calls/${ccid}/actions/transfer`, {
      caller: "rig-api", body: { to: ivr },
    }))).resolves.toBe("dial.to_not_owned");
  });

  it("refuses body fields that reach past the partition", async () => {
    const h = await ready();
    const id = await lease(h);
    for (const extra of [
      { conference_config: { conference_name: "production-room" } },
      { link_to: "ccid-production" },
      { supervise_call_control_id: "ccid-production" },
      { webhook_url: "https://somewhere.example" },
      { stream_url: "wss://somewhere.example" },
      { sip_auth_username: "u", sip_auth_password: "p" },
      { billing_group_id: "bg-production" },
      { conversation_relay_config: { url: "wss://x.example" } },
    ]) {
      await expect(ruleOf(await dial(h, id, { ...DIAL, ...extra }))).resolves.toBe("dial.field_refused");
    }
    expect((await dial(h, id, { ...DIAL, webhook_url: `${EDGE}/t/r`, billing_group_id: "bg-nonprod" })).status).toBe(200);
  });

});

describe("transfer and bridge", () => {
  it("transfers a registered leg only to an allowed target", async () => {
    const h = await ready();
    const id = await lease(h);
    await registerViaEdge(h, "ccid-1");
    const transfer = (body: Record<string, unknown>, ccid = "ccid-1") =>
      h.call(`/telnyx/v2/calls/${ccid}/actions/transfer`, { body, headers: { [HEADER.lease]: id } });
    await expect(ruleOf(await transfer({ to: N.notOwned }))).resolves.toBe("dial.to_not_owned");
    await expect(ruleOf(await transfer({ to: N.devW2, from: N.notOwned }))).resolves.toBe("dial.from_not_owned");
    await expect(ruleOf(await transfer({ to: N.devW2 }, "ccid-production"))).resolves.toBe("dial.leg_not_registered");
    expect((await transfer({ to: "sip:gencredowner@sip.telnyx.com", from: N.robot1 })).status).toBe(200);
  });

  it("bridges only two registered legs, and refuses a queue or room", async () => {
    const h = await ready();
    const id = await lease(h);
    await registerViaEdge(h, "ccid-1");
    await registerViaEdge(h, "ccid-2", "conn-robot", "robot");
    const bridge = (body: Record<string, unknown>) =>
      h.call("/telnyx/v2/calls/ccid-1/actions/bridge", { body, headers: { [HEADER.lease]: id } });
    await expect(ruleOf(await bridge({ call_control_id: "ccid-production" }))).resolves.toBe("dial.leg_not_registered");
    await expect(ruleOf(await bridge({ call_control_id: "ccid-2", queue: "support" }))).resolves.toBe("dial.field_refused");
    expect((await bridge({ call_control_id: "ccid-2" })).status).toBe(200);
    // A bridge adds no leg, so it spends no dial.
    expect((await h.store.get("count:dials:2026-11-02")) ?? 0).toBe(0);
  });
});

/** Telnyx's refusal of the next dial, with one error code. */
describe("on-demand dials", () => {
  it("forwards dials past the former hourly and daily caps without checking the balance", async () => {
    const h = await ready({ now: Date.parse("2026-11-02T21:30:00Z") });
    h.telnyx.balance = "0.00";
    const id = await lease(h);
    for (let count = 0; count < 19; count++) expect((await dial(h, id)).status).toBe(200);
    expect(h.telnyx.requests("GET", "/v2/balance")).toEqual([]);
  });

  it("relays a Telnyx refusal and still forwards the next dial", async () => {
    const h = await ready();
    const id = await lease(h);
    const body = { errors: [{ code: "90041", title: "Concurrent call limit exceeded" }] };
    h.telnyx.failNext = { method: "POST", path: "/v2/calls", status: 422, body };
    const refused = await dial(h, id);
    expect(refused.status).toBe(422);
    expect(refused.headers.has(HEADER.refusedBy)).toBe(false);
    await expect(refused.json()).resolves.toEqual(body);
    await recordSignal(h.ctx, { signal: "Low Balance", notice_id: null, corroborated_by: "balance" });
    expect((await dial(h, id)).status).toBe(200);
  });

  it("refuses everything Telnyx when the start-up checks find the partition unsafe", async () => {
    const h = harness({ now: MONDAY_0500 });
    seedAccount(h.telnyx);
    const voice = h.telnyx.lists.call_control_applications.find((item) => item.id === "conn-voice");
    if (voice) voice.webhook_event_url = "https://api.loonext.com/webhooks/telnyx/voice";
    expect((await runSafetyChecks(h.ctx)).state).toBe("unsafe");
    await expect(ruleOf(await h.call("/telnyx/v2/phone_numbers"))).resolves.toBe("startup.unsafe");
    await expect(ruleOf(await h.call("/partition"))).resolves.toBe("startup.unsafe");
  });
});
