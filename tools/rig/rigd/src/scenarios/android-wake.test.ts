import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_BOOTED } from "@loonext/rig-lanes";
import type { CallPlan } from "@loonext/rig-robot";
import { describe, expect, it } from "vitest";
import {
  BEACON_AFTER,
  CALL_STAGES,
  D02,
  D02p,
  D03,
  D04,
  D04_VARIANTS,
  d04Device,
  D10,
  D11,
  D12,
  E01,
  EMULATOR_APIS,
  EMULATOR_HEARING_NOT_JUDGED,
  RING_BEACON_STAGES,
  d04VariantOn,
  d04Verdict,
  emulatorApiOn,
  judgeBeacons,
} from "./android-wake.ts";
import type { ScenarioContext, ScenarioHistoryApi, ScenarioRunner } from "./context.ts";
import { fakeContext } from "./fakes.ts";

const REPO = fileURLToPath(new URL("../../../../../", import.meta.url));
const DAY_MS = 86_400_000;
const PASSED = { outcome: "pass", detail: undefined };
const E01_PASSED = { outcome: "pass", detail: EMULATOR_HEARING_NOT_JUDGED };

const LANES: Record<string, { tenant: string; member: string }> = {
  "DEV-A1": { tenant: "QA-A", member: "qa-a-technician" },
  "DEV-E1": { tenant: "QA-E", member: "qa-e-owner" },
};

/**
 * A rig where a call to DEV-A1 or DEV-E1, and a simulated ring, each make
 * the API push to the lane's device and the woken device report its
 * beacons, which arrive only as the clock passes them.
 */
function wakeWorld(scenario: string) {
  const world = fakeContext(scenario);
  const { app, robot, time } = world;
  const script = {
    /** Whether a ring reaches the API at all. */
    pushes: true,
    /** What FCM answers each ring push. */
    push: { response_class: "accepted", priority: "high" as string | null },
    /** A woken device's beacons for a call, in the order it sends them; ring-me races the ring. */
    callStages: ["push_received", "os_reported", "ringing_shown", "ring_me_sent", "answered"],
    syntheticStages: ["push_received", "os_reported", "ringing_shown"],
  };
  const simulated: unknown[] = [];
  let sessions = 0;
  const wake = (tenant: string, member: string, sessionId: string, stages: string[]) => {
    if (!script.pushes) return;
    const attempt = { tenant, purpose: "ring", platform: "android", attempted_at: new Date(time.now).toISOString(), call_session_id: sessionId, ...script.push };
    app.pushes.push(attempt);
    stages.forEach((stage, i) =>
      app.beacons.push({ tenant, member, stage, platform: "android", occurred_at: new Date(time.now + 500 * (i + 1)).toISOString(), call_session_id: sessionId }),
    );
  };
  app.pushAttempts = async (args: { tenant: string; since: number; purpose?: string }) =>
    app.pushes.filter((p) => p.tenant === args.tenant && Date.parse(p.attempted_at) >= args.since && (!args.purpose || p.purpose === args.purpose));
  const beacons = app.ringBeacons.bind(app);
  app.ringBeacons = async (args) => (await beacons(args)).filter((b) => Date.parse(b.occurred_at) <= time.now);
  const dial = robot.dial.bind(robot);
  robot.dial = async (plan: CallPlan) => {
    const lane = LANES[plan.to ?? ""];
    if (lane) wake(lane.tenant, lane.member, `call-${++sessions}`, script.callStages);
    return dial(plan);
  };
  app.simulateIncoming = async (args?: unknown) => {
    simulated.push(args);
    wake("QA-A", "qa-a-technician", "synthetic-1", script.syntheticStages);
    return app.simulated;
  };
  app.targets.set("qa-a-technician", 1);
  return { ...world, script, simulated, pixel: world.devices.pixelDevice, audio: world.devices.audio };
}

/** The robot's recording, judged deaf to the device. */
function deafRobot(world: ReturnType<typeof wakeWorld>) {
  const outcome = world.robot.outcome;
  world.robot.outcome = (plan) => {
    const record = outcome(plan);
    return { ...record, judgement: { ...record.judgement!, pass: false, heard: [], verdict: "silent", answered: null } };
  };
}

function refusedDial(world: ReturnType<typeof wakeWorld>) {
  world.robot.dial = async (plan) => ({ plan_id: "plan-0", plan, state: "failed", ids: {}, events: [], dtmf: "", errors: ["guard_refused:dial.window"] });
}

describe("ring beacons", () => {
  it("speaks apps/api's stage vocabulary, and orders every stage", () => {
    const source = readFileSync(join(REPO, "apps", "api", "src", "routes", "ring-beacons.ts"), "utf8");
    const list = /RING_BEACON_STAGES = \[([^\]]*)\]/.exec(source)?.[1];
    expect(list, "apps/api's RING_BEACON_STAGES moved").toBeDefined();
    expect([...list!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1])).toEqual([...RING_BEACON_STAGES]);
    expect(Object.keys(BEACON_AFTER).sort()).toEqual([...RING_BEACON_STAGES].sort());
  });

  const at = (stage: string, ms: number) => ({
    stage,
    platform: "android",
    occurred_at: new Date(Date.UTC(2026, 9, 31, 15) + ms).toISOString(),
    call_session_id: "s",
    app_version: null,
    device_idle: null,
    screen_locked: null,
    standby_bucket: null,
  });

  it("lets ring-me and the ring race, and fails only what breaks cause and effect", () => {
    const raced = ["push_received", "os_reported", "ringing_shown", "ring_me_sent", "answered"].map((s, i) => at(s, i * 100));
    expect(judgeBeacons(raced, CALL_STAGES)).toBeUndefined();
    const shownFirst = ["push_received", "ringing_shown", "os_reported", "ring_me_sent", "answered"].map((s, i) => at(s, i * 100));
    expect(judgeBeacons(shownFirst, CALL_STAGES)).toMatchObject({ failure_class: "beacons_out_of_order" });
    const answeredFirst = ["push_received", "os_reported", "answered", "ringing_shown", "ring_me_sent"].map((s, i) => at(s, i * 100));
    expect(judgeBeacons(answeredFirst, CALL_STAGES)).toMatchObject({ failure_class: "beacons_out_of_order" });
  });

  it("names the first stage the ring never reached, and ignores words it does not know", () => {
    expect(judgeBeacons([], CALL_STAGES)).toMatchObject({ failure_class: "push_not_received" });
    expect(judgeBeacons([at("push_received", 0)], CALL_STAGES)).toMatchObject({ failure_class: "not_reported_to_telecom" });
    const noRingMe = ["push_received", "os_reported", "ringing_shown", "answered"].map((s, i) => at(s, i * 100));
    expect(judgeBeacons(noRingMe, CALL_STAGES)).toMatchObject({ failure_class: "ring_me_not_sent" });
    const withNoise = [at("warp_drive", 0), ...["push_received", "os_reported", "ringing_shown"].map((s, i) => at(s, (i + 1) * 100))];
    expect(judgeBeacons(withNoise, ["push_received", "os_reported", "ringing_shown"])).toBeUndefined();
  });
});

