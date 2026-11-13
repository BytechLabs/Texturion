/**
 * The rig's health and the Android call scenarios: R00, D01, D07, D08, D09,
 * D13 and D14. The calls ring or start on QA-A's DEV-A1, whose surfaces are
 * the dispatcher's page and the device lane's emulator (`pixel`, the AVD
 * rig-pixel), signed in as QA-A's technician. Its audio goes through the
 * emulator's gRPC controller, and its network through the emulator's console.
 *
 * None of these sends a text, so no body carries the nonce; what each run
 * changes (ring audience, the emulator and its network, D14's voicemail) is
 * undone by the lease.
 */
import type { GuardHealth } from "@loonext/rig-protocol";
import type { DeviceState, HostdHealth, NetworkShape, RigDeviceName } from "@loonext/rig-lanes";
import type { CallRecord, Detection, Surface } from "@loonext/rig-robot";
import { MAX_WORD_ERROR, VOICEMAIL_PHRASE } from "./calls.ts";
import {
  audioFault,
  audioReady,
  fail,
  infra,
  pass,
  poll,
  wordErrorRate,
  type AudioLinkApi,
  type DeviceApi,
  type RigHealthReport,
  type ScenarioContext,
  type ScenarioResult,
  type ScenarioRunner,
} from "./context.ts";

const TENANT = "QA-A";
const NUMBER = "DEV-A1";
const DISPATCHER = "qa-a-dispatcher" satisfies Surface;
const TECHNICIAN = "qa-a-technician";
const MEMBER_OF: Partial<Record<Surface, string>> = { [DISPATCHER]: DISPATCHER, pixel: TECHNICIAN };

type RingLevel = "text" | "note" | null;
type Member = typeof DISPATCHER | typeof TECHNICIAN;
/** DEV-A1's audience at rest (scripts/rig/tenants.mjs): the technician rings, the dispatcher only under a lease. */
const AT_REST: Record<Member, RingLevel> = { [DISPATCHER]: null, [TECHNICIAN]: "text" };

const TALK_MS = 25_000;
const CLEARED: ReadonlySet<string> = new Set(["none", "disconnected"]);

/** What a call keeps as evidence: ids, timings and verdicts, never audio and never a phone number. */
function callEvidence(record: CallRecord): Record<string, unknown> {
  const { frames: _frames, ...judgement } = record.judgement ?? {};
  return {
    ids: record.ids,
    state: record.state,
    from_role: record.from_role,
    dialed_at: record.dialed_at,
    answered_at: record.answered_at,
    ended_at: record.ended_at,
    hangup: record.hangup,
    rtp: record.rtp,
    robot_heard: record.judgement ? judgement : undefined,
    robot_frames: record.judgement?.frames,
    recording_deleted: record.recording_deleted,
    errors: record.errors,
  };
}

function heardEvidence(detection: Detection): Record<string, unknown> {
  return { verdict: detection.verdict, answered: detection.answered, heard: detection.heard, echo: detection.echo };
}

function guardRefusal(record: CallRecord): ScenarioResult | undefined {
  const refusal = record.errors.find((e) => e.startsWith("guard_refused:"));
  return refusal ? infra("guard", refusal) : undefined;
}

/** A plan the robot could not start: the guard's refusal, or the robot's own fault. */
function notStarted(record: CallRecord): ScenarioResult | undefined {
  if (record.state !== "failed") return undefined;
  return guardRefusal(record) ?? infra("robot", record.errors.join("; ") || "the robot could not start the call");
}

/** A call the guard refused or that never connected: undefined once the robot answered. */
function unconnected(record: CallRecord): ScenarioResult | undefined {
  const refused = guardRefusal(record);
  if (refused) return refused;
  return record.answered_at ? undefined : fail("not_answered", `the call never connected (${record.errors.join("; ") || record.state})`);
}

/** The robot's side of a call it judged against one expected surface: undefined when it heard that surface. */
function robotVerdict(record: CallRecord, surface: Surface, failureClass: string): ScenarioResult | undefined {
  const dropped = unconnected(record);
  if (dropped) return dropped;
  if (!record.judgement) return infra("robot", `no verdict on the robot's recording (${record.errors.join("; ") || record.state})`);
  if (!record.judgement.pass) return fail(failureClass, `the robot heard ${record.judgement.heard.join(", ") || record.judgement.verdict}, not ${surface}`);
  if (!record.recording_deleted) return infra("robot", "the robot could not delete Telnyx's copy of its recording");
  return undefined;
}

function isResult(value: object): value is ScenarioResult {
  return "outcome" in value;
}

/** The device lane's emulator with its gRPC audio, or the reason the rig cannot give it. */
async function pixelWithAudio(ctx: ScenarioContext): Promise<{ device: DeviceApi; audio: AudioLinkApi } | ScenarioResult> {
  let device: DeviceApi;
  try {
    device = ctx.devices.pixel();
  } catch (error) {
    return infra("pixel", (error as Error).message);
  }
  if (!(await device.reachable())) return infra("pixel", "adb does not see the device lane's emulator, or it has not finished booting");
  return (await audioReady(device)) ?? { device, audio: device.audio };
}

/** Plays the emulator's code; a refusal is the rig's to report. */
async function playPixelCode(audio: AudioLinkApi): Promise<ScenarioResult | undefined> {
  try {
    await audio.playCode("pixel");
    return undefined;
  } catch (error) {
    return audioFault(error);
  }
}

/** The device lane at rest is unlocked; one found locked is unlocked, and the reset puts the rest back too. */
async function readyToDial(ctx: ScenarioContext, device: DeviceApi): Promise<void> {
  ctx.lease.registerUndo({ kind: "device.reset", params: { device: "pixel" } });
  if ((await device.state()).locked) await device.unlock();
}

