/**
 * A keyboard event's `key` can be missing: Chrome sends `keydown` with no `key`
 * when it autofills a field. A handler that calls a string method on it throws,
 * as the ⌘K shortcut did in production on 2026-11-10 ("Cannot read properties
 * of undefined (reading 'toLowerCase')"). Any string call on `.key` needs a
 * `typeof … === "string"` check on the same line.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const STRING_CALL_ON_KEY = /\b\w+\.key\.(?:toLowerCase|toUpperCase|trim|startsWith|endsWith|charAt|localeCompare)\(/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("a keyboard event's key is checked before it is used as a string", () => {
  it("guards every string call on .key", () => {
    const files = sourceFiles(SRC);
    expect(files.length, "no source files were scanned").toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (STRING_CALL_ON_KEY.test(line) && !/typeof\s+\w+\.key\s*===\s*"string"/.test(line)) {
            offenders.push(`${relative(SRC, file)}:${index + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
