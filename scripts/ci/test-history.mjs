/**
 * The test history CI keeps between runs: per test file, how long it took and
 * what it depended on (imports, files read, directories listed, processes
 * started). Paths are stored once in a table and referenced by index, because
 * the tree-walking guards each read thousands of files.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const HISTORY_VERSION = 1;

export function readHistory(file) {
  if (!file || !existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, "utf8"));
  if (raw.version !== HISTORY_VERSION) return null;
  const table = raw.paths;
  const decode = (indexes = []) => new Set(indexes.map((index) => table[index]));
  const files = new Map();
  for (const [unit, entry] of Object.entries(raw.files)) {
    files.set(unit, {
      ms: entry.ms,
      imports: decode(entry.i),
      reads: decode(entry.r),
      lists: decode(entry.l),
      spawns: entry.s === 1,
    });
  }
  return { sha: raw.sha, recordedAt: raw.recordedAt, files };
}

export function writeHistory(file, { sha, files }) {
  const table = [];
  const index = new Map();
  const encode = (paths) =>
    [...paths].toSorted((a, b) => a < b ? -1 : Number(a > b)).map((p) => {
      if (!index.has(p)) {
        index.set(p, table.length);
        table.push(p);
      }
      return index.get(p);
    });
  const out = {};
  for (const [unit, entry] of [...files.entries()].toSorted(([a], [b]) => a.localeCompare(b))) {
    out[unit] = {
      ms: Math.round(entry.ms),
      i: encode(entry.imports),
      r: encode(entry.reads),
      l: encode(entry.lists),
      s: entry.spawns ? 1 : 0,
    };
  }
  const body = { version: HISTORY_VERSION, sha, recordedAt: new Date().toISOString(), paths: table, files: out };
  writeFileSync(file, JSON.stringify(body));
}
