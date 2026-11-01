/**
 * The Android wake scenarios: D02, D02p, D03, D04, D10, D11, D12 and E01.
 *
 * Each asks whether a ring push wakes the app into a ring, and judges every
 * stage a ring passes through: the push the API sent and FCM accepted, the
 * beacons the device reported, Telecom's ringing state and the full-screen
 * ring, the answer on the lock screen, and the codes heard both ways. The
 * Pixel is the device lane (QA-A's technician on DEV-A1); the emulators are
 * the emulator lane (QA-E's owner on DEV-E1).
 */
import type { StandingRole } from "@loonext/rig-protocol";
import type { DeviceState } from "@loonext/rig-lanes";
import type { CallRecord, Detection, Surface } from "@loonext/rig-robot";
import {
  fail,
  infra,
  pass,
  poll,
  type AppApi,
  type AudioLinkApi,
  type DeviceApi,
  type LeaseHandle,
  type ScenarioContext,
  type ScenarioResult,
  type ScenarioRunner,
} from "./context.ts";

const DAY_MS = 86_400_000;
const RING_WITHIN_MS = 12_000;
/** How long a ring that must not come is watched for; ROBOT-1 hangs up a little after. */
const NO_RING_WAIT_MS = 15_000;
const TALK_MS = 25_000;
/** The device records this long from the answer, the span the robot judges as well (2-12 s). */
const HEAR_MS = 12_000;
/** Push attempts and beacons are written in the background; this is how long they get. */
const EVIDENCE_WAIT_MS = 30_000;
/** A device's clock may run behind the rig's. Beacons are matched by session, so a wide margin costs nothing. */
const DEVICE_CLOCK_MARGIN_MS = 5 * 60_000;
/**
 * A woken app asks for the call's state, then for ring-me, within seconds,
 * and retries ring-me once 4 s later (CallWakePolicy.RING_ME_RETRY_MS). After
 * this long, no ring_me_sent beacon means no ring-me was answered.
 */
const RING_ME_SETTLE_MS = 15_000;

/** Where a wake lands: the tenant, the member signed in on the device, the number that rings it and the code it plays. */
export interface WakeLane {
  tenant: string;
  member: string;
  number: StandingRole;
  surface: Surface;
}

export const PIXEL_LANE: WakeLane = { tenant: "QA-A", member: "qa-a-technician", number: "DEV-A1", surface: "pixel" };
export const EMULATOR_LANE: WakeLane = { tenant: "QA-E", member: "qa-e-owner", number: "DEV-E1", surface: "emulator" };
/** QA-A's owner is API-only: the member who asks the API to ring the technician. */
const SIMULATING_MEMBER = "qa-a-owner";

export const EMULATOR_APIS = [34, 35, 36] as const;
export type EmulatorApi = (typeof EMULATOR_APIS)[number];

/** apps/api's RING_BEACON_STAGES (routes/ring-beacons.ts): the words all three clients send. */
export const RING_BEACON_STAGES = ["push_received", "os_reported", "ring_me_sent", "ringing_shown", "answered", "declined"] as const;
export type RingBeaconStage = (typeof RING_BEACON_STAGES)[number];

/**
 * The stages each stage must come after. apps/api lists the usual order, not
 * a law: the Android app shows the ring from the push while it asks to be
 * rung, so ring_me_sent and ringing_shown race. Only cause and effect is
 * judged.
 */
export const BEACON_AFTER: Readonly<Record<RingBeaconStage, readonly RingBeaconStage[]>> = {
  push_received: [],
  os_reported: ["push_received"],
  ring_me_sent: ["push_received"],
  ringing_shown: ["os_reported"],
  answered: ["ringing_shown"],
  declined: ["ringing_shown"],
};

/** A missing stage, named for where the ring stopped. */
const MISSING_STAGE: Readonly<Record<RingBeaconStage, string>> = {
  push_received: "push_not_received",
  os_reported: "not_reported_to_telecom",
  ring_me_sent: "ring_me_not_sent",
  ringing_shown: "ring_not_shown",
  answered: "answer_not_reported",
  declined: "decline_not_reported",
};

/** What a real call's wake reports, from the push to the answer. */
export const CALL_STAGES: readonly RingBeaconStage[] = ["push_received", "os_reported", "ring_me_sent", "ringing_shown", "answered"];
/**
 * What a synthetic session's wake reports. The app asks for the session's
 * state before ring-me and stops at its 404, so no ring_me_sent follows.
 */
export const PUSH_STAGES: readonly RingBeaconStage[] = ["push_received", "os_reported", "ringing_shown"];

type Beacon = Awaited<ReturnType<AppApi["ringBeacons"]>>[number];
type Ring = { telecom_ms?: number; full_screen_ms?: number };

/** A section of the attempt's evidence, so a runner that repeats a check keeps each one's readings. */
function section(ctx: ScenarioContext, name: string): Record<string, unknown> {
  const evidence: Record<string, unknown> = {};
  ctx.evidence[name] = evidence;
  return evidence;
}

export async function reachable(device: DeviceApi): Promise<ScenarioResult | undefined> {
  return (await device.reachable()) ? undefined : infra(device.name, "adb does not see it, or it has not finished booting");
}

/** A device step that threw is the device's fault, not the product's. */
async function onDevice(device: DeviceApi, what: string, action: () => Promise<unknown>): Promise<ScenarioResult | undefined> {
  try {
    await action();
    return undefined;
  } catch (error) {
    return infra(device.name, `${what} failed: ${(error as Error).message}`);
  }
}

