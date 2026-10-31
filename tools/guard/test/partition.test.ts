import { describe, expect, it } from "vitest";

import { STANDING_ROLES } from "../src/edge-contract";
import { SPEC } from "../src/setup/spec";
import { standingReference } from "../src/telnyx/partition";
import { N, ready, ruleOf, type Harness } from "./support";

interface Wire {
  billing_group_id: string;
  owned_e164: string[];
  standing_e164: string[];
  connection_ids: Record<string, string>;
  messaging_profile_ids: string[];
  standing: { role: string; e164: string; telnyx_phone_number_id: string; messaging_profile_id: string | null }[];
}

async function partition(h: Harness, caller = "robot"): Promise<Wire> {
  return (await (await h.call("/partition", { caller })).json()) as Wire;
}

describe("GET /partition", () => {
  it("lists owned numbers, connections, profiles and each standing number's role from Telnyx", async () => {
    const h = await ready();
    const wire = await partition(h);
    expect(wire.billing_group_id).toBe("bg-nonprod");
    expect(wire.owned_e164).not.toContain(N.production);
    expect(wire.connection_ids).toEqual({
      voice: "conn-voice",
      robot: "conn-robot",
      webrtc: "conn-webrtc",
      sentinel: "conn-sentinel",
    });
    expect(wire.messaging_profile_ids).not.toContain("prof-prod");
    // Roles come from each number's customer reference; DEV-A1 carries only the tag.
    expect(wire.standing).toEqual([
      { role: "ROBOT-1", e164: N.robot1, telnyx_phone_number_id: "num-robot1", messaging_profile_id: "prof-robot" },
      { role: "ROBOT-2", e164: N.robot2, telnyx_phone_number_id: "num-robot2", messaging_profile_id: "prof-robot" },
      { role: "STRANGER-1", e164: N.stranger1, telnyx_phone_number_id: "num-stranger1", messaging_profile_id: "prof-robot" },
      { role: "DEV-W1", e164: N.devW1, telnyx_phone_number_id: "num-devw1", messaging_profile_id: "prof-qa-w" },
      { role: "DEV-W2", e164: N.devW2, telnyx_phone_number_id: "num-devw2", messaging_profile_id: "prof-qa-w" },
    ]);
    expect(wire.standing_e164).toContain(N.devA1);
    expect(wire.standing_e164).not.toContain(N.scratch);
  });

  it("takes a role from what the setup routine recorded too", async () => {
    const h = await ready();
    await h.store.put("partition:standing", { "DEV-A1": { role: "DEV-A1", phone_number: N.devA1 } });
    const wire = await partition(h, "rig-api");
    expect(wire.standing.find((item) => item.e164 === N.devA1)?.role).toBe("DEV-A1");
  });

  it("is not served to the diag class", async () => {
    const h = await ready();
    expect(await ruleOf(await h.call("/partition", { caller: "diag" }))).toBe("class.not_allowed");
  });

  it("knows the eight roles the spec orders, and names each on Telnyx without a number", () => {
    expect(SPEC.numbers.standing.map((item) => item.role)).toEqual([...STANDING_ROLES]);
    expect(STANDING_ROLES.map(standingReference)).toContain("rig-standing-dev-w1");
  });
});