describe("D02, Android wake: killed, forced Doze, locked with a PIN", () => {
  it("passes when FCM takes the push at high priority, the emulator rings, is answered on its lock screen and both codes are heard", async () => {
    const world = wakeWorld("D02");
    const { ctx, robot, pixel, audio, undo } = world;
    let stopped = false;
    audio.stop = async () => {
      stopped = true;
    };
    expect(await D02.run(ctx)).toEqual(PASSED);
    expect(undo).toEqual([{ kind: "device.reset", params: { device: "pixel" } }]);
    expect(pixel.actions).toEqual(["kill", "force doze", "lock", "tap call_answer"]);
    expect(robot.plans).toHaveLength(1);
    expect(robot.plans[0]).toMatchObject({ direction: "outbound", role: "ROBOT-1", to: "DEV-A1", expect: "pixel", lease_id: "lease-test" });
    expect(audio.played).toEqual(["pixel"]);
    expect(stopped).toBe(true);
    expect(ctx.evidence).toMatchObject({
      ring: { telecom_ms: 2_000, full_screen_ms: 2_500 },
      push: [{ session_id: "call-1", response_class: "accepted", priority: "high" }],
      device: { doze: "IDLE", locked: true },
      call: { device_heard: { answered: "robot" }, robot_heard: { pass: true } },
    });
    expect((ctx.evidence.beacons as { stage: string }[]).map((b) => b.stage)).toEqual(world.script.callStages);
    expect(JSON.stringify(ctx.evidence)).not.toMatch(/\+\d{10}/);
  });

  it("blames the rig, and changes nothing, when the emulator or its audio link is missing, or EA1 has not proven the audio", async () => {
    const gone = wakeWorld("D02");
    gone.pixel.reachableNow = false;
    expect(await D02.run(gone.ctx)).toMatchObject({ outcome: "infra", component: "pixel" });
    expect(gone.undo).toEqual([]);
    expect(gone.robot.plans).toEqual([]);

    const unlinked = wakeWorld("D02");
    unlinked.audio.connectedNow = false;
    expect(await D02.run(unlinked.ctx)).toMatchObject({ outcome: "infra", component: "pixel-audio" });
    expect(unlinked.pixel.actions).toEqual([]);
    expect(unlinked.robot.plans).toEqual([]);

    const unproven = wakeWorld("D02");
    unproven.audio.provenNow = false;
    expect(await D02.run(unproven.ctx)).toMatchObject({ outcome: "infra", component: "emulator-audio-unproven" });
    expect(unproven.pixel.actions).toEqual([]);
    expect(unproven.robot.plans).toEqual([]);
  });

  it("turns audio refused mid-call into infra, never a pass", async () => {
    const world = wakeWorld("D02");
    world.audio.hear = async () => {
      throw new Error("emulator-audio-unproven");
    };
    expect(await D02.run(world.ctx)).toMatchObject({ outcome: "infra", component: "emulator-audio-unproven" });

    // A product failure still outranks the rig's.
    const unshown = wakeWorld("D02");
    unshown.audio.hear = world.audio.hear;
    unshown.script.callStages = ["push_received", "os_reported", "ring_me_sent", "answered"];
    expect(await D02.run(unshown.ctx)).toMatchObject({ failure_class: "ring_not_shown" });
  });

  it("blames the emulator, before dialing, when Doze or the lock did not take", async () => {
    const awake = wakeWorld("D02");
    awake.pixel.forceDoze = async () => {
      throw new Error("adb: force-idle on emulator-5560 did not force deep idle (Unable to go deep idle; not enabled)");
    };
    expect(await D02.run(awake.ctx)).toMatchObject({ outcome: "infra", component: "pixel", detail: expect.stringContaining("not enabled") });
    expect(awake.robot.plans).toEqual([]);
    expect(awake.undo).toEqual([{ kind: "device.reset", params: { device: "pixel" } }]);

    const open = wakeWorld("D02");
    open.pixel.lock = async () => undefined;
    expect(await D02.run(open.ctx)).toMatchObject({ outcome: "infra", component: "pixel" });
    expect(open.robot.plans).toEqual([]);
  });

  it("names where a missing or late ring stopped", async () => {
    const late = wakeWorld("D02");
    late.pixel.rings = { telecom_ms: 13_000, full_screen_ms: 13_500 };
    expect(await D02.run(late.ctx)).toMatchObject({ failure_class: "no_ring_within_12s" });

    const unpushed = wakeWorld("D02");
    unpushed.script.pushes = false;
    unpushed.pixel.rings = undefined;
    expect(await D02.run(unpushed.ctx)).toMatchObject({ failure_class: "no_push_attempt" });

    const lost = wakeWorld("D02");
    lost.script.callStages = [];
    lost.pixel.rings = undefined;
    expect(await D02.run(lost.ctx)).toMatchObject({ failure_class: "push_not_received" });

    const kept = wakeWorld("D02");
    kept.script.callStages = ["push_received"];
    kept.pixel.rings = undefined;
    expect(await D02.run(kept.ctx)).toMatchObject({ failure_class: "not_reported_to_telecom" });
  });

  it("fails a push FCM refused or took at normal priority, and blames FCM's weather on the rig", async () => {
    const rejected = wakeWorld("D02");
    rejected.script.push.response_class = "rejected";
    expect(await D02.run(rejected.ctx)).toMatchObject({ failure_class: "push_not_accepted" });

    const throttled = wakeWorld("D02");
    throttled.script.push.response_class = "throttled";
    expect(await D02.run(throttled.ctx)).toMatchObject({ outcome: "infra", component: "fcm" });

    const normal = wakeWorld("D02");
    normal.script.push.priority = "normal";
    expect(await D02.run(normal.ctx)).toMatchObject({ failure_class: "push_not_high_priority" });
  });

  it("passes on a stale token's `gone` beside the live token's acceptance", async () => {
    const world = wakeWorld("D02");
    world.app.pushes.push({
      tenant: "QA-A",
      purpose: "ring",
      platform: "android",
      response_class: "gone",
      attempted_at: new Date(world.time.now).toISOString(),
      priority: "high",
    });
    expect(await D02.run(world.ctx)).toEqual(PASSED);
  });

  it("fails a ring with no answer control on the lock screen, and missing or disordered beacons", async () => {
    const noControl = wakeWorld("D02");
    noControl.pixel.onScreen.delete("call_answer");
    expect(await D02.run(noControl.ctx)).toMatchObject({ failure_class: "answer_control_missing" });

    const unshown = wakeWorld("D02");
    unshown.script.callStages = ["push_received", "os_reported", "ring_me_sent", "answered"];
    expect(await D02.run(unshown.ctx)).toMatchObject({ failure_class: "ring_not_shown" });

    const unanswered = wakeWorld("D02");
    unanswered.script.callStages = ["push_received", "os_reported", "ringing_shown", "ring_me_sent"];
    expect(await D02.run(unanswered.ctx)).toMatchObject({ failure_class: "answer_not_reported" });

    const disordered = wakeWorld("D02");
    disordered.script.callStages = ["push_received", "ringing_shown", "os_reported", "ring_me_sent", "answered"];
    expect(await D02.run(disordered.ctx)).toMatchObject({ failure_class: "beacons_out_of_order" });
  });

  it("fails when either side does not hear the other, or the call never connected", async () => {
    const deaf = wakeWorld("D02");
    deafRobot(deaf);
    expect(await D02.run(deaf.ctx)).toMatchObject({ failure_class: "robot_did_not_hear_device" });

    const muted = wakeWorld("D02");
    muted.audio.heard = null;
    expect(await D02.run(muted.ctx)).toMatchObject({ failure_class: "device_did_not_hear_robot" });

    const dropped = wakeWorld("D02");
    dropped.robot.outcome = () => ({ state: "done", answered_at: undefined });
    expect(await D02.run(dropped.ctx)).toMatchObject({ failure_class: "not_answered" });
  });

  it("reports a guard refusal as the rig's", async () => {
    const world = wakeWorld("D02");
    refusedDial(world);
    expect(await D02.run(world.ctx)).toMatchObject({ outcome: "infra", component: "guard" });
  });
});