async function connectedAudio(pixel: DeviceApi): Promise<{ audio: AudioLinkApi } | { failure: ScenarioResult }> {
  if (!pixel.audio) return { failure: infra("pixel-audio", "the rig names no Bluetooth hands-free link for the Pixel") };
  if (!(await pixel.audio.connected())) return { failure: infra("pixel-audio", "the Pixel's Bluetooth hands-free link is not connected") };
  return { audio: pixel.audio };
}

const resets = new WeakMap<LeaseHandle, Set<string>>();

/** Registers `device.reset` once per lease, however many of a runner's checks ask for it. */
export function resetOnRelease(ctx: ScenarioContext, device: string): void {
  const registered = resets.get(ctx.lease) ?? new Set<string>();
  if (registered.has(device)) return;
  ctx.lease.registerUndo({ kind: "device.reset", params: { device } });
  registered.add(device);
  resets.set(ctx.lease, registered);
}

/** The app killed as memory pressure kills it (never force-stopped), the device in deep idle and locked. */
export async function killedAsleepLocked(device: DeviceApi, doze: "force" | "natural"): Promise<ScenarioResult | undefined> {
  const failed =
    (await onDevice(device, "killing the app", () => device.kill())) ??
    (doze === "force" ? await onDevice(device, "forcing Doze", () => device.forceDoze()) : undefined) ??
    (await onDevice(device, "locking it", () => device.lock()));
  if (failed) return failed;
  const state = await device.state();
  if (state.doze !== "IDLE") {
    return infra(device.name, `Doze reads ${state.doze ?? "nothing"}, not IDLE, ${doze === "force" ? "after forcing it" : "after idling by itself"}`);
  }
  if (state.locked !== true) return infra(device.name, "the screen did not lock");
  return undefined;
}

/** FCM answers that say the push never had a fair try: the guard's credential, a throttle or Google's weather. */
const FCM_FAULTS: ReadonlySet<string> = new Set(["unauthorized", "throttled", "provider_error", "transport_error"]);

/**
 * The ring push to the lane's Android devices, which FCM must have accepted
 * at high priority. Resolves with the session it carried, by which the
 * beacons are matched. A token an uninstalled build left behind answers
 * `gone` beside the live one's `accepted`, so one accepted push is enough.
 */
export async function ringPush(
  ctx: ScenarioContext,
  lane: WakeLane,
  args: { since: number; sessionId?: string },
  ev: Record<string, unknown>,
): Promise<{ sessionId: string } | { failure: ScenarioResult }> {
  const rows = await poll(ctx, async () => {
    const attempts = await ctx.app.pushAttempts({ tenant: lane.tenant, since: args.since, purpose: "ring" });
    const android = attempts.filter(
      (a) => a.purpose === "ring" && a.platform === "android" && (args.sessionId === undefined || a.call_session_id === args.sessionId),
    );
    return android.length > 0 ? android : undefined;
  }, EVIDENCE_WAIT_MS, 2_000);
  ev.push = (rows ?? []).map((a) => ({
    session_id: a.call_session_id ?? null,
    response_class: a.response_class,
    priority: a.priority ?? null,
    attempted_at: a.attempted_at,
  }));
  if (!rows) {
    return { failure: fail("no_push_attempt", `the API recorded no ring push to an Android device in ${lane.tenant}${args.sessionId ? " for the session" : ""}`) };
  }
  const accepted = rows.find((a) => a.response_class === "accepted");
  if (!accepted) {
    const answers = [...new Set(rows.map((a) => a.response_class))];
    const detail = `FCM answered the ring push ${answers.join(", ")}`;
    return { failure: answers.every((a) => FCM_FAULTS.has(a)) ? infra("fcm", detail) : fail("push_not_accepted", detail) };
  }
  if (accepted.priority !== "high") {
    return { failure: fail("push_not_high_priority", `FCM took the ring push at ${accepted.priority ?? "no recorded"} priority`) };
  }
  if (!accepted.call_session_id) return { failure: fail("push_without_session", "the accepted ring push names no call session") };
  return { sessionId: accepted.call_session_id };
}

/** The device's beacons for one session: read until `until` have all arrived, then once more at `settleUntil`. */
export async function readBeacons(
  ctx: ScenarioContext,
  lane: WakeLane,
  args: { since: number; sessionId: string; until: readonly RingBeaconStage[]; settleUntil?: number },
  ev: Record<string, unknown>,
): Promise<Beacon[]> {
  const read = async () =>
    (await ctx.app.ringBeacons({ tenant: lane.tenant, since: args.since - DEVICE_CLOCK_MARGIN_MS, member: lane.member })).filter(
      (b) => b.call_session_id === args.sessionId,
    );
  let rows =
    (await poll(ctx, async () => {
      const current = await read();
      return args.until.every((stage) => current.some((b) => b.stage === stage)) ? current : undefined;
    }, EVIDENCE_WAIT_MS, 2_000)) ?? (await read());
  if (args.settleUntil !== undefined && ctx.now() < args.settleUntil) {
    await ctx.sleep(args.settleUntil - ctx.now());
    rows = await read();
  }
  ev.beacons = rows.map((b) => ({
    stage: b.stage,
    at: b.occurred_at,
    device_idle: b.device_idle,
    screen_locked: b.screen_locked,
    standby_bucket: b.standby_bucket,
    app_version: b.app_version,
  }));
  return rows;
}