/** The labels the device lane finds the app's dialer by are unverified on the nonprod build, so a miss is the lane's. */
async function dialFromPixel(device: DeviceApi): Promise<ScenarioResult | undefined> {
  try {
    await device.callPermissionsAllowed();
    await device.dial("ROBOT-1");
    return undefined;
  } catch (error) {
    return infra("android-dialer", (error as Error).message);
  }
}

/** Ends whatever call the emulator still holds, so a robot that never hung up cannot leave it open. */
async function endPixelCall(device: DeviceApi): Promise<void> {
  try {
    const state = await device.callState();
    if (state === "active" || state === "holding") await device.tap("call_hang_up");
    else if (state === "ringing") await device.tap("call_decline");
  } catch {
    // The verdict already stands; the lease's device reset follows.
  }
}

/**
 * Sets members' levels on DEV-A1. Each undo is registered before any change
 * and restores the level at rest, so a run killed half way, or one after an
 * undo that failed, still leaves the seed's audience. Resolves with the
 * levels found, which differ from rest only after such a failure.
 */
async function setAudience(ctx: ScenarioContext, levels: Partial<Record<Member, RingLevel>>): Promise<Record<string, RingLevel>> {
  const members = Object.keys(levels) as Member[];
  for (const member of members) {
    ctx.lease.registerUndo({ kind: "app.ring-audience", params: { tenant: TENANT, role: NUMBER, member, level: AT_REST[member] } });
  }
  const found: Record<string, RingLevel> = {};
  for (const member of members) {
    found[member] = await ctx.app.setRingAudience({ tenant: TENANT, role: NUMBER, member, level: levels[member] ?? null });
  }
  return found;
}

/** The record once the robot has answered, or once it gave up. */
function untilAnswered(ctx: ScenarioContext, planId: string, timeoutMs: number): Promise<CallRecord | undefined> {
  return poll(ctx, async () => {
    const record = await ctx.robot.wait(planId, 1_000);
    return record.answered_at || record.state === "done" || record.state === "failed" ? record : undefined;
  }, timeoutMs, 500);
}

/** How long until the emulator holds no call, or undefined at the deadline. */
function pixelCleared(ctx: ScenarioContext, device: DeviceApi, from: number, timeoutMs: number): Promise<number | undefined> {
  return poll(ctx, async () => (CLEARED.has(await device.callState()) ? ctx.now() - from : undefined), timeoutMs, 250);
}

/** The database's one answered leg for ROBOT-1's call, which must be the expected member's. */
async function oneWinner(ctx: ScenarioContext, since: number, member: string): Promise<ScenarioResult | undefined> {
  const row = await poll(ctx, async () => (await ctx.app.calls({ tenant: TENANT, callerRole: "ROBOT-1", since })).at(-1), 60_000, 2_000);
  if (!row) return fail("no_call_row", "no call row for ROBOT-1's call to DEV-A1");
  const legs = await ctx.app.callLegs({ tenant: TENANT, callSessionId: row.call_session_id });
  ctx.evidence.legs = legs.map((leg) => ({ member: leg.member, state: leg.state, kind: leg.kind }));
  const answered = legs.filter((leg) => leg.state === "answered");
  if (answered.length !== 1) return fail("not_one_winner", `${answered.length} legs of the call are answered in the database`);
  if (answered[0]!.member !== member) return fail("wrong_winner", `the database's winner is ${answered[0]!.member ?? "nobody"}, not ${member}`);
  return undefined;
}

const MISSING_SECRET = /^rig secrets: \S+ is not in the store\b/;
const EMULATOR_APIS = [34, 35, 36] as const;

/** One result for the run: a critical failure first, then any failure, then the rig's own faults; the rest are named after it. */
function firstOf(findings: ScenarioResult[]): ScenarioResult | undefined {
  const rank = (r: ScenarioResult) => (r.outcome === "fail" ? (r.critical ? 0 : 1) : 2);
  const [first, ...rest] = [...findings].sort((a, b) => rank(a) - rank(b));
  if (!first || rest.length === 0) return first;
  const also = rest.map((r) => (r.outcome === "fail" ? r.failure_class : r.outcome === "infra" ? `${r.component} (infra)` : r.outcome)).join(", ");
  if (first.outcome === "fail") return fail(first.failure_class, `${first.detail}; also ${also}`, { critical: first.critical });
  if (first.outcome === "infra") return infra(first.component, `${first.detail}; also ${also}`);
  return first;
}

async function healthFindings(ctx: ScenarioContext): Promise<ScenarioResult[]> {
  let report: RigHealthReport;
  try {
    report = await ctx.rig.health();
  } catch (error) {
    return [infra("rig-health", (error as Error).message)];
  }
  ctx.evidence.room = report.room ?? null;
  if (typeof report.room === "number") ctx.evidence.blocked_by_room = ctx.blockedAt(report.room);
  ctx.evidence.health = report.results.map((r) => ({ name: r.name, pass: r.pass }));
  return report.results
    .filter((r) => !r.pass)
    .map((r) => {
      const reason = `${r.name}: ${r.reason ?? "no reason given"}`;
      if (r.reason && MISSING_SECRET.test(r.reason)) return infra("store", reason);
      return fail(`health_${r.name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`, reason);
    });
}

