import { createScheduledController } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import worker from "./index";
import { mailStatus } from "./mailbox";
import { counters, edgeEnv, fakeGuard, resetEdge } from "./test/support";

const NOW = 1_790_000_000_000;

beforeEach(async () => {
  await resetEdge();
});

describe("the cron", () => {
  it("refreshes the mail heartbeat, even with no PostHog key configured", async () => {
    const bare = await edgeEnv(fakeGuard());
    await worker.scheduled(createScheduledController({ scheduledTime: NOW, cron: "*/15 * * * *" }), bare);
    expect((await mailStatus(bare)).heartbeat_at).toBe(new Date(NOW).toISOString());
  });

  it("sends nothing to PostHog however long the rig has been quiet", async () => {
    const sent: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      sent.push(new Request(input, init).url);
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const env = await edgeEnv(fakeGuard(), {
        POSTHOG_PROJECT_KEY: "phc_edge_test_key",
      });
      for (let at = NOW; at <= NOW + 12 * 60 * 60_000; at += 15 * 60_000) {
        await worker.scheduled(createScheduledController({ scheduledTime: at, cron: "*/15 * * * *" }), env);
      }
    } finally {
      globalThis.fetch = original;
    }
    expect(sent.filter((url) => url.includes("posthog.com"))).toEqual([]);
    expect(Object.keys(await counters()).filter((name) => name.startsWith("events.sent."))).toEqual([]);
  });
});
