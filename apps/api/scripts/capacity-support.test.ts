import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assertHostedTarget, CapacityConfigError, expectedConfirmation } from "./deployed-capacity-lib.ts";
import { countStatuses, loadSigner, percentile, summarize } from "./capacity-support.ts";

describe("capacity-support", () => {
  it("summarizes a sample by nearest rank", () => {
    const summary = summarize([5, 1, 3, 2, 4, 100, 9, 8, 7, 6]);
    expect(summary).toEqual({ count: 10, p50: 6, p90: 100, p99: 100, max: 100 });
    expect(percentile([], 0.5)).toBe(0);
  });

  it("counts statuses, with 0 for a network failure", () => {
    expect(countStatuses([{ status: 200, ms: 1 }, { status: 200, ms: 2 }, { status: 0, ms: 3 }])).toEqual({
      "200": 2,
      "0": 1,
    });
  });

  it("signs the carrier's `${timestamp}|${body}` with the key file's Ed25519 key", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const dir = mkdtempSync(join(tmpdir(), "cap-support-"));
    try {
      const file = join(dir, "key.json");
      writeFileSync(
        file,
        JSON.stringify({
          publicKeyB64: "",
          privateKeyPkcs8B64: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
        }),
      );
      const sign = await loadSigner(file);
      const headers = await sign('{"a":1}');
      const ok = verify(
        null,
        Buffer.from(`${headers["telnyx-timestamp"]}|{"a":1}`),
        publicKey,
        Buffer.from(headers["telnyx-signature-ed25519"] ?? "", "base64"),
      );
      expect(ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("assertHostedTarget", () => {
  const base = {
    targetId: "capacity-251",
    apiOrigin: "https://loonext-api-capacity-251.example.workers.dev",
    supabaseOrigin: "https://abcdefghijklmnopqrst.supabase.co",
  };
  const confirmation = expectedConfirmation(base);

  it("accepts a temporary target with its target-bound phrase", () => {
    expect(assertHostedTarget({ ...base, confirmation }).apiOrigin).toBe(base.apiOrigin);
  });

  it("refuses the production project, the production API and a wrong phrase", () => {
    const production = { ...base, supabaseOrigin: "https://qoruyuxcgkdqpcgclgzs.supabase.co" };
    expect(() =>
      assertHostedTarget({ ...production, confirmation: expectedConfirmation(production) }),
    ).toThrow(CapacityConfigError);
    const api = { ...base, apiOrigin: "https://api.loonext.com" };
    expect(() => assertHostedTarget({ ...api, confirmation: expectedConfirmation(api) })).toThrow(
      CapacityConfigError,
    );
    expect(() => assertHostedTarget({ ...base, confirmation: "yes" })).toThrow(CapacityConfigError);
  });
});