describe("D02p, a ring push with no call", () => {
  it("passes when the synthetic push is accepted, rings in full screen and ring-me is never answered, dialing nobody", async () => {
    const { ctx, pixel, robot, undo, simulated } = wakeWorld("D02p");
    expect(await D02p.run(ctx)).toEqual(PASSED);
    expect(simulated).toEqual([{ member: "qa-a-owner", target: "qa-a-technician", caller: "Rig n0nce" }]);
    expect((simulated[0] as { caller: string }).caller).toContain(ctx.nonce);
    expect(pixel.actions).toEqual(["tap call_decline"]);
    expect(robot.plans).toEqual([]);
    expect(undo).toEqual([]);
    expect(ctx.evidence).toMatchObject({ session_id: "synthetic-1", dismissed: true, push: [{ session_id: "synthetic-1" }] });
    expect(ctx.evidence.simulated).toEqual({ status: 201, code: undefined, reachable: true });
  });

  it("fails a refused or session-less simulate-incoming, and blames a refused probe session on the rig", async () => {
    const broken = wakeWorld("D02p");
    broken.app.simulated = { status: 500, code: "internal" };
    expect(await D02p.run(broken.ctx)).toMatchObject({ failure_class: "simulate_refused" });

    const signedOut = wakeWorld("D02p");
    signedOut.app.simulated = { status: 401, code: "unauthorized" };
    expect(await D02p.run(signedOut.ctx)).toMatchObject({ outcome: "infra", component: "app-probe" });

    const sessionless = wakeWorld("D02p");
    sessionless.app.simulated = { status: 202, body: {} };
    expect(await D02p.run(sessionless.ctx)).toMatchObject({ failure_class: "no_synthetic_session" });

    const down = wakeWorld("D02p");
    down.app.simulateIncoming = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    expect(await D02p.run(down.ctx)).toMatchObject({ outcome: "infra", component: "app-probe" });
  });

  it("fails no ring, a ring without the full-screen notification, a refused push and a ring never shown", async () => {
    const silent = wakeWorld("D02p");
    silent.pixel.rings = undefined;
    expect(await D02p.run(silent.ctx)).toMatchObject({ failure_class: "no_ring_within_12s" });

    const telecomOnly = wakeWorld("D02p");
    telecomOnly.pixel.rings = { telecom_ms: 2_000 };
    expect(await D02p.run(telecomOnly.ctx)).toMatchObject({ failure_class: "no_full_screen_ring" });

    const refused = wakeWorld("D02p");
    refused.script.push.response_class = "rejected";
    expect(await D02p.run(refused.ctx)).toMatchObject({ failure_class: "push_not_accepted" });

    const unshown = wakeWorld("D02p");
    unshown.script.syntheticStages = ["push_received", "os_reported"];
    expect(await D02p.run(unshown.ctx)).toMatchObject({ failure_class: "ring_not_shown" });
  });

  it("fails a ring-me answered for the synthetic session, even one reported 10 s after the push", async () => {
    const world = wakeWorld("D02p");
    const simulate = world.app.simulateIncoming;
    world.app.simulateIncoming = async () => {
      const answer = await simulate();
      world.app.beacons.push({
        tenant: "QA-A",
        member: "qa-a-technician",
        stage: "ring_me_sent",
        platform: "android",
        occurred_at: new Date(world.time.now + 10_000).toISOString(),
        call_session_id: "synthetic-1",
      });
      return answer;
    };
    expect(await D02p.run(world.ctx)).toMatchObject({ failure_class: "ring_me_not_refused" });
  });

  it("blames the rig when the emulator is unreachable, before asking for a ring", async () => {
    const world = wakeWorld("D02p");
    world.pixel.reachableNow = false;
    expect(await D02p.run(world.ctx)).toMatchObject({ outcome: "infra", component: "pixel" });
    expect(world.simulated).toEqual([]);
  });
});

describe("the ring push and the beacons a call wake judges", () => {
  it("takes only an accepted Android ring push that names a session, and only the session it was asked for", async () => {
    const web = wakeWorld("D02");
    const pushed = web.app.pushAttempts;
    web.app.pushAttempts = async (args) => (await pushed(args)).map((a) => ({ ...a, platform: "web" }));
    expect(await D02.run(web.ctx)).toMatchObject({ failure_class: "no_push_attempt" });

    const sessionless = wakeWorld("D02");
    sessionless.script.push = { response_class: "accepted", priority: "high" };
    const read = sessionless.app.pushAttempts;
    sessionless.app.pushAttempts = async (args) => (await read(args)).map((a) => ({ ...a, call_session_id: null }));
    expect(await D02.run(sessionless.ctx)).toMatchObject({ failure_class: "push_without_session" });

    // D02p asks for its synthetic session's push; another session's does not count.
    const other = wakeWorld("D02p");
    const attempts = other.app.pushAttempts;
    other.app.pushAttempts = async (args) => (await attempts(args)).map((a) => ({ ...a, call_session_id: "call-9" }));
    expect(await D02p.run(other.ctx)).toMatchObject({ failure_class: "no_push_attempt" });
  });

  it("reads the beacons of the lane's member and the call's session only, from a device clock running behind", async () => {
    // Another session's answered beacon cannot stand in for this call's missing one.
    const stray = wakeWorld("D02");
    stray.script.callStages = ["push_received", "os_reported", "ringing_shown", "ring_me_sent"];
    stray.app.beacons.push({ tenant: "QA-A", member: "qa-a-technician", stage: "answered", platform: "android", occurred_at: new Date(stray.time.now + 3_000).toISOString(), call_session_id: "synthetic-1" });
    expect(await D02.run(stray.ctx)).toMatchObject({ failure_class: "answer_not_reported" });

    // Nor can another member's beacon for the same session.
    const member = wakeWorld("D02");
    member.script.callStages = ["push_received", "os_reported", "ringing_shown", "ring_me_sent"];
    member.app.beacons.push({ tenant: "QA-A", member: "qa-a-dispatcher", stage: "answered", platform: "android", occurred_at: new Date(member.time.now + 3_000).toISOString(), call_session_id: "call-1" });
    expect(await D02.run(member.ctx)).toMatchObject({ failure_class: "answer_not_reported" });

    // A device whose clock is two minutes behind reports its stages before the rig's dial.
    const behind = wakeWorld("D02");
    const dial = behind.robot.dial;
    behind.robot.dial = async (plan) => {
      const record = await dial(plan);
      for (const b of behind.app.beacons) b.occurred_at = new Date(Date.parse(b.occurred_at) - 2 * 60_000).toISOString();
      return record;
    };
    expect(await D02.run(behind.ctx)).toEqual(PASSED);
  });

  it("orders stages by each one's first beacon, so a repeated push does not reorder the ring", async () => {
    const at = (stage: string, ms: number) => ({
      stage,
      platform: "android",
      occurred_at: new Date(Date.UTC(2026, 9, 31, 15) + ms).toISOString(),
      call_session_id: "s",
      app_version: null,
      device_idle: null,
      screen_locked: null,
      standby_bucket: null,
    });
    const repeated = [at("push_received", 0), at("os_reported", 100), at("ringing_shown", 200), at("push_received", 300)];
    expect(judgeBeacons(repeated, ["push_received", "os_reported", "ringing_shown"])).toBeUndefined();
  });

  it("blames the robot when it could not delete Telnyx's copy of the wake's recording", async () => {
    const world = wakeWorld("D02");
    const outcome = world.robot.outcome;
    world.robot.outcome = (plan) => ({ ...outcome(plan), recording_deleted: false });
    expect(await D02.run(world.ctx)).toMatchObject({ outcome: "infra", component: "robot", detail: expect.stringContaining("delete") });
  });
});

