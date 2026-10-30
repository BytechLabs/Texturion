import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * These pin what `scripts/check-rig-no-e164.mjs` reads as a number, that only
 * 555-0100..0199 passes, and that its legacy list can only shrink.
 *
 * The non-fictional examples are assembled from parts, so this file publishes
 * no number outside the fictional range either.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type Found = { line: number; fictional: boolean };
const guard = (await import(join(REPO, "scripts", "check-rig-no-e164.mjs"))) as {
  SCOPE: RegExp[];
  LEGACY: Record<string, number>;
  isFictionalNanp: (national: string) => boolean;
  findNumbers: (text: string) => Found[];
  judge: (
    files: { file: string; text: string }[],
    legacy?: Record<string, number>,
  ) => { failures: string[]; literals: number };
  coverage: (files: { file: string; text: string }[]) => string[];
};

/** Toronto, in the 555 exchange but outside the fictional lines. */
const outside = (line: string) => `+1416555${line}`;
const OUTSIDE = outside("0200");

describe("the fictional range", () => {
  it("passes 555-0100 through 555-0199 in any area code", () => {
    expect(guard.isFictionalNanp("4165550100")).toBe(true);
    expect(guard.isFictionalNanp("6135550199")).toBe(true);
  });

  it("fails the rest of the 555 exchange", () => {
    expect(guard.isFictionalNanp(OUTSIDE.slice(2))).toBe(false);
    expect(guard.isFictionalNanp(outside("1234").slice(2))).toBe(false);
  });

  it("passes a prefix only while every digit it has agrees", () => {
    expect(guard.isFictionalNanp("416555")).toBe(true);
    expect(guard.isFictionalNanp("41655501")).toBe(true);
    expect(guard.isFictionalNanp("41655502")).toBe(false);
  });

  it("fails anything longer than a NANP number", () => {
    expect(guard.isFictionalNanp("41655501234")).toBe(false);
  });
});

describe("what it reads as a number", () => {
  const verdicts = (text: string) => guard.findNumbers(text).map((n) => n.fictional);

  it("reads E.164, fictional or not", () => {
    expect(verdicts(`const a = "+14165550123";`)).toEqual([true]);
    expect(verdicts(`const a = "${OUTSIDE}";`)).toEqual([false]);
  });

  it("reads a number an env file or query string writes after =", () => {
    expect(verdicts(`RIG_FROM=${OUTSIDE}`)).toEqual([false]);
    expect(verdicts(`/v2/messages?to=${OUTSIDE}&from=+14165550101`)).toEqual([false, true]);
  });

  it("reads the URL-encoded plus a form body carries", () => {
    expect(verdicts(`To=${OUTSIDE.replace("+", "%2B")}`)).toEqual([false]);
    expect(verdicts(`body=To%3D${OUTSIDE.replace("+", "%2B")}`)).toEqual([false]);
  });

  it("reads a number in a URL path, where a runbook curl or an e2e request puts one", () => {
    expect(verdicts(`/v2/number_lookup/${OUTSIDE}`)).toEqual([false]);
    expect(verdicts(`"/v1/numbers/${OUTSIDE.replace("+", "%2B")}/voice"`)).toEqual([false]);
    expect(verdicts(`"${OUTSIDE}/messages"`)).toEqual([false]);
  });

  it("reads a number right after a string escape", () => {
    expect(verdicts(`"first line\\n${OUTSIDE}"`)).toEqual([false]);
  });

  it("reads the written NANP forms", () => {
    expect(verdicts("(416) 555-0123")).toEqual([true]);
    expect(verdicts("416.555.0150")).toEqual([true]);
    expect(verdicts(`416-555-${"0200"}`)).toEqual([false]);
  });

  it("reads numbers outside the NANP as real", () => {
    // Ofcom's drama range: fictional in the UK, but only 555-01xx passes here.
    expect(verdicts(`"+447700900123"`)).toEqual([false]);
  });

  it("judges a +1 prefix a fixture builds numbers from by the digits it has", () => {
    expect(verdicts("const base = `+141655501${n}`;")).toEqual([true]);
    expect(verdicts("const base = `+141655502${n}`;")).toEqual([false]);
  });

  it("does not read base64 or a digit run longer than any number", () => {
    expect(verdicts(`"aGVsbG8${OUTSIDE}d29ybGQ="`)).toEqual([]);
    expect(verdicts(`"aGVs/${OUTSIDE}d29ybGQ="`)).toEqual([]);
    expect(verdicts(`"aGVsbG8${OUTSIDE}=="`)).toEqual([]);
    expect(verdicts(`${OUTSIDE}12345678`)).toEqual([]);
  });

  it("reports the line each number is on", () => {
    expect(guard.findNumbers(`one\ntwo ${OUTSIDE}\nthree`)).toEqual([{ line: 2, fictional: false }]);
  });
});