async function guardFindings(ctx: ScenarioContext): Promise<ScenarioResult[]> {
  let health: GuardHealth;
  try {
    health = await ctx.guard.health();
  } catch (error) {
    return [infra("guard", (error as Error).message)];
  }
  const { safety } = health.telnyx;
  ctx.evidence.guard = { ok: health.ok, balance_above_floor: health.balance_above_floor, safety: safety.state, room: health.room ?? null };
  const found: ScenarioResult[] = [];
  // Unsafe is what the start-up checks call a nonprod resource wired to production.
  if (safety.state === "unsafe") {
    const why = safety.reasons.join(", ") || "no reason given";
    found.push(fail("isolation_unsafe", `the guard's start-up checks found the partition unsafe: ${why}`, { critical: true }));
  } else if (health.telnyx.key === "absent") found.push(infra("guard", "the guard holds no Telnyx key"));
  else if (!health.ok) found.push(fail("guard_not_ok", `the guard does not report ok (start-up checks ${safety.state})`));
  if (!health.balance_above_floor) found.push(fail("balance_below_floor", "the guard reports the Telnyx balance below its floor"));
  return found;
}

/** hostd's report on the Windows host: WHPX and the tunnel must be up; a pending Windows reboot is only reported. */
async function hostFindings(ctx: ScenarioContext): Promise<ScenarioResult[]> {
  let host: HostdHealth;
  try {
    host = await ctx.devices.hostHealth();
  } catch (error) {
    return [infra("hostd", (error as Error).message)];
  }
  ctx.evidence.host = { ...host };
  const found: ScenarioResult[] = [];
  if (!host.whpx_usable) found.push(fail("whpx_unusable", "hostd reports WHPX unusable, so no emulator boots accelerated"));
  if (!host.tunnel_up) found.push(fail("hostd_tunnel_down", "hostd reports its tunnel into the VM down"));
  return found;
}

/**
 * What every booted emulator must show: deep Doze enabled, which each boot
 * turns off until rigd enables it again, and Play services at the versionName
 * its image pins. Nothing updates Play services on a headless, signed-out
 * image, so a different one means the image changed under the rig.
 */
function bootedFindings(ctx: ScenarioContext, device: DeviceApi, state: DeviceState, evidence: Record<string, unknown>): ScenarioResult[] {
  const found: ScenarioResult[] = [];
  const lane = device.name === "pixel" ? "pixel" : "emulator";
  if (state.deep_idle_enabled === null) found.push(infra(device.name, "whether deep Doze is enabled could not be read"));
  else if (!state.deep_idle_enabled) found.push(fail(`${lane}_deep_idle_disabled`, `${device.name} has deep Doze off, as a boot leaves it until rigd enables it`));
  let pin: string | undefined;
  try {
    pin = ctx.devices.playServicesPin(device.name as RigDeviceName);
  } catch (error) {
    found.push(infra("store", (error as Error).message));
    return found;
  }
  evidence.play_services_pin = pin ?? null;
  if (pin === undefined) found.push(infra("store", `play-services-pins.json pins no Play services version for ${device.name}`));
  else if (state.play_services_version_name === null) found.push(infra(device.name, "Play services' versionName could not be read"));
  else if (state.play_services_version_name !== pin) {
    found.push(infra("play-services-pin", `${device.name} runs Play services ${state.play_services_version_name}, but play-services-pins.json pins ${pin}: its image changed`));
  }
  return found;
}

async function pixelFindings(ctx: ScenarioContext): Promise<ScenarioResult[]> {
  let pixel: DeviceApi;
  try {
    pixel = ctx.devices.pixel();
  } catch (error) {
    return [infra("pixel", (error as Error).message)];
  }
  if (!(await pixel.reachable())) return [infra("pixel", "adb does not see the device lane's emulator booted")];
  const state = await pixel.state();
  const found: ScenarioResult[] = [];
  const evidence: Record<string, unknown> = {
    locked: state.locked,
    deep_idle_enabled: state.deep_idle_enabled,
    play_services_version: state.play_services_version,
    play_services_version_name: state.play_services_version_name,
  };
  ctx.evidence.pixel = evidence;
  // A run that holds the device lane while it prepares has put it out of rest on purpose.
  const holder = ctx.laneHeldBy("device");
  if (holder) evidence.held_by = holder;
  else if (state.locked === null) found.push(infra("pixel", "the device lane's lock state could not be read"));
  else if (state.locked) found.push(fail("pixel_locked", "the device lane's emulator is locked, and at rest it is not"));
  found.push(...bootedFindings(ctx, pixel, state, evidence));
  evidence.audio_connected = await pixel.audio.connected();
  evidence.audio_proven = await pixel.audio.proven();
  if (!evidence.audio_connected) found.push(fail("pixel_audio_link_down", "the device lane's gRPC audio link does not answer getStatus"));
  else {
    const unproven = await audioReady(pixel);
    if (unproven) found.push(unproven);
  }
  let minimum: number | null;
  try {
    minimum = await pixel.playServicesMinimum();
  } catch (error) {
    found.push(infra("pixel", `the app's Play services minimum could not be read: ${(error as Error).message}`));
    return found;
  }
  evidence.play_services_minimum = minimum;
  if (minimum === null) found.push(infra("app-build", "the installed nonprod build declares no com.google.android.gms.version"));
  else if (state.play_services_version === null) found.push(infra("pixel", "Play services' version could not be read"));
  else if (state.play_services_version < minimum) {
    found.push(fail("play_services_below_minimum", `Play services ${state.play_services_version} is below the app's minimum ${minimum}`));
  }
  return found;
}

/**
 * E01's AVDs are checked when booted. At most three emulators run at once,
 * the device lane's among them, so one that is down is E01's to boot.
 */
