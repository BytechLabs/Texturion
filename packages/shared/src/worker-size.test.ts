import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `scripts/check-worker-size.mjs` is the only look at the web Worker's size
 * before ship.yml uploads it. These pin how it reads wrangler's dry run and
 * that the build job still runs it once the Worker exists.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type Size = { rawKiB: number; gzipKiB: number };
const { uploadSize, judge } = (await import(join(REPO, "scripts", "check-worker-size.mjs"))) as {
  uploadSize: (output: string) => Size | null;
  judge: (size: Size, budgetKiB: number) => { ok: boolean; message: string };
};

// Cloudflare's compressed limit on Workers Paid is 10 MB.
const PAID_LIMIT_KIB = 10_000_000 / 1024;

/** Wrangler 4.153's dry run, trimmed, as CI prints it. */
const dryRun = (total: string) =>
  [
    " \u001b[33m▲ \u001b[43;33m[\u001b[43;30mWARNING\u001b[43;33m]\u001b[0m \u001b[1mProcessing wrangler.jsonc configuration:\u001b[0m",
    "",
    '    - Unexpected fields found in ratelimits[0] field: "type"',
    "Read 273 files from the assets directory /home/runner/work/apps/web/.open-next/assets",
    total,
    "Your Worker has access to the following bindings:",
    "--dry-run: exiting now.",
  ].join("\n");

describe("reading wrangler's dry run", () => {
  it("reads raw and gzip KiB from the Total Upload line", () => {
    expect(uploadSize(dryRun("Total Upload: 20990.80 KiB / gzip: 4593.19 KiB"))).toEqual({
      rawKiB: 20990.8,
      gzipKiB: 4593.19,
    });
  });

  it("reads the line through colour codes", () => {
    expect(
      uploadSize("\u001b[1mTotal Upload: 4904.64 KiB\u001b[0m / gzip: \u001b[1m985.42 KiB\u001b[0m"),
    ).toEqual({ rawKiB: 4904.64, gzipKiB: 985.42 });
  });

  it("knows nothing when the line is missing, rather than calling it small", () => {
    expect(uploadSize(dryRun("Total Upload: (unknown)"))).toBeNull();
    expect(uploadSize("")).toBeNull();
  });
});

describe("judging the size", () => {
  it("passes the Next 16 Worker with inlined CSS off", () => {
    const verdict = judge({ rawKiB: 20990.8, gzipKiB: 4593.19 }, 7168);
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toContain("2574.81 KiB to spare");
  });

  it("fails the Next 16 Worker with inlined CSS on, which Cloudflare would refuse", () => {
    const verdict = judge({ rawKiB: 160687.43, gzipKiB: 26926.77 }, 7168);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain("19758.77 KiB over");
  });
});

describe("the build job runs it", () => {
  const lines = readFileSync(join(REPO, ".github", "workflows", "checks.yml"), "utf8").split(
    /\r?\n/,
  );
  const runOf = (pattern: RegExp) => lines.findIndex((line) => pattern.test(line.trim()));
  const check = runOf(/^run: node scripts\/check-worker-size\.mjs apps\/web --budget-kib \d+$/);

  it("on the web Worker, after the OpenNext build that produces it", () => {
    const openNext = runOf(/^run: pnpm --filter @loonext\/web exec opennextjs-cloudflare build$/);
    expect(openNext).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(openNext);
  });

  it("with a budget that leaves room under the plan's limit", () => {
    const budget = Number(/--budget-kib (\d+)/.exec(lines[check] ?? "")?.[1]);
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThan(PAID_LIMIT_KIB * 0.8);
  });
});
