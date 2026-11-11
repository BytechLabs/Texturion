/**
 * #749: the setting defaults the phones read come from this table. Their tests
 * decode a company with no settings and compare against
 * `vectors/setting-defaults.json`, which this test keeps in step, as it does the
 * D162 table in docs/DECISIONS.md, where each setting's reason is written.
 * Regenerate both, keeping the reasons, with:
 * WRITE_SETTING_VECTORS=1 pnpm --filter @loonext/shared test setting-defaults
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AUTOMATIC_TEXT_DEFAULTS } from "./automatic-text-settings";
import { RING_SECONDS_MAX } from "./number-identity";
import {
  COMPANY_SETTING_DEFAULTS,
  NOTIFICATION_SETTING_DEFAULTS,
  REVENUE_SETTING_KEYS,
  type SettingDefault,
} from "./setting-defaults";

const VECTORS = join(import.meta.dirname, "..", "vectors", "setting-defaults.json");
const DECISIONS = join(import.meta.dirname, "..", "..", "..", "docs", "DECISIONS.md");

function vectors() {
  const rows = (table: string, defaults: Record<string, SettingDefault>) =>
    Object.entries(defaults).map(([key, { value, revenue }]) => ({
      table,
      key,
      value,
      revenue: revenue === true,
    }));
  return [
    ...rows("companies", COMPANY_SETTING_DEFAULTS),
    ...rows("notification_prefs", NOTIFICATION_SETTING_DEFAULTS),
  ];
}

const DOC_START = "<!-- setting-defaults:start -->";
const DOC_END = "<!-- setting-defaults:end -->";
const DOC_ROW = /^\| `([a-z_]+)\.([a-z_]+)` \| `(.*)` \| (yes)? \| (.*) \|$/;

/** The reasons now in the D162 table, by setting. */
function documentedReasons(block: string): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const line of block.split("\n")) {
    const row = DOC_ROW.exec(line);
    if (row) reasons.set(`${row[1]}.${row[2]}`, row[5]!.trim());
  }
  return reasons;
}

/**
 * The D162 table rebuilt from the code: the setting, its default and whether it
 * is attributed come from setting-defaults.ts; the reason is carried over from
 * the doc, and a new setting starts with none, which fails the reason check.
 */
function decisionRows(reasons: Map<string, string>): string {
  const header = "| Setting | Default | Attributed | Why |\n|---|---|---|---|";
  const rows = vectors().map(
    ({ table, key, value, revenue }) =>
      `| \`${table}.${key}\` | \`${JSON.stringify(value)}\` | ${revenue ? "yes" : ""} | ${reasons.get(`${table}.${key}`) ?? ""} |`,
  );
  return [header, ...rows].join("\n");
}

describe("setting defaults (#749)", () => {
  it("the phones' vectors match the table", () => {
    const body = `${JSON.stringify(vectors(), null, 2)}\n`;
    if (process.env.WRITE_SETTING_VECTORS) writeFileSync(VECTORS, body);
    expect(readFileSync(VECTORS, "utf8").replace(/\r\n/g, "\n")).toBe(body);
  });

  it("docs/DECISIONS.md lists every default with its reason (D162)", () => {
    const doc = readFileSync(DECISIONS, "utf8").replace(/\r\n/g, "\n");
    const start = doc.indexOf(DOC_START);
    const end = doc.indexOf(DOC_END);
    expect(start).toBeGreaterThan(0);
    const reasons = documentedReasons(doc.slice(start, end));
    const expected =
      `${doc.slice(0, start + DOC_START.length)}\n${decisionRows(reasons)}\n${doc.slice(end)}`;
    if (process.env.WRITE_SETTING_VECTORS) writeFileSync(DECISIONS, expected);
    expect(readFileSync(DECISIONS, "utf8").replace(/\r\n/g, "\n")).toBe(expected);

    const silent = vectors()
      .map(({ table, key }) => `${table}.${key}`)
      .filter((setting) => (reasons.get(setting) ?? "").length < 20);
    expect(silent, "write why each of these is the default in the D162 table").toEqual([]);
  });

  it("nothing that can lose a customer starts switched against them", () => {
    expect(COMPANY_SETTING_DEFAULTS.after_hours_calls.value).toBe("ring_everyone");
    expect(COMPANY_SETTING_DEFAULTS.away_enabled.value).toBe(false);
    expect(COMPANY_SETTING_DEFAULTS.call_screening.value).not.toBe("divert");
    expect(COMPANY_SETTING_DEFAULTS.ring_seconds.value).toBe(RING_SECONDS_MAX);
    expect(COMPANY_SETTING_DEFAULTS.us_texting_enabled.value).toBe(true);
    expect(NOTIFICATION_SETTING_DEFAULTS.email_enabled.value).toBe(true);
    expect(NOTIFICATION_SETTING_DEFAULTS.push_enabled.value).toBe(true);
    expect(REVENUE_SETTING_KEYS).toContain("after_hours_calls");
  });

  it("the automatic-text defaults are the ones the table holds", () => {
    for (const [key, value] of Object.entries(AUTOMATIC_TEXT_DEFAULTS)) {
      expect(
        (COMPANY_SETTING_DEFAULTS as Record<string, SettingDefault>)[key]?.value,
        key,
      ).toBe(value);
    }
  });
});