async function emulatorFindings(ctx: ScenarioContext): Promise<ScenarioResult[]> {
  const booted: Record<string, boolean> = {};
  const found: ScenarioResult[] = [];
  for (const api of EMULATOR_APIS) {
    const device = ctx.devices.emulator(api);
    booted[api] = await device.reachable();
    if (booted[api]) found.push(...bootedFindings(ctx, device, await device.state(), {}));
  }
  ctx.evidence.emulators = booted;
  return found;
}

/** R00: `rig health`, the guard, hostd, the device lane and the booted emulators, and the room published with the scenarios it blocks. */
export const R00: ScenarioRunner = {
  id: "R00",
  async run(ctx) {
    const findings = [
      ...(await healthFindings(ctx)),
      ...(await guardFindings(ctx)),
      ...(await hostFindings(ctx)),
      ...(await pixelFindings(ctx)),
      ...(await emulatorFindings(ctx)),
    ];
    ctx.evidence.findings = findings.map((r) =>
      r.outcome === "fail" ? { fail: r.failure_class } : r.outcome === "infra" ? { infra: r.component } : { outcome: r.outcome },
    );
    return firstOf(findings) ?? pass();
  },
};

const WEEK_MS = 7 * 86_400_000;
const RING_WITHIN_MS = 8_000;
const OTHER_CLEARS_MS = 3_000;

/** Which surface answers D01 this week: they alternate, so each is the answerer every other run. */
export function d01Answerer(at: number): "page" | "pixel" {
  return Math.floor(at / WEEK_MS) % 2 === 0 ? "page" : "pixel";
}

/**
 * D01: ROBOT-1 rings DEV-A1 with the dispatcher added, so the page and the
 * device lane's emulator both ring. The emulator plays its code whichever
 * answers, so a leg bridged that should not be is heard.
 */
export const D01: ScenarioRunner = {
  id: "D01",
  async run(ctx) {
    const pixel = await pixelWithAudio(ctx);
    if (isResult(pixel)) return pixel;
    const answerer = d01Answerer(ctx.now());
    const surface: Surface = answerer === "page" ? DISPATCHER : "pixel";
    ctx.evidence.answerer = surface;
    const page = await ctx.browser.open(DISPATCHER, DISPATCHER);
    ctx.evidence.audience_before = await setAudience(ctx, { [DISPATCHER]: "text" });

    const unplayed = await playPixelCode(pixel.audio);
    if (unplayed) return unplayed;
    try {
      const since = ctx.now();
      const dialed = await ctx.robot.dial({
        scenario: ctx.scenario,
        lease_id: ctx.lease.id,
        direction: "outbound",
        role: "ROBOT-1",
        to: NUMBER,
        expect: surface,
        exclusive: true,
        hangup_after_ms: TALK_MS,
      });
      const refused = notStarted(dialed);
      if (refused) return refused;

      const [pageRingMs, rings] = await Promise.all([page.waitForRing(RING_WITHIN_MS), pixel.device.waitForRinging(RING_WITHIN_MS)]);
      ctx.evidence.ring = { page_ms: pageRingMs, telecom_ms: rings?.telecom_ms, full_screen_ms: rings?.full_screen_ms };
      const unrung =
        pageRingMs === undefined
          ? fail("page_did_not_ring", "the dispatcher's page did not ring within 8 s")
          : rings?.telecom_ms === undefined
            ? fail("pixel_not_ringing", "Telecom did not report the call ringing on the emulator within 8 s")
            : rings.full_screen_ms === undefined
              ? fail("no_full_screen_ring", "the emulator's full-screen ring did not show within 8 s")
              : undefined;
      if (unrung) {
        await ctx.robot.wait(dialed.plan_id, 90_000);
        return unrung;
      }

      if (answerer === "page") await page.answer();
      else if (!(await pixel.device.tap("call_answer"))) {
        await ctx.robot.wait(dialed.plan_id, 90_000);
        return fail("pixel_answer_control_missing", "the emulator's ring offered no answer control");
      }
      const answeredAt = ctx.now();
      const clearedMs =
        answerer === "page" ? await pixelCleared(ctx, pixel.device, answeredAt, OTHER_CLEARS_MS) : await page.waitForCallCleared(OTHER_CLEARS_MS);
      ctx.evidence.other_cleared_ms = clearedMs;

      const record = await ctx.robot.wait(dialed.plan_id, 180_000);
      ctx.evidence.call = callEvidence(record);
      const robot = robotVerdict(record, surface, "robot_did_not_hear_answerer");
      if (robot) return robot;
      if (clearedMs === undefined) {
        return fail("other_surface_kept_ringing", `${answerer === "page" ? "the emulator" : "the page"} still showed the call 3 s after the ${answerer} answered`);
      }
      return (await oneWinner(ctx, since, MEMBER_OF[surface]!)) ?? pass();
    } finally {
      await pixel.audio.stop();
      await endPixelCall(pixel.device);
    }
  },
};

const PIXEL_HEARS_MS = 12_000;
const BOTH_WAYS = "both ways";

/**
 * D07's runs, by which of the emulator's gRPC audio calls each opens. A
 * one-sided run opens one, so an emulator fault during a live call can be put
 * on `injectAudio` or on `streamAudio` (docs/RIG.md risk 19).
 */
const D07_AUDIO: Readonly<Record<string, { speaks: boolean; listens: boolean }>> = {
  [BOTH_WAYS]: { speaks: true, listens: true },
  "speaks only": { speaks: true, listens: false },
  "listens only": { speaks: false, listens: true },
};

