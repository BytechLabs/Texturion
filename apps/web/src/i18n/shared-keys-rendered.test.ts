import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import * as shared from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { makeTranslate } from "./provider";

/**
 * A shared constant whose value is a catalogue key ("domain.referralCopy") has
 * to go through `t` or `say` before it reaches the page. Rendered bare, the
 * reader sees the key itself, which is how Billing's referral button came to
 * say "domain.referralCopy". This scan fails on a line that puts such a
 * constant in a JSX slot (`{KEY}`, `? KEY :`, `: KEY}`) with no translator
 * call before it on the line.
 */
const SRC = join(__dirname, "..");
const en = makeTranslate("en");

function sharedKeyConstants(): string[] {
  return Object.entries(shared)
    .filter(
      ([name, value]) =>
        /^[A-Z][A-Z0-9_]+$/.test(name) &&
        typeof value === "string" &&
        /^[a-z][A-Za-z]*\.[A-Za-z0-9_]+$/.test(value) &&
        en(value as Parameters<typeof en>[0]) !== value,
    )
    .map(([name]) => name);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** The lines that render one of `names` without translating it first. */
export function bareKeyLines(text: string, names: readonly string[]): string[] {
  if (names.length === 0) return [];
  const slot = new RegExp(`[{?:]\\s*(${names.join("|")})\\s*[}:]`);
  return text.split("\n").filter((line) => {
    if (/^\s*import\b/.test(line)) return false;
    const match = slot.exec(line);
    if (!match) return false;
    const before = line.slice(0, match.index);
    return !/\b(?:t|say|sayWith|translate)\(/.test(before);
  });
}

describe("shared catalogue keys are translated before they render", () => {
  const names = sharedKeyConstants();

  it("finds the shared key constants it checks", () => {
    expect(names).toContain("REFERRAL_SHARE_COPY");
    expect(names.length).toBeGreaterThan(20);
  });

  it("flags a key rendered bare, and passes one wrapped in say()", () => {
    expect(bareKeyLines("  {copied ? REFERRAL_SHARE_COPIED : REFERRAL_SHARE_COPY}", names)).toHaveLength(1);
    expect(bareKeyLines("  {say(copied ? REFERRAL_SHARE_COPIED : REFERRAL_SHARE_COPY)}", names)).toEqual([]);
  });

  it("no web file renders one bare", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      bareKeyLines(readFileSync(file, "utf8"), names).map(
        (line) => `${relative(SRC, file)}: ${line.trim()}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
