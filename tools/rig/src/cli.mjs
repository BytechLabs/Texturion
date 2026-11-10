/**
 * The `rig` command. Every command is a function of its
 * arguments and the environment, so tests import `main` instead of spawning.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { APK_DIR, buildApk } from "./apk.mjs";
import { bootstrapDb } from "./bootstrap-db.mjs";
import { fireCron, readCronRegistry, resolveCron, scheduledMinute } from "./cron.mjs";
import { deploy, resolveSha, STACK_EXCLUDES } from "./deploy.mjs";
import { fetchPartition, recordStanding, rigEndpoints, standingNumbers } from "./guard.mjs";
import { runHealth } from "./health.mjs";
import { rigLayout, rigSettings, TOOLING_ROOT } from "./layout.mjs";
import { runCommand } from "./run.mjs";
import { secretStore } from "./secrets.mjs";
import { serve } from "./serve.mjs";
import { projectIdOf } from "./supabase-config.mjs";
import { localStatus, supabase, waitForStack } from "./supabase.mjs";
import { run, userManagerEnv } from "./exec.mjs";
import { waitForStackUnit } from "./stack-unit.mjs";
import { seed } from "../../../scripts/rig/seed.mjs";

export const USAGE = `rig <command>

The rig runs nothing on a timer. Every command below is something you ask for.

  deploy --ref <tag|branch|sha>   worktree, install, derive, migrate or reset+reseed, restart
         --worktree <path>        deploy a checkout in place instead of a ref
         [--reset] [--reseed] [--pre-seam] [--skip-install] [--skip-web]
         [--no-restart] [--offline]
  bootstrap-db [--pre-seam]       rig settings on the database, pools restarted, posture proved
  seed                            the tenants, numbers from the guard, audiences at rest
  run <scenario>[-<variant>] [--run-id <id>]
                                  one scenario run: the guard lease, the judging, the verdict
  verdicts [--unresolved]         the verdict store: the last 50 runs, or what still fails
  budget                          the dials spent today and this hour against the caps
  secrets                         fetch the edge's sealed bundle into the secret store now
  calibrate --surface <s> --wav <file> [--own <s>]
                                  measure one surface's tone margin from a recording
  cron <expr|job:name> [--time <ms>]
                                  fire one cron on the local API
  health [--only a,b] [--json]    R00's checks that boot no emulator
  apk --ref <ref> | --worktree <path> [--debuggable]
                                  build the nonprod APK; refuse any other package;
                                  place a release-style build as work/apk/current.apk
  serve api|web|stripe            run a service in the foreground (what the units run)
  stack up                        start the stack from the derived config; bootstrap if unready
  stack wait                      wait until the stack unit is up (what the API and web units run first)
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
  "unresolved",
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

  // Needs neither the secret store nor a deployed ref: the units run it first.
  if (command === "stack" && rest[0] === "wait") {
    await waitForStackUnit({ log });
    return 0;
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

    case "run": {
      const [instance] = rest;
      if (!instance) throw new Error("rig run: give the scenario, like S20, D02p or S25-2");
      const { command: file, args, env: extra } = runCommand({
        instance,
        runId: typeof flags["run-id"] === "string" ? flags["run-id"] : undefined,
        layout,
        systemd: settings.systemd,
      });
      const result = spawnSync(file, args, { stdio: "inherit", env: userManagerEnv({ ...process.env, ...extra }) });
      if (result.error) throw new Error(`rig run: ${file} did not start: ${result.error.code ?? result.error.message}`);
      return result.status ?? 1;
    }

    case "verdicts":
    case "budget":
    case "secrets":
    case "calibrate": {
      const options = Object.entries(flags).flatMap(([name, value]) => (value === true ? [`--${name}`] : [`--${name}`, String(value)]));
      const cli = join(TOOLING_ROOT, "tools", "rig", "rigd", "src", "cli.ts");
      const result = spawnSync(process.execPath, [cli, command, ...options], {
        stdio: "inherit",
        env: { ...process.env, RIG_HOME: layout.home },
      });
      if (result.error) throw new Error(`rig ${command}: rigd's cli did not start: ${result.error.code ?? result.error.message}`);
      return result.status ?? 1;
    }

    case "cron": {
      const [arg] = rest;
      if (!arg) throw new Error("rig cron: give the cron expression, quoted, or job:<name>");
      const cron = resolveCron(arg, readCronRegistry());
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
      if (rest[0] !== "up") throw new Error("rig stack: only `rig stack up` and `rig stack wait`");
      // Docker restarts the containers when the VM boots; `supabase start` refuses them until they are healthy.
      await waitForStack(projectIdFor(layout), { log });
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
