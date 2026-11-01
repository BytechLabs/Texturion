/**
 * `rig deploy --ref <tag|branch|sha>`:
 *   1. a git worktree of the ref, with its dependencies installed;
 *   2. the configuration derived from the ref's own files, where every
 *      refusal happens, before anything that runs is changed;
 *   3. the local database migrated, or reset and reseeded when the ref's
 *      schema cannot be reached by migrating, with the services stopped
 *      first when the schema changes, and held stopped (deploy-hold.mjs)
 *      until step 4 has finished;
 *   4. the SHA recorded for every verdict, the ref's cron timers installed,
 *      the services restarted, and then rigd's scenario timers installed.
 *
 * `--worktree <path>` deploys a checkout in place instead, for a branch an
 * agent is working on; nothing is fetched, created or installed.
 */
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { bootstrapDb } from "./bootstrap-db.mjs";
import { cronTimers, cronUnits, cronsToSchedule, readCronRegistry } from "./cron.mjs";
import { holdForDeploy, readDeployHold, releaseDeployHold } from "./deploy-hold.mjs";
import { dummyServiceAccount, firebaseProjectId, generateVapidPair, relayDsn, renderDevVars, seams } from "./dev-vars.mjs";
import { run, systemctlUser, userManagerEnv } from "./exec.mjs";
import { edgeOrigin, fetchPartition, recordStanding, rigEndpoints, standingNumbers } from "./guard.mjs";
import { TOOLING_ROOT } from "./layout.mjs";
import { parseJsonc } from "./jsonc.mjs";
import {
  buildSupabaseWorkdir,
  deriveSupabaseConfig,
  generateSigningKeys,
  projectIdOf,
} from "./supabase-config.mjs";
import { ensureStripeCatalog, requiredCatalogKeys, stripeSandboxKey, stripeWebhookSecret } from "./stripe.mjs";
import { appliedMigrationVersions, localStatus, psql, refMigrationVersions, schemaPlan, supabase } from "./supabase.mjs";
import { aiShimConfig, deriveRigConfig, renderRigConfig } from "./wrangler-config.mjs";
import { seed, seedGapsSql } from "../../../scripts/rig/seed.mjs";

/** The CLI's own address for its stack; anything else is set as the issuer. */
const CLI_API_URL = "http://127.0.0.1:54321";

/** Services the stack does not need on the rig. */
export const STACK_EXCLUDES = ["vector", "logflare", "imgproxy", "edge-runtime"];

/** User-level units (`loginctl enable-linger`), so deploy needs no root. */
export const SERVICE_UNITS = ["loonext-rig-api.service", "loonext-rig-web.service", "loonext-rig-stripe-listen.service"];

/** Stopped before a schema change: the services, and every timer that starts something against them. */
export const SCHEMA_CHANGE_STOPS = [...SERVICE_UNITS, "loonext-rig-cron-*.timer", "loonext-rig-scenario-*.timer"];

/** Files the rig writes into a worktree; none may ever be committed from one. */
export const DERIVED_FILES = ["apps/api/wrangler.rig.jsonc", "apps/api/.dev.vars.rig", "apps/web/wrangler.rig.jsonc"];

function git(args, cwd = TOOLING_ROOT) {
  return run("git", ["-C", cwd, ...args]).stdout.trim();
}

/** A branch name resolves to the remote's copy, so a stale local branch never wins. */
export function resolveSha(ref, cwd = TOOLING_ROOT) {
  for (const candidate of [`origin/${ref}`, ref]) {
    const out = run("git", ["-C", cwd, "rev-parse", "--verify", "--quiet", `${candidate}^{commit}`], { allowFailure: true });
    if (out.status === 0) return out.stdout.trim();
  }
  throw new Error(`rig deploy: ${ref} is not a commit, tag or branch here`);
}

/** Old refs predate any .gitignore line for these, so the repository's own exclude file carries them. */
function excludeDerivedFiles() {
  const exclude = join(resolve(TOOLING_ROOT, git(["rev-parse", "--git-common-dir"])), "info", "exclude");
  const existing = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
  const missing = DERIVED_FILES.filter((file) => !existing.split(/\r?\n/).includes(`/${file}`));
  if (missing.length === 0) return;
  mkdirSync(join(exclude, ".."), { recursive: true });
  appendFileSync(exclude, `${existing.endsWith("\n") || existing === "" ? "" : "\n"}${missing.map((file) => `/${file}`).join("\n")}\n`);
}