/** An emulator that died under the call is the rig's fault, whatever the call then looked like. */
async function emulatorDown(ctx: ScenarioContext, device: DeviceApi): Promise<ScenarioResult | undefined> {
  const answers = await device.reachable();
  ctx.evidence.emulator_answers_adb = answers;
  return answers ? undefined : infra("pixel", "the emulator stopped answering adb during the call");
}

/**
 * D07: the device lane's emulator calls ROBOT-1 from DEV-A1; codes are heard
 * both ways and the caller ID is DEV-A1. A one-sided run judges its own half.
 */
export const D07: ScenarioRunner = {
  id: "D07",
  async run(ctx) {
    const variant = ctx.slot.label ?? BOTH_WAYS;
    const half = D07_AUDIO[variant];
    if (!half) return infra("runner", `D07 has no variant named ${variant}`);
    ctx.evidence.variant = variant;
    const pixel = await pixelWithAudio(ctx);
    if (isResult(pixel)) return pixel;
    await readyToDial(ctx, pixel.device);
    const plan = await ctx.robot.expect({
      scenario: ctx.scenario,
      lease_id: ctx.lease.id,
      direction: "inbound",
      role: "ROBOT-1",
      answer_after_ms: 4_000,
      expect_within_ms: 60_000,
      // An emulator that injects nothing gives the robot no code to judge.
      ...(half.speaks ? { expect: "pixel" as const } : { record: false }),
      hangup_after_ms: TALK_MS,
    });
    const unplanned = notStarted(plan);
    if (unplanned) return unplanned;

    const unplayed = half.speaks ? await playPixelCode(pixel.audio) : undefined;
    if (unplayed) return unplayed;
    try {
      const undialed = await dialFromPixel(pixel.device);
      if (undialed) return undialed;
      const answered = await untilAnswered(ctx, plan.plan_id, 90_000);
      // The emulator's ear opens at answer, the window the robot's code plays in.
      let heard: Detection | undefined;
      try {
        heard = half.listens && answered?.answered_at ? await pixel.audio.hear({ stream: "call", ms: PIXEL_HEARS_MS, own: "pixel" }) : undefined;
      } catch (error) {
        await ctx.robot.wait(plan.plan_id, 180_000);
        return (await emulatorDown(ctx, pixel.device)) ?? audioFault(error);
      }
      const record = await ctx.robot.wait(plan.plan_id, 180_000);
      ctx.evidence.call = { ...callEvidence(record), pixel_heard: heard ? heardEvidence(heard) : undefined };
      const down = await emulatorDown(ctx, pixel.device);
      if (down) return down;

      const robot = half.speaks ? robotVerdict(record, "pixel", "robot_did_not_hear_pixel") : unconnected(record);
      if (robot) return robot;
      if (record.from_role !== NUMBER) return fail("wrong_caller_id", `the robot saw the call from ${record.from_role ?? "nobody"}, not DEV-A1`);
      if (half.listens && heard?.answered !== "robot") {
        return fail("pixel_did_not_hear_robot", `the emulator heard ${heard?.heard.join(", ") || heard?.verdict || "nothing"}`);
      }
      return pass(variant === BOTH_WAYS ? undefined : `${variant}: the other half of the audio was not judged`);
    } finally {
      await pixel.audio.stop();
      await endPixelCall(pixel.device);
    }
  },
};

const CALL_TAG = "loonext:call";
const RING_SHOWS_MS = 10_000;
/** The robot gives up ringing before DEV-A1's voicemail would answer, so the outcome is a missed call. */
const RING_FOR_MS = 15_000;
const OUTCOME_SHOWS_MS = 30_000;

/**
 * D08: a dispatcher-only audience, the dispatcher's Chrome with push on and
 * its page in the background. The ring arrives as a notification and the
 * outcome replaces it on the same tag. Notification text can carry the
 * caller, so only tags and timings are kept.
 */
export const D08: ScenarioRunner = {
  id: "D08",
  async run(ctx) {
    const page = await ctx.browser.open(DISPATCHER, DISPATCHER, "/", { push: true });
    if (!(await page.enablePush())) {
      return infra(
        "push-target",
        "the dispatcher's browser could not subscribe to push: Web Push needs Google Chrome (RIG_CHROME_BIN), and Chromium has no push service",
      );
    }
    const saved = await poll(ctx, async () => (await ctx.app.pushTargets({ member: DISPATCHER })) > 0, 10_000);
    if (!saved) return fail("push_subscription_not_saved", "the page subscribed to push but the API kept no subscription");
    ctx.evidence.audience_before = await setAudience(ctx, { [DISPATCHER]: "text", [TECHNICIAN]: "note" });
    await page.background();

    // The profile keeps earlier calls' outcome cards; only a tag new since now is this call's ring.
    const earlier = new Set((await page.notifications()).map((n) => n.tag));
    const since = ctx.now();
    const dialed = await ctx.robot.dial({
      scenario: ctx.scenario,
      lease_id: ctx.lease.id,
      direction: "outbound",
      role: "ROBOT-1",
      to: NUMBER,
      play: null,
      record: false,
      hangup_before_answer_ms: RING_FOR_MS,
      hangup_after_ms: 20_000,
      ring_timeout_secs: 30,
    });
    const refused = notStarted(dialed);
    if (refused) return refused;
    const ring = await poll(ctx, async () => (await page.notifications()).find((n) => n.tag.startsWith(CALL_TAG) && !earlier.has(n.tag)), RING_SHOWS_MS, 500);
    ctx.evidence.ring = ring ? { tag: ring.tag, shown_ms: ctx.now() - since } : undefined;

    const record = await ctx.robot.wait(dialed.plan_id, 120_000);
    ctx.evidence.call = callEvidence(record);
    const robotRefused = guardRefusal(record);
    if (robotRefused) return robotRefused;
    if (!ring) return fail("no_ring_notification", "Chrome showed no ring notification within 10 s");
    const hungUpAt = ctx.now();
    const outcome = await poll(
      ctx,
      async () => (await page.notifications()).find((n) => n.tag === ring.tag && (n.title !== ring.title || n.body !== ring.body)),
      OUTCOME_SHOWS_MS,
      1_000,
    );
    ctx.evidence.outcome = outcome
      ? { tag: outcome.tag, shown_ms: ctx.now() - hungUpAt, title_changed: outcome.title !== ring.title, body_changed: outcome.body !== ring.body }
      : undefined;
    if (!outcome) return fail("ring_not_replaced", "the ring notification was not replaced by the call's outcome within 30 s of hang-up");
    return pass();
  },
};