describe("D03, stepped Doze", () => {
  it("steps deep Doze to IDLE and through a maintenance window, then runs D02 without forcing it, naming X6", async () => {
    const world = wakeWorld("D03");
    const { ctx, pixel, undo } = world;
    const result = await D03.run(ctx);
    expect(result).toEqual({ outcome: "pass", detail: "stepped Doze; natural entry on a physical phone is X6" });
    expect(pixel.actions).toEqual(["kill", "step doze", "lock", "tap call_answer"]);
    expect(undo).toEqual([{ kind: "device.reset", params: { device: "pixel" } }]);
    expect(ctx.evidence).toMatchObject({ residual: "X6", doze_steps: pixel.steps, device: { doze: "IDLE", locked: true } });
    expect(world.robot.plans).toHaveLength(1);
  });

  it("calls a Doze that never reaches deep idle, or skips the maintenance window, the rig's, and dials nobody", async () => {
    const stuck = wakeWorld("D03");
    stuck.pixel.steps = ["INACTIVE", "IDLE_PENDING", "SENSING"];
    const result = await D03.run(stuck.ctx);
    expect(result).toMatchObject({ outcome: "infra", component: "pixel", detail: expect.stringContaining("never reached deep idle") });
    expect((result as { detail: string }).detail).toContain("X6");
    expect(stuck.robot.plans).toEqual([]);
    expect(stuck.undo).toEqual([{ kind: "device.reset", params: { device: "pixel" } }]);

    const unmaintained = wakeWorld("D03");
    unmaintained.pixel.steps = ["INACTIVE", "IDLE_PENDING", "SENSING", "LOCATING", "IDLE"];
    expect(await D03.run(unmaintained.ctx)).toMatchObject({ outcome: "infra", detail: expect.stringContaining("never reached deep idle") });

    const broken = wakeWorld("D03");
    broken.pixel.stepDoze = async () => {
      throw new Error("adb: deviceidle step on emulator-5560 printed no state (Unknown command)");
    };
    expect(await D03.run(broken.ctx)).toMatchObject({ outcome: "infra", component: "pixel", detail: expect.stringContaining("stepping Doze failed") });
    expect(broken.robot.plans).toEqual([]);
  });

  it("checks the emulator and its audio before changing anything", async () => {
    const gone = wakeWorld("D03");
    gone.pixel.reachableNow = false;
    expect(await D03.run(gone.ctx)).toMatchObject({ outcome: "infra", component: "pixel" });

    const unproven = wakeWorld("D03");
    unproven.audio.provenNow = false;
    expect(await D03.run(unproven.ctx)).toMatchObject({ outcome: "infra", component: "emulator-audio-unproven" });
    expect(unproven.pixel.actions).toEqual([]);
    expect(unproven.undo).toEqual([]);
  });

  it("has no prepare left: stepping takes seconds, inside the lease", () => {
    expect(D03.prepare).toBeUndefined();
    expect(D03.abandon).toBeUndefined();
  });
});

/** A time inside the fortnight that runs `variant`. */
function d04Day(name: string): number {
  const index = D04_VARIANTS.findIndex((v) => v.name === name);
  const cycle = 14 * D04_VARIANTS.length;
  return (Math.ceil(Date.UTC(2026, 9, 31) / DAY_MS / cycle) * cycle + index * 14) * DAY_MS + 8 * 3_600_000;
}

function d04World(name: string) {
  const world = wakeWorld("D04");
  world.time.now = d04Day(name);
  const variant = D04_VARIANTS.find((v) => v.name === name)!;
  // The emulator variants take an API level by the 14-day period, as E01's do by theirs.
  const api = emulatorApiOn(world.time.now, 14);
  const device = d04Device(variant) === "pixel" ? world.pixel : world.devices.emulators.get(api)!;
  return { ...world, device, api };
}

const SETUP: Record<string, string[]> = {
  "standby-rare": ["bucket rare", "lock"],
  "standby-restricted": ["bucket restricted", "lock"],
  "battery-saver": ["battery saver on", "lock"],
  "secure-lock": ["lock"],
  "before-first-unlock": ["reboot locked"],
  hibernation: ["hibernate on", "lock"],
};

