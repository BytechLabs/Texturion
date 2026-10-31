/**
 * The real rig, assembled from the config: one place both the daemon and a
 * scenario run build their parts from, so the two never disagree about where
 * the state lives or which token goes where.
 *
 * rigd keeps its own files under `state/rigd/`; what other tools read
 * (`state/uplink.json`, `state/sentry-relay.json`) sits directly in `state/`.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserLane } from "@loonext/rig-lanes";
import {
  isRobotRole,
  loadMargins,
  RobotClient,
  standingBook,
  systemClock,
  writeFakeMicWavs,
  SURFACES,
  type NumberBook,
} from "@loonext/rig-robot";
import { AppProbe, type TenantsFile } from "./app-probe.ts";
import { readDeployedSha, readRoom, type RigdConfig } from "./config.ts";
import { LateDeliveries } from "./late.ts";
import { LeaseClient, type UndoHandlers } from "./lease.ts";
import { loadRegistry, type RegisteredScenario } from "./registry.ts";
import { localSupabase, robotLocalToken } from "@loonext/rig-robot";
import type { RunnerDeps } from "./runner.ts";
import { RUNNERS } from "./scenarios/index.ts";
import type { BrowserApi } from "./scenarios/context.ts";
import { parseDsn, SentryRelay, type Dsn } from "./sentry-relay.ts";
import { VerdictStore } from "./verdicts.ts";

export interface Rig {
  config: RigdConfig;
  /** `state/rigd`: verdicts, lease journals, counters. */
  dir: string;
  verdicts: VerdictStore;
  robot: RobotClient;
  leases: LeaseClient;
  late: LateDeliveries;
  relay?: SentryRelay;
  syntheticDsn?: Dsn;
  marginsFile: string;
  registry(): ReadonlyMap<string, RegisteredScenario>;
  numbers(): NumberBook;
  app(): AppProbe;
  browser(): BrowserApi;
  runnerDeps(): RunnerDeps;
}

export function rigdDir(config: RigdConfig): string {
  return join(config.home.state, "rigd");
}

/** robotd and the browser lane read the same calibrated margins. */
export function marginsFileOf(config: RigdConfig): string {
  return join(rigdDir(config), "margins.json");
}

export function buildRig(config: RigdConfig): Rig {
  const dir = rigdDir(config);
  const { store } = config;
  const verdicts = new VerdictStore(join(dir, "verdicts"));
  const robot = new RobotClient({ base: config.robotBase, token: robotLocalToken(store) });
  const once = <T>(make: () => T): (() => T) => {
    let value: T | undefined;
    return () => (value ??= make());
  };
  const numbers = once(() => standingBook(store.readJson<unknown>("standing-numbers.json")));
  const app = once(() => {
    const supabase = localSupabase(config.home, config.env);
    return new AppProbe({
      tenants: store.readJson<TenantsFile>("tenants.json"),
      numbers: numbers(),
      apiBase: config.localApiBase,
      supabaseUrl: supabase.apiUrl,
      serviceRoleKey: supabase.secretKey,
      anonKey: supabase.publishableKey,
      edgeOrigin: config.edgeOrigin,
      guardToken: store.read("guard-token-rig-api"),
    });
  });

  const undo: UndoHandlers = {
    "robot.sms": async (params) => {
      if (!isRobotRole(params.from_role) || typeof params.to_role !== "string" || typeof params.text !== "string") {
        throw new Error("robot.sms undo needs from_role, to_role and text");
      }
      await robot.sms({ from_role: params.from_role, to_role: params.to_role, text: params.text, scenario: "undo" });
    },
    "app.disarm-automations": async (params) => {
      await app().disarmAutomations({ tenant: String(params.tenant), nonce: String(params.nonce) });
    },
  };
  const leases = new LeaseClient({
    edgeOrigin: config.edgeOrigin,
    token: store.read("guard-token-robot"),
    stateDir: dir,
    handlers: undo,
  });
  const late = new LateDeliveries(join(dir, "late-deliveries.jsonl"));

  const synthetic = store.readOptional("sentry-dsn-synthetic");
  const syntheticDsn = synthetic ? parseDsn(synthetic) : undefined;
  const relay = syntheticDsn
    ? new SentryRelay({ statePath: join(dir, "sentry-counters.json"), alertDsn: syntheticDsn })
    : undefined;

  const marginsFile = marginsFileOf(config);
  const browser = once((): BrowserApi => {
    const fakeMicDir = join(config.home.work, "fake-mic");
    if (!SURFACES.every((surface) => existsSync(join(fakeMicDir, `${surface}.wav`)))) writeFakeMicWavs(fakeMicDir);
    const lane = new BrowserLane({
      appOrigin: config.settings.appOrigin,
      profilesDir: join(config.home.work, "browser-profiles"),
      fakeMicDir,
      numbers: numbers(),
      headless: config.env.RIG_HEADLESS !== "0",
    });
    return {
      async open(member, surface, path) {
        const page = await lane.open(member, surface, path);
        return {
          waitForRing: (ms) => page.waitForRing(ms),
          answer: () => page.answer(),
          hangUp: () => page.hangUp(),
          dial: (role) => page.dial(role),
          waitForText: (text, ms) => page.waitForText(text, ms),
          hear: (options) => page.hear({ margins: loadMargins(marginsFile), ...options }),
          mark: (name) => page.mark(name),
        };
      },
      closeAll: () => lane.closeAll(),
    };
  });

  const registry = once(() => new Map(loadRegistry(config.registryPath).map((entry) => [entry.id, entry])));
  return {
    config,
    dir,
    verdicts,
    robot,
    leases,
    late,
    relay,
    syntheticDsn,
    marginsFile,
    registry,
    numbers,
    app,
    browser,
    runnerDeps: () => ({
      registry: registry(),
      runners: RUNNERS,
      verdicts,
      leases,
      localLease: (scenario) => leases.acquireLocal(scenario),
      lanes: () => ({ robot, app: app(), browser: browser() }),
      relay,
      syntheticDsn,
      sha: () => readDeployedSha(config),
      room: () => readRoom(config),
      window: config.window,
      caps: config.caps,
      clock: systemClock,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      lateDeliveries: (since) => late.since(since).length,
      ran: (at) => markSuiteRan(config, at),
      log: (line) => console.log(line),
    }),
  };
}

/** The dead-man's "last suite run": a file the daemon reads and beats with. */
export function suiteMarker(config: RigdConfig): string {
  return join(rigdDir(config), "heartbeats", "suite");
}

function markSuiteRan(config: RigdConfig, at: number): void {
  mkdirSync(join(rigdDir(config), "heartbeats"), { recursive: true });
  writeFileSync(suiteMarker(config), String(at));
}
