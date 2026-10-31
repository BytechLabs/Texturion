import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * These pin how `scripts/check-rig-ratelimit-band.mjs` keeps the rig's
 * limiters off production's counters: the band for the cloud Workers, and the
 * local-only rule that lets the derived configs keep production's ids.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type Config = Record<string, unknown>;
type Pair = { file: string; config: Config };
const guard = (await import(join(REPO, "scripts", "check-rig-ratelimit-band.mjs"))) as {
  BAND: { first: number; last: number };
  RESERVED_FOR_PRODUCTION: string[];
  limiters: (config: Config) => { name: string; id: string; remote: boolean; at: string }[];
  bandProblems: (configs: { cloud: Pair[]; production: Pair[] }) => string[];
  derivedProblems: (file: string, config: Config, derived: Config) => string[];
  serveProblems: (service: string, args: string[]) => string[];
};

const unsafe = (name: string, id: string) => ({
  unsafe: { bindings: [{ name, type: "ratelimit", namespace_id: id, simple: { limit: 1, period: 60 } }] },
});
const production: Pair[] = [
  { file: "apps/api/wrangler.jsonc", config: unsafe("SEND_RATE_LIMITER", "1001") },
  { file: "apps/web/wrangler.jsonc", config: { ratelimits: [{ name: "STATUS", namespace_id: "2001" }] } },
];
const edge = (id: string): Pair => ({ file: "tools/edge/wrangler.jsonc", config: { name: "loonext-rig-edge", ...unsafe("EDGE_LIMITER", id) } });

describe("which limiters a config declares", () => {
  it("reads unsafe bindings, the ratelimits list and environments, and nothing else", () => {
    const config = {
      unsafe: { bindings: [{ name: "A", type: "ratelimit", namespace_id: 3001 }, { name: "B", type: "other" }] },
      ratelimits: [{ name: "C", namespace_id: "3002", remote: true }],
      env: { rig: { ratelimits: [{ name: "D", namespace_id: "3003" }] } },
    };
    expect(guard.limiters(config).map(({ name, id, remote }) => [name, id, remote])).toEqual([
      ["A", "3001", false],
      ["C", "3002", true],
      ["D", "3003", false],
    ]);
  });
});

describe("the cloud Workers' band", () => {
  it("passes the edge on 3001", () => {
    expect(guard.bandProblems({ cloud: [edge("3001")], production })).toEqual([]);
  });

  it("fails an id outside 3001-3009", () => {
    expect(guard.bandProblems({ cloud: [edge("3010")], production })).toEqual([
      "tools/edge/wrangler.jsonc unsafe.bindings EDGE_LIMITER  uses 3010; the rig's cloud Workers use 3001-3009 only",
    ]);
  });

  it("fails production's id, and one RIG.md reserves for production that no config uses yet", () => {
    expect(guard.bandProblems({ cloud: [edge("1001")], production })).toContain(
      "tools/edge/wrangler.jsonc unsafe.bindings EDGE_LIMITER  uses 1001, which is production's (apps/api/wrangler.jsonc SEND_RATE_LIMITER)",
    );
    expect(guard.RESERVED_FOR_PRODUCTION).toContain("1013");
    expect(guard.bandProblems({ cloud: [edge("1013")], production })).toContain(
      "tools/edge/wrangler.jsonc unsafe.bindings EDGE_LIMITER  uses 1013, which is production's (docs/RIG.md 2.2)",
    );
  });

  it("fails two rig limiters on one counter", () => {
    const second: Pair = { file: "tools/guard/wrangler.jsonc", config: { name: "loonext-telnyx-guard", ratelimits: [{ name: "G", namespace_id: "3001" }] } };
    expect(guard.bandProblems({ cloud: [edge("3001"), second], production })).toEqual([
      "tools/guard/wrangler.jsonc ratelimits G  shares 3001 with loonext-rig-edge EDGE_LIMITER, so one spends the other's limit",
    ]);
  });

  it("fails production taking an id from the rig's band", () => {
    const taken = [...production, { file: "apps/web/wrangler.jsonc", config: { ratelimits: [{ name: "NEW", namespace_id: "3004" }] } }];
    expect(guard.bandProblems({ cloud: [edge("3001")], production: taken })).toEqual([
      "apps/web/wrangler.jsonc  NEW uses 3004, which is in the rig's band 3001-3009; production must leave it to the rig",
    ]);
  });
});

describe("the derived configs, which keep production's ids locally", () => {
  const source = unsafe("SEND_RATE_LIMITER", "1001");
  const derive = (bindings: unknown[]) => ({ unsafe: { bindings }, env: { rig: { unsafe: { bindings } } } });

  it("passes limiters kept exactly as the ref has them", () => {
    expect(guard.derivedProblems("apps/api/wrangler.jsonc", source, derive(source.unsafe.bindings))).toEqual([]);
  });

  it("fails a renumbered limiter, and a remote one", () => {
    const renumbered = [{ ...source.unsafe.bindings[0], namespace_id: "3005" }];
    expect(guard.derivedProblems("f", source, derive(renumbered))).toHaveLength(2);
    const remote = [{ ...source.unsafe.bindings[0], remote: true }];
    expect(guard.derivedProblems("f", source, derive(remote))).toEqual([
      "f  derived SEND_RATE_LIMITER is remote, so its counter is the account's",
      "f  derived env.rig.SEND_RATE_LIMITER is remote, so its counter is the account's",
    ]);
  });

  it("fails a derived config without the env.rig section rig serve selects", () => {
    expect(guard.derivedProblems("f", source, { unsafe: source.unsafe })).toEqual([
      "f  derived config has no env.rig section, which rig serve selects",
    ]);
  });

  it("passes wrangler dev on loopback, and fails anything that could run on the account", () => {
    expect(guard.serveProblems("api", ["dev", "--config", "wrangler.rig.jsonc", "--ip", "127.0.0.1"])).toEqual([]);
    expect(guard.serveProblems("api", ["deploy", "--ip", "127.0.0.1"])).toEqual([
      "rig serve api runs wrangler deploy, not wrangler dev",
    ]);
    expect(guard.serveProblems("web", ["dev", "--ip", "0.0.0.0", "--remote"])).toEqual([
      "rig serve web does not pin wrangler dev to loopback",
      "rig serve web passes --remote, which runs it on the account with real counters",
    ]);
  });
});

it("runs in the CI guard job", () => {
  const workflow = readFileSync(join(REPO, ".github", "workflows", "checks.yml"), "utf8");
  expect(workflow).toMatch(/^\s*run: node scripts\/check-rig-ratelimit-band\.mjs\s*$/m);
});