describe("D04, Android variants", () => {
  it("takes one variant per run, the next each fortnight, and the same one for a retry that day", () => {
    const base = d04Day("standby-rare");
    expect(D04_VARIANTS.map((_, k) => d04VariantOn(base + k * 14 * DAY_MS).name)).toEqual(D04_VARIANTS.map((v) => v.name));
    expect(d04VariantOn(base + 3_600_000).name).toBe(d04VariantOn(base).name);
    expect(D04_VARIANTS.every((v) => !v.expect.confirmed)).toBe(true);
  });

  for (const variant of D04_VARIANTS) {
    const rings = variant.expect.ringsWithinMs !== null;
    const where = d04Device(variant);
    it(`${variant.name}: puts the ${where === "pixel" ? "device lane" : "day's E01 AVD"} in it, passes when it ${rings ? "rings" : "stays quiet"} and fails when it does not`, async () => {
      const world = d04World(variant.name);
      if (!rings) world.device.rings = undefined;
      expect((await D04.run(world.ctx)).outcome).toBe("pass");
      expect(world.device.actions).toEqual(SETUP[variant.name]);
      expect(world.undo[0]).toEqual({ kind: "device.reset", params: { device: world.device.name } });
      if (variant.undo) expect(world.undo[1]).toEqual({ kind: variant.undo, params: { device: world.device.name } });
      expect(world.robot.plans[0]).toMatchObject({ to: where === "pixel" ? "DEV-A1" : "DEV-E1", play: null, record: false, lease_id: "lease-test" });
      expect(world.ctx.evidence).toMatchObject({ variant: variant.name, expected: variant.expect, device_name: world.device.name, device: { locked: true } });

      const wrong = d04World(variant.name);
      if (rings) wrong.device.rings = undefined;
      expect(await D04.run(wrong.ctx)).toMatchObject({ outcome: "fail", failure_class: `unconfirmed_${variant.name.replaceAll("-", "_")}` });
    });
  }

  it("never runs a ring that must not come on the device lane", async () => {
    const quiet = D04_VARIANTS.filter((v) => v.expect.ringsWithinMs === null);
    expect(quiet.map((v) => v.name)).toEqual(["before-first-unlock", "hibernation"]);
    for (const variant of quiet) {
      expect(d04Device(variant)).toBe("emulator");
      const world = d04World(variant.name);
      world.device.rings = undefined;
      await D04.run(world.ctx);
      expect(world.pixel.actions).toEqual([]);
      expect(world.undo.every((u) => u.params.device !== "pixel")).toBe(true);
    }
    for (const variant of D04_VARIANTS.filter((v) => v.expect.ringsWithinMs !== null)) expect(d04Device(variant)).toBe("pixel");
  });

  it("boots the day's E01 AVD for an emulator variant, and blames the rig when it will not come up", async () => {
    const down = d04World("hibernation");
    down.device.rings = undefined;
    down.device.reachableNow = false;
    down.devices.bootEmulator = async (api) => {
      down.devices.actions.push(`boot ${api}`);
      down.device.reachableNow = true;
    };
    expect((await D04.run(down.ctx)).outcome).toBe("pass");
    expect(down.devices.actions).toEqual([`boot ${down.api}`]);

    const dead = d04World("hibernation");
    dead.device.reachableNow = false;
    expect(await D04.run(dead.ctx)).toMatchObject({ outcome: "infra", component: dead.device.name });
    expect(dead.robot.plans).toEqual([]);
  });

  it("reads back the bucket, battery saver and the lock before every push", async () => {
    const leftover = d04World("secure-lock");
    leftover.pixel.deviceState.battery_saver = true;
    expect(await D04.run(leftover.ctx)).toMatchObject({ outcome: "infra", component: "pixel", detail: expect.stringContaining("saver true") });
    expect(leftover.robot.plans).toEqual([]);

    const bucketed = d04World("battery-saver");
    bucketed.pixel.deviceState.standby_bucket = "rare";
    expect(await D04.run(bucketed.ctx)).toMatchObject({ outcome: "infra", component: "pixel", detail: expect.stringContaining("bucket rare") });

    const unlocked = d04World("hibernation");
    unlocked.device.lock = async () => undefined;
    expect(await D04.run(unlocked.ctx)).toMatchObject({ outcome: "infra", detail: expect.stringContaining("locked false") });
    expect(unlocked.robot.plans).toEqual([]);
  });

  it("runs before-first-unlock only where storage is file-encrypted, so the reboot really locks it", async () => {
    const world = d04World("before-first-unlock");
    world.device.rings = undefined;
    world.device.crypto = "none";
    expect(await D04.run(world.ctx)).toMatchObject({ outcome: "infra", component: world.device.name, detail: expect.stringContaining("not file") });
    expect(world.robot.plans).toEqual([]);
    expect(world.ctx.evidence.crypto_type).toBe("none");
  });

  it("hibernation's undo opens the app, which is all that lifts the stopped state hibernating leaves", () => {
    expect(D04_VARIANTS.find((v) => v.name === "hibernation")?.undo).toBe("device.launch");
  });

  it("blames the device when a variant did not take, and reads a bucket by name or number", async () => {
    const stuck = d04World("standby-rare");
    stuck.pixel.setStandbyBucket = async () => undefined;
    expect(await D04.run(stuck.ctx)).toMatchObject({ outcome: "infra", component: "pixel" });
    expect(stuck.robot.plans).toEqual([]);

    const saverOff = d04World("battery-saver");
    saverOff.pixel.batterySaver = async () => undefined;
    expect(await D04.run(saverOff.ctx)).toMatchObject({ outcome: "infra", component: "pixel" });

    const numbered = d04World("standby-restricted");
    numbered.pixel.setStandbyBucket = async () => {
      numbered.pixel.deviceState.standby_bucket = "45";
    };
    expect((await D04.run(numbered.ctx)).outcome).toBe("pass");
  });

  it("counts a quiet device only when the API really pushed and FCM accepted", async () => {
    const unpushed = d04World("before-first-unlock");
    unpushed.device.rings = undefined;
    unpushed.script.pushes = false;
    expect(await D04.run(unpushed.ctx)).toMatchObject({ failure_class: "no_push_attempt" });

    const refused = d04World("hibernation");
    refused.device.rings = undefined;
    refused.script.push.response_class = "rejected";
    expect(await D04.run(refused.ctx)).toMatchObject({ failure_class: "push_not_accepted" });
  });

  it("names a confirmed expectation's break as a regression, apart from an unconfirmed one", () => {
    const quiet = { ringsWithinMs: null, confirmed: true, why: "" };
    const ringing = { ringsWithinMs: 12_000, confirmed: true, why: "" };
    expect(d04Verdict("hibernation", quiet, { telecom_ms: 2_000 })).toMatchObject({ failure_class: "rang_hibernation" });
    expect(d04Verdict("battery-saver", ringing, undefined)).toMatchObject({ failure_class: "no_ring_battery_saver" });
    expect(d04Verdict("battery-saver", ringing, { full_screen_ms: 2_000 })).toMatchObject({ failure_class: "no_ring_battery_saver" });
    expect(d04Verdict("battery-saver", ringing, { telecom_ms: 2_000 }).outcome).toBe("pass");
    expect(d04Verdict("hibernation", quiet, undefined).outcome).toBe("pass");
  });

  it("blames the rig when the device lane is unreachable", async () => {
    const world = d04World("secure-lock");
    world.pixel.reachableNow = false;
    expect(await D04.run(world.ctx)).toMatchObject({ outcome: "infra", component: "pixel" });
    expect(world.undo).toEqual([]);
  });
});

const INSTALL_UNDOS = [
  { kind: "device.install", params: { device: "pixel", build: "current", member: "qa-a-technician" } },
  { kind: "device.reset", params: { device: "pixel" } },
];
const WAKES = ["tap call_decline", "kill", "force doze", "lock", "tap call_answer"];

describe("D10, fresh install", () => {
  it("installs, signs in, stores a push token, then passes D02p and D02", async () => {
    const { ctx, pixel, undo, robot } = wakeWorld("D10");
    expect(await D10.run(ctx)).toEqual(PASSED);
    expect(pixel.actions).toEqual(["uninstall", "install current", "notifications allowed", "launch /", "sign in qa-a-technician", ...WAKES]);
    expect(undo).toEqual(INSTALL_UNDOS);
    expect(robot.plans).toHaveLength(1);
    expect(ctx.evidence).toMatchObject({
      install: { current_package: "com.loonext.android.nonprod", signed_in: true, push_targets: 1, stored_tokens: 1, token_matches: true },
      push_wake: { session_id: "synthetic-1" },
      call_wake: { push: [{ session_id: "call-1" }] },
    });
  });

  it("unlocks the emulator for the sign-in, and blames the rig for an emulator or audio link that is missing", async () => {
    const locked = wakeWorld("D10");
    locked.pixel.deviceState.locked = true;
    expect(await D10.run(locked.ctx)).toEqual(PASSED);
    expect(locked.pixel.actions[0]).toBe("unlock");

    const gone = wakeWorld("D10");
    gone.pixel.reachableNow = false;
    expect(await D10.run(gone.ctx)).toMatchObject({ outcome: "infra", component: "pixel" });
    expect(gone.undo).toEqual([]);

    const unlinked = wakeWorld("D10");
    unlinked.audio.connectedNow = false;
    expect(await D10.run(unlinked.ctx)).toMatchObject({ outcome: "infra", component: "pixel-audio" });
    expect(unlinked.pixel.actions).toEqual([]);

    const unproven = wakeWorld("D10");
    unproven.audio.provenNow = false;
    expect(await D10.run(unproven.ctx)).toMatchObject({ outcome: "infra", component: "emulator-audio-unproven" });
    expect(unproven.pixel.actions).toEqual([]);
  });

  it("fails when the token the API stores is not the one the installed app holds, keeping neither", async () => {
    const stale = wakeWorld("D10");
    stale.app.storedTokens.set("qa-a-technician", ["fcm-token-0"]);
    expect(await D10.run(stale.ctx)).toMatchObject({ outcome: "fail", failure_class: "push_token_mismatch" });
    expect(stale.ctx.evidence.install).toMatchObject({ stored_tokens: 1, token_matches: false });
    expect(JSON.stringify(stale.ctx.evidence)).not.toMatch(/fcm-token/);

    const tokenless = wakeWorld("D10");
    tokenless.pixel.token = null;
    expect(await D10.run(tokenless.ctx)).toMatchObject({ outcome: "fail", failure_class: "no_device_push_token" });

    const unreadable = wakeWorld("D10");
    unreadable.pixel.pushToken = async () => {
      throw new Error("adb: run-as: package not debuggable");
    };
    expect(await D10.run(unreadable.ctx)).toMatchObject({ outcome: "infra", component: "pixel" });

    // A probe that cannot read the stored tokens leaves the check unmade, which is no pass.
    const blind = wakeWorld("D10");
    blind.app.pushTokens = async () => {
      throw new Error("app probe: reading device_push_tokens returned 503");
    };
    expect(await D10.run(blind.ctx)).toMatchObject({ outcome: "infra", component: "app-probe" });

    // A wake that failed is reported before any token check.
    const unwoken = wakeWorld("D10");
    unwoken.app.storedTokens.set("qa-a-technician", []);
    unwoken.pixel.rings = undefined;
    expect(await D10.run(unwoken.ctx)).toMatchObject({ failure_class: "no_ring_within_12s" });
  });

  it("fails a missing sign-in screen and a push token never stored", async () => {
    const noScreen = wakeWorld("D10");
    noScreen.pixel.signIn = async () => false;
    expect(await D10.run(noScreen.ctx)).toMatchObject({ failure_class: "no_sign_in_screen" });

    const tokenless = wakeWorld("D10");
    tokenless.app.targets.delete("qa-a-technician");
    expect(await D10.run(tokenless.ctx)).toMatchObject({ failure_class: "push_token_not_stored" });
    expect(tokenless.robot.plans).toEqual([]);
  });

  it("blames a missing APK on the rig, and calls a production package critical", async () => {
    const missing = wakeWorld("D10");
    missing.pixel.install = async () => {
      throw new Error("no APK at work/apk/current.apk");
    };
    expect(await D10.run(missing.ctx)).toMatchObject({ outcome: "infra", component: "apk" });

    const production = wakeWorld("D10");
    production.pixel.install = async () => "com.loonext.android";
    expect(await D10.run(production.ctx)).toMatchObject({ failure_class: "not_nonprod_package", critical: true });
  });

  it("fails when the new install's push wake or call wake fails", async () => {
    const unwoken = wakeWorld("D10");
    unwoken.script.syntheticStages = [];
    expect(await D10.run(unwoken.ctx)).toMatchObject({ failure_class: "push_not_received" });
    expect(unwoken.robot.plans).toEqual([]);

    const deaf = wakeWorld("D10");
    deafRobot(deaf);
    expect(await D10.run(deaf.ctx)).toMatchObject({ failure_class: "robot_did_not_hear_device" });
  });
});

