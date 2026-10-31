/**
 * The long-running half of rigd: the uplink, the lease watchdog, the Sentry
 * relay's listener, secret delivery, the rpc commands and the dead-man's
 * heartbeats. Scenario runs are separate processes (timers and `triage.rerun`
 * start them), so a run that crashes takes nothing else down.
 *
 * What it publishes for `rig health` (tools/rig/src/health.mjs):
 *   state/uplink.json        { connected, at }, at least every minute
 *   state/sentry-relay.json  { at, unexplained_24h, ... }, every five minutes
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { triageMethods } from "@loonext/rig-triage";
import type { RigdConfig } from "./config.ts";
import { webhookForwarder } from "./forward.ts";
import { LeaseWatchdog } from "./lease.ts";
import { Mailbox } from "./mail.ts";
import { mediaRelay } from "./media.ts";
import { localSupabase, publishState, robotLocalToken } from "@loonext/rig-robot";
import { objectParams, RpcRouter } from "./rpc.ts";
import { BUNDLE_KEY_SECRET, deliverSecrets } from "./secrets.ts";
import { infraFingerprint, parseDsn, type Dsn } from "./sentry-relay.ts";
import { Uplink } from "./uplink.ts";
import { buildRig, suiteMarker, type Rig } from "./wiring.ts";

const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));
const HEARTBEAT_MS = 60_000;
const RELAY_REPORT_MS = 5 * 60_000;
const SECRET_REFRESH_MS = 6 * 60 * 60_000;
const ENVELOPE_MAX_BYTES = 1024 * 1024;

export interface Daemon {
  uplink: Uplink;
  watchdog: LeaseWatchdog;
  router: RpcRouter;
  relayServer?: Server;
  stop(): void;
}

/** Starts a scenario run in its own process and returns at once; its verdicts land in the store. */
export function startRun(scenario: string): { started: true; scenario: string; pid?: number } {
  if (!/^[A-Z]{1,3}\d{2,3}[a-z]?$/.test(scenario)) throw new Error("not a scenario id");
  const child = spawn(process.execPath, [CLI, "run", scenario], { detached: true, stdio: "ignore" });
  child.unref();
  return { started: true, scenario, pid: child.pid };
}

export function buildRouter(rig: Rig, lastTriage: { at?: number }, run = startRun): RpcRouter {
  const router = new RpcRouter();
  router.register(
    "rig.status",
    () => ({
      unresolved: rig.verdicts.unresolved().length,
      registry: [...rig.registry().keys()],
      late_deliveries_24h: rig.late.since(Date.now() - 86_400_000).length,
    }),
    ["triage", "rig"],
  );
  router.register("scenario.run", (params) => {
    const { scenario } = objectParams(params);
    if (typeof scenario !== "string" || !rig.registry().has(scenario)) throw new Error("scenario.run takes a registered { scenario }");
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

/** Fingerprints the cron registry expects (a cron run that is refused by design). */
export function explainedFingerprints(registryText: string | undefined): Set<string> {
  const explained = new Set<string>();
  if (!registryText) return explained;
  const parsed: unknown = JSON.parse(registryText);
  const entries: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { crons?: unknown })?.crons)
      ? (parsed as { crons: unknown[] }).crons
      : Object.values((parsed as Record<string, unknown>) ?? {});
  for (const entry of entries) {
    const record = (entry ?? {}) as { fingerprint?: unknown; fingerprints?: unknown };
    const list = Array.isArray(record.fingerprints) ? record.fingerprints : record.fingerprint ? [record.fingerprint] : [];
    for (const fingerprint of list) {
      if (Array.isArray(fingerprint) && fingerprint.every((part) => typeof part === "string")) {
        explained.add(JSON.stringify(fingerprint));
      }
    }
  }
  return explained;
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
        onLate: (entry) => {
          rig.late.record(entry);
          log(`a text reached the API ${entry.age_s} s after Telnyx signed it; counted as a late delivery and acked`);
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
    const report = () =>
      publishState(
        home,
        "sentry-relay.json",
        relay.report(explainedFingerprints(existsSync(cronRegistry) ? readFileSync(cronRegistry, "utf8") : undefined)),
      );
    report();
    every(RELAY_REPORT_MS, report);
  } else {
    log("no sentry-dsn-synthetic or sentry-dsn-rig in the store; the Sentry relay is off");
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
