/**
 * The `rig` command. Every command is a function of its
 * arguments and the environment, so tests import `main` instead of spawning.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { APK_DIR, buildApk } from "./apk.mjs";
import { bootstrapDb } from "./bootstrap-db.mjs";
import { fireCron, scheduledMinute } from "./cron.mjs";
import { deploy, resolveSha, STACK_EXCLUDES } from "./deploy.mjs";
import { fetchPartition, recordStanding, rigEndpoints, standingNumbers } from "./guard.mjs";
import { runHealth } from "./health.mjs";
import { rigLayout, rigSettings, TOOLING_ROOT } from "./layout.mjs";
import { secretStore } from "./secrets.mjs";
import { serve } from "./serve.mjs";
import { projectIdOf } from "./supabase-config.mjs";
import { localStatus, supabase } from "./supabase.mjs";
import { run } from "./exec.mjs";
import { seed } from "../../../scripts/rig/seed.mjs";

export const USAGE = `rig <command>

  deploy --ref <tag|branch|sha>   worktree, install, derive, migrate or reset+reseed, restart
         --worktree <path>        deploy a checkout in place instead of a ref
         [--reset] [--reseed] [--pre-seam] [--skip-install] [--skip-web]
         [--no-restart] [--offline]
  bootstrap-db [--pre-seam]       rig settings on the database, pools restarted, posture proved
  seed                            the tenants, numbers from the guard, audiences at rest
  cron <expr> [--time <ms>]       fire one cron on the local API
  health [--only a,b] [--json]    R00's checks that boot no emulator
  apk --ref <ref> | --worktree <path> [--debuggable]
                                  build the nonprod APK; refuse any other package;
                                  place a release-style build as work/apk/current.apk
  serve api|web|stripe            run a service in the foreground (what the units run)
  stack up                        start the stack from the derived config; bootstrap if unready
`;

const BOOLEAN_FLAGS = new Set([
  "reset",
  "reseed",
  "pre-seam",
  "skip-install",
  "skip-web",
  "no-restart",
  "offline",
  "json",
  "debuggable",
  "help",
]);

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (BOOLEAN_FLAGS.has(name)) flags[name] = inline === undefined ? true : inline !== "false";
    else {
      const value = inline ?? argv[(i += 1)];
      if (value === undefined) throw new Error(`rig: --${name} needs a value`);
      flags[name] = value;
    }
  }
  return { positional, flags };
}

function deployed(layout) {
  const path = join(layout.state, "deployed.json");
  if (!existsSync(path)) throw new Error("rig: nothing is deployed yet; run rig deploy first");
  return JSON.parse(readFileSync(path, "utf8"));
}

function projectIdFor(layout) {
  return projectIdOf(readFileSync(join(layout.supabaseWorkdir, "supabase", "config.toml"), "utf8"));
}

function requireStatus(layout) {
  const status = localStatus(layout.supabaseWorkdir);
  if (status === null) throw new Error("rig: the local stack is not running; run rig stack up");
  return status;
}

async function endpointsFromGuard(store) {
  const partition = await fetchPartition(store);
  const standing = standingNumbers(partition, store);
  recordStanding(store, standing);
  return { partition, endpoints: rigEndpoints(standing) };
}

/** Everything the checks need; when any of it is missing, every check reports why. */
function healthContext(env) {
  const layout = rigLayout(env);
  const context = { layout, deployed: null };
  try {
    context.settings = rigSettings(layout);
    context.store = secretStore(layout.secrets);
    context.deployed = deployed(layout);
    context.status = requireStatus(layout);
    context.projectId = projectIdFor(layout);
  } catch (error) {
    context.unavailable = error instanceof Error ? error.message : String(error);
  }
  return context;
}

