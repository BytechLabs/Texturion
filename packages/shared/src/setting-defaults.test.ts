/**
 * #749: the setting defaults the phones read come from this table. Their tests
 * decode a company with no settings and compare against
 * `vectors/setting-defaults.json`, which this test keeps in step.
 * The same run keeps the D162 table in docs/DECISIONS.md. Regenerate both with:
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

/** The D162 table: one row per setting, written from the table so the two cannot drift. */
function decisionRows(): string {
  const header = "| Setting | Default | Attributed | Why |\n|---|---|---|---|";
  const rows = vectors().map(({ table, key, value, revenue }) => {
    const all = { ...COMPANY_SETTING_DEFAULTS, ...NOTIFICATION_SETTING_DEFAULTS } as Record<
      string,
      SettingDefault
    >;
    return `| \`${table}.${key}\` | \`${JSON.stringify(value)}\` | ${revenue ? "yes" : ""} | ${all[key]!.reason} |`;
  });
  return [header, ...rows].join("\n");
}

describe("setting defaults (#749)", () => {
  it("the phones' vectors match the table", () => {
    const body = `${JSON.stringify(vectors(), null, 2)}\n`;
    if (process.env.WRITE_SETTING_VECTORS) writeFileSync(VECTORS, body);
    expect(readFileSync(VECTORS, "utf8").replace(/\r\n/g, "\n")).toBe(body);
  });

  it("docs/DECISIONS.md lists every default with its reason (D162)", () => {
    const start = "<!-- setting-defaults:start -->";
    const end = "<!-- setting-defaults:end -->";
    const doc = readFileSync(DECISIONS, "utf8").replace(/\r\n/g, "\n");
    const before = doc.slice(0, doc.indexOf(start) + start.length);
    const after = doc.slice(doc.indexOf(end));
    expect(doc.indexOf(start)).toBeGreaterThan(0);
    const expected = `${before}\n${decisionRows()}\n${after}`;
    if (process.env.WRITE_SETTING_VECTORS) writeFileSync(DECISIONS, expected);
    expect(readFileSync(DECISIONS, "utf8").replace(/\r\n/g, "\n")).toBe(expected);
  });

  it("every setting says why it is the default", () => {
    const all = { ...COMPANY_SETTING_DEFAULTS, ...NOTIFICATION_SETTING_DEFAULTS };
    const silent = Object.entries(all as Record<string, SettingDefault>)
      .filter(([, { reason }]) => reason.trim().length < 20)
      .map(([key]) => key);
    expect(silent).toEqual([]);
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