const RACE_RINGS_MS = 15_000;
const RACE_WITHIN_MS = 300;
const LOSER_CLEARS_MS = 5_000;

/**
 * D09: the page and the emulator answer the same ring together, and exactly one
 * wins. Neither catalogue has an "answered elsewhere" message: the web and
 * Android apps drop a lost call's ring and call bar without one, so the loser
 * is judged by holding no call.
 */
export const D09: ScenarioRunner = {
  id: "D09",
  async run(ctx) {
    const pixel = await pixelWithAudio(ctx);
    if (isResult(pixel)) return pixel;
    const page = await ctx.browser.open(DISPATCHER, DISPATCHER);
    ctx.evidence.audience_before = await setAudience(ctx, { [DISPATCHER]: "text" });

    const unplayed = await playPixelCode(pixel.audio);
    if (unplayed) return unplayed;
    try {
      const since = ctx.now();
      // Nobody knows the winner at dial time, so the robot names no expected
      // surface and the runner judges that it heard exactly one.
      const dialed = await ctx.robot.dial({
        scenario: ctx.scenario,
        lease_id: ctx.lease.id,
        direction: "outbound",
        role: "ROBOT-1",
        to: NUMBER,
        exclusive: true,
        hangup_after_ms: TALK_MS,
      });
      const refused = notStarted(dialed);
      if (refused) return refused;

      const [pageRingMs, rings] = await Promise.all([page.waitForRing(RACE_RINGS_MS), pixel.device.waitForRinging(RACE_RINGS_MS)]);
      ctx.evidence.ring = { page_ms: pageRingMs, telecom_ms: rings?.telecom_ms, full_screen_ms: rings?.full_screen_ms };
      // A tap reads the screen first; timing one read lets the page's click wait for the emulator's.
      const readStarted = ctx.now();
      const offered = pageRingMs !== undefined && rings?.telecom_ms !== undefined && (await pixel.device.showing({ id: "call_answer" }));
      const lead = ctx.now() - readStarted;
      if (!offered) {
        await ctx.robot.wait(dialed.plan_id, 90_000);
        if (pageRingMs === undefined) return fail("page_did_not_ring", "the dispatcher's page did not ring, so there was no race");
        if (rings?.telecom_ms === undefined) return fail("pixel_not_ringing", "Telecom did not report the call ringing on the emulator, so there was no race");
        return fail("pixel_answer_control_missing", "the emulator's ring offered no answer control");
      }

      const answered: { page?: number; pixel?: number } = {};
      const raceAt = ctx.now();
      const [tapped] = await Promise.all([
        pixel.device.tap("call_answer").then((ok) => {
          answered.pixel = ctx.now();
          return ok;
        }),
        ctx
          .sleep(lead)
          .then(() => page.answer())
          .then(() => {
            answered.page = ctx.now();
          }),
      ]);
      const gap = Math.abs(answered.pixel! - answered.page!);
      ctx.evidence.answer_gap_ms = gap;
      const [pixelClearedMs, pageClearedMs] = await Promise.all([
        pixelCleared(ctx, pixel.device, raceAt, LOSER_CLEARS_MS),
        page.waitForCallCleared(LOSER_CLEARS_MS),
      ]);
      ctx.evidence.cleared_ms = { pixel: pixelClearedMs, page: pageClearedMs };

      const record = await ctx.robot.wait(dialed.plan_id, 180_000);
      ctx.evidence.call = callEvidence(record);
      if (!tapped) return fail("pixel_answer_control_missing", "the emulator's answer control was gone when the race tapped it");
      const won = raceWinner(record);
      if (typeof won !== "string") return won;
      ctx.evidence.winner = won;
      const legs = await oneWinner(ctx, since, MEMBER_OF[won]!);
      if (legs) return legs;
      const loserClearedMs = won === "pixel" ? pageClearedMs : pixelClearedMs;
      if (loserClearedMs === undefined) {
        return fail("loser_kept_call", `${won === "pixel" ? "the page" : "the emulator"} still showed the call ${LOSER_CLEARS_MS / 1000} s after losing`);
      }
      // Nothing failed, but answers further apart than the race allows tested no race.
      if (gap > RACE_WITHIN_MS) return infra("race-timing", `the answers landed ${gap} ms apart, over ${RACE_WITHIN_MS} ms`);
      return pass();
    } finally {
      await pixel.audio.stop();
      await endPixelCall(pixel.device);
    }
  },
};

