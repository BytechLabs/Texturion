/**
 * #749: a setting's default is written once, in packages/shared/src/setting-defaults.ts.
 * The database's column defaults and the API's fallbacks must say the same.
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
  COMPANY_COLUMNS_NOT_SETTINGS,
  COMPANY_SETTING_DEFAULTS,
  NOTIFICATION_COLUMNS_NOT_SETTINGS,
  NOTIFICATION_SETTING_DEFAULTS,
} from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { productionSources, sourceText, stripComments } from "./source-tree";

const SNAPSHOT = JSON.parse(
  readFileSync(join(import.meta.dirname, "schema-snapshot.json"), "utf8"),
) as { defaults: Record<string, Record<string, string | null>> };

const TABLES = [
  {
    table: "companies",
    defaults: COMPANY_SETTING_DEFAULTS as Record<string, { value: unknown }>,
    notSettings: COMPANY_COLUMNS_NOT_SETTINGS as Record<string, string>,
  },
  {
    table: "notification_prefs",
    defaults: NOTIFICATION_SETTING_DEFAULTS as Record<string, { value: unknown }>,
    notSettings: NOTIFICATION_COLUMNS_NOT_SETTINGS as Record<string, string>,
  },
];

/** Postgres's text form of a column default, as information_schema prints it. */
function parseColumnDefault(sql: string | null): unknown {
  if (sql === null) return null;
  if (sql === "true") return true;
  if (sql === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(sql)) return Number(sql);
  const quoted = /^'((?:[^']|'')*)'::([\w ]+)$/.exec(sql);
  if (quoted) {
    const text = quoted[1]!.replace(/''/g, "'");
    return quoted[2] === "jsonb" ? JSON.parse(text) : text;
  }
  throw new Error(`cannot read the column default ${sql}`);
}

describe("every setting's default is written once (#749)", () => {
  for (const { table, defaults, notSettings } of TABLES) {
    const columns = SNAPSHOT.defaults[table] ?? {};

    it(`${table}: every column is a setting with a default or is named as not one`, () => {
      const names = Object.keys(columns);
      expect(names.length).toBeGreaterThan(5);
      const unclassified = names.filter((name) => !(name in defaults) && !(name in notSettings));
      expect(unclassified, "add these to packages/shared/src/setting-defaults.ts").toEqual([]);
      const both = Object.keys(defaults).filter((name) => name in notSettings);
      expect(both).toEqual([]);
      const gone = [...Object.keys(defaults), ...Object.keys(notSettings)].filter(
        (name) => !(name in columns),
      );
      expect(gone, "these are no longer columns").toEqual([]);
    });

    it(`${table}: the database's defaults are the shared ones`, () => {
      const differ = Object.entries(defaults)
        .map(([name, { value }]) => ({ name, shared: value, database: parseColumnDefault(columns[name] ?? null) }))
        .filter(({ shared, database }) => JSON.stringify(shared) !== JSON.stringify(database));
      expect(differ).toEqual([]);
    });
  }

  it("phone_numbers: a number's copy of a workspace setting starts empty, so it inherits", () => {
    const numberColumns = SNAPSHOT.defaults.phone_numbers ?? {};
    const shared = Object.keys(numberColumns).filter((name) => name in COMPANY_SETTING_DEFAULTS);
    expect(shared.length).toBeGreaterThan(5);
    expect(shared.filter((name) => numberColumns[name] !== null)).toEqual([]);
  });

  /** Lines that match by name but deliberately do not mean the setting's default. */
  const NOT_THE_SETTING: Record<string, string> = {
    "messaging/appointment-reminders.ts: p_clock_timezone: clock?.timezone ?? \"UTC\",":
      "the reminder clock's zone, on a call that only clears reminders; not the workspace's time zone",
    "calls/runtime.ts: timezone: company.timezone ?? \"\",":
      "a zone the router cannot place rings the whole crew (AH-R5); a guessed default could send the call to voicemail",
  };

  it("the API never writes a setting's default as a literal fallback", () => {
    const keys = [
      ...Object.keys(COMPANY_SETTING_DEFAULTS),
      ...Object.keys(NOTIFICATION_SETTING_DEFAULTS),
    ];
    const literalFallback = new RegExp(
      String.raw`\b(${keys.join("|")})\s*\?\?\s*(true|false|-?\d+(?:\.\d+)?|"[^"]*"|'[^']*'|\{\}|\[\])`,
    );
    const root = join(import.meta.dirname, "..");
    const files = productionSources(root);
    expect(files.length).toBeGreaterThan(100);
    const hits = files.flatMap((path) => {
      const file = relative(root, path).replaceAll("\\", "/");
      return stripComments(sourceText(path))
        .split("\n")
        .filter((line) => literalFallback.test(line))
        .map((line) => `${file}: ${line.trim()}`);
    });
    const excused = hits.filter((hit) => hit in NOT_THE_SETTING);
    expect(
      hits.filter((hit) => !(hit in NOT_THE_SETTING)),
      "read the default from companySettingDefault() or NOTIFICATION_SETTING_DEFAULTS",
    ).toEqual([]);
    expect(excused.sort(), "an exception that matches nothing any more").toEqual(
      Object.keys(NOT_THE_SETTING).sort(),
    );
  });
});