describe("D12, upgrade from the previous release", () => {
  it("signs in on the previous build, upgrades in place without reopening it, keeps the token, then passes D02p and D02", async () => {
    const { ctx, pixel, undo, robot } = wakeWorld("D12");
    let version = "0.9.0";
    pixel.install = async (build) => {
      pixel.actions.push(`install ${build}`);
      version = build === "current" ? "1.0.0" : "0.9.0";
      return "com.loonext.android.nonprod";
    };
    const state = pixel.state.bind(pixel);
    pixel.state = async () => ({ ...(await state()), app_version: version });
    expect(await D12.run(ctx)).toEqual(PASSED);
    expect(pixel.actions).toEqual(["uninstall", "install previous", "notifications allowed", "launch /", "sign in qa-a-technician", "install current", ...WAKES]);
    expect(undo).toEqual(INSTALL_UNDOS);
    expect(robot.plans).toHaveLength(1);
    expect(ctx.evidence).toMatchObject({
      upgrade: { previous_package: "com.loonext.android.nonprod", current_package: "com.loonext.android.nonprod", version_before: "0.9.0", version_after: "1.0.0", push_targets_after: 1 },
    });
  });

  it("blames the rig for a missing previous APK, a previous build with no sign-in, and a signature mismatch on upgrade", async () => {
    const missing = wakeWorld("D12");
    missing.pixel.install = async (build) => {
      if (build === "previous") throw new Error("no APK at work/apk/previous.apk");
      return "com.loonext.android.nonprod";
    };
    expect(await D12.run(missing.ctx)).toMatchObject({ outcome: "infra", component: "apk" });

    const noScreen = wakeWorld("D12");
    noScreen.pixel.signIn = async () => false;
    expect(await D12.run(noScreen.ctx)).toMatchObject({ outcome: "infra", component: "apk" });

    const mismatch = wakeWorld("D12");
    mismatch.pixel.install = async (build) => {
      if (build === "current") throw new Error("INSTALL_FAILED_UPDATE_INCOMPATIBLE");
      return "com.loonext.android.nonprod";
    };
    expect(await D12.run(mismatch.ctx)).toMatchObject({ outcome: "infra", component: "apk" });
    expect(mismatch.robot.plans).toEqual([]);
  });

  it("fails a token lost in the upgrade, and a wake that fails after it", async () => {
    const lost = wakeWorld("D12");
    lost.pixel.install = async (build) => {
      if (build === "current") lost.app.targets.delete("qa-a-technician");
      return "com.loonext.android.nonprod";
    };
    expect(await D12.run(lost.ctx)).toMatchObject({ failure_class: "push_token_not_stored" });

    const unwoken = wakeWorld("D12");
    unwoken.pixel.rings = undefined;
    expect(await D12.run(unwoken.ctx)).toMatchObject({ failure_class: "no_ring_within_12s" });

    const muted = wakeWorld("D12");
    muted.audio.heard = null;
    expect(await D12.run(muted.ctx)).toMatchObject({ failure_class: "device_did_not_hear_robot" });
  });

  it("fails a token the upgrade left that is not the device's", async () => {
    const world = wakeWorld("D12");
    world.app.storedTokens.set("qa-a-technician", ["fcm-token-0", "fcm-token-9"]);
    expect(await D12.run(world.ctx)).toMatchObject({ outcome: "fail", failure_class: "push_token_mismatch", detail: expect.stringContaining("2 token(s)") });
    const kept = wakeWorld("D12");
    kept.app.storedTokens.set("qa-a-technician", ["fcm-token-0", "fcm-token-1"]);
    expect(await D12.run(kept.ctx)).toEqual(PASSED);
  });

  it("calls a production package critical", async () => {
    const world = wakeWorld("D12");
    world.pixel.install = async (build) => (build === "current" ? "com.loonext.android" : "com.loonext.android.nonprod");
    expect(await D12.run(world.ctx)).toMatchObject({ failure_class: "not_nonprod_package", critical: true });
  });
});

function recoveryWorld() {
  const world = wakeWorld("D11");
  const polls: number[] = [];
  let greenAfter = 0;
  world.rig.health = async () => {
    polls.push(world.time.now);
    // tools/rig/src/health.mjs's own check names: none of them is a device.
    return { ...world.rig.report, results: polls.length > greenAfter ? [{ name: "api", pass: true }] : [{ name: "uplink", pass: false }] };
  };
  // A realistic host: API 34 and 35 up beside the device lane, 36 down, and hostd's boots and stops followed by adb.
  world.devices.emulators.get(36)!.reachableNow = false;
  let mostBooted = 0;
  const count = () => {
    const up = [world.pixel, ...world.devices.emulators.values()].filter((d) => d.reachableNow).length;
    mostBooted = Math.max(mostBooted, up);
  };
  world.devices.bootEmulator = async (api) => {
    world.devices.actions.push(`boot ${api}`);
    world.devices.emulators.get(api)!.reachableNow = true;
    count();
  };
  world.devices.shutdownEmulator = async (api) => {
    world.devices.actions.push(`shutdown ${api}`);
    world.devices.emulators.get(api)!.reachableNow = false;
  };
  return { ...world, polls, greenAfter: (n: number) => (greenAfter = n), mostBooted: () => mostBooted };
}

