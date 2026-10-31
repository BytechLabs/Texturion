/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { HEADER } from "@loonext/rig-protocol";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const as = (caller: string) => ({ headers: { [HEADER.callerClass]: caller } });

describe("the guard on workerd", () => {
  it("refuses an unknown caller at the Worker", async () => {
    const response = await SELF.fetch("https://guard.internal/health");
    expect(response.status).toBe(403);
    expect(response.headers.get(HEADER.refusedBy)).toBe("class.unknown");
  });

  it("serves /health from the Durable Object, saying the Telnyx key is absent", async () => {
    const response = await SELF.fetch("https://guard.internal/health", as("robot"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; telnyx: { key: string; rule: string } };
    expect(body.ok).toBe(false);
    expect(body.telnyx).toMatchObject({ key: "absent", rule: "telnyx.key_missing" });
  });

  it("fails a Telnyx route closed without the key", async () => {
    const response = await SELF.fetch("https://guard.internal/telnyx/v2/phone_numbers", as("rig-api"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "guard_refused", rule: "telnyx.key_missing" });
  });

  it("keeps one lease at a time in Durable Object storage", async () => {
    const acquire = (scenario: string) =>
      SELF.fetch("https://guard.internal/lease", {
        method: "POST",
        headers: { [HEADER.callerClass]: "robot", "content-type": "application/json" },
        body: JSON.stringify({ scenario }),
      });
    const first = await acquire("S02");
    expect(first.status).toBe(201);
    const second = await acquire("S04");
    expect(second.headers.get(HEADER.refusedBy)).toBe("lease.busy");
    const current = (await (await SELF.fetch("https://guard.internal/lease", as("rig-api"))).json()) as { scenario: string };
    expect(current.scenario).toBe("S02");
  });

  it("answers /version", async () => {
    const response = await SELF.fetch("https://guard.internal/version", as("diag"));
    expect(await response.json()).toHaveProperty("version_id");
  });
});
