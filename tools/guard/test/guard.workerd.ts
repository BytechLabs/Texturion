/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { HEADER } from "@loonext/rig-protocol";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type entrypoint from "../src/index";

declare global {
  // oxlint-disable-next-line typescript/no-namespace -- Cloudflare's worker export inference uses this declaration.
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: { default: typeof entrypoint };
    }
  }
}

const as = (caller: string) => ({ headers: { [HEADER.callerClass]: caller } });

describe("the guard on workerd", () => {
  it("refuses an unknown caller at the Worker", async () => {
    const response = await exports.default.fetch("https://guard.internal/health");
    expect(response.status).toBe(403);
    expect(response.headers.get(HEADER.refusedBy)).toBe("class.unknown");
  });

  it("serves /health from the Durable Object, saying the Telnyx key is absent", async () => {
    const response = await exports.default.fetch("https://guard.internal/health", as("robot"));
    expect(response.status).toBe(200);
    const body = await response.json<{ ok: boolean; telnyx: { key: string; rule: string } }>();
    expect(body.ok).toBe(false);
    expect(body.telnyx).toMatchObject({ key: "absent", rule: "telnyx.key_missing" });
  });

  it("fails a Telnyx route closed without the key", async () => {
    const response = await exports.default.fetch("https://guard.internal/telnyx/v2/phone_numbers", as("rig-api"));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "guard_refused", rule: "telnyx.key_missing" });
  });

  it("keeps one lease at a time in Durable Object storage", async () => {
    const acquire = (scenario: string) =>
      exports.default.fetch("https://guard.internal/lease", {
        method: "POST",
        headers: { [HEADER.callerClass]: "robot", "content-type": "application/json" },
        body: JSON.stringify({ scenario }),
      });
    const first = await acquire("S02");
    expect(first.status).toBe(201);
    const second = await acquire("S04");
    expect(second.headers.get(HEADER.refusedBy)).toBe("lease.busy");
    const current = await (await exports.default.fetch("https://guard.internal/lease", as("rig-api"))).json<{ scenario: string }>();
    expect(current.scenario).toBe("S02");
  });

  it("answers /version", async () => {
    const response = await exports.default.fetch("https://guard.internal/version", as("diag"));
    await expect(response.json()).resolves.toHaveProperty("version_id");
  });
});
