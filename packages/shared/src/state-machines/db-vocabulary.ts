import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reads the migration SQL as text and answers: what values may this column
 * hold, according to the schema as the migrations leave it?
 *
 * Test support only. It is NOT exported from the package index: it touches the
 * filesystem, and the index is bundled into Workers and browsers.
 *
 * Two shapes pin a vocabulary in this repo, and the file order of the
 * migrations decides which definition is current (a later one replaces an
 * earlier one):
 *
 *   check   `check (col in ('a','b'))` or `check (col = any (array['a','b']))`,
 *           inline on the column or as a named constraint, attributed to the
 *           table named by the nearest preceding `create table` or
 *           `alter table`. A leading `col is null or` is read as nullable.
 *   enum    `create type x as enum (...)` plus every `alter type x add value`.
 *
 * It does not understand `alter type ... rename value`, `drop type` or a
 * constraint that is dropped and never re-added. It throws on a rename so the
 * day one lands, the test says so instead of passing on a stale list.
 */

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "..", "supabase", "migrations");

export interface CheckVocabulary {
  values: string[];
  nullable: boolean;
  file: string;
}

export interface DbVocabulary {
  checks: Map<string, CheckVocabulary>;
  enums: Map<string, string[]>;
}

const LIST = String.raw`((?:'[^']*'(?:::\w+)?\s*,?\s*)+)`;
const CHECK_RE = new RegExp(
  String.raw`\b(\w+)\s+(?:in\s*\(\s*${LIST}\)|=\s*any\s*\(\s*array\s*\[\s*${LIST}\]\s*\))`,
  "gi",
);

function literals(list: string): string[] {
  return [...list.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? "");
}

let cached: DbVocabulary | null = null;

export function readDbVocabulary(): DbVocabulary {
  if (cached) return cached;
  const checks = new Map<string, CheckVocabulary>();
  const enums = new Map<string, string[]>();

  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8").replace(/--[^\n]*/g, "");

    const tableAt = (index: number): string | null => {
      const head = sql.slice(0, index);
      const re =
        /(?:create table(?: if not exists)?|alter table(?: only)?(?: if exists)?)\s+(?:public\.)?"?(\w+)"?/gi;
      let last: string | null = null;
      for (let match = re.exec(head); match; match = re.exec(head)) {
        last = match[1] ?? null;
      }
      return last;
    };

    for (let match = CHECK_RE.exec(sql); match; match = CHECK_RE.exec(sql)) {
      const before = sql.slice(Math.max(0, match.index - 160), match.index);
      const nullable = /is\s+null\s+or\s*\(*\s*$/i.test(before);
      if (!/check\s*\(\s*\(*\s*(?:\w+\s+is\s+null\s+or\s*\(*\s*)?$/i.test(before)) continue;
      const table = tableAt(match.index);
      if (!table) continue;
      checks.set(`${table}.${match[1]}`, {
        values: literals(match[2] ?? match[3] ?? ""),
        nullable,
        file,
      });
    }

    const create = /create type\s+(?:public\.)?(\w+)\s+as enum\s*\(([^)]*)\)/gi;
    for (let match = create.exec(sql); match; match = create.exec(sql)) {
      enums.set(match[1] ?? "", literals(match[2] ?? ""));
    }
    const add = /alter type\s+(?:public\.)?(\w+)\s+add value(?: if not exists)?\s+'([^']*)'/gi;
    for (let match = add.exec(sql); match; match = add.exec(sql)) {
      const name = match[1] ?? "";
      const list = enums.get(name) ?? [];
      list.push(match[2] ?? "");
      enums.set(name, list);
    }
    if (/alter type\s+(?:public\.)?\w+\s+rename value/i.test(sql)) {
      throw new Error(
        `enum value renamed in ${file}, which db-vocabulary.ts cannot model yet`,
      );
    }
  }

  cached = { checks, enums };
  return cached;
}
