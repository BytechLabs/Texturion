/**
 * The real rig, assembled from the config: one place both the daemon and a
 * scenario run build their parts from, so the two never disagree about where
 * the state lives or which token goes where.
 *
 * rigd keeps its own files under `state/rigd/`; what other tools read
 * (`state/uplink.json`, `state/sentry-relay.json`) sits directly in `state/`.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserLane, HostdClient } from "@loonext/rig-lanes";
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
import { APK_DIR, CURRENT_APK, NONPROD_PACKAGE, PREVIOUS_APK } from "../../src/apk.mjs";
import { readDeployHold } from "../../src/deploy-hold.mjs";
import { AppProbe, splitMember, type TenantsFile } from "./app-probe.ts";
import { readDeployedSha, readRoom, type RigdConfig } from "./config.ts";
import { WindowSource } from "./guard-window.ts";
import { LateDeliveries } from "./late.ts";
import { LeaseClient, type UndoHandlers } from "./lease.ts";
import { loadRegistry, type Registry } from "./registry.ts";
import { localSupabase, robotLocalToken, WhisperTranscriber } from "@loonext/rig-robot";
import { GuardClient } from "./guard-client.ts";
import { Mailbox } from "./mail.ts";
import { MailClient } from "./mail-client.ts";
import { rigDevices, RigOps } from "./rig-ops.ts";
import { FaultFile, HandoffFile, LaneHoldFile } from "./state-files.ts";
import { deleteStripeObject, STRIPE_DELETE_UNDO, StripeSandbox } from "./stripe-sandbox.ts";
import type { RunnerDeps } from "./runner.ts";
import { RUNNERS } from "./scenarios/index.ts";
import type { BrowserApi, DeviceApi, DevicesApi, RigApi, ScenarioLanes, StripeApi, WorkspaceState } from "./scenarios/context.ts";
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
  registry(): Registry;
  /** The dial window in force: the guard's measured one, else the registry's. */
  windows(): WindowSource;
  numbers(): NumberBook;
  app(): AppProbe;
  browser(): BrowserApi;
  /** Every lane a scenario attempt is handed. */
  lanes(): ScenarioLanes;
  /** The fault the forwarder answers the next call event with (S17), as webhookForwarder's `takeFault`. */
  faults: FaultFile;
  runnerDeps(): RunnerDeps;
}

