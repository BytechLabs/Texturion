/**
 * The long-running half of rigd: the uplink, the lease watchdog, secret
 * delivery and the rpc commands. It starts no scenario by itself: runs are
 * separate processes that someone asks for (`rig run`, or `triage.rerun`
 * through the rpc), each in its own process or systemd unit, so a run that
 * crashes takes nothing else down and a restart of rigd takes no run with it.
 * It judges nothing on a timer either: the local API's exceptions and the
 * guard's version are read when `rig health` asks (api-exceptions.ts,
 * guard-attest.ts).
 *
 * It publishes state/uplink.json, { connected, at }, at least every minute,
 * which `rig health` reads (tools/rig/src/health.mjs).
 */
import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { triageMethods, type StartedRun } from "@loonext/rig-triage";
import type { RigdConfig } from "./config.ts";
import { webhookForwarder, type ForwardTargets } from "./forward.ts";
import { parseInstance } from "./registry.ts";
import { telnyxPublicKey } from "./late.ts";
import { LeaseWatchdog } from "./lease.ts";
import { Mailbox } from "./mail.ts";
import { mediaRelay } from "./media.ts";
import { isRobotRole, localSupabase, publishState, robotLocalToken } from "@loonext/rig-robot";
import { objectParams, RpcRouter } from "./rpc.ts";
import { newRunId } from "./runner.ts";
import { BUNDLE_KEY_SECRET, deliverSecrets } from "./secrets.ts";
import { infraFingerprint } from "./posthog-errors.ts";
import { Uplink } from "./uplink.ts";
import { buildRig, type Rig } from "./wiring.ts";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));
const UPLINK_STATE_MS = 60_000;
const SECRET_REFRESH_MS = 6 * 60 * 60_000;

export interface Daemon {
  uplink: Uplink;
  watchdog: LeaseWatchdog;
  router: RpcRouter;
  stop(): void;
}

export interface RunStarter {
  (scenario: string): StartedRun;
}

/**
 * Starts a scenario run in its own process and returns at once; its verdicts
 * land in the store under the run id it returns. Under systemd the run gets a
 * transient unit of its own, so it outlives a restart of rigd and logs to the
 * journal; elsewhere it is a detached child that logs to state/rigd/runs.
 */
export function runStarter(config: Pick<RigdConfig, "home" | "systemd">, launch = spawn): RunStarter {
  return (scenario) => {
    const { id } = parseInstance(scenario);
    const runId = newRunId(id, Date.now());
    const args = [CLI, "run", scenario, "--run-id", runId];
    if (config.systemd) {
      const path = [...new Set([dirname(process.execPath), "/usr/local/bin", "/usr/bin", "/bin"])].join(":");
      launch(
        "systemd-run",
        [
          "--user",
          `--unit=loonext-rig-rerun-${runId}`,
          "--collect",
          "--quiet",
          "--service-type=exec",
          "--property=TimeoutStopSec=10min",
          `--setenv=RIG_HOME=${config.home.home}`,
          `--setenv=PATH=${path}`,
          process.execPath,
          ...args,
        ],
        { stdio: "ignore" },
      ).unref();
    } else {
      const logs = join(config.home.state, "rigd", "runs");
      mkdirSync(logs, { recursive: true });
      const out = openSync(join(logs, `${runId}.log`), "a");
      launch(process.execPath, args, { detached: true, stdio: ["ignore", out, out] }).unref();
    }
    return { started: true, scenario: id, run_id: runId };
  };
}

export function buildRouter(rig: Rig, run: RunStarter = runStarter(rig.config)): RpcRouter {
  const router = new RpcRouter();
  router.register(
    "rig.status",
    () => ({
      unresolved: rig.verdicts.unresolved().length,
      registry: [...rig.registry().byId.keys()],
      late_deliveries_24h: rig.late.since(Date.now() - 86_400_000).length,
    }),
    ["triage", "rig"],
  );
  router.register("scenario.run", (params) => {
    const { scenario } = objectParams(params);
    if (typeof scenario !== "string" || !rig.registry().byId.has(scenario)) throw new Error("scenario.run takes a registered { scenario }");
    return run(scenario);
  });
  const { store } = rig.config;
  const methods = triageMethods({
    unresolved: () => rig.verdicts.unresolved(),
    run: async (scenario) => run(scenario),
    evidence: (runId) => ({ verdicts: rig.verdicts.forRun(runId), evidence: rig.verdicts.evidence(runId) }),
    app: () => ({ appId: store.read("rig-app-id"), privateKey: store.read("rig-app-key"), repo: rig.config.repo }),
  });
  for (const [name, handler] of Object.entries(methods)) router.register(name, handler, ["triage", "rig"]);
  return router;
}

