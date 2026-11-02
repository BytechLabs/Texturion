/**
 * The Supabase CLI and the local stack it runs, at the CLI version CI pins.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { run } from "./exec.mjs";
import { TOOLING_ROOT } from "./layout.mjs";
import { isLocalUrl } from "../../../scripts/local-supabase.mjs";

/** How long `rig stack up` gives the stack's containers to become healthy after the VM boots. */
export const STACK_READY_MS = 3 * 60_000;

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

/** The stack's containers with their state and, when they have a healthcheck, its answer. */
export function listStackContainers(projectId, exec = run) {
  const { stdout, status } = exec(
    "docker",
    ["ps", "-a", "--filter", `label=com.supabase.cli.project=${projectId}`, "--format", "{{.Names}}\t{{.State}}\t{{.Status}}"],
    { allowFailure: true },
  );
  if (status !== 0) return [];
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name = "", state = "", text = ""] = line.split("\t");
      return { name, state, health: /\((?:health: )?(starting|healthy|unhealthy)\)/.exec(text)?.[1] ?? null };
    });
}

/** What keeps a container from being used yet: still starting, or restarting. Null when it is ready or not meant to run. */
export function notReadyBecause(container) {
  if (container.state === "restarting") return "restarting";
  if (container.state !== "running") return null;
  return container.health === "starting" || container.health === "unhealthy" ? container.health : null;
}

/**
 * Waits for the stack's containers to finish starting. Docker brings the
 * containers back by itself when the VM boots (`unless-stopped`), so at that
 * moment `supabase start` finds them "already running" and refuses while the
 * database is still starting. The wait is bounded; a database that is not
 * healthy by then is named, with where to look.
 *
 * Containers that are not running at all are left to `supabase start`.
 */
export async function waitForStack(
  projectId,
  { timeoutMs = STACK_READY_MS, intervalMs = 2_000, list = listStackContainers, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now, log = () => {} } = {},
) {
  const deadline = now() + timeoutMs;
  const database = `supabase_db_${projectId}`;
  let announced = false;
  for (;;) {
    const waiting = list(projectId)
      .map((container) => ({ name: container.name, because: notReadyBecause(container) }))
      .filter((entry) => entry.because !== null);
    if (waiting.length === 0) return;
    if (now() >= deadline) {
      const named = waiting.map((entry) => `${entry.name} (${entry.because})`).join(", ");
      const which = waiting.some((entry) => entry.name === database) ? `the database ${database}` : "the stack";
      throw new Error(
        `rig stack: ${which} was still not ready after ${Math.round(timeoutMs / 1000)} s: ${named}. Look at \`docker logs ${database}\`, then run \`rig stack up\` again.`,
      );
    }
    if (!announced) {
      log(`stack: waiting for ${waiting.map((entry) => entry.name).join(", ")}`);
      announced = true;
    }
    await sleep(intervalMs);
  }
}
