/**
 * `rig deploy --ref <tag|branch|sha>`:
 *   1. a git worktree of the ref, with its dependencies installed;
 *   2. the local database migrated, or reset and reseeded when the ref's
 *      schema cannot be reached by migrating;
 *   3. the configuration derived from the ref's own files;
 *   4. the services restarted, and the SHA recorded for every verdict.
 *
 * `--worktree <path>` deploys a checkout in place instead, for a branch an
 * agent is working on; nothing is fetched, created or installed.
 */
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { bootstrapDb } from "./bootstrap-db.mjs";
import { cronUnits, cronsToSchedule, readCronRegistry } from "./cron.mjs";
import { dummyServiceAccount, generateVapidPair, relayDsn, renderDevVars, seams } from "./dev-vars.mjs";
import { run } from "./exec.mjs";
import { edgeOrigin, fetchPartition, rigEndpoints, standingNumbers } from "./guard.mjs";
import { TOOLING_ROOT } from "./layout.mjs";
import { parseJsonc } from "./jsonc.mjs";
import {
  buildSupabaseWorkdir,
  deriveSupabaseConfig,
  generateSigningKeys,
  projectIdOf,
} from "./supabase-config.mjs";
import { appliedMigrationVersions, localStatus, psql, refMigrationVersions, schemaPlan, supabase } from "./supabase.mjs";
import { aiShimConfig, deriveRigConfig, renderRigConfig } from "./wrangler-config.mjs";
import { seed } from "../../../scripts/rig/seed.mjs";

/** The CLI's own address for its stack; anything else is set as the issuer. */
const CLI_API_URL = "http://127.0.0.1:54321";

/** Services the stack does not need on the rig. */
export const STACK_EXCLUDES = ["vector", "logflare", "imgproxy", "edge-runtime"];

/** User-level units (`loginctl enable-linger`), so deploy needs no root. */
export const SERVICE_UNITS = ["loonext-rig-api.service", "loonext-rig-web.service", "loonext-rig-stripe-listen.service"];

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

function buildWeb({ root, sha, settings, status, log }) {
  const web = join(root, "apps", "web");
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
  const derived = deriveRigConfig(parseJsonc(readFileSync(join(web, "wrangler.jsonc"), "utf8")), { port: settings.webPort });
  writeFileSync(join(web, "wrangler.rig.jsonc"), renderRigConfig(derived, { source: "apps/web/wrangler.jsonc", sha }));
}

/**
 * The ref's crons as user timers. Stale ones are removed first, so a cron a
 * release dropped stops firing.
 */
function writeCronTimers({ root, nodeBin, log }) {
  const unitDir = join(homedir(), ".config", "systemd", "user");
  mkdirSync(unitDir, { recursive: true });
  for (const file of readdirSync(unitDir)) {
    if (file.startsWith("loonext-rig-cron-")) {
      run("systemctl", ["--user", "disable", "--now", file], { allowFailure: true });
      rmSync(join(unitDir, file), { force: true });
    }
  }
  const crons = parseJsonc(readFileSync(join(root, "apps", "api", "wrangler.jsonc"), "utf8")).triggers?.crons ?? [];
  const { schedule, unclassified } = cronsToSchedule(crons, readCronRegistry() ?? []);
  if (unclassified.length > 0) log(`crons: no timer for ${unclassified.length} cron(s) tools/rig/crons.json does not classify: ${unclassified.join(" | ")}`);
  schedule.forEach((cron, index) => {
    const slug = `c${String(index).padStart(2, "0")}`;
    const units = cronUnits({ cron, slug, node: nodeBin, rigBin: join(TOOLING_ROOT, "tools", "rig", "bin", "rig.mjs") });
    writeFileSync(join(unitDir, `loonext-rig-cron-${slug}.service`), units.service);
    writeFileSync(join(unitDir, `loonext-rig-cron-${slug}.timer`), units.timer);
  });
  run("systemctl", ["--user", "daemon-reload"]);
  schedule.forEach((_, index) => run("systemctl", ["--user", "enable", "--now", `loonext-rig-cron-c${String(index).padStart(2, "0")}.timer`]));
  log(`crons: ${schedule.length} timer(s)`);
}