describe("judging files against the legacy list", () => {
  const file = "apps/api/e2e/example.e2e.ts";
  const holding = (count: number) => ({
    file,
    text: Array.from({ length: count }, () => `"${OUTSIDE}"`).join("\n"),
  });

  it("fails a file in scope with a number outside the range", () => {
    const { failures } = guard.judge([holding(1)], {});
    expect(failures.join("\n")).toMatch(/1 phone number\(s\) outside 555-0100\.\.0199/);
  });

  it("passes a legacy file at its count, and fails it when the count grows", () => {
    expect(guard.judge([holding(2)], { [file]: 2 }).failures).toEqual([]);
    expect(guard.judge([holding(3)], { [file]: 2 }).failures.join("\n")).toMatch(/2 allowed as legacy/);
  });

  it("fails a legacy count that has fallen, so the list cannot go stale", () => {
    expect(guard.judge([holding(1)], { [file]: 2 }).failures.join("\n")).toMatch(/Lower LEGACY .* to 1/);
    expect(guard.judge([holding(0)], { [file]: 2 }).failures.join("\n")).toMatch(/delete the entry/);
  });

  it("fails a legacy entry for a file it never read", () => {
    expect(guard.judge([], { [file]: 1 }).failures.join("\n")).toMatch(/is in LEGACY but is gone/);
  });

  it("keeps every real legacy entry inside its own scope", () => {
    for (const legacyFile of Object.keys(guard.LEGACY)) {
      expect(guard.SCOPE.some((pattern) => pattern.test(legacyFile)), legacyFile).toBe(true);
    }
  });
});

describe("scope", () => {
  const scoped = (file: string) => guard.SCOPE.some((pattern) => pattern.test(file));

  it("covers rig tooling, the harness, configs, workflows and operator docs", () => {
    for (const file of [
      "docs/RIG.md",
      "docs/deploy/04-telnyx.md",
      "tools/synthetic/recipes/123.yml",
      "tools/rig/crons.json",
      "scripts/rig/seed.mjs",
      "scripts/dev-seed.mjs",
      "scripts/ci-dev-vars.mjs",
      "scripts/trace-to-fixture.mjs",
      "apps/api/src/calls/trace-to-fixture.test.ts",
      ".github/workflows/rig-cloud.yml",
      "apps/api/e2e/call-sessions.ts",
      "apps/api/src/test/support.ts",
      "apps/api/.dev.vars.example",
      "apps/api/wrangler.jsonc",
      "apps/web/.env.example",
      "supabase/seed.sql",
    ]) {
      expect(scoped(file), file).toBe(true);
    }
  });

  it("leaves product source and unit tests to their own review", () => {
    for (const file of ["apps/api/src/messaging/send.ts", "apps/api/src/messaging/send.test.ts", "docs/DECISIONS.md"]) {
      expect(scoped(file), file).toBe(false);
    }
  });
});

it("fails when it reads no files, since a blind reader passes everything", () => {
  expect(guard.coverage([{ file: "docs/RIG.md", text: "" }])).toEqual([]);
  expect(guard.coverage([]).join("\n")).toMatch(/reading nothing/);
});

it("runs in the CI guard job", () => {
  const workflow = readFileSync(join(REPO, ".github", "workflows", "checks.yml"), "utf8");
  expect(workflow).toMatch(/^\s*run: node scripts\/check-rig-no-e164\.mjs\s*$/m);
});