/** Where the uplink's webhook frames go, with the call-event fault S17 arms. */
export function forwardTargets(rig: Pick<Rig, "config" | "numbers" | "faults" | "late">, log: (line: string) => void): ForwardTargets {
  const { store } = rig.config;
  return {
    apiBase: rig.config.localApiBase,
    robotBase: rig.config.robotBase,
    robotToken: robotLocalToken(store),
    robotNumber: (e164) => {
      try {
        return isRobotRole(rig.numbers().role(e164));
      } catch {
        return false;
      }
    },
    telnyxKey: () => {
      const key = store.readOptional("telnyx-public-key");
      return key ? telnyxPublicKey(key) : undefined;
    },
    takeFault: () => rig.faults.take(),
    onLate: (entry) => {
      rig.late.record(entry);
      log(`a genuine text reached the API ${entry.age_s} s after Telnyx signed it; recorded as a late delivery`);
    },
  };
}

export function startDaemon(config: RigdConfig): Daemon {
  const rig = buildRig(config);
  const { store, home } = config;
  const log = (line: string) => console.log(`rigd: ${line}`);
  const router = buildRouter(rig);
  const mailbox = new Mailbox(join(rig.dir, "mail"));
  let supabaseUrl: string | undefined;

  const uplink = new Uplink({
    edgeOrigin: config.edgeOrigin,
    token: store.read("control-token-rig"),
    handlers: {
      webhook: webhookForwarder(forwardTargets(rig, log)),
      media: mediaRelay({ supabaseUrl: () => (supabaseUrl ??= localSupabase(home, config.env).apiUrl) }),
      mail: async (frame) => {
        mailbox.store(frame);
      },
      rpc: (frame) => router.dispatch(frame),
    },
    log,
    onState: (connected) => publishState(home, "uplink.json", { connected, at: new Date().toISOString() }),
  });
  publishState(home, "uplink.json", { connected: false, at: new Date().toISOString() });
  uplink.start();

  const watchdog = new LeaseWatchdog({
    client: rig.leases,
    log,
    onReap: (result, entry) => {
      if (!rig.posthog.canSend) return;
      void rig.posthog.send({
        fingerprint: infraFingerprint(result.failed.length ? "lease-undo" : "lease"),
        message: `the lease for ${entry.scenario} was not released in time; rigd ran its ${entry.undo.length} undo(s)`,
        extra: { lease_id: result.lease_id, failed: result.failed },
      });
    },
  });
  watchdog.start();

  const timers: ReturnType<typeof setInterval>[] = [];
  const every = (ms: number, fn: () => void) => {
    const timer = setInterval(fn, ms);
    timer.unref();
    timers.push(timer);
  };

  // `rig health` reads uplink.json's `at` to know the daemon is up.
  every(UPLINK_STATE_MS, () => {
    publishState(home, "uplink.json", { connected: uplink.connected, at: new Date().toISOString() });
  });

  if (store.has(BUNDLE_KEY_SECRET)) {
    const deliver = () =>
      deliverSecrets({ edgeOrigin: config.edgeOrigin, store })
        .then((result) => log(`secrets delivered: ${result.written.length} written${result.absent.length ? `, ${result.absent.length} absent` : ""}`))
        .catch((error: unknown) => log(`secret delivery failed: ${error instanceof Error ? error.message : "error"}`));
    void deliver();
    every(SECRET_REFRESH_MS, () => void deliver());
  } else {
    log(`no ${BUNDLE_KEY_SECRET} in the store; secret delivery is off`);
  }

  return {
    uplink,
    watchdog,
    router,
    stop() {
      for (const timer of timers) clearInterval(timer);
      uplink.stop();
      watchdog.stop();
      publishState(home, "uplink.json", { connected: false, at: new Date().toISOString() });
    },
  };
}