/** Every expected stage arrived, and each came after the stages that cause it. */
export function judgeBeacons(rows: readonly Beacon[], expected: readonly RingBeaconStage[]): ScenarioResult | undefined {
  const first = new Map<RingBeaconStage, number>();
  for (const row of rows) {
    if (!(RING_BEACON_STAGES as readonly string[]).includes(row.stage)) continue;
    const stage = row.stage as RingBeaconStage;
    const at = Date.parse(row.occurred_at);
    const seen = first.get(stage);
    if (seen === undefined || at < seen) first.set(stage, at);
  }
  const reported = RING_BEACON_STAGES.filter((stage) => first.has(stage)).join(", ") || "nothing";
  for (const stage of RING_BEACON_STAGES) {
    if (expected.includes(stage) && !first.has(stage)) return fail(MISSING_STAGE[stage], `no ${stage} beacon for the ring (the device reported ${reported})`);
  }
  for (const [stage, at] of first) {
    for (const cause of BEACON_AFTER[stage]) {
      const causedAt = first.get(cause);
      if (causedAt !== undefined && at < causedAt) return fail("beacons_out_of_order", `${stage} came ${causedAt - at} ms before ${cause}`);
    }
  }
  return undefined;
}

function dialFailure(record: CallRecord): ScenarioResult {
  const refusal = record.errors.find((e) => e.startsWith("guard_refused:"));
  return infra(refusal ? "guard" : "robot", record.errors.join("; ") || "the robot could not dial");
}

/** The robot's side of the call: undefined when it connected and was judged, and, when asked, heard the device. */
function robotVerdict(record: CallRecord, surface: Surface, judgeHearing: boolean): ScenarioResult | undefined {
  const refusal = record.errors.find((e) => e.startsWith("guard_refused:"));
  if (refusal) return infra("guard", refusal);
  if (!record.answered_at) return fail("not_answered", `the call never connected (${record.errors.join("; ") || record.state})`);
  if (!record.judgement) return infra("robot", `no verdict on the robot's recording (${record.errors.join("; ") || record.state})`);
  if (judgeHearing && !record.judgement.pass) {
    return fail("robot_did_not_hear_device", `the robot heard ${record.judgement.heard.join(", ") || record.judgement.verdict}, not ${surface}`);
  }
  if (!record.recording_deleted) return infra("robot", "the robot could not delete Telnyx's copy of its recording");
  return undefined;
}

function callEvidence(record: CallRecord, hearing?: Detection): Record<string, unknown> {
  const { frames: _frames, ...judgement } = record.judgement ?? {};
  return {
    ids: record.ids,
    state: record.state,
    dialed_at: record.dialed_at,
    answered_at: record.answered_at,
    ended_at: record.ended_at,
    hangup: record.hangup,
    rtp: record.rtp,
    robot_heard: record.judgement ? judgement : undefined,
    robot_frames: record.judgement?.frames,
    recording_deleted: record.recording_deleted,
    errors: record.errors,
    device_heard: hearing ? { verdict: hearing.verdict, answered: hearing.answered, heard: hearing.heard, echo: hearing.echo } : undefined,
  };
}

/** Where a ring that never came stopped: no push, a refused one, or one the device never got or never gave Telecom. */
async function whyNoRing(
  ctx: ScenarioContext,
  lane: WakeLane,
  args: { since: number; sessionId?: string },
  ev: Record<string, unknown>,
): Promise<ScenarioResult | undefined> {
  const push = await ringPush(ctx, lane, args, ev);
  if ("failure" in push) return push.failure;
  const until = ["push_received", "os_reported"] as const;
  return judgeBeacons(await readBeacons(ctx, lane, { since: args.since, sessionId: push.sessionId, until }, ev), until);
}

export interface CallWakeOutcome {
  /** The first check that failed; undefined when the device woke, rang, was answered and was heard. */
  failure?: ScenarioResult;
  /** Whether the robot heard the device's code, for E01, which judges that over a week. */
  robotHeardDevice?: boolean;
}

/**
 * D02's check from the dial on, for a device already put in its state:
 * ROBOT-1 calls the lane's number; FCM takes the ring push at high priority;
 * Telecom rings within 12 s; the ring is answered from the lock screen; the
 * device reports each stage in order; the robot hears the device's code and,
 * with an audio link, the device hears the robot's.
 */
export async function callWake(
  ctx: ScenarioContext,
  device: DeviceApi,
  lane: WakeLane,
  options: { audio?: AudioLinkApi; judgeRobotHearing?: boolean } = {},
  ev: Record<string, unknown> = ctx.evidence,
): Promise<CallWakeOutcome> {
  const since = ctx.now();
  const dialed = await ctx.robot.dial({
    scenario: ctx.scenario,
    lease_id: ctx.lease.id,
    direction: "outbound",
    role: "ROBOT-1",
    to: lane.number,
    expect: lane.surface,
    hangup_after_ms: TALK_MS,
  });
  if (dialed.state === "failed") return { failure: dialFailure(dialed) };
  const ring = await device.waitForRinging(RING_WITHIN_MS);
  ev.ring = ring ?? null;
  if (ring?.telecom_ms === undefined) {
    await ctx.robot.wait(dialed.plan_id, 120_000);
    const why = await whyNoRing(ctx, lane, { since }, ev);
    return { failure: why ?? fail("no_ring_within_12s", "Telecom reported no ringing call within 12 s of the dial") };
  }
  ev.locked_at_ring = (await device.state()).locked;
  const answered = await device.tap("call_answer");
  ev.answer_tapped = answered;
  const hearing = answered && options.audio ? await options.audio.hear({ stream: "call", ms: HEAR_MS, own: lane.surface }) : undefined;
  const record = await ctx.robot.wait(dialed.plan_id, 180_000);
  ev.call = callEvidence(record, hearing);

  const push = await ringPush(ctx, lane, { since }, ev);
  if ("failure" in push) return push;
  if (!answered) return { failure: fail("answer_control_missing", "the ring showed no call_answer control on the lock screen") };
  const order = judgeBeacons(await readBeacons(ctx, lane, { since, sessionId: push.sessionId, until: CALL_STAGES }, ev), CALL_STAGES);
  if (order) return { failure: order };
  const robot = robotVerdict(record, lane.surface, options.judgeRobotHearing ?? true);
  if (robot) return { failure: robot };
  const robotHeardDevice = record.judgement?.pass === true;
  if (hearing && hearing.answered !== "robot") {
    return { failure: fail("device_did_not_hear_robot", `the ${lane.surface} heard ${hearing.heard.join(", ") || hearing.verdict}`), robotHeardDevice };
  }
  return { robotHeardDevice };
}