/** tools/rig/bin/rig.mjs, beside this package in the tooling checkout. */
const RIG_BIN = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "rig.mjs");

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
  const tenants = once(() => store.readJson<TenantsFile>("tenants.json"));
  const app = once(() => {
    const supabase = localSupabase(config.home, config.env);
    return new AppProbe({
      tenants: tenants(),
      numbers: numbers(),
      apiBase: config.localApiBase,
      supabaseUrl: supabase.apiUrl,
      serviceRoleKey: supabase.secretKey,
      anonKey: supabase.publishableKey,
      edgeOrigin: config.edgeOrigin,
      guardToken: store.read("guard-token-rig-api"),
      robotWebhookSecret: () => store.readOptional("robot-webhook-secret"),
      stateDir: dir,
    });
  });
  const guard = once(
    () =>
      new GuardClient({
        edgeOrigin: config.edgeOrigin,
        robotToken: store.read("guard-token-robot"),
        rigApiToken: store.read("guard-token-rig-api"),
      }),
  );
  const handoff = new HandoffFile(join(dir, "handoff"));
  const faults = new FaultFile(join(dir, "faults"));
  const holds = new LaneHoldFile(join(dir, "holds"));
  const transcriber = once(() => {
    const binary = config.env.RIG_WHISPER_BIN;
    const model = config.env.RIG_WHISPER_MODEL;
    return binary && model ? new WhisperTranscriber({ binary, model }) : undefined;
  });

  const undo = undoHandlers({ robot, app, guard, handoff, devices: () => devices(), rig: () => rig(), stripe: () => stripe() });
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
      chrome: config.env.RIG_CHROME_BIN ? { executablePath: config.env.RIG_CHROME_BIN, members: ["qa-a-dispatcher"] } : undefined,
      credentials: (member) => {
        const { tenant, member: name } = splitMember(member);
        return tenants()[tenant]?.members[name];
      },
    });
    return {
      openPublic: (path) => lane.openPublic(path),
      async open(member, surface, path) {
        const page = await lane.open(member, surface, path);
        return {
          waitForRing: (ms) => page.waitForRing(ms),
          waitForCallCleared: (ms) => page.waitForCallCleared(ms),
          answer: () => page.answer(),
          hangUp: () => page.hangUp(),
          dial: (role) => page.dial(role),
          decline: () => page.decline(),
          hold: (on) => page.hold(on),
          mute: (on) => page.mute(on),
          pressKeys: (digits) => page.pressKeys(digits),
          transfer: (args) => page.transfer(args),
          completeTransfer: () => page.completeTransfer(),
          background: () => page.background(),
          notifications: () => page.notifications(),
          waitForText: (text, ms) => page.waitForText(text, ms),
          enablePush: () => page.enablePush(),
          hear: (options) => page.hear({ margins: loadMargins(marginsFile), ...options }),
          mark: (name) => page.mark(name),
        };
      },
      closeAll: () => lane.closeAll(),
    };
  });

  const devices = once(() =>
    rigDevices({
      pkg: NONPROD_PACKAGE,
      apks: { current: join(config.home.work, APK_DIR, CURRENT_APK), previous: join(config.home.work, APK_DIR, PREVIOUS_APK) },
      pin: () => store.readOptional("pixel-pin"),
      hostd: new HostdClient({ origin: config.hostdOrigin, token: () => store.read("hostd-token") }),
      adbServer: config.adbServer,
      audioProof: () => store.readOptional("emulator-audio-proven"),
      playServicesPins: () => store.readJson<Record<string, unknown>>("play-services-pins.json"),
      transcriber: transcriber(),
      numbers: numbers(),
      credentials: (member) => {
        const { tenant, member: name } = splitMember(member);
        return tenants()[tenant]?.members[name];
      },
    }),
  );
  const rig = once(
    () =>
      new RigOps({
        stateDir: config.home.state,
        rigBin: RIG_BIN,
        relayState: join(dir, "sentry-counters.json"),
        faults,
        transcriber: transcriber(),
      }),
  );
  const mail = once(() => {
    const mailbox = new Mailbox(join(dir, "mail"));
    return new MailClient({
      robotMailbox: store.readOptional("robot-mailbox"),
      storedMail: (since) => mailbox.list(since),
      mailpitUrl: config.env.RIG_MAILPIT_URL ?? "http://127.0.0.1:54324",
    });
  });
  const stripe = once(
    () =>
      new StripeSandbox({
        key: () => store.read("stripe-secret-key"),
        subscriptionIdOf: (tenant) => app().stripeSubscriptionId(tenant),
        checkoutSubscriptionOf: async (ownerEmail) => (await app().workspaceOf({ ownerEmail }))?.stripe_subscription_id ?? null,
      }),
  );
  const lanes = (): ScenarioLanes => ({
    robot,
    app: app(),
    browser: browser(),
    guard: guard(),
    devices: devices(),
    rig: rig(),
    mail: mail(),
    stripe: stripe(),
    handoff,
  });

  const registry = once(() => loadRegistry(config.registryPath));
  const windows = once(
    () =>
      new WindowSource({
        edgeOrigin: config.edgeOrigin,
        token: store.read("guard-token-robot"),
        stateFile: join(dir, "guard-window.json"),
        registry: registry().budget.window,
        override: config.windowOverride,
      }),
  );
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
    windows,
    numbers,
    app,
    browser,
    lanes,
    faults,
    runnerDeps: () => ({
      registry: registry(),
      runners: RUNNERS,
      verdicts,
      leases,
      localLease: (scenario) => leases.acquireLocal(scenario),
      lanes,
      relay,
      syntheticDsn,
      sha: () => readDeployedSha(config),
      room: () => readRoom(config),
      dialWindow: () => windows().current(),
      caps: config.capsOverride ?? registry().budget,
      clock: systemClock,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      lateDeliveries: (query) => late.matching(query).length,
      ran: (at) => markSuiteRan(config, at),
      holds,
      deployHold: () => {
        const hold = readDeployHold(config.home.state);
        if (hold === null) return undefined;
        return `a deploy holds the rig for a schema change${hold.unreadable ? "" : ` (${String(hold.sha).slice(0, 12)} since ${hold.at})`}`;
      },
      log: (line) => console.log(line),
    }),
  };
}

/** What the undo handlers act through, each built only when an undo first needs it. */
export interface UndoParts {
  robot: Pick<RobotClient, "sms">;
  app: () => AppProbe;
  guard: () => Pick<GuardClient, "releaseNumber">;
  handoff: Pick<HandoffFile, "read" | "clear">;
  devices: () => DevicesApi;
  rig: () => Pick<RigApi, "disarmCallEventFault">;
  stripe: () => Pick<StripeApi, "request">;
}