/** The surface the robot heard alone, or why the race did not have one winner. */
function raceWinner(record: CallRecord): Surface | ScenarioResult {
  const refused = guardRefusal(record);
  if (refused) return refused;
  if (!record.answered_at) return fail("not_answered", `the call never connected (${record.errors.join("; ") || record.state})`);
  const judgement = record.judgement;
  if (!judgement) return infra("robot", `no verdict on the robot's recording (${record.errors.join("; ") || record.state})`);
  if (judgement.verdict !== "heard" || judgement.heard.length === 0) return fail("robot_heard_nobody", `the robot's recording was ${judgement.verdict}`);
  if (judgement.heard.length > 1) return fail("both_answered", `the robot heard ${judgement.heard.join(" and ")}: more than one answer was bridged`);
  const winner = judgement.heard[0]!;
  if (!MEMBER_OF[winner]) return fail("robot_heard_wrong_surface", `the robot heard ${winner}, neither the page nor the emulator`);
  if (!record.recording_deleted) return infra("robot", "the robot could not delete Telnyx's copy of its recording");
  return winner;
}

/** Delay and a narrow link through the emulator's console. It has no loss control, so loss is X27's and not shaped here. */
const IMPAIRMENT: NetworkShape = { delayMs: 80, speedKbps: { up: 256, down: 1_024 } };
const OUTAGE_AT_MS = 15_000;
const OUTAGE_MS = 3_000;
const RESUME_WITHIN_MS = 5_000;
/** Tolerated lateness of the outage's end, which shortens the time the codes get to come back by as much. */
const OUTAGE_SLACK_MS = 1_000;
const BEFORE = { name: "before", start_ms: 2_000, end_ms: 12_000 };
const AFTER = { name: "after", start_ms: OUTAGE_AT_MS + OUTAGE_MS + RESUME_WITHIN_MS, end_ms: OUTAGE_AT_MS + OUTAGE_MS + RESUME_WITHIN_MS + 10_000 };
const D13_HANGUP_MS = AFTER.end_ms + 3_000;
/** A call that ends this much before the robot's own hang-up did not survive. */
const SURVIVE_SLACK_MS = 2_000;
export const MAX_LOSS = 0.05;
/** RTP's 20 ms packet time: how many packets an outage of a given length takes away. */
const PACKET_MS = 20;

/**
 * The share of the emulator's packets the robot lost outside the outage, from
 * Telnyx's hang-up statistics for the robot's leg. They cover the whole call,
 * so the outage's own packets are taken out of both counts. Telnyx's call
 * control counts received and skipped packets apart, as FreeSWITCH does.
 */
export function lossOutsideOutage(
  rtp: unknown,
  outageMs: number,
): { received: number; skipped: number; outage_packets: number; ratio: number } | undefined {
  const inbound = (rtp as { inbound?: Record<string, unknown> } | null | undefined)?.inbound;
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : undefined;
  const received = count(inbound?.packet_count);
  const skipped = count(inbound?.skip_packet_count);
  if (received === undefined || skipped === undefined) return undefined;
  const outagePackets = Math.ceil(outageMs / PACKET_MS);
  const expected = received + skipped - outagePackets;
  const ratio = expected > 0 ? Math.max(0, skipped - outagePackets) / expected : 1;
  return { received, skipped, outage_packets: outagePackets, ratio: Math.round(ratio * 10_000) / 10_000 };
}

/**
 * D13: the device lane's emulator calls ROBOT-1 through delay and a narrow
 * link set on its console, with a 3 s outage mid-call: Wi-Fi off and cellular
 * unregistered. The robot judges a window before the outage and one from 5 s
 * after it. The emulator cannot lose packets on purpose (X27), so the loss the
 * robot measures is whatever the path really lost.
 */