/**
 * ROBOT-1 calls the lane's number and hangs up before anyone could answer.
 * The API must have pushed and FCM accepted, so a device that stays quiet
 * stayed quiet for a ring that was really sent. Resolves with what the
 * device showed within `waitMs`; the beacons are kept, not judged.
 */
export async function ringOnly(
  ctx: ScenarioContext,
  device: DeviceApi,
  lane: WakeLane,
  waitMs: number,
  ev: Record<string, unknown> = ctx.evidence,
): Promise<{ ring: Ring | undefined } | { failure: ScenarioResult }> {
  const since = ctx.now();
  const dialed = await ctx.robot.dial({
    scenario: ctx.scenario,
    lease_id: ctx.lease.id,
    direction: "outbound",
    role: "ROBOT-1",
    to: lane.number,
    play: null,
    record: false,
    hangup_before_answer_ms: waitMs + 3_000,
    hangup_after_ms: 1_000,
  });
  if (dialed.state === "failed") return { failure: dialFailure(dialed) };
  const ring = await device.waitForRinging(waitMs);
  ev.ring = ring ?? null;
  const record = await ctx.robot.wait(dialed.plan_id, 120_000);
  ev.call = { ids: record.ids, state: record.state, dialed_at: record.dialed_at, answered_at: record.answered_at, ended_at: record.ended_at, errors: record.errors };
  const refusal = record.errors.find((e) => e.startsWith("guard_refused:"));
  if (refusal) return { failure: infra("guard", refusal) };
  const push = await ringPush(ctx, lane, { since }, ev);
  if ("failure" in push) return push;
  await readBeacons(ctx, lane, { since, sessionId: push.sessionId, until: [] }, ev);
  return { ring };
}

/**
 * D02p's check: a real FCM ring push for a session with no call behind it.
 * FCM accepts it; the Pixel receives it, reports it to Telecom and shows the
 * full-screen ring within 12 s; and ring-me is never answered, so no ring
 * leg is dialed. The guard's log cannot show that zero dials happened: D02p
 * runs under a local lease, which the guard has no record of, so the
 * refusal is read from the beacons.
 */
export async function pushWake(ctx: ScenarioContext, pixel: DeviceApi, ev: Record<string, unknown> = ctx.evidence): Promise<ScenarioResult | undefined> {
  const since = ctx.now();
  const caller = `Rig ${ctx.nonce}`;
  let answer: Awaited<ReturnType<AppApi["simulateIncoming"]>>;
  try {
    answer = await ctx.app.simulateIncoming({ member: SIMULATING_MEMBER, target: PIXEL_LANE.member, caller });
  } catch (error) {
    return infra("app-probe", `simulate-incoming failed: ${(error as Error).message}`);
  }
  ev.simulated = { status: answer.status, code: answer.code, reachable: answer.body?.reachable };
  if (answer.status === 401) return infra("app-probe", `the API refused the probe's session for ${SIMULATING_MEMBER}`);
  if (answer.status < 200 || answer.status >= 300) {
    return fail("simulate_refused", `POST /v1/rig/simulate-incoming answered ${answer.status}${answer.code ? ` ${answer.code}` : ""}`);
  }
  const sessionId = answer.body?.session_id;
  if (!sessionId) return fail("no_synthetic_session", "simulate-incoming answered without a session id");
  ev.session_id = sessionId;

  const ring = await pixel.waitForRinging(RING_WITHIN_MS);
  ev.ring = ring ?? null;
  if (ring) ev.ring_shows_nonce = await pixel.showing({ text: caller });
  const beacons = await readBeacons(ctx, PIXEL_LANE, { since, sessionId, until: PUSH_STAGES, settleUntil: since + RING_ME_SETTLE_MS }, ev);
  if (ring) ev.dismissed = await pixel.tap("call_decline");

  const push = await ringPush(ctx, PIXEL_LANE, { since, sessionId }, ev);
  if ("failure" in push) return push.failure;
  if (ring?.telecom_ms === undefined) {
    return judgeBeacons(beacons, ["push_received", "os_reported"]) ?? fail("no_ring_within_12s", "Telecom reported no ringing call within 12 s of the push");
  }
  if (ring.full_screen_ms === undefined) return fail("no_full_screen_ring", "Telecom rang, but the full-screen ring did not show within 12 s");
  const stages = judgeBeacons(beacons, PUSH_STAGES);
  if (stages) return stages;
  if (beacons.some((b) => b.stage === "ring_me_sent")) {
    return fail("ring_me_not_refused", "ring-me answered the device for a session with no call, which only a live call may");
  }
  return undefined;
}

