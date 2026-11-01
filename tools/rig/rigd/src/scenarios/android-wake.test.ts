import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
  D10,
  D11,
  D12,
  E01,
  EMULATOR_APIS,
  RING_BEACON_STAGES,
  d04VariantOn,
  d04Verdict,
  emulatorApiOn,
  judgeBeacons,
} from "./android-wake.ts";
import type { LeaseHandle, ScenarioContext, ScenarioHistoryApi, ScenarioResult, ScenarioRunner } from "./context.ts";
import { fakeContext } from "./fakes.ts";

const REPO = fileURLToPath(new URL("../../../../../", import.meta.url));
const DAY_MS = 86_400_000;
const PASSED = { outcome: "pass", detail: undefined };

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
  it("passes when FCM takes the push at high priority, the Pixel rings, is answered on its lock screen and both codes are heard", async () => {
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

  it("blames the rig, and changes nothing, when the Pixel or its audio link is missing", async () => {
    const gone = wakeWorld("D02");
    gone.pixel.reachableNow = false;
    expect(await D02.run(gone.ctx)).toMatchObject({ outcome: "infra", component: "pixel" });
    expect(gone.undo).toEqual([]);
    expect(gone.robot.plans).toEqual([]);

    const unpaired = wakeWorld("D02");
    unpaired.audio.connectedNow = false;
    expect(await D02.run(unpaired.ctx)).toMatchObject({ outcome: "infra", component: "pixel-audio" });
    expect(unpaired.pixel.actions).toEqual([]);
    expect(unpaired.robot.plans).toEqual([]);
  });

  it("blames the Pixel, before dialing, when Doze or the lock did not take", async () => {
    const awake = wakeWorld("D02");
    awake.pixel.forceDoze = async () => undefined;
    expect(await D02.run(awake.ctx)).toMatchObject({ outcome: "infra", component: "pixel" });
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

  it("blames the rig when the Pixel is unreachable, before asking for a ring", async () => {
    const world = wakeWorld("D02p");
    world.pixel.reachableNow = false;
    expect(await D02p.run(world.ctx)).toMatchObject({ outcome: "infra", component: "pixel" });
    expect(world.simulated).toEqual([]);
  });
});

/** The handle rigd gives prepare: there is no lease yet to register an undo with. */
const UNLEASED: LeaseHandle = {
  id: "",
  registerUndo() {
    throw new Error("prepare runs before the lease; register undos in run");
  },
};

function idlesAfter(world: ReturnType<typeof wakeWorld>, ms: number | undefined) {
  const { pixel, time } = world;
  const idleAt = ms === undefined ? Infinity : time.now + ms;
  pixel.idleNaturally = async () => {
    pixel.actions.push("idle naturally");
  };
  const state = pixel.state.bind(pixel);
  pixel.state = async () => ({ ...(await state()), doze: time.now >= idleAt ? "IDLE" : "IDLE_PENDING" });
}

describe("D03, natural Doze", () => {
  it("waits before the lease for the deep idle the Pixel reaches by itself, then runs D02 without forcing Doze", async () => {
    const world = wakeWorld("D03");
    idlesAfter(world, 45 * 60_000);
    const { ctx, pixel, undo } = world;
    expect(await D03.prepare!({ ...ctx, lease: UNLEASED })).toBeUndefined();
    expect(ctx.evidence.deep_idle_after_ms).toBeGreaterThanOrEqual(45 * 60_000);
    expect(await D03.run(ctx)).toEqual(PASSED);
    expect(undo[0]).toEqual({ kind: "device.reset", params: { device: "pixel" } });
    expect(undo).toHaveLength(1);
    expect(pixel.actions).toEqual(["idle naturally", "kill", "lock", "tap call_answer"]);
    expect(world.robot.plans).toHaveLength(1);
  });

  it("reports a Pixel that never reached deep idle as the rig's, inside rigd's prepare limit, and plugs it back in", async () => {
    const world = wakeWorld("D03");
    idlesAfter(world, undefined);
    const started = world.time.now;
    expect(await D03.prepare!({ ...world.ctx, lease: UNLEASED })).toEqual({ outcome: "infra", component: "pixel", detail: "never reached deep idle" });
    expect(world.time.now - started).toBeLessThan(2 * 60 * 60_000);
    expect(world.pixel.actions).toEqual(["idle naturally", "exit doze"]);
  });

  it("checks the Pixel and its audio link before two hours of waiting", async () => {
    const gone = wakeWorld("D03");
    gone.pixel.reachableNow = false;
    expect(await D03.prepare!({ ...gone.ctx, lease: UNLEASED })).toMatchObject({ outcome: "infra", component: "pixel" });

    const unpaired = wakeWorld("D03");
    unpaired.audio.connectedNow = false;
    expect(await D03.prepare!({ ...unpaired.ctx, lease: UNLEASED })).toMatchObject({ outcome: "infra", component: "pixel-audio" });
    expect(unpaired.pixel.actions).toEqual([]);
  });

  it("resets the Pixel even when it left deep idle before the dial", async () => {
    const world = wakeWorld("D03");
    expect(await D03.run(world.ctx)).toMatchObject({ outcome: "infra", component: "pixel" });
    expect(world.undo).toEqual([{ kind: "device.reset", params: { device: "pixel" } }]);
    expect(world.robot.plans).toEqual([]);
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
  return world;
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
    it(`${variant.name}: puts the Pixel in it, passes when it ${rings ? "rings" : "stays quiet"} and fails when it does not`, async () => {
      const world = d04World(variant.name);
      if (!rings) world.pixel.rings = undefined;
      expect((await D04.run(world.ctx)).outcome).toBe("pass");
      expect(world.pixel.actions).toEqual(SETUP[variant.name]);
      expect(world.undo[0]).toEqual({ kind: "device.reset", params: { device: "pixel" } });
      if (variant.undo) expect(world.undo[1]).toEqual({ kind: variant.undo, params: { device: "pixel" } });
      expect(world.robot.plans[0]).toMatchObject({ to: "DEV-A1", play: null, record: false, lease_id: "lease-test" });
      expect(world.ctx.evidence).toMatchObject({ variant: variant.name, expected: variant.expect, device: { locked: true } });

      const wrong = d04World(variant.name);
      if (rings) wrong.pixel.rings = undefined;
      expect(await D04.run(wrong.ctx)).toMatchObject({ outcome: "fail", failure_class: `unconfirmed_${variant.name.replaceAll("-", "_")}` });
    });
  }

  it("hibernation's undo opens the app, which is all that lifts the stopped state hibernating leaves", () => {
    expect(D04_VARIANTS.find((v) => v.name === "hibernation")?.undo).toBe("device.launch");
  });

  it("blames the Pixel when a variant did not take, and reads a bucket by name or number", async () => {
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

  it("counts a quiet Pixel only when the API really pushed and FCM accepted", async () => {
    const unpushed = d04World("before-first-unlock");
    unpushed.pixel.rings = undefined;
    unpushed.script.pushes = false;
    expect(await D04.run(unpushed.ctx)).toMatchObject({ failure_class: "no_push_attempt" });

    const refused = d04World("hibernation");
    refused.pixel.rings = undefined;
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

  it("blames the rig when the Pixel is unreachable", async () => {
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
      install: { current_package: "com.loonext.android.nonprod", signed_in: true, push_targets: 1 },
      push_wake: { session_id: "synthetic-1" },
      call_wake: { push: [{ session_id: "call-1" }] },
    });
  });

  it("unlocks the Pixel for the sign-in, and blames the rig for a Pixel or audio link that is missing", async () => {
    const locked = wakeWorld("D10");
    locked.pixel.deviceState.locked = true;
    expect(await D10.run(locked.ctx)).toEqual(PASSED);
    expect(locked.pixel.actions[0]).toBe("unlock");

    const gone = wakeWorld("D10");
    gone.pixel.reachableNow = false;
    expect(await D10.run(gone.ctx)).toMatchObject({ outcome: "infra", component: "pixel" });
    expect(gone.undo).toEqual([]);

    const unpaired = wakeWorld("D10");
    unpaired.audio.connectedNow = false;
    expect(await D10.run(unpaired.ctx)).toMatchObject({ outcome: "infra", component: "pixel-audio" });
    expect(unpaired.pixel.actions).toEqual([]);
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
    return { ...world.rig.report, results: polls.length > greenAfter ? [{ name: "api", pass: true }] : [{ name: "emulators", pass: false }] };
  };
  return { ...world, polls, greenAfter: (n: number) => (greenAfter = n) };
}

describe("D11, unattended recovery", () => {
  it("disrupts the Pixel and every emulator, waits for health, then passes D02p", async () => {
    const world = recoveryWorld();
    const { ctx, devices, pixel, undo, robot } = world;
    world.greenAfter(3);
    expect(await D11.run(ctx)).toEqual(PASSED);
    expect(devices.actions).toEqual(["power cycle", "shutdown 34", "shutdown 35", "shutdown 36", "boot 34", "boot 35", "boot 36"]);
    expect(pixel.actions).toEqual(["reboot", "tap call_decline"]);
    expect(undo).toEqual([
      { kind: "device.reset", params: { device: "pixel" } },
      ...EMULATOR_APIS.map((api) => ({ kind: "device.boot", params: { device: `emulator-${api}` } })),
    ]);
    expect(robot.plans).toEqual([]);
    expect(world.polls).toHaveLength(4);
    expect(world.polls.slice(1).every((at, i) => at - world.polls[i]! >= 60_000)).toBe(true);
    expect(ctx.evidence).toMatchObject({ recovery: { health_polls: 4, failing: [], restart_errors: [] }, push_wake: { session_id: "synthetic-1" } });
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

  it("keeps polling past a health run that threw, and records restarts that failed", async () => {
    const world = recoveryWorld();
    let calls = 0;
    world.rig.health = async () => {
      calls++;
      if (calls === 1) throw new Error("rig health exited 1");
      return world.rig.report;
    };
    world.devices.bootEmulator = async (api) => {
      if (api === 35) throw new Error("the API 35 emulator did not finish booting");
    };
    expect(await D11.run(world.ctx)).toEqual(PASSED);
    expect((world.ctx.evidence.recovery as { restart_errors: string[] }).restart_errors).toEqual([
      "boot emulator-35: the API 35 emulator did not finish booting",
    ]);
  });

  it("fails a Pixel that health calls green but adb cannot see, and unlocks one left locked by its reboot", async () => {
    const lost = recoveryWorld();
    let seen = 0;
    lost.pixel.reachable = async () => ++seen <= 2;
    expect(await D11.run(lost.ctx)).toMatchObject({ failure_class: "pixel_not_recovered" });

    const locked = recoveryWorld();
    locked.pixel.reboot = async () => {
      locked.pixel.actions.push("reboot");
      locked.pixel.deviceState.locked = true;
    };
    expect(await D11.run(locked.ctx)).toEqual(PASSED);
    expect(locked.pixel.actions).toEqual(["reboot", "unlock", "tap call_decline"]);
  });

  it("fails when D02p fails after recovery, and blames the rig when there is no hub port to cycle", async () => {
    const unwoken = recoveryWorld();
    unwoken.pixel.rings = undefined;
    expect(await D11.run(unwoken.ctx)).toMatchObject({ failure_class: "no_ring_within_12s" });

    const hubless = recoveryWorld();
    hubless.devices.powerCycle = async () => {
      throw new Error("rig: the store names no USB hub port for the Pixel");
    };
    expect(await D11.run(hubless.ctx)).toMatchObject({ outcome: "infra", component: "usb-hub" });
    expect(hubless.devices.actions).toEqual([]);
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
    expect(await E01.run(ctx)).toEqual(PASSED);
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
    expect(await E01.run(down.ctx)).toEqual(PASSED);
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
    [D03, (world) => idlesAfter(world, 0)],
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
        const prepared: ScenarioResult | undefined = runner.prepare ? await runner.prepare({ ...world.ctx, lease: UNLEASED }) : undefined;
        expect(prepared).toBeUndefined();
        expect((await runner.run(world.ctx)).outcome).not.toBe("infra");
        expect(world.robot.plans.length).toBeLessThanOrEqual(row.far_end_legs);
        if (row.dials === 0) expect(world.robot.plans).toEqual([]);
      }
    });
  }
});