describe("D11, unattended recovery", () => {
  it("cold-restarts the device lane and cycles each E01 AVD one at a time within max_booted, waits for health, then passes D02p", async () => {
    const world = recoveryWorld();
    const { ctx, devices, pixel, undo, robot } = world;
    world.greenAfter(3);
    expect(await D11.run(ctx)).toEqual(PASSED);
    expect(devices.actions).toEqual([
      "cold restart pixel",
      "shutdown 34",
      "shutdown 35",
      "shutdown 36",
      "boot 34",
      "shutdown 34",
      "boot 35",
      "shutdown 35",
      "boot 36",
      "shutdown 36",
    ]);
    expect(world.mostBooted()).toBeLessThanOrEqual(MAX_BOOTED);
    expect(pixel.actions).toEqual(["tap call_decline"]);
    // The release boots back what was running before.
    expect(undo).toEqual([
      { kind: "device.reset", params: { device: "pixel" } },
      { kind: "device.boot", params: { device: "emulator-34" } },
      { kind: "device.boot", params: { device: "emulator-35" } },
    ]);
    expect(robot.plans).toEqual([]);
    expect(world.polls).toHaveLength(4);
    expect(world.polls.slice(1).every((at, i) => at - world.polls[i]! >= 60_000)).toBe(true);
    expect(ctx.evidence).toMatchObject({
      recovery: { health_polls: 4, failing: [], restart_errors: [], emulators_booted_before: [34, 35] },
      push_wake: { session_id: "synthetic-1" },
    });
  });

  it("fails when health is not green 10 minutes after the disruption, asking no more than once a minute", async () => {
    const world = recoveryWorld();
    world.greenAfter(Infinity);
    const started = world.time.now;
    expect(await D11.run(world.ctx)).toMatchObject({ failure_class: "health_not_green_in_10min" });
    expect(world.polls.at(-1)! - started).toBeLessThanOrEqual(10 * 60_000);
    expect(world.polls.slice(1).every((at, i) => at - world.polls[i]! >= 60_000)).toBe(true);
    expect(world.simulated).toEqual([]);
  });

  it("judges each E01 AVD's boot and the device lane's audio link, which rig health does not check", async () => {
    const dead = recoveryWorld();
    dead.devices.bootEmulator = async (api) => {
      if (api !== 35) return void (dead.devices.emulators.get(api)!.reachableNow = true);
      throw new Error("the API 35 emulator did not finish booting");
    };
    const deadResult = await D11.run(dead.ctx);
    expect(deadResult).toMatchObject({ failure_class: "health_not_green_in_10min" });
    expect((deadResult as { detail: string }).detail).toContain("emulator-35");
    expect((deadResult as { detail: string }).detail).toContain("boot emulator-35: the API 35 emulator did not finish booting");
    expect(dead.simulated).toEqual([]);

    const unlinked = recoveryWorld();
    unlinked.devices.coldRestart = async () => {
      unlinked.audio.connectedNow = false;
    };
    const result = await D11.run(unlinked.ctx);
    expect(result).toMatchObject({ failure_class: "health_not_green_in_10min", detail: expect.stringContaining("pixel-audio-link") });
    expect((result as { detail: string }).detail).not.toContain("bluetooth");

    // A link already down would make its recovery mean nothing, so nothing is disrupted.
    const downBefore = recoveryWorld();
    downBefore.audio.connectedNow = false;
    expect(await D11.run(downBefore.ctx)).toMatchObject({ outcome: "infra", component: "pixel-audio" });
    expect(downBefore.devices.actions).toEqual([]);
  });

  it("waits for an E01 AVD that answers adb late, inside its boot wait", async () => {
    const late = recoveryWorld();
    const emulator = late.devices.emulators.get(36)!;
    let bootedAt = Infinity;
    const boot = late.devices.bootEmulator;
    late.devices.bootEmulator = async (api) => {
      await boot(api);
      if (api === 36) bootedAt = late.time.now;
    };
    emulator.reachable = async () => late.time.now - bootedAt >= 2 * 60_000;
    expect(await D11.run(late.ctx)).toEqual(PASSED);
  });

  it("keeps polling past a health run that threw, and records restarts that failed", async () => {
    const world = recoveryWorld();
    let calls = 0;
    world.rig.health = async () => {
      calls++;
      if (calls === 1) throw new Error("rig health exited 1");
      return world.rig.report;
    };
    const boot = world.devices.bootEmulator;
    world.devices.bootEmulator = async (api) => {
      await boot(api);
      if (api === 35) throw new Error("rig: the device is locked and the store has no PIN");
    };
    expect(await D11.run(world.ctx)).toEqual(PASSED);
    expect((world.ctx.evidence.recovery as { restart_errors: string[] }).restart_errors).toEqual([
      "boot emulator-35: rig: the device is locked and the store has no PIN",
    ]);
  });

  it("fails a device lane that health calls green but adb cannot see, and unlocks one its restart left locked", async () => {
    const lost = recoveryWorld();
    let seen = 0;
    lost.pixel.reachable = async () => ++seen <= 1;
    expect(await D11.run(lost.ctx)).toMatchObject({ failure_class: "health_not_green_in_10min", detail: expect.stringContaining("pixel") });
    expect(lost.simulated).toEqual([]);

    const locked = recoveryWorld();
    locked.devices.coldRestart = async (name) => {
      locked.devices.actions.push(`cold restart ${name}`);
      locked.pixel.deviceState.locked = true;
    };
    expect(await D11.run(locked.ctx)).toEqual(PASSED);
    expect(locked.pixel.actions).toEqual(["unlock", "tap call_decline"]);
  });

  it("fails when D02p fails after recovery, and blames hostd when it cannot cold-restart the device lane", async () => {
    const unwoken = recoveryWorld();
    unwoken.pixel.rings = undefined;
    expect(await D11.run(unwoken.ctx)).toMatchObject({ failure_class: "no_ring_within_12s" });

    const hostless = recoveryWorld();
    hostless.devices.coldRestart = async () => {
      throw new Error("hostd: POST /v1/devices/pixel/kill answered 503");
    };
    expect(await D11.run(hostless.ctx)).toMatchObject({ outcome: "infra", component: "hostd" });
    expect(hostless.devices.actions).toEqual([]);
  });
});

function e01World(label: string, api: (typeof EMULATOR_APIS)[number] = 35) {
  const world = wakeWorld("E01");
  const every = label === "wake" ? 3 : 7;
  // A day in the period that runs `api`.
  const period = Math.ceil(Date.UTC(2026, 9, 31) / DAY_MS / every / 3) * 3 + EMULATOR_APIS.indexOf(api);
  world.time.now = period * every * DAY_MS + 6 * 3_600_000;
  world.ctx.slot = { index: 0, label };
  const device = world.devices.emulators.get(api)!;
  return { ...world, api, device };
}

function withHistory(ctx: ScenarioContext, attempts: Awaited<ReturnType<ScenarioHistoryApi["attempts"]>>) {
  const asked: number[] = [];
  const history: ScenarioHistoryApi = {
    async attempts(args) {
      asked.push(args.since);
      return attempts;
    },
  };
  ctx.history = history;
  return asked;
}