/**
 * D02 from the reachability check on: the app killed, the Pixel in deep idle
 * and locked with its PIN, rung by ROBOT-1 and answered from the lock screen,
 * with the codes heard both ways. D03 keeps the deep idle the Pixel reached by
 * itself instead of forcing it; D10 and D12 repeat it after an install.
 */
export async function androidWake(
  ctx: ScenarioContext,
  pixel: DeviceApi,
  doze: "force" | "natural",
  ev: Record<string, unknown> = ctx.evidence,
): Promise<ScenarioResult> {
  const unreachable = await reachable(pixel);
  if (unreachable) return unreachable;
  const link = await connectedAudio(pixel);
  if ("failure" in link) return link.failure;
  resetOnRelease(ctx, pixel.name);
  const setup = await killedAsleepLocked(pixel, doze);
  if (setup) return setup;
  ev.device = { ...(await pixel.state()) };
  try {
    await link.audio.playCode(PIXEL_LANE.surface);
  } catch (error) {
    return infra("pixel-audio", `playing the Pixel's code failed: ${(error as Error).message}`);
  }
  try {
    const { failure } = await callWake(ctx, pixel, PIXEL_LANE, { audio: link.audio }, ev);
    return failure ?? pass();
  } finally {
    await link.audio.stop();
  }
}

/** D02: app killed, forced Doze, locked with a PIN; ROBOT-1 calls DEV-A1. */
export const D02: ScenarioRunner = {
  id: "D02",
  async run(ctx) {
    return androidWake(ctx, ctx.devices.pixel(), "force");
  },
};

/** D02p: a real ring push for a synthetic session, which dials nobody. */
export const D02p: ScenarioRunner = {
  id: "D02p",
  async run(ctx) {
    const pixel = ctx.devices.pixel();
    return (await reachable(pixel)) ?? (await pushWake(ctx, pixel)) ?? pass();
  },
};

/** Natural deep idle takes far longer than a lease lasts, so it is waited for before the lease, inside rigd's 2-hour prepare limit. */
const DEEP_IDLE_WAIT_MS = 110 * 60_000;
const DEEP_IDLE_POLL_MS = 60_000;
/** Deep idle opens short maintenance windows; one is waited out before the dial. */
const MAINTENANCE_WAIT_MS = 3 * 60_000;

/** D03: as D02, in the deep idle the Pixel reached by itself. */
export const D03: ScenarioRunner = {
  id: "D03",
  async prepare(ctx) {
    const pixel = ctx.devices.pixel();
    const unreachable = await reachable(pixel);
    if (unreachable) return unreachable;
    // Found out now, not after two hours of waiting.
    const link = await connectedAudio(pixel);
    if ("failure" in link) return link.failure;
    const started = ctx.now();
    const idled = await onDevice(pixel, "letting it idle", () => pixel.idleNaturally());
    const idle = idled ? undefined : await poll(ctx, async () => (await pixel.state()).doze === "IDLE", DEEP_IDLE_WAIT_MS, DEEP_IDLE_POLL_MS);
    ctx.evidence.deep_idle_after_ms = idle ? ctx.now() - started : null;
    if (idle) return undefined;
    // No undo can be registered before the lease, so the battery goes back in here.
    await pixel.exitDoze().catch(() => undefined);
    return idled ?? infra("pixel", "never reached deep idle");
  },
  async run(ctx) {
    const pixel = ctx.devices.pixel();
    // First, before anything can fail: prepare left the Pixel idle and unplugged in software.
    resetOnRelease(ctx, pixel.name);
    const unreachable = await reachable(pixel);
    if (unreachable) return unreachable;
    const idle = await poll(ctx, async () => (await pixel.state()).doze === "IDLE", MAINTENANCE_WAIT_MS, 10_000);
    if (!idle) return infra("pixel", "the Pixel left deep idle between reaching it and the dial");
    return androidWake(ctx, pixel, "natural");
  },
};

export interface WakeExpectation {
  /** Telecom rings within this long, or null when the ring must not come. */
  ringsWithinMs: number | null;
  /** False until a real run has shown this is how Android behaves: the first run confirms it. */
  confirmed: boolean;
  why: string;
}

export interface D04Variant {
  name: string;
  /** Puts the Pixel in the variant's state, the screen off and locked. */
  apply(pixel: DeviceApi): Promise<void>;
  /** Whether the state took, as the Pixel reports it; absent when nothing reports it. */
  took?(state: DeviceState): boolean;
  /** An undo that device.reset does not cover. */
  undo?: string;
  expect: WakeExpectation;
}

/** `am get-standby-bucket` prints the framework's number on some releases and the name on others. */
const BUCKET_NUMBER: Readonly<Record<"rare" | "restricted", string>> = { rare: "40", restricted: "45" };
const inBucket = (bucket: "rare" | "restricted") => (state: DeviceState) =>
  state.standby_bucket === bucket || state.standby_bucket === BUCKET_NUMBER[bucket];

/**
 * D04's expectations table. Behaviour before the first unlock and under
 * hibernation differs between Android releases, which is why every row
 * waits for a run to confirm it.
 */