function hash(...parts) {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

async function runningKids(apiUrl) {
  try {
    const response = await fetch(`${apiUrl}/auth/v1/.well-known/jwks.json`);
    if (!response.ok) return [];
    return ((await response.json()).keys ?? []).map((key) => key.kid);
  } catch {
    return [];
  }
}

/**
 * Starts the stack from the derived folder, restarting it when what runs is
 * not what was derived: another config, or a key other than the rig's.
 */
async function ensureStack({ workdir, configHash, kid, state, log }) {
  const appliedPath = join(state, "supabase-applied.json");
  const applied = existsSync(appliedPath) ? JSON.parse(readFileSync(appliedPath, "utf8")) : null;
  const status = localStatus(workdir);
  const current = status !== null && applied?.configHash === configHash && (await runningKids(status.apiUrl)).includes(kid);
  if (current) return { restarted: false };
  if (status !== null) {
    log("stack: restarting with the derived config");
    supabase(["stop"], { workdir, inherit: true });
  } else {
    log("stack: starting");
  }
  supabase(["start", "-x", STACK_EXCLUDES.join(",")], { workdir, inherit: true });
  mkdirSync(state, { recursive: true });
  writeFileSync(appliedPath, `${JSON.stringify({ configHash, at: new Date().toISOString() }, null, 2)}\n`);
  return { restarted: true };
}

/** Next majors before 16 cannot pass OpenNext's support-date check; the rig builds them anyway. */
export function webBuildArgs(webPackageJson) {
  const range = webPackageJson.dependencies?.next ?? webPackageJson.devDependencies?.next ?? "";
  const major = Number(/(\d+)/.exec(range)?.[1] ?? "0");
  return ["exec", "opennextjs-cloudflare", "build", ...(major > 0 && major < 16 ? ["--dangerouslyUseUnsupportedNextVersion"] : [])];
}


/** The OpenNext build. Its config is derived first, so a refusal never waits for the build. */
function buildWeb({ root, sha, settings, status, log }) {
  const web = join(root, "apps", "web");
  const derived = deriveRigConfig(parseJsonc(readFileSync(join(web, "wrangler.jsonc"), "utf8")), { port: settings.webPort });
  log("web: OpenNext build");
  run("pnpm", webBuildArgs(JSON.parse(readFileSync(join(web, "package.json"), "utf8"))), {
    cwd: web,
    inherit: true,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: settings.supabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.publishableKey,
      NEXT_PUBLIC_API_URL: settings.apiOrigin,
      // Cloudflare's published always-pass test site key.
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      // Unset on purpose: every route stays on the one rig origin.
      NEXT_PUBLIC_APP_ORIGIN: "",
      NEXT_PUBLIC_BLOG_ORIGIN: "",
    },
  });
  return { path: join(web, "wrangler.rig.jsonc"), content: renderRigConfig(derived, { source: "apps/web/wrangler.jsonc", sha }) };
}

/**
 * `systemctl --user` must answer before anything changes, or the deploy
 * would stop half done at the restart.
 */
function requireUserManager() {
  try {
    systemctlUser(["show-environment"]);
  } catch {
    throw new Error(
      "rig deploy: systemctl --user cannot reach the rig account's user manager; " +
        "set XDG_RUNTIME_DIR=/run/user/$(id -u), or pass --no-restart",
    );
  }
}

/**
 * The ref's crons as user timers. The new units are written before the stale
 * ones are removed, so a failure part way leaves timers that still fire.
 */
function installCronTimers({ timers, nodeBin, unitDir, systemctl }) {
  mkdirSync(unitDir, { recursive: true });
  const keep = new Set();
  for (const { cron, slug } of timers) {
    const units = cronUnits({ cron, slug, node: nodeBin, rigBin: join(TOOLING_ROOT, "tools", "rig", "bin", "rig.mjs") });
    for (const [kind, text] of [["service", units.service], ["timer", units.timer]]) {
      const file = `loonext-rig-cron-${slug}.${kind}`;
      writeFileSync(join(unitDir, file), text);
      keep.add(file);
    }
  }
  for (const file of readdirSync(unitDir)) {
    if (!file.startsWith("loonext-rig-cron-") || keep.has(file)) continue;
    if (file.endsWith(".timer")) systemctl(["disable", "--now", file], { allowFailure: true });
    rmSync(join(unitDir, file), { force: true });
  }
  systemctl(["daemon-reload"]);
  if (timers.length === 0) return;
  const names = timers.map((entry) => entry.timer);
  systemctl(["enable", ...names]);
  systemctl(["restart", ...names]);
}

