import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * D142's checks run in the gate, each in the job that can run it. A step that
 * moved to a job without Chromium, or ran before the step it depends on,
 * would fail; one that went missing would pass by never running.
 */

const REPO = join(import.meta.dirname, "..", "..", "..");
const WORKFLOW = readFileSync(join(REPO, ".github", "workflows", "checks.yml"), "utf8");

/** Each job's run lines, in order, keyed by job id. */
function jobRuns(workflow: string): Record<string, string[]> {
  const jobs: Record<string, string[]> = {};
  let current: string | null = null;
  let inJobs = false;
  for (const line of workflow.split(/\r?\n/)) {
    if (/^jobs:\s*$/.test(line)) inJobs = true;
    const job = inJobs ? /^ {2}([\w-]+):\s*$/.exec(line) : null;
    if (job) {
      ([, current] = job);
      jobs[current] = [];
      continue;
    }
    const run = /^\s+(?:- )?run:\s*(.*)$/.exec(line);
    if (current && run) jobs[current].push(run[1].trim());
    else if (current && jobs[current].length > 0 && /^\s{10,}\S/.test(line)) {
      jobs[current][jobs[current].length - 1] += `\n${line.trim()}`;
    }
  }
  return jobs;
}

const jobs = jobRuns(WORKFLOW);
const indexOf = (job: string, needle: string) => jobs[job].findIndex((run) => run.includes(needle));

describe("the rig's checks in the gate", () => {
  it("reads the workflow's jobs", () => {
    expect(Object.keys(jobs)).toEqual(expect.arrayContaining(["guards", "tooling-tests", "build", "android"]));
  });

  it.each([
    ["node scripts/check-rig-crons.mjs"],
    ["node scripts/check-rig-scenarios.mjs"],
    ["node scripts/check-rig-test-ids.mjs"],
    ["node scripts/check-rig-hosts.mjs"],
    ["node scripts/check-rig-ratelimit-band.mjs"],
  ])("runs %s with the other rig guards", (command) => {
    expect(jobs.guards).toContain(command);
    expect(indexOf("guards", command)).toBeGreaterThan(indexOf("guards", "node scripts/check-rig-no-e164.mjs"));
  });

  it("scans the checkout for live production secrets after the phone-host guard", () => {
    expect(jobs.guards).toContain("node scripts/check-local-secrets.mjs");
    expect(indexOf("guards", "check-local-secrets")).toBeGreaterThan(
      indexOf("guards", "check-production-host-literals"),
    );
  });

  it("runs the rig CLI's node:test suites after the install", () => {
    expect(jobs["tooling-tests"]).toContain('node --test "tools/rig/test/*.test.mjs"');
    expect(indexOf("tooling-tests", "node --test")).toBeGreaterThan(
      indexOf("tooling-tests", "pnpm install --frozen-lockfile"),
    );
  });

  it("runs hostd's node:test suites after the install, beside the rig CLI's", () => {
    const step = indexOf("tooling-tests", 'node --test "tools/rig/host/test/*.test.mjs"');
    expect(step).toBeGreaterThan(indexOf("tooling-tests", "pnpm install --frozen-lockfile"));
    expect(step).toBe(indexOf("tooling-tests", 'node --test "tools/rig/test/*.test.mjs"') + 1);
  });

  it("runs the guard's workerd suite in a job of its own, never beside the vitest shards", () => {
    expect(indexOf("tooling-tests", "pnpm --filter @loonext/telnyx-guard test:workerd")).toBeGreaterThan(-1);
    const beside = Object.entries(jobs).filter(
      ([job, runs]) => job !== "tooling-tests" && runs.some((run) => run.includes("test:workerd")),
    );
    expect(beside).toEqual([]);
    expect(indexOf("tooling-tests", "test-shard.mjs")).toBe(-1);
  });

  it("runs the browser lane in a job that installed Chromium first", () => {
    const lane = indexOf("build", "pnpm --filter @loonext/rig-lanes test:browser");
    expect(lane).toBeGreaterThan(-1);
    expect(lane).toBeGreaterThan(indexOf("build", "playwright install --with-deps chromium"));
  });

  it("runs the whole unit suite on the nonprodDebug build in the Android job", () => {
    const step = indexOf("android", "./gradlew :app:testNonprodDebugUnitTest");
    expect(step).toBeGreaterThan(-1);
    expect(jobs.android[step]).not.toContain("--tests");
  });

  it("checks the shrunk release build after assembling it", () => {
    const assemble = indexOf("android", "./gradlew :app:assembleRelease");
    const check = indexOf("android", "node scripts/check-shrunk-build.mjs");
    expect(assemble).toBeGreaterThan(-1);
    expect(check).toBe(assemble + 1);
    // A mapping for an APK nobody ships would sit in PostHog beside the real ones.
    expect(jobs.android[assemble]).not.toMatch(/posthog|upload/i);
  });
});