export const D04_VARIANTS: readonly D04Variant[] = [
  {
    name: "standby-rare",
    async apply(pixel) {
      await pixel.setStandbyBucket("rare");
      await pixel.lock();
    },
    took: inBucket("rare"),
    expect: { ringsWithinMs: 12_000, confirmed: false, why: "the rare bucket does not defer a high-priority FCM message" },
  },
  {
    name: "standby-restricted",
    async apply(pixel) {
      await pixel.setStandbyBucket("restricted");
      await pixel.lock();
    },
    took: inBucket("restricted"),
    expect: { ringsWithinMs: 12_000, confirmed: false, why: "the restricted bucket still admits a few high-priority FCM messages a day, and one ring is within them" },
  },
  {
    name: "battery-saver",
    async apply(pixel) {
      await pixel.batterySaver(true);
      await pixel.lock();
    },
    took: (state) => state.battery_saver === true,
    expect: { ringsWithinMs: 12_000, confirmed: false, why: "battery saver defers background work, not a high-priority FCM message" },
  },
  {
    name: "secure-lock",
    apply: (pixel) => pixel.lock(),
    expect: { ringsWithinMs: 12_000, confirmed: false, why: "the full-screen ring shows over the PIN keyguard" },
  },
  {
    name: "before-first-unlock",
    apply: (pixel) => pixel.reboot({ unlock: false }),
    expect: { ringsWithinMs: null, confirmed: false, why: "the app is not direct-boot aware, so FCM holds its message until the first unlock" },
  },
  {
    name: "hibernation",
    async apply(pixel) {
      await pixel.hibernate(true);
      await pixel.lock();
    },
    // Hibernating stops the app, and only opening it lifts that.
    undo: "device.launch",
    expect: { ringsWithinMs: null, confirmed: false, why: "hibernation stops the app, and FCM delivers nothing to a stopped app" },
  },
];

/** The variant a run tests: the registry runs D04 every 14 days, and each run takes the next. */
export function d04VariantOn(at: number): D04Variant {
  return D04_VARIANTS[Math.floor(at / DAY_MS / 14) % D04_VARIANTS.length]!;
}

/** A variant's ring against its expectation; a mismatch with an unconfirmed one asks for the table to be checked. */
export function d04Verdict(name: string, expectation: WakeExpectation, ring: Ring | undefined): ScenarioResult {
  const rang = ring !== undefined;
  const met =
    expectation.ringsWithinMs === null ? !rang : ring?.telecom_ms !== undefined && ring.telecom_ms <= expectation.ringsWithinMs;
  const wanted = expectation.ringsWithinMs === null ? "not to ring" : `to ring within ${expectation.ringsWithinMs / 1000} s`;
  if (met) return pass(`${name} behaved as expected: ${wanted}`);
  const observed = rang ? `rang (Telecom ${ring.telecom_ms ?? "never"} ms, full screen ${ring.full_screen_ms ?? "never"} ms)` : "did not ring";
  const key = name.replaceAll("-", "_");
  if (!expectation.confirmed) {
    return fail(
      `unconfirmed_${key}`,
      `${name} ${observed}; the table expects it ${wanted}, which no run has confirmed. If Android does this by design, correct the row and confirm it`,
    );
  }
  return fail(expectation.ringsWithinMs === null ? `rang_${key}` : `no_ring_${key}`, `${name} ${observed}, expected ${wanted}`);
}

/** D04: one Android variant per run, judged against the expectations table. */
export const D04: ScenarioRunner = {
  id: "D04",
  async run(ctx) {
    const pixel = ctx.devices.pixel();
    const unreachable = await reachable(pixel);
    if (unreachable) return unreachable;
    const variant = d04VariantOn(ctx.now());
    ctx.evidence.variant = variant.name;
    ctx.evidence.expected = variant.expect;
    resetOnRelease(ctx, pixel.name);
    if (variant.undo) ctx.lease.registerUndo({ kind: variant.undo, params: { device: pixel.name } });
    const applied = await onDevice(pixel, `putting it in ${variant.name}`, () => variant.apply(pixel));
    if (applied) return applied;
    const state = await pixel.state();
    ctx.evidence.device = { ...state };
    if (state.locked !== true || (variant.took && !variant.took(state))) {
      return infra(pixel.name, `${variant.name} did not take (locked ${String(state.locked)}, bucket ${state.standby_bucket ?? "unknown"}, saver ${String(state.battery_saver)})`);
    }
    const outcome = await ringOnly(ctx, pixel, PIXEL_LANE, variant.expect.ringsWithinMs ?? NO_RING_WAIT_MS);
    if ("failure" in outcome) return outcome.failure;
    return d04Verdict(variant.name, variant.expect, outcome.ring);
  },
};

/**
 * Before the app is uninstalled: the Pixel answers, D02's audio link is up,
 * and the undos are in. `device.install` is registered before `device.reset`
 * so that it runs after it, on a screen the reset has unlocked.
 */
async function readyToReinstall(ctx: ScenarioContext, pixel: DeviceApi): Promise<ScenarioResult | undefined> {
  const unreachable = await reachable(pixel);
  if (unreachable) return unreachable;
  const link = await connectedAudio(pixel);
  if ("failure" in link) return link.failure;
  ctx.lease.registerUndo({ kind: "device.install", params: { device: pixel.name, build: "current", member: PIXEL_LANE.member } });
  resetOnRelease(ctx, pixel.name);
  if ((await pixel.state()).locked === false) return undefined;
  return onDevice(pixel, "unlocking it for the sign-in", () => pixel.unlock());
}

/** Installs a build, which must be the nonprod package: any other could take production's pushes. */
async function install(pixel: DeviceApi, build: "current" | "previous", ev: Record<string, unknown>): Promise<ScenarioResult | undefined> {
  let pkg: string;
  try {
    pkg = await pixel.install(build);
  } catch (error) {
    return infra("apk", `installing the ${build} build failed: ${(error as Error).message}`);
  }
  ev[`${build}_package`] = pkg;
  if (!pkg.endsWith(".nonprod")) {
    return fail("not_nonprod_package", `the ${build} build installed ${pkg}; the rig runs only .nonprod builds`, { critical: true });
  }
  return undefined;
}

