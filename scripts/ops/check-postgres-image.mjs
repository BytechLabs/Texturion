#!/usr/bin/env node
/**
 * Fail when production's Postgres image is not the one CI tests against.
 *
 *   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... node scripts/ops/check-postgres-image.mjs
 *
 * CI runs the version in `supabase/postgres-version` (scripts/pin-postgres-image.mjs).
 * Supabase upgrades production's image on its own schedule, so the pin goes
 * stale silently; on 2026-10-30 a stale CI image crashed the SQL suite on a bug
 * production no longer had. Run weekly by backup-posture.yml, where a failure
 * opens one issue through scheduled-failures.yml. The fix is to write the
 * printed version into `supabase/postgres-version` and let CI run the suites.
 */
import { pinnedPostgresVersion } from "../pin-postgres-image.mjs";

const API = "https://api.supabase.com/v1";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}: see the commented block in apps/api/.dev.vars, or the same-named GitHub secret.`);
    process.exit(2);
  }
  return value;
}

const token = required("SUPABASE_ACCESS_TOKEN");
const ref = required("SUPABASE_PROJECT_REF");
const response = await fetch(`${API}/projects/${ref}`, { headers: { Authorization: `Bearer ${token}` } });
if (!response.ok) {
  console.error(`Management API answered HTTP ${response.status}. A 401 means the token is wrong or expired; a 404 means the project ref is.`);
  process.exit(1);
}
const production = (await response.json())?.database?.version;
if (typeof production !== "string" || production === "") {
  console.error("The management API returned no database.version for the project.");
  process.exit(1);
}
const pinned = pinnedPostgresVersion();
console.log(`production  ${production}`);
console.log(`CI pin      ${pinned}`);
if (production !== pinned) {
  console.error(`CI tests against postgres ${pinned} and production runs ${production}. Write ${production} into supabase/postgres-version.`);
  process.exit(1);
}
console.log("CI runs production's image.");