/**
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, { env = process.env, log = console.log } = {}) {
  const { positional, flags } = parseArgs(argv);
  const [command, ...rest] = positional;
  if (!command || flags.help) {
    log(USAGE);
    return command ? 0 : 2;
  }

  if (command === "health") {
    const report = await runHealth(healthContext(env), typeof flags.only === "string" ? flags.only.split(",") : undefined);
    if (flags.json) log(JSON.stringify(report, null, 2));
    else {
      for (const result of report.results) log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.reason ? `  ${result.reason}` : ""}`);
      if (report.room !== undefined) log(`room: ${report.room}`);
    }
    return report.results.every((result) => result.pass) ? 0 : 1;
  }

  const layout = rigLayout(env);
  const settings = rigSettings(layout);
  const store = secretStore(layout.secrets);

  switch (command) {
    case "deploy": {
      await deploy({
        layout,
        settings,
        store,
        ref: flags.ref,
        worktree: flags.worktree,
        options: {
          reset: flags.reset === true,
          reseed: flags.reseed === true,
          preSeam: flags["pre-seam"] === true,
          skipInstall: flags["skip-install"] === true,
          skipWeb: flags["skip-web"] === true,
          noRestart: flags["no-restart"] === true,
          offline: flags.offline === true,
        },
        log,
      });
      return 0;
    }

    case "bootstrap-db": {
      const { endpoints } = await endpointsFromGuard(store);
      await bootstrapDb({
        projectId: projectIdFor(layout),
        status: requireStatus(layout),
        endpoints,
        preSeam: flags["pre-seam"] === true,
        log,
      });
      return 0;
    }

    case "seed": {
      await seed({ workdir: layout.supabaseWorkdir, store, log });
      return 0;
    }

    case "cron": {
      const [cron] = rest;
      if (!cron) throw new Error("rig cron: give the cron expression, quoted");
      const time = flags.time === undefined ? scheduledMinute() : Number(flags.time);
      if (!Number.isSafeInteger(time) || time < 0) throw new Error("rig cron: --time is milliseconds since the epoch");
      const result = await fireCron(`http://127.0.0.1:${settings.apiPort}`, cron, time);
      log(`cron "${cron}" at ${new Date(time).toISOString()} via ${result.route}: ${result.status}`);
      if (!result.timeHonored && flags.time !== undefined) {
        log(`rig cron: ${result.route} ignores --time; the job ran at the wall clock`);
      }
      if (result.status >= 400 && result.body) log(result.body.slice(0, 2_000));
      return result.status < 400 ? 0 : 1;
    }

    case "apk": {
      let root;
      let sha;
      if (flags.worktree) {
        root = flags.worktree;
        sha = run("git", ["-C", root, "rev-parse", "HEAD"]).stdout.trim();
      } else {
        if (!flags.ref) throw new Error("rig apk: --ref or --worktree is required");
        sha = resolveSha(flags.ref);
        root = join(layout.worktrees, `apk-${sha}`);
        if (!existsSync(root)) run("git", ["-C", TOOLING_ROOT, "worktree", "add", "--detach", root, sha], { inherit: true });
      }
      buildApk({
        root,
        settings,
        store,
        publishableKey: requireStatus(layout).publishableKey,
        debuggable: Boolean(flags.debuggable),
        worktree: Boolean(flags.worktree),
        dir: join(layout.work, APK_DIR),
        sha,
        log,
      });
      return 0;
    }

    case "serve": {
      const [service] = rest;
      const root = flags.worktree ?? deployed(layout).worktree;
      return serve(service, { root, layout, settings, store });
    }

    case "stack": {
      if (rest[0] !== "up") throw new Error("rig stack: only `rig stack up`");
      if (localStatus(layout.supabaseWorkdir) === null) {
        supabase(["start", "-x", STACK_EXCLUDES.join(",")], { workdir: layout.supabaseWorkdir, inherit: true });
      }
      const status = requireStatus(layout);
      const posture = await fetch(`${status.apiUrl}/rest/v1/rpc/rig_database_posture`, {
        method: "POST",
        headers: { apikey: status.secretKey, authorization: `Bearer ${status.secretKey}`, "content-type": "application/json" },
        body: "{}",
      })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      if (posture?.deploy_env === "rig" && posture.endpoints > 0) {
        log("stack: up, database in rig posture");
        return 0;
      }
      const { endpoints } = await endpointsFromGuard(store);
      await bootstrapDb({ projectId: projectIdFor(layout), status, endpoints, log });
      return 0;
    }

    default:
      log(USAGE);
      return 2;
  }
}