/** Opens a freshly installed app and signs the technician in; `noScreen` says whose fault a missing sign-in screen is. */
async function signIn(pixel: DeviceApi, ev: Record<string, unknown>, noScreen: (detail: string) => ScenarioResult): Promise<ScenarioResult | undefined> {
  // A person taps Allow on the notification prompt; the grant stands in for
  // that, before the prompt can cover the sign-in screen.
  const opened =
    (await onDevice(pixel, "allowing notifications", () => pixel.notificationsAllowed(true))) ??
    (await onDevice(pixel, "opening the app", () => pixel.launch()));
  if (opened) return opened;
  let shown: boolean;
  try {
    shown = await pixel.signIn(PIXEL_LANE.member);
  } catch (error) {
    return infra(pixel.name, `signing in failed: ${(error as Error).message}`);
  }
  ev.signed_in = shown;
  return shown ? undefined : noScreen(`no sign-in screen showed for ${PIXEL_LANE.member} (the lane looks for Email, Password and Sign in)`);
}

/**
 * The technician has somewhere to push to. It counts rows, so a token the
 * uninstalled build left behind counts as well: D02p's beacons are what show
 * that this install's token works.
 */
async function pushTargetStored(ctx: ScenarioContext, ev: Record<string, unknown>, key: string): Promise<ScenarioResult | undefined> {
  const count = await poll(ctx, async () => {
    const targets = await ctx.app.pushTargets({ member: PIXEL_LANE.member });
    return targets > 0 ? targets : undefined;
  }, 60_000, 5_000);
  ev[key] = count ?? 0;
  return count ? undefined : fail("push_token_not_stored", `${PIXEL_LANE.member} has no push target a minute after signing in`);
}

/** D10: a fresh install signs in, stores its push token, then passes D02p and D02. */
export const D10: ScenarioRunner = {
  id: "D10",
  async run(ctx) {
    const pixel = ctx.devices.pixel();
    const ready = await readyToReinstall(ctx, pixel);
    if (ready) return ready;
    const ev = section(ctx, "install");
    const installed =
      (await onDevice(pixel, "uninstalling the app", () => pixel.uninstall())) ??
      (await install(pixel, "current", ev)) ??
      (await signIn(pixel, ev, (detail) => fail("no_sign_in_screen", detail))) ??
      (await pushTargetStored(ctx, ev, "push_targets"));
    if (installed) return installed;
    return (await pushWake(ctx, pixel, section(ctx, "push_wake"))) ?? (await androidWake(ctx, pixel, "force", section(ctx, "call_wake")));
  },
};

/** D12: the previous release, signed in, upgraded in place; its push token survives, then D02p and D02 pass. */
export const D12: ScenarioRunner = {
  id: "D12",
  async run(ctx) {
    const pixel = ctx.devices.pixel();
    const ready = await readyToReinstall(ctx, pixel);
    if (ready) return ready;
    const ev = section(ctx, "upgrade");
    // The previous build only sets the scene, so its failures are the rig's to report.
    const previous =
      (await onDevice(pixel, "uninstalling the app", () => pixel.uninstall())) ??
      (await install(pixel, "previous", ev)) ??
      (await signIn(pixel, ev, (detail) => infra("apk", `the previous build: ${detail}`)));
    if (previous) return previous;
    ev.push_targets_before = await ctx.app.pushTargets({ member: PIXEL_LANE.member });
    ev.version_before = (await pixel.state()).app_version;
    // adb install -r keeps the app's data and leaves it closed, as an update from the store does.
    const upgraded = await install(pixel, "current", ev);
    if (upgraded) return upgraded;
    ev.version_after = (await pixel.state()).app_version;
    const kept = await pushTargetStored(ctx, ev, "push_targets_after");
    if (kept) return kept;
    return (await pushWake(ctx, pixel, section(ctx, "push_wake"))) ?? (await androidWake(ctx, pixel, "force", section(ctx, "call_wake")));
  },
};

/** D11's clock starts at the disruption: power cycle, reboot and emulator restarts included. */
const RECOVERY_MS = 10 * 60_000;
/** `rig health` runs the whole CLI each time, so it is asked no more than once a minute. */
const HEALTH_POLL_MS = 60_000;

