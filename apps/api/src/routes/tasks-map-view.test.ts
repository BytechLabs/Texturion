import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TASK_COLUMNS } from "./tasks";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "../../../../supabase/migrations");

/** The output column names of the newest definition of `view` in the migrations. */
function latestViewColumns(view: string): string[] {
  const definition = new RegExp(
    `create (?:or replace )?view public\\.${view}\\b[\\s\\S]*?\\bselect\\b([\\s\\S]*?)\\bfrom public\\.`,
    "gi",
  );
  let body = "";
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
    for (const match of readFileSync(join(MIGRATIONS, file), "utf8").matchAll(definition)) {
      body = match[1];
    }
  }
  return body.split(",").map((part) => {
    const column = part.trim().replace(/\s+/g, " ");
    const alias = / as (\w+)$/i.exec(column);
    return alias ? alias[1] : (column.split(".").pop() ?? column).trim();
  });
}

describe("task_map_rows carries every column the task list selects", () => {
  // The map path reads the view with TASK_COLUMNS. When tasks gained `number`
  // the view did not, and every production map read failed.
  it("has each of them", () => {
    const viewColumns = new Set(latestViewColumns("task_map_rows"));
    expect(viewColumns.size).toBeGreaterThan(20);
    const missing = TASK_COLUMNS.split(",").filter((column) => !viewColumns.has(column));
    expect(missing).toEqual([]);
  });
});