/** Whether every tenant in the store has its company row, whoever reset the database last. */
function tenantsPresent(projectId, store) {
  if (!store.has("tenants.json")) return false;
  const ids = Object.values(store.readJson("tenants.json")).map((tenant) => tenant.company_id);
  if (ids.some((id) => !/^[0-9a-f-]{36}$/.test(id ?? ""))) return false;
  const found = psql(projectId, `select count(*) from public.companies where id in (${ids.map((id) => `'${id}'`).join(", ")});`);
  return Number(found.trim()) === ids.length;
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
 * @param {{ layout, settings, store, ref?: string, worktree?: string, options: object, log: (line: string) => void }} args
 */
export async function deploy({ layout, settings, store, ref, worktree, options, log }) {
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

  const partition = await fetchPartition(store);
  const standing = standingNumbers(partition, store);
  const endpoints = rigEndpoints(partition, standing);
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

  const plan = options.reset
    ? { action: "reset", reason: "--reset" }
    : schemaPlan(appliedMigrationVersions(projectId), refMigrationVersions(root));
  log(`schema: ${plan.action} (${plan.reason})`);
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

  const status = localStatus(workdir);
  if (status === null) throw new Error("rig deploy: the stack is not answering after start");
  await bootstrapDb({ projectId, status, endpoints, preSeam: options.preSeam === true, log });
  if (plan.action === "reset" || options.reseed || !tenantsPresent(projectId, store)) {
    await seed({ workdir, store, partition, log });
  }

  const apiDir = join(root, "apps", "api");
  const apiConfig = parseJsonc(readFileSync(join(apiDir, "wrangler.jsonc"), "utf8"));
  writeFileSync(
    join(apiDir, "wrangler.rig.jsonc"),
    renderRigConfig(deriveRigConfig(apiConfig, { port: settings.apiPort, aiShim: true }), { source: "apps/api/wrangler.jsonc", sha }),
  );
  const vapid = store.ensureJson("vapid.json", generateVapidPair);
  const stripeWebhookSecret =
    store.readOptional("stripe-webhook-secret") ??
    run("stripe", ["listen", "--print-secret"], { env: { STRIPE_API_KEY: store.read("stripe-secret-key") } }).stdout.trim();
  const devVars = renderDevVars(readFileSync(join(TOOLING_ROOT, "tools", "rig", "templates", "api.dev.vars.rig"), "utf8"), {
    store,
    catalog: store.readJson("stripe-catalog.json"),
    partition,
    edge,
    rig: settings,
    supabase: status,
    deploy: { sha },
    derived: {
      fcmServiceAccount: dummyServiceAccount(store.read("firebase-project-id")),
      stripeWebhookSecret,
      sentryDsn: relayDsn(store.read("sentry-dsn-rig"), settings.sentryRelayOrigin),
      vapidPublicKey: vapid.publicKey,
      vapidPrivateKey: vapid.privateKey,
      rigOwnedE164: endpoints.join(","),
    },
  });
  writeFileSync(join(apiDir, ".dev.vars.rig"), devVars, { mode: 0o600 });

  mkdirSync(layout.aiShimDir, { recursive: true });
  writeFileSync(
    join(layout.aiShimDir, "wrangler.jsonc"),
    `${JSON.stringify(
      aiShimConfig({
        main: join(TOOLING_ROOT, "tools", "rig", "ai-shim", "src", "index.mjs").replace(/\\/g, "/"),
        compatibilityDate: apiConfig.compatibility_date,
        guardAiUrl: seams(edge).guardAiUrl,
      }),
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(layout.aiShimDir, ".dev.vars.rig"), `GUARD_TOKEN=${store.read("guard-token-rig-api")}\n`, { mode: 0o600 });
  log("config: wrangler.rig.jsonc, .dev.vars.rig and the AI shim derived");

  if (!options.skipWeb) buildWeb({ root, sha, settings, status, log });

  const record = { sha, ref: ref ?? null, worktree: root, at: new Date().toISOString(), schema: plan.action };
  mkdirSync(layout.state, { recursive: true });
  writeFileSync(join(layout.state, "deployed.json"), `${JSON.stringify(record, null, 2)}\n`);
  const historyPath = join(layout.state, "history.json");
  const history = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, "utf8")) : [];
  writeFileSync(historyPath, `${JSON.stringify([...history, record].slice(-50), null, 2)}\n`);
  pointCurrent(layout, root);

  if (settings.systemd && !options.noRestart) {
    writeCronTimers({ root, nodeBin: process.execPath, log });
    run("systemctl", ["--user", "restart", ...SERVICE_UNITS], { inherit: true });
    log(`services restarted: ${SERVICE_UNITS.join(", ")}`);
  }
  if (!worktree) pruneWorktrees(layout, settings.keepWorktrees, root);
  log(`deployed ${sha}`);
  return record;
}
