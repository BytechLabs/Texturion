/**
 * D146: what an `ops_heartbeat` carries, which is all PostHog's "Heartbeat
 * overdue" alert reads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getEnv } from "../env";
import { eventsCaptured, resetCaptures } from "../test/capture-mock";
import { completeEnv } from "../test/support";
import { channelHeartbeat, cronHeartbeatKey, isCronSchedule } from "./heartbeat";

vi.mock("./capture", async () => (await import("../test/capture-mock")).captureModuleMock());

beforeEach(() => {
  resetCaptures();
});

describe("heartbeats", () => {
  it("name a cron by its expression with the spaces gone, so the property survives the scrubber", () => {
    expect(cronHeartbeatKey("0 13 * * *")).toBe("cron:0_13_*_*_*");
    expect(cronHeartbeatKey("*/5 * * * *")).toBe("cron:*/5_*_*_*_*");
  });

  it("know which expressions are triggers", () => {
    expect(isCronSchedule("* * * * *")).toBe(true);
    expect(isCronSchedule("5 */2 * * *")).toBe(false);
    expect(isCronSchedule("toString")).toBe(false);
  });

  it("send a channel's key and grace under the system's identity", () => {
    channelHeartbeat(getEnv(completeEnv()), "channel:resend-send");
    expect(eventsCaptured("ops_heartbeat")).toEqual([
      {
        event: "ops_heartbeat",
        distinctId: "loonext-api",
        properties: { key: "channel:resend-send", grace_minutes: 420 },
      },
    ]);
  });
});
