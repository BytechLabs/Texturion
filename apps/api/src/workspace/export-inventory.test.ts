import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import schema from "../test/schema-snapshot.json";
import { EXPORT_TABLES } from "./export-tables";

const inventory = readFileSync(
  new URL("../../../../docs/PERSONAL-DATA-INVENTORY.md", import.meta.url),
  "utf8",
);

function namesIn(cell: string) {
  return Array.from(cell.matchAll(/`([^`]+)`/g), ([, name]) => name);
}

it("accounts for each record in the personal-data inventory", () => {
  const tables = inventory.split("## 1.")[1]?.split("## 6.")[0] ?? "";
  const named = [...tables.matchAll(/^\| (`[^|]+) \|/gm)]
    .flatMap(([, cell]) => namesIn(cell));
  const coverage = inventory.split("## Workspace export coverage")[1]?.split("\n## ")[0] ?? "";
  const excluded = [...coverage.matchAll(/^\| ([^|]+) \| (`[^|]+) \|/gm)]
    .flatMap(([, reason, cell]) => {
      expect(reason.trim()).not.toBe("");
      return namesIn(cell);
    });
  const exported = EXPORT_TABLES.map(({ table }) => table);

  expect(named.length).toBeGreaterThan(50);
  expect(new Set([...exported, ...excluded])).toEqual(new Set(named));
  expect(exported.filter((table) => excluded.includes(table))).toEqual([]);
});

it("reads existing columns and pages on keys present in the export", () => {
  const tables: Record<string, { columns: string[] }> = schema.tables;
  for (const spec of EXPORT_TABLES) {
    const columns = spec.columns.split(",");
    expect(tables[spec.table].columns, spec.table).toEqual(expect.arrayContaining([
      "company_id", ...columns,
    ]));
    expect(columns, spec.table).toEqual(expect.arrayContaining([...(spec.key ?? ["id"])]));
    if (spec.parent) {
      expect(schema.foreignKeys).toContainEqual(expect.objectContaining({
        table: spec.table, refTable: spec.parent,
      }));
    }
  }
});
