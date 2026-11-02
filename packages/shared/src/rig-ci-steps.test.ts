import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * D142's checks run in the gate, each in the job that can run it. A step that
 * moved to a job without Chromium, or ran before the step it depends on,
 * would fail; one that went missing would pass by never running.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
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
      current = job[1];
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
    expect(Object.keys(jobs)).toEqual(expect.arrayContaining(["verify", "build", "android"]));
  });

  it.each([
    ["node scripts/check-rig-crons.mjs"],
    ["node scripts/check-rig-scenarios.mjs"],
    ["node scripts/check-rig-test-ids.mjs"],
    ["node scripts/check-rig-hosts.mjs"],
    ["node scripts/check-rig-ratelimit-band.mjs"],
  ])("runs %s with the other rig guards", (command) => {
    expect(jobs.verify).toContain(command);
    expect(indexOf("verify", command)).toBeGreaterThan(indexOf("verify", "node scripts/check-rig-no-e164.mjs"));
  });

  it("scans the checkout for live production secrets after the phone-host guard", () => {
    expect(jobs.verify).toContain("node scripts/check-local-secrets.mjs");
    expect(indexOf("verify", "check-local-secrets")).toBeGreaterThan(
      indexOf("verify", "check-production-host-literals"),
    );
  });

  it("runs the rig CLI's node:test suites after the install", () => {
    expect(jobs.verify).toContain('node --test "tools/rig/test/*.test.mjs"');
    expect(indexOf("verify", "node --test")).toBeGreaterThan(indexOf("verify", "pnpm install --frozen-lockfile"));
  });

  it("runs hostd's node:test suites after the install, beside the rig CLI's", () => {
    const step = indexOf("verify", 'node --test "tools/rig/host/test/*.test.mjs"');
    expect(step).toBeGreaterThan(indexOf("verify", "pnpm install --frozen-lockfile"));
    expect(step).toBe(indexOf("verify", 'node --test "tools/rig/test/*.test.mjs"') + 1);
  });

  it("runs the guard's workerd suite on its own, after the parallel test run", () => {
    const workerd = indexOf("verify", "pnpm --filter @loonext/telnyx-guard test:workerd");
    expect(workerd).toBeGreaterThan(indexOf("verify", "pnpm -r test"));
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
    // A release build that reached the console would put a mapping there for an APK nobody ships.
    expect(jobs.android[assemble]).toContain("-x :app:uploadCrashlyticsMappingFileRelease");
  });
});
