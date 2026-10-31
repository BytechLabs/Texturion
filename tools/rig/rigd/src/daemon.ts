/**
 * The long-running half of rigd: the uplink, the lease watchdog, the Sentry
 * relay's listener, secret delivery, the rpc commands, the dead-man's
 * heartbeats and the scenario timers. Scenario runs are separate processes
 * (timers and `triage.rerun` start them), each in its own systemd unit, so a
 * run that crashes takes nothing else down and a restart of rigd takes no
 * run with it.
 *
 * What it publishes for `rig health` (tools/rig/src/health.mjs):
 *   state/uplink.json        { connected, at }, at least every minute
 *   state/sentry-relay.json  { at, unexplained_24h, defects_24h, ... }, every five minutes
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { triageMethods, type StartedRun } from "@loonext/rig-triage";
import type { RigdConfig } from "./config.ts";
import { cronExplainer, type CronExplainer } from "./cron-events.ts";
import { webhookForwarder } from "./forward.ts";
import { installSchedule, userUnitDir } from "./install.ts";
import { loadRegistry } from "./registry.ts";
import { telnyxPublicKey } from "./late.ts";
import { LeaseWatchdog } from "./lease.ts";
import { Mailbox } from "./mail.ts";
import { mediaRelay } from "./media.ts";
import { isRobotRole, localSupabase, publishState, robotLocalToken } from "@loonext/rig-robot";
import { objectParams, RpcRouter } from "./rpc.ts";
import { newRunId } from "./runner.ts";
import { buildSchedule, parseInstance } from "./schedule.ts";
import { NOT_RUNNABLE_YET, RUNNERS } from "./scenarios/index.ts";
import { BUNDLE_KEY_SECRET, deliverSecrets } from "./secrets.ts";
import { infraFingerprint, parseDsn, type Dsn } from "./sentry-relay.ts";
import { Uplink } from "./uplink.ts";
import { buildRig, suiteMarker, type Rig } from "./wiring.ts";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));
const HEARTBEAT_MS = 60_000;
const RELAY_REPORT_MS = 5 * 60_000;
const SECRET_REFRESH_MS = 6 * 60 * 60_000;
const SCHEDULE_REFRESH_MS = 60 * 60_000;
const ENVELOPE_MAX_BYTES = 1024 * 1024;

export interface Daemon {
  uplink: Uplink;
  watchdog: LeaseWatchdog;
  router: RpcRouter;
  relayServer?: Server;
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

export function buildRouter(rig: Rig, lastTriage: { at?: number }, run: RunStarter = runStarter(rig.config)): RpcRouter {
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
    heartbeat: () => {
      lastTriage.at = Date.now();
    },
  });
  for (const [name, handler] of Object.entries(methods)) router.register(name, handler, ["triage", "rig"]);
  return router;
}

/**
 * Writes the timers for the registry and the window in force, and starts
 * them. The registry is read afresh, so a deploy that changes it is timed
 * within the hour without a restart of rigd.
 */
export async function refreshSchedule(rig: Rig, log: (line: string) => void): Promise<void> {
  const window = await rig.windows().current();
  const schedule = buildSchedule(loadRegistry(rig.config.registryPath), {
    window,
    runnable: new Set(Object.keys(RUNNERS)),
    notRunnable: NOT_RUNNABLE_YET,
    node: process.execPath,
    cli: CLI,
    home: rig.config.home.home,
  });
  const result = installSchedule(schedule, { unitDir: userUnitDir(rig.config.env) });
  if (result.written.length || result.removed.length) {
    log(`timers: ${result.written.length} written, ${result.removed.length} removed (window ${window.startHour}:00 UTC)`);
  }
}