describe("E01, emulator wake", () => {
  it("steps each variant's runs through API 34, 35 and 36", () => {
    for (const every of [3, 7]) {
      const start = Math.ceil(Date.UTC(2026, 9, 31) / DAY_MS / every / 3) * 3 * every * DAY_MS;
      expect([0, 1, 2, 3].map((k) => emulatorApiOn(start + k * every * DAY_MS, every))).toEqual([34, 35, 36, 34]);
      expect(emulatorApiOn(start + 2 * 3_600_000, every)).toBe(emulatorApiOn(start, every));
    }
  });

  it("wakes the day's emulator as D02 does, and records the robot hearing its code", async () => {
    const { ctx, device, robot, undo, api } = e01World("wake");
    expect(await E01.run(ctx)).toEqual(E01_PASSED);
    expect(undo).toEqual([{ kind: "device.reset", params: { device: `emulator-${api}` } }]);
    expect(device.actions).toEqual(["kill", "force doze", "lock", "tap call_answer"]);
    expect(robot.plans).toHaveLength(1);
    expect(robot.plans[0]).toMatchObject({ direction: "outbound", role: "ROBOT-1", to: "DEV-E1", expect: "emulator", lease_id: "lease-test" });
    expect(ctx.evidence).toMatchObject({ variant: "wake", api, audio: { api, heard: true }, push: [{ response_class: "accepted" }] });
  });

  it("boots the emulator when it is down, and blames the rig when it will not boot", async () => {
    const down = e01World("wake");
    down.device.reachableNow = false;
    down.devices.bootEmulator = async (api) => {
      down.devices.actions.push(`boot ${api}`);
      down.device.reachableNow = true;
    };
    expect(await E01.run(down.ctx)).toEqual(E01_PASSED);
    expect(down.devices.actions).toEqual(["boot 35"]);

    const dead = e01World("wake");
    dead.device.reachableNow = false;
    dead.devices.bootEmulator = async () => {
      throw new Error("the API 35 emulator did not finish booting");
    };
    expect(await E01.run(dead.ctx)).toMatchObject({ outcome: "infra", component: "emulator-35" });
    expect(dead.undo).toEqual([]);

    const unseen = e01World("wake");
    unseen.device.reachableNow = false;
    expect(await E01.run(unseen.ctx)).toMatchObject({ outcome: "infra", component: "emulator-35" });
  });

  it("forgives one level's silence when another was heard this week, and raises emulator-audio-degraded when none was", async () => {
    const forgiven = e01World("wake");
    deafRobot(forgiven);
    const asked = withHistory(forgiven.ctx, [
      { run_id: "E01-1", attempt: 1, outcome: "pass", finished_at: "2026-10-29T06:05:00.000Z", evidence: { audio: { api: 34, heard: true } } },
    ]);
    const result = await E01.run(forgiven.ctx);
    expect(result).toMatchObject({ outcome: "pass" });
    expect((result as { detail: string }).detail).toContain("API 34");
    expect((result as { detail: string }).detail).toContain(EMULATOR_HEARING_NOT_JUDGED);
    expect(asked).toEqual([forgiven.time.now - 7 * DAY_MS]);
    expect(forgiven.ctx.evidence.audio).toEqual({ api: 35, heard: false });

    const degraded = e01World("wake");
    deafRobot(degraded);
    withHistory(degraded.ctx, [{ run_id: "E01-1", attempt: 1, outcome: "pass", finished_at: "", evidence: { audio: { api: 34, heard: false } } }]);
    expect(await E01.run(degraded.ctx)).toMatchObject({ outcome: "fail", failure_class: "emulator-audio-degraded" });

    const firstWeek = e01World("wake");
    deafRobot(firstWeek);
    expect(await E01.run(firstWeek.ctx)).toMatchObject({ outcome: "fail", failure_class: "emulator-audio-degraded" });
  });

  it("fails a wake that does not ring, or rings with a refused push, whatever the audio did", async () => {
    const silent = e01World("wake");
    silent.device.rings = undefined;
    expect(await E01.run(silent.ctx)).toMatchObject({ failure_class: "no_ring_within_12s" });

    const refused = e01World("wake");
    refused.script.push.priority = "normal";
    expect(await E01.run(refused.ctx)).toMatchObject({ failure_class: "push_not_high_priority" });
  });

  it("must not ring with notifications revoked", async () => {
    const quiet = e01World("notifications revoked", 36);
    quiet.device.rings = undefined;
    expect(await E01.run(quiet.ctx)).toEqual(PASSED);
    expect(quiet.device.actions).toEqual(["notifications revoked"]);
    expect(quiet.undo).toEqual([{ kind: "device.reset", params: { device: "emulator-36" } }]);
    expect(quiet.robot.plans[0]).toMatchObject({ to: "DEV-E1", play: null, record: false, hangup_before_answer_ms: 18_000 });

    const rang = e01World("notifications revoked", 36);
    expect(await E01.run(rang.ctx)).toMatchObject({ failure_class: "rang_with_notifications_revoked" });
  });

  it("must not ring force-stopped, and opens the app again on release", async () => {
    const quiet = e01World("force-stopped", 34);
    quiet.device.rings = undefined;
    expect(await E01.run(quiet.ctx)).toEqual(PASSED);
    expect(quiet.device.actions).toEqual(["force-stop"]);
    expect(quiet.undo).toEqual([
      { kind: "device.reset", params: { device: "emulator-34" } },
      { kind: "device.launch", params: { device: "emulator-34" } },
    ]);

    const rang = e01World("force-stopped", 34);
    expect(await E01.run(rang.ctx)).toMatchObject({ failure_class: "rang_when_force_stopped" });

    // Quiet because the call never reached the API proves nothing.
    const unpushed = e01World("force-stopped", 34);
    unpushed.device.rings = undefined;
    unpushed.script.pushes = false;
    expect(await E01.run(unpushed.ctx)).toMatchObject({ failure_class: "no_push_attempt" });
  });

  it("blames the rig for a variant it does not know, or a refused dial", async () => {
    const unknown = e01World("upside down");
    expect(await E01.run(unknown.ctx)).toMatchObject({ outcome: "infra", component: "runner" });

    const refused = e01World("notifications revoked");
    refusedDial(refused);
    expect(await E01.run(refused.ctx)).toMatchObject({ outcome: "infra", component: "guard" });
  });
});

describe("the wake runners' budgets", () => {
  const scenarios = (JSON.parse(readFileSync(join(REPO, "tools", "rig", "scenarios.json"), "utf8")) as {
    scenarios: { id: string; dials: number; far_end_legs: number; runs: { label?: string }[] }[];
  }).scenarios;
  const runners: [ScenarioRunner, (world: ReturnType<typeof wakeWorld>) => void][] = [
    [D02, () => undefined],
    [D02p, () => undefined],
    [D03, () => undefined],
    [D04, () => undefined],
    [D10, () => undefined],
    [D11, () => undefined],
    [D12, () => undefined],
    [E01, () => undefined],
  ];

  for (const [runner, arrange] of runners) {
    const row = scenarios.find((s) => s.id === runner.id)!;
    it(`${runner.id} places at most its ${row.far_end_legs} far-end leg(s) in every registry run`, async () => {
      for (const run of row.runs) {
        const world = wakeWorld(runner.id);
        world.ctx.slot = { index: 0, ...(run.label ? { label: run.label } : {}) };
        arrange(world);
        expect(runner.prepare).toBeUndefined();
        expect((await runner.run(world.ctx)).outcome).not.toBe("infra");
        expect(world.robot.plans.length).toBeLessThanOrEqual(row.far_end_legs);
        if (row.dials === 0) expect(world.robot.plans).toEqual([]);
      }
    });
  }
});
