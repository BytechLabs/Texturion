/**
 * The rig's health and the Android call scenarios: R00, D01, D07, D08, D09
 * and D13. The calls ring or start on QA-A's DEV-A1, whose surfaces are the
 * dispatcher's page and the Pixel, signed in as QA-A's technician.
 *
 * None of these sends a text, so no body carries the nonce; what each run
 * changes (ring audience, the Pixel, the access point) is undone by the lease.
 */
import type { GuardHealth } from "@loonext/rig-protocol";
import type { NetworkImpairment } from "@loonext/rig-lanes";
import type { CallRecord, Detection, Surface } from "@loonext/rig-robot";
import {
  fail,
  infra,
  pass,
  poll,
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

/** The robot's side of a call it judged against one expected surface: undefined when it heard that surface. */
function robotVerdict(record: CallRecord, surface: Surface, failureClass: string): ScenarioResult | undefined {
  const refused = guardRefusal(record);
  if (refused) return refused;
  if (!record.answered_at) return fail("not_answered", `the call never connected (${record.errors.join("; ") || record.state})`);
  if (!record.judgement) return infra("robot", `no verdict on the robot's recording (${record.errors.join("; ") || record.state})`);
  if (!record.judgement.pass) return fail(failureClass, `the robot heard ${record.judgement.heard.join(", ") || record.judgement.verdict}, not ${surface}`);
  if (!record.recording_deleted) return infra("robot", "the robot could not delete Telnyx's copy of its recording");
  return undefined;
}

function isResult(value: object): value is ScenarioResult {
  return "outcome" in value;
}

/** The Pixel with its Bluetooth audio, or the reason the rig cannot give it. */
async function pixelWithAudio(ctx: ScenarioContext): Promise<{ device: DeviceApi; audio: AudioLinkApi } | ScenarioResult> {
  let device: DeviceApi;
  try {
    device = ctx.devices.pixel();
  } catch (error) {
    return infra("pixel", (error as Error).message);
  }
  if (!(await device.reachable())) return infra("pixel", "adb does not see the Pixel, or it has not finished booting");
  if (!device.audio) return infra("pixel-audio", "the rig's store names no Bluetooth address for the Pixel");
  if (!(await device.audio.connected())) return infra("pixel-audio", "the Pixel's Bluetooth hands-free link is not connected");
  return { device, audio: device.audio };
}

/** The Pixel at rest is unlocked; one found locked is unlocked, and the reset puts the rest back too. */
async function readyToDial(ctx: ScenarioContext, device: DeviceApi): Promise<void> {
  ctx.lease.registerUndo({ kind: "device.reset", params: { device: "pixel" } });
  if ((await device.state()).locked) await device.unlock();
}

/** The labels the device lane finds the app's dialer by are unverified on the nonprod build, so a miss is the lane's. */
async function dialFromPixel(device: DeviceApi): Promise<ScenarioResult | undefined> {
  try {
    await device.dial("ROBOT-1");
    return undefined;
  } catch (error) {
    return infra("android-dialer", (error as Error).message);
  }
}

/** Ends whatever call the Pixel still holds, so a robot that never hung up cannot leave it open. */
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

/** How long until the Pixel holds no call, or undefined at the deadline. */
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

async function pixelFindings(ctx: ScenarioContext): Promise<ScenarioResult[]> {
  let pixel: DeviceApi;
  try {
    pixel = ctx.devices.pixel();
  } catch (error) {
    return [infra("pixel", (error as Error).message)];
  }
  if (!(await pixel.reachable())) return [infra("pixel", "adb does not see the Pixel, or it has not finished booting")];
  const state = await pixel.state();
  const found: ScenarioResult[] = [];
  const evidence: Record<string, unknown> = {
    locked: state.locked,
    bluetooth_bonded: state.bluetooth_bonded,
    play_services_version: state.play_services_version,
  };
  ctx.evidence.pixel = evidence;
  if (state.locked === null) found.push(infra("pixel", "the Pixel's lock state could not be read"));
  else if (state.locked) found.push(fail("pixel_locked", "the Pixel is locked, and at rest it is not"));
  if (state.bluetooth_bonded === null) found.push(infra("pixel", "the Pixel's Bluetooth bonds could not be read"));
  else if (state.bluetooth_bonded < 1) found.push(fail("pixel_not_paired", "the Pixel has no Bluetooth bond, so the rig's hands-free unit is gone"));
  if (!pixel.audio) found.push(infra("pixel-audio", "the rig's store names no Bluetooth address for the Pixel"));
  else {
    evidence.audio_connected = await pixel.audio.connected();
    if (!evidence.audio_connected) found.push(fail("pixel_audio_disconnected", "the Pixel's Bluetooth hands-free link is not connected"));
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

/** Emulators are only checked: booting them belongs to D11, not to a check every 15 minutes. */
async function emulatorFindings(ctx: ScenarioContext): Promise<ScenarioResult[]> {
  const reachable: Record<string, boolean> = {};
  for (const api of EMULATOR_APIS) reachable[api] = await ctx.devices.emulator(api).reachable();
  ctx.evidence.emulators = reachable;
  return EMULATOR_APIS.filter((api) => !reachable[api]).map((api) => infra(`emulator-${api}`, `adb does not see the API ${api} emulator booted`));
}

/** R00: `rig health`, the guard, the Pixel and the emulators, and the room published. */
export const R00: ScenarioRunner = {
  id: "R00",
  async run(ctx) {
    const findings = [...(await healthFindings(ctx)), ...(await guardFindings(ctx)), ...(await pixelFindings(ctx)), ...(await emulatorFindings(ctx))];
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
 * Pixel both ring. The Pixel plays its code whichever answers, so a leg
 * bridged that should not be is heard.
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

    await pixel.audio.playCode("pixel");
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
            ? fail("pixel_not_ringing", "Telecom did not report the call ringing on the Pixel within 8 s")
            : rings.full_screen_ms === undefined
              ? fail("no_full_screen_ring", "the Pixel's full-screen ring did not show within 8 s")
              : undefined;
      if (unrung) {
        await ctx.robot.wait(dialed.plan_id, 90_000);
        return unrung;
      }

      if (answerer === "page") await page.answer();
      else if (!(await pixel.device.tap("call_answer"))) {
        await ctx.robot.wait(dialed.plan_id, 90_000);
        return fail("pixel_answer_control_missing", "the Pixel's ring offered no answer control");
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
        return fail("other_surface_kept_ringing", `${answerer === "page" ? "the Pixel" : "the page"} still showed the call 3 s after the ${answerer} answered`);
      }
      return (await oneWinner(ctx, since, MEMBER_OF[surface]!)) ?? pass();
    } finally {
      await pixel.audio.stop();
      await endPixelCall(pixel.device);
    }
  },
};

const PIXEL_HEARS_MS = 12_000;

/** D07: the Pixel calls ROBOT-1 from DEV-A1; codes are heard both ways and the caller ID is DEV-A1. */
export const D07: ScenarioRunner = {
  id: "D07",
  async run(ctx) {
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
      expect: "pixel",
      hangup_after_ms: TALK_MS,
    });
    const unplanned = notStarted(plan);
    if (unplanned) return unplanned;

    await pixel.audio.playCode("pixel");
    try {
      const undialed = await dialFromPixel(pixel.device);
      if (undialed) return undialed;
      const answered = await untilAnswered(ctx, plan.plan_id, 90_000);
      // The Pixel's ear opens at answer, the window the robot's code plays in.
      const heard = answered?.answered_at ? await pixel.audio.hear({ stream: "call", ms: PIXEL_HEARS_MS, own: "pixel" }) : undefined;
      const record = await ctx.robot.wait(plan.plan_id, 180_000);
      ctx.evidence.call = { ...callEvidence(record), pixel_heard: heard ? heardEvidence(heard) : undefined };

      const robot = robotVerdict(record, "pixel", "robot_did_not_hear_pixel");
      if (robot) return robot;
      if (record.from_role !== NUMBER) return fail("wrong_caller_id", `the robot saw the call from ${record.from_role ?? "nobody"}, not DEV-A1`);
      if (heard?.answered !== "robot") {
        return fail("pixel_did_not_hear_robot", `the Pixel heard ${heard?.heard.join(", ") || heard?.verdict || "nothing"}`);
      }
      return pass();
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
    const page = await ctx.browser.open(DISPATCHER, DISPATCHER, "/");
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
 * D09: the page and the Pixel answer the same ring together, and exactly one
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

    await pixel.audio.playCode("pixel");
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
      // A tap reads the screen first; timing one read lets the page's click wait for the Pixel's.
      const readStarted = ctx.now();
      const offered = pageRingMs !== undefined && rings?.telecom_ms !== undefined && (await pixel.device.showing({ id: "call_answer" }));
      const lead = ctx.now() - readStarted;
      if (!offered) {
        await ctx.robot.wait(dialed.plan_id, 90_000);
        if (pageRingMs === undefined) return fail("page_did_not_ring", "the dispatcher's page did not ring, so there was no race");
        if (rings?.telecom_ms === undefined) return fail("pixel_not_ringing", "Telecom did not report the call ringing on the Pixel, so there was no race");
        return fail("pixel_answer_control_missing", "the Pixel's ring offered no answer control");
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
      if (!tapped) return fail("pixel_answer_control_missing", "the Pixel's answer control was gone when the race tapped it");
      const won = raceWinner(record);
      if (typeof won !== "string") return won;
      ctx.evidence.winner = won;
      const legs = await oneWinner(ctx, since, MEMBER_OF[won]!);
      if (legs) return legs;
      const loserClearedMs = won === "pixel" ? pageClearedMs : pixelClearedMs;
      if (loserClearedMs === undefined) {
        return fail("loser_kept_call", `${won === "pixel" ? "the page" : "the Pixel"} still showed the call ${LOSER_CLEARS_MS / 1000} s after losing`);
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
  if (!MEMBER_OF[winner]) return fail("robot_heard_wrong_surface", `the robot heard ${winner}, neither the page nor the Pixel`);
  if (!record.recording_deleted) return infra("robot", "the robot could not delete Telnyx's copy of its recording");
  return winner;
}

const IMPAIRMENT: NetworkImpairment = { lossPercent: 2, delayMs: 80, jitterMs: 20 };
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
 * The share of the Pixel's packets the robot lost outside the outage, from
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
 * D13: the Pixel calls ROBOT-1 through loss and delay on its access point,
 * with a 3 s outage mid-call. The robot judges a window before the outage and
 * one from 5 s after it.
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
      await ctx.rig.impairNetwork(IMPAIRMENT);
    } catch (error) {
      return infra("network-shaper", `the access point could not be shaped (RIG_AP_IFACE, sudo tc): ${(error as Error).message}`);
    }
    ctx.evidence.impairment = IMPAIRMENT;
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

    await pixel.audio.playCode("pixel");
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
          await ctx.rig.networkOutage(OUTAGE_MS);
        } catch (error) {
          return infra("network-shaper", `the outage could not be made: ${(error as Error).message}`);
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
        return fail("no_code_before_outage", `under the impairment the robot heard ${before.heard.join(", ") || before.verdict} before the outage, not the Pixel`);
      }
      if (!after.heard.includes("pixel")) {
        const heard = after.heard.join(", ") || after.verdict;
        return fail("codes_did_not_resume", `the Pixel's code was not back within ${RESUME_WITHIN_MS / 1000} s of the outage (heard ${heard})`);
      }
      const loss = lossOutsideOutage(record.rtp, outage.end_ms - outage.start_ms);
      ctx.evidence.robot_loss = loss;
      if (!loss) return infra("robot", "the hang-up carried no inbound RTP statistics");
      if (loss.ratio >= MAX_LOSS) {
        return fail("loss_over_limit", `the robot lost ${(loss.ratio * 100).toFixed(1)}% of the Pixel's packets outside the outage, ${MAX_LOSS * 100}% or more`);
      }
      if (!record.recording_deleted) return infra("robot", "the robot could not delete Telnyx's copy of its recording");
      return pass();
    } finally {
      await pixel.audio.stop();
      await endPixelCall(pixel.device);
    }
  },
};
