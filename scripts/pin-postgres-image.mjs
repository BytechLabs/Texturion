#!/usr/bin/env node
/**
 * Make the next `supabase start` run production's Postgres image.
 *
 * The CLI starts the image its own release pins unless
 * `supabase/.temp/postgres-version` names another; `supabase link` writes that
 * file from the linked project, which is why a linked workstation matched
 * production and CI (never linked, `.temp` is gitignored) did not. This writes
 * the same file from `supabase/postgres-version`, the committed copy of
 * production's version. `scripts/ops/check-postgres-image.mjs` keeps that copy
 * in step with production.
 *
 * Usage:  node scripts/pin-postgres-image.mjs            write the pin
 *         node scripts/pin-postgres-image.mjs --print    print the pinned version
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function pinnedPostgresVersion() {
  const version = readFileSync(join(root, "supabase", "postgres-version"), "utf8").trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`supabase/postgres-version must be a Supabase image tag like 17.6.1.141, not "${version}"`);
  }
  return version;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const version = pinnedPostgresVersion();
  if (process.argv.includes("--print")) {
    console.log(version);
  } else {
    mkdirSync(join(root, "supabase", ".temp"), { recursive: true });
    writeFileSync(join(root, "supabase", ".temp", "postgres-version"), `${version}\n`);
    console.log(`supabase start will run postgres ${version}`);
  }
}