/** Every undo a scenario may register, by kind. A kind with no handler here fails its run's release. */
export function undoHandlers(parts: UndoParts): UndoHandlers {
  return {
    "robot.sms": async (params) => {
      if (!isRobotRole(params.from_role) || typeof params.to_role !== "string" || typeof params.text !== "string") {
        throw new Error("robot.sms undo needs from_role, to_role and text");
      }
      await parts.robot.sms({ from_role: params.from_role, to_role: params.to_role, text: params.text, scenario: "undo" });
    },
    "app.disarm-automations": async (params) => {
      await parts.app().disarmAutomations({ tenant: String(params.tenant), nonce: String(params.nonce) });
    },
    "app.flag": async (params) => {
      if (typeof params.key !== "string" || !(typeof params.enabled === "boolean" || params.enabled === null)) {
        throw new Error("app.flag undo needs key and enabled (true, false or null)");
      }
      await parts.app().setFlag(params.key, params.enabled);
    },
    "app.company-restore": async (params) => {
      if (typeof params.tenant !== "string" || !isRecord(params.values)) throw new Error("app.company-restore undo needs tenant and values");
      await parts.app().patchCompany({ tenant: params.tenant, values: params.values });
    },
    "app.number-status": async (params) => {
      const status = params.status;
      if (typeof params.tenant !== "string" || typeof params.role !== "string" || (status !== "active" && status !== "suspended" && status !== "released")) {
        throw new Error("app.number-status undo needs tenant, role and status");
      }
      await parts.app().setNumberStatus({ tenant: params.tenant, role: params.role as never, status });
    },
    "app.remove-on-call": async (params) => {
      if (typeof params.id !== "string") throw new Error("app.remove-on-call undo needs id");
      await parts.app().removeOnCallShift(params.id);
    },
    "app.ring-audience": async (params) => {
      const level = params.level;
      if (typeof params.tenant !== "string" || typeof params.role !== "string" || typeof params.member !== "string" || !(level === "text" || level === "note" || level === null)) {
        throw new Error("app.ring-audience undo needs tenant, role, member and level");
      }
      await parts.app().setRingAudience({ tenant: params.tenant, role: params.role as never, member: params.member, level });
    },
    "app.clear-seeded-usage": async (params) => {
      if (typeof params.marker !== "string") throw new Error("app.clear-seeded-usage undo needs marker");
      await parts.app().clearSeededUsage(params.marker);
    },
    "app.clear-seeded-voicemail": async (params) => {
      if (typeof params.tenant !== "string" || typeof params.sessionId !== "string") throw new Error("app.clear-seeded-voicemail undo needs tenant and sessionId");
      await parts.app().clearSeededVoicemail({ tenant: params.tenant, sessionId: params.sessionId });
    },
    "app.ai-usage": async (params) => {
      const count = params.requestCount;
      if (typeof params.tenant !== "string" || typeof params.feature !== "string" || !(typeof count === "number" || count === null)) {
        throw new Error("app.ai-usage undo needs tenant, feature and requestCount");
      }
      await parts.app().seedAiUsage({ tenant: params.tenant, feature: params.feature, requestCount: count });
    },
    "app.delete-sign-up": async (params) => {
      if (typeof params.email !== "string") throw new Error("app.delete-sign-up undo needs email");
      await parts.app().deleteSignUp({ email: params.email });
    },
    "app.revoke-invite": async (params) => {
      if (typeof params.member !== "string" || typeof params.inviteId !== "string") throw new Error("app.revoke-invite undo needs member and inviteId");
      await parts.app().revokeInvite({ member: params.member, inviteId: params.inviteId });
    },
    "app.restore-workspace": async (params) => {
      const state = params.state as WorkspaceState | undefined;
      if (typeof params.tenant !== "string" || !state || typeof state.subscription_status !== "string") {
        throw new Error("app.restore-workspace undo needs tenant and state");
      }
      await parts.app().restoreWorkspace({ tenant: params.tenant, state });
    },
    "number.release": async (params) => releaseHeldNumber(params, { guard: parts.guard(), app: parts.app(), handoff: parts.handoff }),
    "number.release-tenant": async (params) => releaseTenantNumbers(params, { guard: parts.guard(), app: parts.app(), handoff: parts.handoff }),
    "device.reset": async (params) => resetDevice(parts.devices(), params.device),
    "device.launch": async (params) => deviceNamed(parts.devices(), params.device).launch(),
    "device.install": async (params) => reinstallDevice(parts.devices(), params),
    "device.boot": async (params) => bootDevice(parts.devices(), params.device),
    // The device lane's emulator back to an unshaped network, Wi-Fi and cellular on.
    "rig.network-clear": async () => {
      await parts.devices().pixel().network.shape(null);
    },
    "rig.disarm-call-event-fault": async () => {
      await parts.rig().disarmCallEventFault();
    },
    [STRIPE_DELETE_UNDO]: async (params) => deleteStripeObject(parts.stripe(), params),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The undo for a number a run holds. S28 registers it with
 * `unless_handed_off`, so a passing S28's number, handed to S29, is left;
 * S29 registers it plainly, for a number grace did not release.
 */
export async function releaseHeldNumber(
  params: Record<string, unknown>,
  lanes: {
    guard: Pick<GuardClient, "releaseNumber">;
    app: Pick<AppProbe, "markNumberReleased">;
    handoff: Pick<HandoffFile, "read" | "clear">;
  },
): Promise<void> {
  const telnyxId = params.telnyx_phone_number_id;
  const rowId = params.phone_number_id;
  if (typeof telnyxId !== "string" || typeof rowId !== "string") throw new Error("number.release undo needs telnyx_phone_number_id and phone_number_id");
  const record = await lanes.handoff.read();
  const named = record?.telnyx_phone_number_id === telnyxId;
  if (params.unless_handed_off === true && named && record.state === "handed_off") return;
  const released = await lanes.guard.releaseNumber(telnyxId);
  if (released.status !== 404 && (released.status < 200 || released.status >= 300)) {
    throw new Error(`the guard answered the release ${released.status}${released.rule ? ` (${released.rule})` : ""}`);
  }
  await lanes.app.markNumberReleased({ phoneNumberId: rowId });
  if (named) await lanes.handoff.clear();
}

/**
 * S28's undo, registered before it buys: every number the workspace holds
 * unreleased, so a number whose row never named it in time, or whose purchase
 * call threw after Telnyx ordered it, is released too. One handed to S29 is left.
 */
export async function releaseTenantNumbers(
  params: Record<string, unknown>,
  lanes: {
    guard: Pick<GuardClient, "releaseNumber">;
    app: Pick<AppProbe, "numberRows" | "markNumberReleased">;
    handoff: Pick<HandoffFile, "read" | "clear">;
  },
): Promise<void> {
  const tenant = params.tenant;
  if (typeof tenant !== "string") throw new Error("number.release-tenant undo needs a tenant");
  const record = await lanes.handoff.read();
  if (params.unless_handed_off === true && record?.tenant === tenant && record.state === "handed_off") return;
  const unnamed: string[] = [];
  for (const row of await lanes.app.numberRows({ tenant })) {
    if (row.status === "released") continue;
    if (row.telnyx_phone_number_id) await releaseHeldNumber({ telnyx_phone_number_id: row.telnyx_phone_number_id, phone_number_id: row.id }, lanes);
    else unnamed.push(row.id);
  }
  if (unnamed.length) throw new Error(`${tenant} holds ${unnamed.length} number row(s) that name no Telnyx number, so none could be released`);
}

/** The device a device undo names: `pixel`, or `emulator-34`, `-35` or `-36`. */
export function deviceNamed(devices: DevicesApi, name: unknown): DeviceApi {
  const match = typeof name === "string" ? /^(pixel|emulator-(34|35|36))$/.exec(name) : null;
  if (!match) throw new Error("a device undo needs device: pixel or emulator-34, -35, -36");
  return match[2] ? devices.emulator(Number(match[2]) as 34 | 35 | 36) : devices.pixel();
}

/**
 * A device back at rest: out of Doze, saver off, active bucket, notifications
 * allowed, unlocked. A failed step does not stop the rest; the lease runs an
 * undo once, so whatever it skips stays wrong for the next run.
 */
export async function resetDevice(devices: DevicesApi, name: unknown): Promise<void> {
  const device = deviceNamed(devices, name);
  const steps: [string, () => Promise<unknown>][] = [
    ["exit doze", () => device.exitDoze()],
    ["battery saver off", () => device.batterySaver(false)],
    ["active bucket", () => device.setStandbyBucket("active")],
    ["hibernation off", () => device.hibernate(false)],
    ["notifications allowed", () => device.notificationsAllowed(true)],
    ["unlock", async () => ((await device.state()).locked ? device.unlock() : undefined)],
  ];
  const failed: string[] = [];
  for (const [what, step] of steps) {
    try {
      await step();
    } catch (error) {
      failed.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failed.length) throw new Error(`device.reset left ${device.name}: ${failed.join("; ")}`);
}

/**
 * The build a run uninstalled or swapped (D10, D12) put back in place and
 * signed in, so the next run finds the app as the rig keeps it.
 */
export async function reinstallDevice(devices: DevicesApi, params: Record<string, unknown>): Promise<void> {
  const { build, member } = params;
  if ((build !== "current" && build !== "previous") || typeof member !== "string") throw new Error("device.install undo needs device, build and member");
  const device = deviceNamed(devices, params.device);
  await device.install(build);
  await device.notificationsAllowed(true);
  // An install over the same build keeps the app's session, so no sign-in screen is not a failure.
  await device.signIn(member);
}

/** An emulator a run shut down (D11), booted again unless something already did. */
export async function bootDevice(devices: DevicesApi, name: unknown): Promise<void> {
  const device = deviceNamed(devices, name);
  const api = /^emulator-(34|35|36)$/.exec(device.name)?.[1];
  if (!api) throw new Error("device.boot undo is for emulators");
  if (!(await device.reachable())) await devices.bootEmulator(Number(api) as 34 | 35 | 36);
}