export function startDaemon(config: RigdConfig): Daemon {
  const rig = buildRig(config);
  const { store, home } = config;
  const log = (line: string) => console.log(`rigd: ${line}`);
  const lastTriage: { at?: number } = {};
  const router = buildRouter(rig, lastTriage);
  const mailbox = new Mailbox(join(rig.dir, "mail"));
  let supabaseUrl: string | undefined;

  const uplink = new Uplink({
    edgeOrigin: config.edgeOrigin,
    token: store.read("control-token-rig"),
    handlers: {
      webhook: webhookForwarder({
        apiBase: config.localApiBase,
        robotBase: config.robotBase,
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
        onLate: (entry) => {
          rig.late.record(entry);
          log(`a genuine text reached the API ${entry.age_s} s after Telnyx signed it; recorded as a late delivery`);
        },
      }),
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
      if (!rig.relay || !rig.syntheticDsn) return;
      void rig.relay.send(rig.syntheticDsn, {
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

  // The dead-man reads three beats: the rig's own, the last suite run and the last triage run.
  every(HEARTBEAT_MS, () => {
    publishState(home, "uplink.json", { connected: uplink.connected, at: new Date().toISOString() });
    const marker = suiteMarker(config);
    if (existsSync(marker)) uplink.heartbeat("suite", Number(readFileSync(marker, "utf8")));
    if (lastTriage.at) uplink.heartbeat("triage", lastTriage.at);
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

  let relayServer: Server | undefined;
  const rigDsn = store.readOptional("sentry-dsn-rig");
  if (rig.relay && rigDsn) {
    const relay = rig.relay;
    relayServer = sentryListener(rig, parseDsn(rigDsn));
    relayServer.listen(config.relayPort, "127.0.0.1");
    const cronRegistry = join(config.registryPath, "..", "crons.json");
    let unread = 0;
    const report = () => {
      // Read each time: a deploy may change what the crons expect.
      let explainer: CronExplainer | undefined;
      try {
        explainer = cronExplainer(existsSync(cronRegistry) ? readFileSync(cronRegistry, "utf8") : undefined);
        if (explainer.unread.length !== unread) log(`crons.json: ${explainer.unread.length} match(es) rigd cannot read; they explain nothing`);
        unread = explainer.unread.length;
      } catch (error) {
        log(`crons.json unreadable, so nothing is explained: ${error instanceof Error ? error.message : "error"}`);
      }
      publishState(home, "sentry-relay.json", relay.report((event) => explainer?.explain(event)));
    };
    report();
    every(RELAY_REPORT_MS, report);
  } else {
    log("no sentry-dsn-synthetic or sentry-dsn-rig in the store; the Sentry relay is off");
  }
  if (rig.relay) {
    const relay = rig.relay;
    every(RELAY_REPORT_MS, () =>
      void relay.flushPending().then(({ sent, left }) => {
        if (sent || left) log(`Sentry: ${sent} held envelope(s) sent, ${left} still held`);
      }),
    );
  }

  if (config.systemd) {
    const schedule = () =>
      refreshSchedule(rig, log).catch((error: unknown) =>
        log(`timers not refreshed: ${error instanceof Error ? error.message : "error"}`),
      );
    void schedule();
    every(SCHEDULE_REFRESH_MS, () => void schedule());
  }

  return {
    uplink,
    watchdog,
    router,
    relayServer,
    stop() {
      for (const timer of timers) clearInterval(timer);
      uplink.stop();
      watchdog.stop();
      relayServer?.close();
      publishState(home, "uplink.json", { connected: false, at: new Date().toISOString() });
    },
  };
}

/**
 * The local API's Sentry SDK posts here: `rig deploy` rewrites the rig's DSN
 * to this listener (`sentryRelayOrigin` in rig.json), and the relay forwards
 * what its caps allow to the real `loonext-rig` project. The SDK is always
 * told 200, so a capped event is never retried into the cap again.
 */
function sentryListener(rig: Rig, rigDsn: Dsn): Server {
  return createServer((request, response) => {
    if (request.method !== "POST" || !/^\/api\/\d+\/envelope\/?$/.test(request.url?.split("?")[0] ?? "")) {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= ENVELOPE_MAX_BYTES) chunks.push(chunk);
    });
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
      if (size > ENVELOPE_MAX_BYTES) return;
      void rig.relay!.forwardEnvelope(rigDsn, Buffer.concat(chunks)).catch(() => undefined);
    });
  });
}