/** D11: the Pixel power-cycled and rebooted and every emulator restarted; health green within 10 min, then D02p. */
export const D11: ScenarioRunner = {
  id: "D11",
  async run(ctx) {
    const pixel = ctx.devices.pixel();
    const unreachable = await reachable(pixel);
    if (unreachable) return unreachable;
    const ev = section(ctx, "recovery");
    resetOnRelease(ctx, pixel.name);
    for (const api of EMULATOR_APIS) ctx.lease.registerUndo({ kind: "device.boot", params: { device: `emulator-${api}` } });
    const started = ctx.now();
    try {
      await ctx.devices.powerCycle();
    } catch (error) {
      return infra("usb-hub", `power-cycling the Pixel's port failed: ${(error as Error).message}`);
    }
    // Every restart is tried; health judges what came back.
    const errors: string[] = [];
    const attempt = async (what: string, action: () => Promise<void>) => {
      try {
        await action();
      } catch (error) {
        errors.push(`${what}: ${(error as Error).message}`);
      }
    };
    const back = await poll(ctx, () => pixel.reachable(), 2 * 60_000, 5_000);
    if (back) await attempt("reboot pixel", () => pixel.reboot());
    else errors.push("the Pixel did not come back after its port was power-cycled");
    // In parallel: one at a time, three cold boots would take most of the 10 minutes.
    await Promise.all(
      EMULATOR_APIS.map(async (api) => {
        await attempt(`shut down emulator-${api}`, () => ctx.devices.shutdownEmulator(api));
        await attempt(`boot emulator-${api}`, () => ctx.devices.bootEmulator(api));
      }),
    );
    ev.restart_errors = errors;
    ev.restarted_after_ms = ctx.now() - started;

    const deadline = started + RECOVERY_MS;
    let failing: string[] = ["no report"];
    let polls = 0;
    for (;;) {
      polls++;
      try {
        failing = (await ctx.rig.health()).results.filter((r) => !r.pass).map((r) => r.name);
      } catch (error) {
        failing = [`rig health: ${(error as Error).message}`];
      }
      if (failing.length === 0 || ctx.now() + HEALTH_POLL_MS > deadline) break;
      await ctx.sleep(HEALTH_POLL_MS);
    }
    ev.health_polls = polls;
    ev.failing = failing;
    if (failing.length > 0) return fail("health_not_green_in_10min", `still failing 10 min after the disruption: ${failing.join(", ")}`);
    ev.green_after_ms = ctx.now() - started;
    if (!(await pixel.reachable())) return fail("pixel_not_recovered", "health is green but adb does not see the Pixel");
    // The rig's reboot unlocks; one that left the Pixel before its first unlock must not fail the wake.
    if ((await pixel.state()).locked !== false) {
      const unlocked = await onDevice(pixel, "unlocking it", () => pixel.unlock());
      if (unlocked) return unlocked;
    }
    return (await pushWake(ctx, pixel, section(ctx, "push_wake"))) ?? pass();
  },
};

const WEEK_MS = 7 * DAY_MS;

/**
 * The robot's verdict on an emulator's code. Emulator audio is the weak half
 * of the lane, so one level not heard is recorded, and the lane is degraded
 * only when no level has been heard all week, which only E01's own earlier
 * attempts can show.
 */
export async function weeklyAudio(ctx: ScenarioContext, api: EmulatorApi, heard: boolean): Promise<ScenarioResult> {
  ctx.evidence.audio = { api, heard };
  if (heard) return pass();
  const attempts = await ctx.history.attempts({ since: ctx.now() - WEEK_MS });
  const heardThisWeek = attempts.find((a) => (a.evidence?.audio as { heard?: unknown } | undefined)?.heard === true);
  if (!heardThisWeek) {
    return fail("emulator-audio-degraded", `the robot has heard no emulator's code in 7 days; API ${api}'s was not heard either`);
  }
  const level = (heardThisWeek.evidence?.audio as { api?: unknown } | undefined)?.api;
  return pass(`API ${api}'s code was not heard; API ${String(level)}'s was, at ${heardThisWeek.finished_at}`);
}

/** Each E01 run's variant, and how many days its runs are apart, which steps the API level. */
const E01_EVERY_DAYS: Readonly<Record<string, number>> = { wake: 3, "notifications revoked": 7, "force-stopped": 7 };

/** The API level a run takes: each variant's runs step through 34, 35 and 36 in turn. */
export function emulatorApiOn(at: number, everyDays: number): EmulatorApi {
  return EMULATOR_APIS[Math.floor(at / DAY_MS / everyDays) % EMULATOR_APIS.length]!;
}

/**
 * E01: as D02 on an emulator, rotating through API 34, 35 and 36. The weekly
 * variants, notifications revoked and force-stopped, must not ring; they run
 * here only, because a push the device drops could teach FCM to deprioritise
 * the package. An emulator has no audio lane, so its hearing is the robot's.
 */
export const E01: ScenarioRunner = {
  id: "E01",
  async run(ctx) {
    const variant = ctx.slot.label ?? "wake";
    const everyDays = E01_EVERY_DAYS[variant];
    if (everyDays === undefined) return infra("runner", `E01 has no variant named ${variant}`);
    const api = emulatorApiOn(ctx.now(), everyDays);
    ctx.evidence.variant = variant;
    ctx.evidence.api = api;
    const device = ctx.devices.emulator(api);
    if (!(await device.reachable())) {
      try {
        await ctx.devices.bootEmulator(api);
      } catch (error) {
        return infra(device.name, `booting it failed: ${(error as Error).message}`);
      }
      const booted = await reachable(device);
      if (booted) return booted;
    }
    resetOnRelease(ctx, device.name);

    if (variant === "wake") {
      const setup = await killedAsleepLocked(device, "force");
      if (setup) return setup;
      ctx.evidence.device = { ...(await device.state()) };
      const outcome = await callWake(ctx, device, EMULATOR_LANE, { judgeRobotHearing: false });
      return outcome.failure ?? (await weeklyAudio(ctx, api, outcome.robotHeardDevice === true));
    }

    const stopped = variant === "force-stopped";
    if (stopped) ctx.lease.registerUndo({ kind: "device.launch", params: { device: device.name } });
    const changed = stopped
      ? await onDevice(device, "force-stopping the app", () => device.forceStop())
      : await onDevice(device, "revoking notifications", () => device.notificationsAllowed(false));
    if (changed) return changed;
    const outcome = await ringOnly(ctx, device, EMULATOR_LANE, NO_RING_WAIT_MS);
    if ("failure" in outcome) return outcome.failure;
    if (outcome.ring) {
      return fail(
        stopped ? "rang_when_force_stopped" : "rang_with_notifications_revoked",
        `API ${api} rang (Telecom ${outcome.ring.telecom_ms ?? "never"} ms, full screen ${outcome.ring.full_screen_ms ?? "never"} ms) when it must not`,
      );
    }
    return pass();
  },
};
