/**
 * What startDaemon connects: the forwarder's targets and the relay's
 * explanation of the local API's events.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { forwardTargets, relayExplain } from "./daemon.ts";
import { destinationRefusedEvent } from "./scenarios/fakes.ts";
import { FaultFile } from "./state-files.ts";
import { VerdictStore, type Verdict } from "./verdicts.ts";
import type { Rig } from "./wiring.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rigd-daemon-"));
  dirs.push(dir);
  return dir;
}

function g01Verdict(startedAt: number, finishedAt: number): Verdict {
  return {
    run_id: "G01-1",
    scenario: "G01",
    sha: "abc1234",
    attempt: 1,
    outcome: "pass",
    started_at: new Date(startedAt).toISOString(),
    finished_at: new Date(finishedAt).toISOString(),
    dials: 0,
    scheduled: true,
  };
}

describe("forwardTargets", () => {
  it("hands the forwarder the fault S17 armed, once", () => {
    const faults = new FaultFile(tempDir());
    const secrets = new Map([["robot-local-token", "token"]]);
    const rig = {
      config: {
        localApiBase: "http://127.0.0.1:8787",
        robotBase: "http://127.0.0.1:7311",
        store: { readOptional: (name: string) => secrets.get(name), write: () => undefined },
      },
      numbers: () => ({ role: () => undefined }),
      faults,
      late: { record: () => undefined },
    } as unknown as Rig;
    const targets = forwardTargets(rig, () => undefined);
    faults.arm(503);
    expect(targets.takeFault?.()).toBe(503);
    expect(targets.takeFault?.()).toBeUndefined();
  });
});

describe("relayExplain", () => {
  it("expects a G01 attempt's refused send, and nothing outside one", () => {
    const at = Date.parse("2026-11-01T15:00:00Z");
    const verdicts = new VerdictStore(tempDir());
    verdicts.record(g01Verdict(at, at + 60_000));
    const explain = relayExplain(undefined, verdicts);
    expect(explain(destinationRefusedEvent("POST /v1/conversations", at + 2_000))).toEqual({ kind: "expected" });
    expect(explain(destinationRefusedEvent("POST /v1/conversations", at + 60 * 60_000))).toBeUndefined();
  });

  it("reads the cron registry before G01", () => {
    const verdicts = new VerdictStore(tempDir());
    const explain = relayExplain({ unread: [], explain: () => ({ kind: "defect", means: "seed" }) }, verdicts);
    expect(explain(destinationRefusedEvent("POST /v1/conversations", 0))).toEqual({ kind: "defect", means: "seed" });
  });
});
