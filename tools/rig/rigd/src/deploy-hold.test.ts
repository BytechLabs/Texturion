/**
 * rigd's hourly schedule refresh against the hold a schema-change `rig deploy`
 * leaves in the state folder (tools/rig/src/deploy-hold.mjs).
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { deployHoldPath, holdForDeploy, releaseDeployHold } from "../../src/deploy-hold.mjs";
import { parseWindow } from "./budget.ts";
import { refreshSchedule } from "./daemon.ts";
import type { Rig } from "./wiring.ts";

const REAL_REGISTRY = resolve(fileURLToPath(import.meta.url), "../../../scenarios.json");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Just what refreshSchedule reads of a rig: the state folder, the registry, the window and the unit folder. */
function rigAt(): { rig: Rig; state: string; unitDir: string; windowReads: () => number } {
  const home = mkdtempSync(join(tmpdir(), "rigd-hold-"));
  dirs.push(home);
  const state = join(home, "state");
  mkdirSync(state, { recursive: true });
  let reads = 0;
  const rig = {
    config: {
      home: { home, state },
      registryPath: REAL_REGISTRY,
      env: { XDG_CONFIG_HOME: join(home, "config") },
    },
    windows: () => ({
      current: async () => {
        reads++;
        return parseWindow("04-10");
      },
    }),
  } as unknown as Rig;
  return { rig, state, unitDir: join(home, "config", "systemd", "user"), windowReads: () => reads };
}

describe("the schedule refresh under a deploy hold", () => {
  it("starts no timer and writes no unit while a deploy holds them stopped", async () => {
    const { rig, state, unitDir, windowReads } = rigAt();
    holdForDeploy(state, { sha: "0123456789abcdef0123456789abcdef01234567", ref: "main" });
    const calls: string[][] = [];
    const lines: string[] = [];
    await refreshSchedule(rig, (line) => lines.push(line), (args) => void calls.push(args));
    expect(calls).toEqual([]);
    expect(existsSync(unitDir)).toBe(false);
    expect(windowReads()).toBe(0);
    expect(lines).toEqual([
      expect.stringMatching(/^timers not refreshed: state\/deploy-hold\.json holds them stopped for the deploy of 0123456789ab since /),
    ]);
  });

  it("holds as surely when the file cannot be read", async () => {
    const { rig, state } = rigAt();
    writeFileSync(deployHoldPath(state), "{");
    const calls: string[][] = [];
    await refreshSchedule(rig, () => undefined, (args) => void calls.push(args));
    expect(calls).toEqual([]);
  });

  it("installs and starts the timers again once the deploy released the hold", async () => {
    const { rig, state, unitDir } = rigAt();
    holdForDeploy(state, { sha: "0123456789abcdef0123456789abcdef01234567", ref: "main" });
    releaseDeployHold(state);
    const calls: string[][] = [];
    await refreshSchedule(rig, () => undefined, (args) => void calls.push(args));
    const enable = calls.find((args) => args[0] === "enable");
    expect(enable?.slice(0, 4)).toEqual(["enable", "--now", "loonext-rig-rigd.service", "loonext-rig-robotd.service"]);
    expect(enable?.some((name) => /^loonext-rig-scenario-.+\.timer$/.test(name))).toBe(true);
    expect(readdirSync(unitDir)).toContain("loonext-rig-scenario@.service");
  });
});
