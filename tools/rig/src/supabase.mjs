/**
 * The Supabase CLI and the local stack it runs, at the CLI version CI pins.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { run } from "./exec.mjs";
import { TOOLING_ROOT } from "./layout.mjs";
import { isLocalUrl } from "../../../scripts/local-supabase.mjs";

/**
 * The version `supabase/setup-cli` installs in CI, read from the workflow so
 * the rig and CI cannot drift apart.
 */
export function pinnedCliVersion(root = TOOLING_ROOT) {
  const workflow = readFileSync(join(root, ".github", "workflows", "checks.yml"), "utf8");
  const match = /supabase\/setup-cli@\S+[^\n]*\n\s*with:\s*\n\s*version:\s*([0-9]+\.[0-9]+\.[0-9]+)/.exec(workflow);
  if (!match) throw new Error("rig: cannot find the Supabase CLI version pinned in checks.yml");
  return match[1];
}

/** `RIG_SUPABASE_CLI` names an installed binary; otherwise pnpm runs the pinned package. */
export function supabaseCli(env = process.env) {
  if (env.RIG_SUPABASE_CLI) return { command: env.RIG_SUPABASE_CLI, prefix: [] };
  return { command: "pnpm", prefix: ["dlx", `supabase@${pinnedCliVersion()}`] };
}

export function supabase(args, { workdir, inherit = false, allowFailure = false } = {}) {
  const cli = supabaseCli();
  const full = [...cli.prefix, ...args, ...(workdir ? ["--workdir", workdir] : [])];
  // Outside a project corepack runs its latest pnpm, which it may not be able to start.
  return run(cli.command, full, { cwd: TOOLING_ROOT, inherit, allowFailure });
}

/**
 * What `supabase status` reports, refused unless it describes this machine.
 * Every writer on the rig gets its target from here, so none can be pointed at
 * a hosted project by a stray environment variable.
 */
export function localStatus(workdir) {
  const { stdout, status } = supabase(["status", "-o", "json"], { workdir, allowFailure: true });
  if (status !== 0) return null;
  return parseLocalStatus(stdout);
}

/** `supabase status -o json` output, or null when it is not a running stack. */
export function parseLocalStatus(stdout) {
  const start = stdout.indexOf("{");
  let parsed;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
  const apiUrl = parsed.API_URL ?? parsed.api_url;
  const secretKey = parsed.SECRET_KEY ?? parsed.secret_key ?? parsed.SERVICE_ROLE_KEY;
  const publishableKey = parsed.PUBLISHABLE_KEY ?? parsed.publishable_key ?? parsed.ANON_KEY;
  const dbUrl = parsed.DB_URL ?? parsed.db_url;
  if (!apiUrl || !secretKey) return null;
  if (!isLocalUrl(apiUrl) || (dbUrl && !isLocalUrl(dbUrl.replace(/^postgres(ql)?:/, "http:")))) {
    throw new Error("rig: supabase status describes a remote host. The rig only writes to its own local stack.");
  }
  return { apiUrl, secretKey, publishableKey, dbUrl };
}

export function containerName(projectId, service) {
  return `supabase_${service}_${projectId}`;
}

/** SQL as the database owner, through the stack's own container. */
export function psql(projectId, sql, { user = "postgres" } = {}) {
  return run(
    "docker",
    ["exec", "-i", containerName(projectId, "db"), "psql", "-U", user, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A"],
    { input: sql },
  ).stdout;
}

/** Migration versions a ref carries: the digits before the first underscore. */
export function refMigrationVersions(refRoot) {
  return readdirSync(join(refRoot, "supabase", "migrations"))
    .map((file) => /^(\d+)_.*\.sql$/.exec(file)?.[1])
    .filter(Boolean)
    .sort();
}

export function appliedMigrationVersions(projectId) {
  try {
    return psql(projectId, "select version from supabase_migrations.schema_migrations order by version;")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .sort();
  } catch {
    return null;
  }
}

/**
 * Migrate when the database's history is a prefix of the ref's. Anything else
 * (a newer database, a ref from another branch, an empty one) means the ref's
 * schema cannot be reached by applying migrations, so the rig resets and
 * reseeds.
 */
export function schemaPlan(applied, wanted) {
  if (applied === null || applied.length === 0) return { action: "reset", reason: "the database has no migration history" };
  if (applied.length > wanted.length) return { action: "reset", reason: "the database is newer than the ref" };
  for (let i = 0; i < applied.length; i += 1) {
    if (applied[i] !== wanted[i]) {
      return { action: "reset", reason: `the histories part at ${applied[i]}` };
    }
  }
  const pending = wanted.slice(applied.length);
  return pending.length === 0
    ? { action: "none", reason: "the database is at the ref's schema" }
    : { action: "migrate", reason: `${pending.length} migration(s) to apply`, pending };
}