export const D13: ScenarioRunner = {
  id: "D13",
  async run(ctx) {
    const pixel = await pixelWithAudio(ctx);
    if (isResult(pixel)) return pixel;
    ctx.evidence.pixel_concealment = { measured: false, why: "only the robot's side of the call has RTP statistics" };
    await readyToDial(ctx, pixel.device);
    ctx.lease.registerUndo({ kind: "rig.network-clear", params: {} });
    try {
      await pixel.device.network.shape(IMPAIRMENT);
    } catch (error) {
      return infra("network-shaper", `the emulator's console could not shape its network: ${(error as Error).message}`);
    }
    ctx.evidence.impairment = { ...IMPAIRMENT, loss_controlled: false, loss_residual: "X27" };
    const plan = await ctx.robot.expect({
      scenario: ctx.scenario,
      lease_id: ctx.lease.id,
      direction: "inbound",
      role: "ROBOT-1",
      answer_after_ms: 3_000,
      expect_within_ms: 60_000,
      expect: "pixel",
      segments: [BEFORE, AFTER],
      hangup_after_ms: D13_HANGUP_MS,
    });
    const unplanned = notStarted(plan);
    if (unplanned) return unplanned;

    const unplayed = await playPixelCode(pixel.audio);
    if (unplayed) return unplayed;
    try {
      const undialed = await dialFromPixel(pixel.device);
      if (undialed) return undialed;
      const answered = await untilAnswered(ctx, plan.plan_id, 90_000);
      let outage: { start_ms: number; end_ms: number } | undefined;
      if (answered?.answered_at) {
        const answeredAt = Date.parse(answered.answered_at);
        await ctx.sleep(Math.max(0, answeredAt + OUTAGE_AT_MS - ctx.now()));
        const startedAt = ctx.now();
        try {
          await pixel.device.network.outage(OUTAGE_MS);
        } catch (error) {
          return infra("network-shaper", `the emulator's console and adb could not make the outage: ${(error as Error).message}`);
        }
        outage = { start_ms: startedAt - answeredAt, end_ms: ctx.now() - answeredAt };
      }
      ctx.evidence.outage = outage;
      const record = await ctx.robot.wait(plan.plan_id, 180_000);
      ctx.evidence.call = callEvidence(record);

      const refused = guardRefusal(record);
      if (refused) return refused;
      if (!record.answered_at) return fail("not_answered", `the call never connected (${record.errors.join("; ") || record.state})`);
      if (!outage) return infra("robot", "the robot reported the answer too late to time the outage");
      if (!record.ended_at) return infra("robot", "the robot's record has no hang-up");
      const lasted = Date.parse(record.ended_at) - Date.parse(record.answered_at);
      ctx.evidence.lasted_ms = lasted;
      if (lasted < D13_HANGUP_MS - SURVIVE_SLACK_MS) {
        return fail("call_dropped", `the call ended ${lasted} ms after answer, before the robot's hang-up at ${D13_HANGUP_MS} ms`);
      }
      if (outage.start_ms < BEFORE.end_ms || outage.end_ms > OUTAGE_AT_MS + OUTAGE_MS + OUTAGE_SLACK_MS) {
        return infra("rig", `the outage ran ${outage.start_ms}-${outage.end_ms} ms after answer, outside the gap between the judged windows`);
      }
      if (!record.judgement) return infra("robot", `no verdict on the robot's recording (${record.errors.join("; ") || record.state})`);
      const segment = (name: string) => record.judgement!.segments?.find((s) => s.name === name);
      const before = segment(BEFORE.name);
      const after = segment(AFTER.name);
      if (!before || !after) return infra("robot", "the robot's judgement has no before and after windows");
      if (!before.heard.includes("pixel")) {
        return fail("no_code_before_outage", `under the impairment the robot heard ${before.heard.join(", ") || before.verdict} before the outage, not the emulator`);
      }
      if (!after.heard.includes("pixel")) {
        const heard = after.heard.join(", ") || after.verdict;
        return fail("codes_did_not_resume", `the emulator's code was not back within ${RESUME_WITHIN_MS / 1000} s of the outage (heard ${heard})`);
      }
      const loss = lossOutsideOutage(record.rtp, outage.end_ms - outage.start_ms);
      ctx.evidence.robot_loss = loss;
      if (!loss) return infra("robot", "the hang-up carried no inbound RTP statistics");
      if (loss.ratio >= MAX_LOSS) {
        return fail("loss_over_limit", `the robot lost ${(loss.ratio * 100).toFixed(1)}% of the emulator's packets outside the outage, ${MAX_LOSS * 100}% or more`);
      }
      if (!record.recording_deleted) return infra("robot", "the robot could not delete Telnyx's copy of its recording");
      return pass();
    } finally {
      await pixel.audio.stop();
      await endPixelCall(pixel.device);
    }
  },
};

/** The voicemail player's control, by the content description the Android app gives it (contactsTasks.playVoicemail). */
export const PLAY_VOICEMAIL = "Play voicemail";
const LISTED_WITHIN_MS = 15_000;
/** S04's phrase is about 6 s; the rest is the app fetching the audio. */
const PLAYBACK_MS = 20_000;

/**
 * D14: S04's voicemail, copied into QA-A's DEV-A1, played in the device
 * lane's app; the rig hears its media audio through the emulator's
 * streamAudio and the words are S04's phrase. The copy is a database and storage write, so the run dials nobody.
 */
export const D14: ScenarioRunner = {
  id: "D14",
  async run(ctx) {
    const pixel = await pixelWithAudio(ctx);
    if (isResult(pixel)) return pixel;
    await readyToDial(ctx, pixel.device);
    const sessionId = `rig-d14-${ctx.nonce}`;
    ctx.lease.registerUndo({ kind: "app.clear-seeded-voicemail", params: { tenant: TENANT, sessionId } });
    if (!(await ctx.app.copyVoicemail({ from: "QA-W", tenant: TENANT, role: NUMBER, callerRole: "ROBOT-1", sessionId }))) {
      return infra("s04-voicemail", "QA-W holds no voicemail from ROBOT-1 to copy, so S04 has not left one yet");
    }
    try {
      await pixel.device.launch("/calls");
    } catch (error) {
      return infra("pixel", `opening the app's calls failed: ${(error as Error).message}`);
    }
    // The newest call is listed first, and the copy is the newest.
    const listed = await poll(ctx, () => pixel.device.showing({ text: PLAY_VOICEMAIL }), LISTED_WITHIN_MS, 1_000);
    if (!listed) return fail("voicemail_not_listed", `the app's calls showed no "${PLAY_VOICEMAIL}" control within ${LISTED_WITHIN_MS / 1000} s`);
    // Recording from before the tap, so the phrase's first word is not lost.
    const recording = pixel.audio.transcribe({ stream: "media", ms: PLAYBACK_MS }).then(
      (text) => ({ text }),
      (error: Error) => ({ error }),
    );
    const tapped = await pixel.device.tapText(PLAY_VOICEMAIL);
    const heard = await recording;
    if ("error" in heard) return audioFault(heard.error);
    const transcript = heard.text;
    if (!tapped) return fail("voicemail_not_listed", `the "${PLAY_VOICEMAIL}" control was gone when it was tapped`);
    const wer = wordErrorRate(VOICEMAIL_PHRASE, transcript);
    ctx.evidence.word_error_rate = Math.round(wer * 1000) / 1000;
    if (!transcript.trim()) return fail("playback_silent", "the rig heard nothing from the emulator's media audio while the voicemail played");
    if (wer > MAX_WORD_ERROR) return fail("playback_wer", `the played voicemail's word error is ${wer.toFixed(2)}, over ${MAX_WORD_ERROR}`);
    return pass();
  },
};