/** rigd writes its own units. Like the `rig` CLI, it runs from the tooling checkout, never the deployed ref. */
export function rigdScheduleCommand(nodeBin = process.execPath, root = TOOLING_ROOT, target = ["--install"]) {
  return { command: nodeBin, args: [join(root, "tools", "rig", "rigd", "src", "cli.ts"), "schedule", ...target] };
}

/**
 * rigd's schedule built into a scratch folder and thrown away, before
 * anything changes: a rigd that cannot load from this checkout (its packages
 * not installed there), or that lacks what its schedule reads, refuses the
 * deploy here rather than after the services were stopped.
 */
export function checkRigdSchedule({ nodeBin = process.execPath, runner = run } = {}) {
  const out = mkdtempSync(join(tmpdir(), "rig-rigd-schedule-"));
  try {
    const { command, args } = rigdScheduleCommand(nodeBin, TOOLING_ROOT, ["--out", out]);
    runner(command, args);
  } catch (error) {
    throw new Error(
      `rig deploy: rigd cannot build its schedule from ${TOOLING_ROOT}, so nothing was changed ` +
        `(run pnpm install there if its packages are missing): ${error.message}`,
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/**
 * Nothing keeps running against a schema it was not built for, even if the
 * migration fails half way. The hold goes down first: rigd's hourly schedule
 * refresh would otherwise start the stopped timers again mid-migration.
 */
export function stopForSchemaChange({ state, sha, ref, systemctl = systemctlUser, log }) {
  holdForDeploy(state, { sha, ref });
  systemctl(["stop", ...SCHEMA_CHANGE_STOPS]);
  log("services stopped for the schema change");
}

/**
 * The ref's cron timers, the services, then rigd's timers. rigd's come after
 * the restart, so a failure there leaves the new SHA serving, and a run its
 * timers catch up on (they are Persistent) finds the API up. rigd's
 * systemctl calls need the user manager's runtime directory as much as the
 * CLI's own do. The deploy hold is released only once all of it worked, so
 * after a failure rigd leaves the timers as this left them.
 */
export function activate({
  timers,
  sha,
  state,
  nodeBin = process.execPath,
  log,
  unitDir = join(homedir(), ".config", "systemd", "user"),
  systemctl = systemctlUser,
  runner = run,
}) {
  installCronTimers({ timers, nodeBin, unitDir, systemctl });
  log(`crons: ${timers.length} timer(s)`);
  systemctl(["restart", ...SERVICE_UNITS], { inherit: true });
  log(`services restarted: ${SERVICE_UNITS.join(", ")}`);
  const { command, args } = rigdScheduleCommand(nodeBin);
  let stdout;
  try {
    ({ stdout } = runner(command, args, { env: userManagerEnv() }));
  } catch (error) {
    throw new Error(
      `rig deploy: ${sha} is deployed and its services restarted, but rigd's schedule install failed, so ` +
        `its scenario timers stay as the last install left them (stopped, after a schema change) until ` +
        `"node tools/rig/rigd/src/cli.ts schedule --install" succeeds: ${error.message}`,
    );
  }
  let installed = null;
  try {
    installed = JSON.parse(stdout);
  } catch {
    // The units are in place once it exits 0; the count is only for the log.
  }
  log(
    Array.isArray(installed?.timed)
      ? `rigd: ${installed.timed.length} scenario timer(s), ${installed.not_timed?.length ?? 0} scenario(s) not timed`
      : "rigd: scenario timers installed",
  );
  if (readDeployHold(state) !== null) {
    releaseDeployHold(state);
    log(`deploy hold released: ${sha} serves, and rigd may start its timers again`);
  }
}

/**
 * Whether the database holds every row the seed writes, as TENANTS and the
 * partition say now, whoever reset it last. A number the 15-minute sweep
 * cannot find is flagged on every run until the seed runs.
 */
function seedIsCurrent(projectId, store, standing) {
  if (!store.has("tenants.json")) return false;
  const sql = seedGapsSql({ ids: store.readJson("tenants.json"), standing });
  return sql !== null && Number(psql(projectId, sql).trim()) === 0;
}

function pointCurrent(layout, root) {
  try {
    unlinkSync(layout.current);
  } catch {
    // first deploy
  }
  symlinkSync(root, layout.current, process.platform === "win32" ? "junction" : "dir");
}

function pruneWorktrees(layout, keep, active) {
  if (!existsSync(layout.worktrees)) return;
  const history = existsSync(join(layout.state, "history.json")) ? JSON.parse(readFileSync(join(layout.state, "history.json"), "utf8")) : [];
  const recent = new Set([active, ...history.slice(-keep).map((entry) => entry.worktree)]);
  for (const entry of readdirSync(layout.worktrees)) {
    const path = join(layout.worktrees, entry);
    if (!recent.has(path)) run("git", ["-C", TOOLING_ROOT, "worktree", "remove", "--force", path], { allowFailure: true });
  }
}

/**
 * Every derived file's content. Every refusal (an untaught config key, a live
 * or missing secret, a missing or unreadable cron registry) happens here,
 * before the database or a service changes.
 */
function deriveAll({ root, sha, layout, settings, store, status, partition, endpoints, edge, timersWanted, log }) {
  const apiDir = join(root, "apps", "api");
  const apiConfig = parseJsonc(readFileSync(join(apiDir, "wrangler.jsonc"), "utf8"));
  const crons = apiConfig.triggers?.crons ?? [];
  const cronPlan = timersWanted ? cronsToSchedule(crons, readCronRegistry()) : null;
  if (cronPlan && cronPlan.unclassified.length > 0) {
    log(`crons: no timer for ${cronPlan.unclassified.length} cron(s) tools/rig/crons.json does not classify (rig health fails on them): ${cronPlan.unclassified.join(" | ")}`);
  }

  const stripeSecretKey = stripeSandboxKey(store);
  const template = readFileSync(join(TOOLING_ROOT, "tools", "rig", "templates", "api.dev.vars.rig"), "utf8");
  const vapid = store.ensureJson("vapid.json", generateVapidPair);
  const devVars = renderDevVars(template, {
    store,
    catalog: ensureStripeCatalog({ store, required: requiredCatalogKeys(template), log }),
    partition,
    edge,
    rig: settings,
    supabase: status,
    deploy: { sha },
    derived: {
      fcmServiceAccount: dummyServiceAccount(firebaseProjectId(store)),
      stripeSecretKey,
      stripeWebhookSecret: stripeWebhookSecret(store),
      sentryDsn: relayDsn(store.read("sentry-dsn-rig"), settings.sentryRelayOrigin),
      vapidPublicKey: vapid.publicKey,
      vapidPrivateKey: vapid.privateKey,
      rigOwnedE164: endpoints.join(","),
    },
  });

  const files = [
    {
      path: join(apiDir, "wrangler.rig.jsonc"),
      content: renderRigConfig(deriveRigConfig(apiConfig, { port: settings.apiPort, aiShim: true }), { source: "apps/api/wrangler.jsonc", sha }),
    },
    { path: join(apiDir, ".dev.vars.rig"), content: devVars, mode: 0o600 },
    {
      path: join(layout.aiShimDir, "wrangler.jsonc"),
      content: `${JSON.stringify(
        aiShimConfig({
          main: join(TOOLING_ROOT, "tools", "rig", "ai-shim", "src", "index.mjs").replace(/\\/g, "/"),
          compatibilityDate: apiConfig.compatibility_date,
          guardAiUrl: seams(edge).guardAiUrl,
        }),
        null,
        2,
      )}\n`,
    },
    { path: join(layout.aiShimDir, ".dev.vars.rig"), content: `GUARD_TOKEN=${store.read("guard-token-rig-api")}\n`, mode: 0o600 },
  ];
  return { files, cronPlan };
}

function writeDerived(files) {
  for (const { path, content, mode } of files) {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, mode === undefined ? undefined : { mode });
  }
}

/**
 * @param {{ layout, settings, store, ref?: string, worktree?: string, options: object, log: (line: string) => void }} args
 */
export async function deploy({ layout, settings, store, ref, worktree, options, log }) {
  const restart = settings.systemd && !options.noRestart;
  if (restart) {
    requireUserManager();
    checkRigdSchedule();
  }

  let root;
  let sha;
  if (worktree) {
    root = resolve(worktree);
    sha = git(["rev-parse", "HEAD"], root);
  } else {
    if (!ref) throw new Error("rig deploy: --ref or --worktree is required");
    if (!options.offline) run("git", ["-C", TOOLING_ROOT, "fetch", "--tags", "--prune", "--quiet", "origin"], { inherit: true });
    sha = resolveSha(ref);
    root = join(layout.worktrees, sha);
    excludeDerivedFiles();
    if (!existsSync(root)) {
      mkdirSync(layout.worktrees, { recursive: true });
      run("git", ["-C", TOOLING_ROOT, "worktree", "add", "--detach", root, sha], { inherit: true });
    }
    if (!options.skipInstall) {
      run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], { cwd: root, inherit: true });
    }
  }
  log(`deploy: ${ref ?? root} at ${sha}`);
  const previous = existsSync(join(layout.state, "deployed.json")) ? JSON.parse(readFileSync(join(layout.state, "deployed.json"), "utf8")) : null;

  const partition = await fetchPartition(store);
  const standing = standingNumbers(partition, store);
  const endpoints = rigEndpoints(standing);
  const edge = edgeOrigin(store);

  const committedConfig = readFileSync(join(root, "supabase", "config.toml"), "utf8");
  const configText = deriveSupabaseConfig(committedConfig, {
    supabaseUrl: settings.supabaseUrl === CLI_API_URL ? undefined : settings.supabaseUrl,
    appOrigin: settings.appOrigin,
    totp: true,
  });
  const signingKeys = store.ensureJson("supabase-signing-keys.json", generateSigningKeys);
  const projectId = projectIdOf(configText);
  const workdir = layout.supabaseWorkdir;
  buildSupabaseWorkdir({ refRoot: root, workdir, configText, signingKeys });
  await ensureStack({ workdir, configHash: hash(configText, signingKeys[0].kid), kid: signingKeys[0].kid, state: layout.state, log });
  const status = localStatus(workdir);
  if (status === null) throw new Error("rig deploy: the stack is not answering after start");

  const { files, cronPlan } = deriveAll({
    root,
    sha,
    layout,
    settings,
    store,
    status,
    partition,
    endpoints,
    edge,
    timersWanted: restart,
    log,
  });
  if (!options.skipWeb) files.push(buildWeb({ root, sha, settings, status, log }));
  log("config: wrangler.rig.jsonc, .dev.vars.rig and the AI shim derived");

  const plan = options.reset
    ? { action: "reset", reason: "--reset" }
    : schemaPlan(appliedMigrationVersions(projectId), refMigrationVersions(root));
  log(`schema: ${plan.action} (${plan.reason})`);
  if (restart && plan.action !== "none") stopForSchemaChange({ state: layout.state, sha, ref, log });
  if (plan.action === "migrate") {
    try {
      supabase(["migration", "up", "--local"], { workdir, inherit: true });
    } catch (error) {
      // 2.109.1 has exited non-zero ("Failed to acquire connection") after
      // applying every file. The history is what decides, not the exit code.
      if (schemaPlan(appliedMigrationVersions(projectId), refMigrationVersions(root)).action !== "none") throw error;
      log("schema: migration up exited non-zero, but the history now matches the ref");
    }
  }
  if (plan.action === "reset") supabase(["db", "reset", "--local"], { workdir, inherit: true });

  await bootstrapDb({ projectId, status, endpoints, preSeam: options.preSeam === true, log });
  if (plan.action === "reset" || options.reseed || !seedIsCurrent(projectId, store, standing)) {
    await seed({ workdir, store, partition, log });
  }
  if (recordStanding(store, standing)) log("store: standing-numbers.json rewritten from the partition");

  writeDerived(files);
  const timers = restart ? cronTimers(cronPlan.schedule) : (previous?.timers ?? []);
  const record = {
    sha,
    ref: ref ?? null,
    worktree: root,
    at: new Date().toISOString(),
    schema: plan.action,
    timers: timers.map(({ cron, timer }) => ({ cron, timer })),
  };
  // Written before the restart, because the units start whatever it names;
  // `rig health` compares it with state/serving-<service>.json.
  mkdirSync(layout.state, { recursive: true });
  writeFileSync(join(layout.state, "deployed.json"), `${JSON.stringify(record, null, 2)}\n`);
  const historyPath = join(layout.state, "history.json");
  const history = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, "utf8")) : [];
  writeFileSync(historyPath, `${JSON.stringify([...history, record].slice(-50), null, 2)}\n`);
  pointCurrent(layout, root);

  if (restart) {
    activate({ timers, sha, state: layout.state, log });
  } else if (settings.systemd) {
    log(`--no-restart: the services and timers still run ${previous?.sha ?? "what they ran"} until restarted, and rig health fails until then`);
  }
  if (!worktree) pruneWorktrees(layout, settings.keepWorktrees, root);
  log(`deployed ${sha}`);
  return record;
}
