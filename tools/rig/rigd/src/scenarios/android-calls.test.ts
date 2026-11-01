import { describe, expect, it } from "vitest";
import type { RecordingJudgement, Surface } from "@loonext/rig-robot";
import { D01, D07, D08, D09, D13, d01Answerer, lossOutsideOutage, MAX_LOSS, R00 } from "./android-calls.ts";
import type { MemberPageApi } from "./context.ts";
import { fakeContext, FakeDevice } from "./fakes.ts";

const WEEK = 7 * 86_400_000;
const AUDIENCE = "QA-A/DEV-A1";

function healthWorld() {
  return fakeContext("R00");
}

describe("R00, rig health", () => {
  it("passes when every check does, publishes the room and boots no emulator", async () => {
    const { ctx, devices } = healthWorld();
    const asked: number[] = [];
    ctx.blockedAt = (room) => (asked.push(room), room < 4 ? ["D01"] : []);
    expect(await R00.run(ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(ctx.evidence.room).toBe(4);
    expect(ctx.evidence.blocked_by_room).toEqual([]);
    expect(asked).toEqual([4]);
    expect(ctx.evidence.emulators).toEqual({ 34: true, 35: true, 36: true });
    expect(ctx.evidence.pixel).toMatchObject({ locked: false, bluetooth_bonded: 1, audio_connected: true, play_services_minimum: 12_451_000 });
    expect(devices.actions).toEqual([]);
  });

  it("publishes the scenarios the room blocks beside the room, and nothing when health reports no room", async () => {
    const tight = healthWorld();
    tight.rig.report.room = 2;
    tight.ctx.blockedAt = (room) => (room < 3 ? ["D01", "S10"] : []);
    await R00.run(tight.ctx);
    expect(tight.ctx.evidence).toMatchObject({ room: 2, blocked_by_room: ["D01", "S10"] });

    const unknown = healthWorld();
    unknown.rig.report.room = null;
    await R00.run(unknown.ctx);
    expect(unknown.ctx.evidence.room).toBeNull();
    expect(unknown.ctx.evidence).not.toHaveProperty("blocked_by_room");
  });

  it("fails each health check that failed, by name", async () => {
    const world = healthWorld();
    world.rig.report.results.push({ name: "signIn", pass: false, reason: "GET /v1/me answered 401" });
    expect(await R00.run(world.ctx)).toMatchObject({ outcome: "fail", failure_class: "health_sign_in" });
    expect(world.ctx.evidence.health).toEqual([
      { name: "api", pass: true },
      { name: "signIn", pass: false },
    ]);
  });

  it("calls a missing store key and an unreadable report the rig's fault", async () => {
    const keyless = healthWorld();
    keyless.rig.report.results.push({ name: "guard", pass: false, reason: "rig secrets: guard-token-rig-api is not in the store (/rig/secrets)" });
    expect(await R00.run(keyless.ctx)).toMatchObject({ outcome: "infra", component: "store" });

    const unread = healthWorld();
    unread.rig.health = async () => {
      throw new Error("rig health wrote no state/health.json");
    };
    expect(await R00.run(unread.ctx)).toMatchObject({ outcome: "infra", component: "rig-health" });
  });

  it("fails a guard that is not ok or under its balance floor, and calls an unsafe partition critical", async () => {
    const down = healthWorld();
    down.guard.healthBody = { ...down.guard.healthBody, ok: false };
    expect(await R00.run(down.ctx)).toMatchObject({ failure_class: "guard_not_ok" });

    const poor = healthWorld();
    poor.guard.healthBody = { ...poor.guard.healthBody, balance_above_floor: false };
    expect(await R00.run(poor.ctx)).toMatchObject({ failure_class: "balance_below_floor" });

    const unsafe = healthWorld();
    unsafe.guard.healthBody = {
      ...unsafe.guard.healthBody,
      ok: false,
      telnyx: { key: "present", safety: { state: "unsafe", reasons: ["webhook_to_production"], checked_at: 0 } },
    };
    unsafe.rig.report.results.push({ name: "tz", pass: false, reason: "Node and Postgres disagree" });
    const result = await R00.run(unsafe.ctx);
    expect(result).toMatchObject({ outcome: "fail", failure_class: "isolation_unsafe", critical: true });
    expect(result).toMatchObject({ detail: expect.stringContaining("also health_tz") });

    const keyless = healthWorld();
    keyless.guard.healthBody = { ...keyless.guard.healthBody, ok: false, telnyx: { key: "absent", safety: { state: "unchecked", reasons: [] } } };
    expect(await R00.run(keyless.ctx)).toMatchObject({ outcome: "infra", component: "guard" });

    const unreachable = healthWorld();
    unreachable.guard.health = async () => {
      throw new Error("fetch failed");
    };
    expect(await R00.run(unreachable.ctx)).toMatchObject({ outcome: "infra", component: "guard" });
  });

  it("calls a missing or unreachable Pixel infra, never a fail", async () => {
    const missing = healthWorld();
    missing.devices.pixel = () => {
      throw new Error("rig: the store names no Pixel serial");
    };
    expect(await R00.run(missing.ctx)).toMatchObject({ outcome: "infra", component: "pixel" });

    const away = healthWorld();
    away.devices.pixelDevice.reachableNow = false;
    expect(await R00.run(away.ctx)).toMatchObject({ outcome: "infra", component: "pixel" });

    const deaf = fakeContext("R00");
    deaf.devices.pixel = () => new FakeDevice("pixel");
    expect(await R00.run(deaf.ctx)).toMatchObject({ outcome: "infra", component: "pixel-audio" });
  });

  it("fails a locked, unpaired or disconnected Pixel", async () => {
    const locked = healthWorld();
    locked.devices.pixelDevice.deviceState.locked = true;
    expect(await R00.run(locked.ctx)).toMatchObject({ failure_class: "pixel_locked" });

    const unreadable = healthWorld();
    unreadable.devices.pixelDevice.deviceState.locked = null;
    expect(await R00.run(unreadable.ctx)).toMatchObject({ outcome: "infra", component: "pixel" });

    // D03 holds the Pixel screen-off while it waits for deep idle; that is not the Pixel at rest.
    const held = healthWorld();
    held.devices.pixelDevice.deviceState.locked = true;
    held.ctx.laneHeldBy = (lane) => (lane === "device" ? "D03" : undefined);
    expect(await R00.run(held.ctx)).toEqual({ outcome: "pass", detail: undefined });
    expect(held.ctx.evidence.pixel).toMatchObject({ held_by: "D03" });
    held.devices.pixelDevice.deviceState.bluetooth_bonded = 0;
    expect(await R00.run(held.ctx)).toMatchObject({ failure_class: "pixel_not_paired" });

    const unpaired = healthWorld();
    unpaired.devices.pixelDevice.deviceState.bluetooth_bonded = 0;
    expect(await R00.run(unpaired.ctx)).toMatchObject({ failure_class: "pixel_not_paired" });

    const silent = healthWorld();
    silent.devices.audio.connectedNow = false;
    expect(await R00.run(silent.ctx)).toMatchObject({ failure_class: "pixel_audio_disconnected" });
  });

  it("compares Play services with the minimum the installed build declares", async () => {
    const old = healthWorld();
    old.devices.pixelDevice.deviceState.play_services_version = 12_000_000;
    expect(await R00.run(old.ctx)).toMatchObject({ failure_class: "play_services_below_minimum" });

    // One version short fails; the minimum itself passes.
    const short = healthWorld();
    short.devices.pixelDevice.deviceState.play_services_version = 12_450_999;
    expect(await R00.run(short.ctx)).toMatchObject({ failure_class: "play_services_below_minimum" });
    const exact = healthWorld();
    exact.devices.pixelDevice.deviceState.play_services_version = 12_451_000;
    expect(await R00.run(exact.ctx)).toEqual({ outcome: "pass", detail: undefined });

    const unread = healthWorld();
    unread.devices.pixelDevice.playServicesMinimum = async () => {
      throw new Error("adb: com.loonext.android.nonprod is not installed");
    };
    expect(await R00.run(unread.ctx)).toMatchObject({ outcome: "infra", component: "pixel" });

    const undeclared = healthWorld();
    undeclared.devices.pixelDevice.gmsMinimum = null;
    expect(await R00.run(undeclared.ctx)).toMatchObject({ outcome: "infra", component: "app-build" });
  });

  it("checks the emulators are up and leaves booting them to D11", async () => {
    const world = healthWorld();
    world.devices.emulators.get(35)!.reachableNow = false;
    expect(await R00.run(world.ctx)).toMatchObject({ outcome: "infra", component: "emulator-35" });
    expect(world.devices.actions).toEqual([]);
  });
});

/** QA-A's call row, the legs it rang, and pages that can say their call has cleared. */
function ringWorld(scenario: string) {
  const world = fakeContext(scenario);
  const { app, browser, devices, robot, time, undo } = world;
  const pixel = devices.pixelDevice;
  pixel.onScreen.add("call_hang_up");
  const row = {
    tenant: "QA-A",
    caller_role: "ROBOT-1",
    call_session_id: "a1-session",
    outcome: "answered" as const,
    forward_seconds: 25,
    started_at: "",
    ended_at: null as string | null,
    voicemail_path: null,
    voicemail_intake: null,
    voicemail_transcript: null,
  };
  app.callRows.push(row);
  // The row starts with ROBOT-1's call.
  const dial = robot.dial.bind(robot);
  robot.dial = async (plan) => {
    row.started_at = new Date(time.now + 1_000).toISOString();
    row.ended_at = new Date(time.now + 30_000).toISOString();
    return dial(plan);
  };
  const page = { clearsAfterMs: 400 as number | undefined, onAnswer: () => undefined as void };
  const open = browser.open.bind(browser);
  browser.open = async (member, surface, path) => {
    const opened = await open(member, surface, path);
    const answer = opened.answer;
    return Object.assign(opened, {
      async answer() {
        await answer();
        page.onAnswer();
      },
      async waitForCallCleared(timeoutMs: number) {
        return page.clearsAfterMs !== undefined && page.clearsAfterMs <= timeoutMs ? page.clearsAfterMs : undefined;
      },
    } satisfies Partial<MemberPageApi>);
  };
  /** Undos registered when each ring level was changed, so a test can see they came first. */
  const undosAtChange: number[] = [];
  const setRingAudience = app.setRingAudience.bind(app);
  app.setRingAudience = async (args) => {
    undosAtChange.push(undo.length);
    return setRingAudience(args);
  };
  return { ...world, pixel, page, undosAtChange };
}

function d01World(answerer: "page" | "pixel") {
  const world = ringWorld("D01");
  const start = world.time.now;
  world.time.now = d01Answerer(start) === answerer ? start : start + WEEK;
  // The server revokes the ring on the surface that did not answer.
  world.page.onAnswer = () => {
    world.pixel.call = "none";
  };
  world.app.callLegs = async () => [
    { member: "qa-a-dispatcher", state: world.browser.actions.includes("qa-a-dispatcher answer") ? "answered" : "failed", kind: "web" },
    { member: "qa-a-technician", state: world.pixel.actions.includes("tap call_answer") ? "answered" : "failed", kind: "android" },
  ];
  return world;
}

describe("D01, every rig surface rings and the answerer rotates", () => {
  it("alternates the answering surface week by week", () => {
    const start = Date.UTC(2026, 9, 31, 15);
    const answerers = [0, 1, 2, 3].map((week) => d01Answerer(start + week * WEEK));
    expect(new Set(answerers)).toEqual(new Set(["page", "pixel"]));
    expect(answerers[0]).not.toBe(answerers[1]);
    expect(answerers[0]).toBe(answerers[2]);
  });

  it("passes in a page week: both ring, the page answers, the Pixel clears, one winner", async () => {
    const { ctx, robot, app, browser, pixel, devices, undo, undosAtChange } = d01World("page");
    expect((await D01.run(ctx)).outcome).toBe("pass");
    expect(robot.plans[0]).toMatchObject({
      direction: "outbound",
      role: "ROBOT-1",
      to: "DEV-A1",
      expect: "qa-a-dispatcher",
      exclusive: true,
      lease_id: "lease-test",
    });
    expect(robot.plans).toHaveLength(1);
    expect(undo).toEqual([{ kind: "app.ring-audience", params: { tenant: "QA-A", role: "DEV-A1", member: "qa-a-dispatcher", level: null } }]);
    expect(undosAtChange).toEqual([1]);
    expect(app.audiences.get(`${AUDIENCE}/qa-a-dispatcher`)).toBe("text");
    expect(browser.opened[0]).toMatchObject({ member: "qa-a-dispatcher", surface: "qa-a-dispatcher" });
    expect(browser.actions).toContain("qa-a-dispatcher answer");
    expect(pixel.actions).not.toContain("tap call_answer");
    expect(devices.audio.played).toEqual(["pixel"]);
    expect(ctx.evidence.ring).toEqual({ page_ms: 1_500, telecom_ms: 2_000, full_screen_ms: 2_500 });
    expect(ctx.evidence.other_cleared_ms).toBe(0);
  });

  it("passes in a Pixel week, with the page clearing and the Pixel's call ended after", async () => {
    const { ctx, robot, browser, pixel } = d01World("pixel");
    expect((await D01.run(ctx)).outcome).toBe("pass");
    expect(robot.plans[0]).toMatchObject({ expect: "pixel", exclusive: true });
    expect(pixel.actions).toEqual(["tap call_answer", "tap call_hang_up"]);
    expect(browser.actions).not.toContain("qa-a-dispatcher answer");
    expect(ctx.evidence.other_cleared_ms).toBe(400);
  });

  it("fails a surface that does not ring within 8 s, and a Pixel without the full-screen ring", async () => {
    const page = d01World("page");
    page.browser.script.ringsAfterMs = 9_000;
    expect(await D01.run(page.ctx)).toMatchObject({ failure_class: "page_did_not_ring" });

    const telecom = d01World("page");
    telecom.pixel.rings = { telecom_ms: 9_000, full_screen_ms: 9_500 };
    expect(await D01.run(telecom.ctx)).toMatchObject({ failure_class: "pixel_not_ringing" });

    const screen = d01World("page");
    screen.pixel.rings = { telecom_ms: 2_000 };
    expect(await D01.run(screen.ctx)).toMatchObject({ failure_class: "no_full_screen_ring" });
  });

  it("fails a Pixel week whose ring offers no answer control", async () => {
    const world = d01World("pixel");
    world.pixel.onScreen.delete("call_answer");
    expect(await D01.run(world.ctx)).toMatchObject({ failure_class: "pixel_answer_control_missing" });
    expect(world.pixel.actions).not.toContain("tap call_answer");
  });

  it("fails when the robot hears someone other than the answerer, or both", async () => {
    const world = d01World("pixel");
    const outcome = world.robot.outcome;
    world.robot.outcome = (plan) => {
      const record = outcome(plan);
      return { ...record, judgement: { ...record.judgement!, pass: false, heard: ["pixel", "qa-a-dispatcher"] } };
    };
    expect(await D01.run(world.ctx)).toMatchObject({ failure_class: "robot_did_not_hear_answerer" });
  });

  it("fails when the surface that did not answer keeps the call past 3 s", async () => {
    const pixelRings = d01World("page");
    pixelRings.page.onAnswer = () => undefined;
    expect(await D01.run(pixelRings.ctx)).toMatchObject({ failure_class: "other_surface_kept_ringing" });

    const pageRings = d01World("pixel");
    pageRings.page.clearsAfterMs = 3_500;
    expect(await D01.run(pageRings.ctx)).toMatchObject({ failure_class: "other_surface_kept_ringing" });
  });

  it("fails unless the database has exactly one winner, the answerer", async () => {
    const two = d01World("page");
    two.app.callLegs = async () => [
      { member: "qa-a-dispatcher", state: "answered", kind: "web" },
      { member: "qa-a-technician", state: "answered", kind: "android" },
    ];
    expect(await D01.run(two.ctx)).toMatchObject({ failure_class: "not_one_winner" });

    const wrong = d01World("page");
    wrong.app.callLegs = async () => [{ member: "qa-a-technician", state: "answered", kind: "android" }];
    expect(await D01.run(wrong.ctx)).toMatchObject({ failure_class: "wrong_winner" });

    const rowless = d01World("page");
    rowless.app.callRows = [];
    expect(await D01.run(rowless.ctx)).toMatchObject({ failure_class: "no_call_row" });
  });

  it("calls an unreachable Pixel or its audio infra, before changing anything", async () => {
    const away = d01World("page");
    away.pixel.reachableNow = false;
    expect(await D01.run(away.ctx)).toMatchObject({ outcome: "infra", component: "pixel" });

    const silent = d01World("page");
    silent.devices.audio.connectedNow = false;
    expect(await D01.run(silent.ctx)).toMatchObject({ outcome: "infra", component: "pixel-audio" });

    for (const world of [away, silent]) {
      expect(world.robot.plans).toEqual([]);
      expect(world.undo).toEqual([]);
      expect(world.app.audiences.size).toBe(0);
    }
  });

  it("blames the guard for a refused dial", async () => {
    const world = d01World("page");
    world.robot.dial = async (plan) => ({ plan_id: "plan-0", plan, state: "failed", ids: {}, events: [], dtmf: "", errors: ["guard_refused:dial.window"] });
    expect(await D01.run(world.ctx)).toMatchObject({ outcome: "infra", component: "guard" });
  });
});

function d07World() {
  const world = fakeContext("D07");
  world.devices.pixelDevice.onScreen.add("call_hang_up");
  const outcome = world.robot.outcome;
  world.robot.outcome = (plan) => ({ ...outcome(plan), from_role: "DEV-A1" });
  return world;
}

describe("D07, the Android app calls out", () => {
  it("passes with the Pixel's code at the robot, the robot's at the Pixel, and DEV-A1 as caller ID", async () => {
    const { ctx, robot, devices, undo } = d07World();
    let undosAtExpect = -1;
    const expectCall = robot.expect.bind(robot);
    robot.expect = async (plan) => {
      undosAtExpect = undo.length;
      return expectCall(plan);
    };
    expect((await D07.run(ctx)).outcome).toBe("pass");
    expect(robot.plans[0]).toMatchObject({ direction: "inbound", role: "ROBOT-1", expect: "pixel", answer_after_ms: 4_000, lease_id: "lease-test" });
    expect(undo).toEqual([{ kind: "device.reset", params: { device: "pixel" } }]);
    expect(undosAtExpect).toBe(1);
    expect(devices.audio.played).toEqual(["pixel"]);
    expect(devices.pixelDevice.actions).toEqual(["dial ROBOT-1", "tap call_hang_up"]);
    expect(ctx.evidence.call).toMatchObject({ from_role: "DEV-A1", pixel_heard: { verdict: "heard", answered: "robot" } });
  });

  it("unlocks a locked Pixel before dialing", async () => {
    const world = d07World();
    world.devices.pixelDevice.deviceState.locked = true;
    expect((await D07.run(world.ctx)).outcome).toBe("pass");
    expect(world.devices.pixelDevice.actions.slice(0, 2)).toEqual(["unlock", "dial ROBOT-1"]);
  });

  it("names a deaf robot, a wrong caller ID, a deaf Pixel and a call that never connected", async () => {
    const deaf = d07World();
    const outcome = deaf.robot.outcome;
    deaf.robot.outcome = (plan) => {
      const record = outcome(plan);
      return { ...record, judgement: { ...record.judgement!, pass: false, heard: [], verdict: "silent", answered: null } };
    };
    expect(await D07.run(deaf.ctx)).toMatchObject({ failure_class: "robot_did_not_hear_pixel" });

    const wrong = d07World();
    const right = wrong.robot.outcome;
    wrong.robot.outcome = (plan) => ({ ...right(plan), from_role: "DEV-W1" });
    expect(await D07.run(wrong.ctx)).toMatchObject({ failure_class: "wrong_caller_id" });

    const muffled = d07World();
    muffled.devices.audio.heard = null;
    expect(await D07.run(muffled.ctx)).toMatchObject({ failure_class: "pixel_did_not_hear_robot" });

    const unanswered = d07World();
    const answered = unanswered.robot.outcome;
    unanswered.robot.outcome = (plan) => ({ ...answered(plan), answered_at: undefined, judgement: undefined });
    expect(await D07.run(unanswered.ctx)).toMatchObject({ failure_class: "not_answered" });
  });

  it("calls the dialer's missing labels, the audio link and the robot infra", async () => {
    const dialer = d07World();
    dialer.devices.pixelDevice.dial = async () => {
      throw new Error("rig: the app's calls screen offered no dialer");
    };
    expect(await D07.run(dialer.ctx)).toMatchObject({ outcome: "infra", component: "android-dialer" });

    const silent = d07World();
    silent.devices.audio.connectedNow = false;
    expect(await D07.run(silent.ctx)).toMatchObject({ outcome: "infra", component: "pixel-audio" });
    expect(silent.undo).toEqual([]);

    const robotless = d07World();
    robotless.robot.expect = async (plan) => ({ plan_id: "plan-0", plan, state: "failed", ids: {}, events: [], dtmf: "", errors: ["robot: no connection"] });
    expect(await D07.run(robotless.ctx)).toMatchObject({ outcome: "infra", component: "robot" });
    expect(robotless.devices.pixelDevice.actions).toEqual([]);
  });
});

const RING = { title: "Incoming call", body: "Rig caller is calling", tag: "loonext:call:a1-session" };

function d08World() {
  const world = fakeContext("D08");
  const { app, browser, robot } = world;
  browser.script.canPush = true;
  browser.script.onPush = (member) => app.targets.set(member, 1);
  // An earlier call's outcome card, still in the profile.
  browser.script.notifications = [{ title: "Missed call", body: "Rig caller called and nobody picked up.", tag: "loonext:call:earlier" }];
  const rings = { shows: true, replaced: true };
  const dial = robot.dial.bind(robot);
  robot.dial = async (plan) => {
    const record = await dial(plan);
    if (rings.shows) browser.script.notifications = [...browser.script.notifications!, RING];
    return record;
  };
  const wait = robot.wait.bind(robot);
  robot.wait = async (planId) => {
    const record = await wait(planId);
    if (rings.replaced) {
      browser.script.notifications = browser.script.notifications!.map((n) =>
        n.tag === RING.tag ? { ...n, title: "Missed call", body: "Rig caller called and nobody picked up." } : n,
      );
    }
    return record;
  };
  return { ...world, rings };
}

describe("D08, a background tab and Web Push", () => {
  it("passes when Chrome shows the ring within 10 s and the outcome replaces it on its tag", async () => {
    const { ctx, robot, app, browser, undo } = d08World();
    const undosAtChange: number[] = [];
    const setRingAudience = app.setRingAudience.bind(app);
    app.setRingAudience = async (args) => {
      undosAtChange.push(undo.length);
      return setRingAudience(args);
    };
    expect((await D08.run(ctx)).outcome).toBe("pass");
    expect(browser.actions).toEqual(["qa-a-dispatcher enable push", "qa-a-dispatcher background"]);
    expect(undo).toEqual([
      { kind: "app.ring-audience", params: { tenant: "QA-A", role: "DEV-A1", member: "qa-a-dispatcher", level: null } },
      { kind: "app.ring-audience", params: { tenant: "QA-A", role: "DEV-A1", member: "qa-a-technician", level: "text" } },
    ]);
    expect(undosAtChange).toEqual([2, 2]);
    expect(app.audiences.get(`${AUDIENCE}/qa-a-dispatcher`)).toBe("text");
    expect(app.audiences.get(`${AUDIENCE}/qa-a-technician`)).toBe("note");
    expect(robot.plans).toHaveLength(1);
    expect(robot.plans[0]).toMatchObject({ direction: "outbound", role: "ROBOT-1", to: "DEV-A1", play: null, record: false, lease_id: "lease-test" });
    expect(robot.plans[0]!.hangup_before_answer_ms).toBeGreaterThan(10_000);
    expect(ctx.evidence.ring).toEqual({ tag: RING.tag, shown_ms: 0 });
    expect(ctx.evidence.outcome).toMatchObject({ tag: RING.tag, title_changed: true, body_changed: true });
    // Notification text can name the caller; only tags and timings are kept.
    expect(JSON.stringify(ctx.evidence)).not.toMatch(/Incoming call|Rig caller/);
  });

  it("blames the push target when the browser cannot subscribe, as Chromium cannot", async () => {
    const world = d08World();
    world.browser.script.canPush = false;
    expect(await D08.run(world.ctx)).toMatchObject({ outcome: "infra", component: "push-target" });
    expect(world.robot.plans).toEqual([]);
    expect(world.undo).toEqual([]);
  });

  it("fails a subscription the API never kept", async () => {
    const world = d08World();
    world.browser.script.onPush = () => undefined;
    expect(await D08.run(world.ctx)).toMatchObject({ failure_class: "push_subscription_not_saved" });
    expect(world.robot.plans).toEqual([]);
  });

  it("fails a ring that never shows, not mistaking an earlier call's card for it", async () => {
    const world = d08World();
    world.rings.shows = false;
    expect(await D08.run(world.ctx)).toMatchObject({ failure_class: "no_ring_notification" });

    // A notification new since the dial that is not a call's, such as a text's, is no ring.
    const texted = d08World();
    texted.rings.shows = false;
    const dial = texted.robot.dial;
    texted.robot.dial = async (plan) => {
      const record = await dial(plan);
      texted.browser.script.notifications = [...texted.browser.script.notifications!, { title: "New text", body: "Rig caller", tag: "loonext:message:m-1" }];
      return record;
    };
    expect(await D08.run(texted.ctx)).toMatchObject({ failure_class: "no_ring_notification" });
  });

  it("fails a ring the outcome does not replace on its own tag", async () => {
    const kept = d08World();
    kept.rings.replaced = false;
    expect(await D08.run(kept.ctx)).toMatchObject({ failure_class: "ring_not_replaced" });

    const beside = d08World();
    beside.rings.replaced = false;
    const wait = beside.robot.wait;
    beside.robot.wait = async (planId) => {
      const record = await wait(planId);
      beside.browser.script.notifications = [...beside.browser.script.notifications!, { title: "Missed call", body: "Nobody picked up.", tag: "loonext:call:other" }];
      return record;
    };
    expect(await D08.run(beside.ctx)).toMatchObject({ failure_class: "ring_not_replaced" });
  });
});

function judged(heard: Surface[]): RecordingJudgement {
  return {
    verdict: heard.length > 0 ? "heard" : "silent",
    answered: heard[0] ?? null,
    heard,
    echo: null,
    surfaces: {},
    silent_frames: 0,
    announcement_ms: 0,
    channel: 0,
    channels: 1,
    sample_rate: 8000,
    duration_ms: 25_000,
  };
}

function d09World(winner: "pixel" | "qa-a-dispatcher") {
  const world = ringWorld("D09");
  const { robot, pixel, page } = world;
  const heard = { surfaces: [winner] as Surface[] };
  const outcome = robot.outcome;
  robot.outcome = (plan) => ({ ...outcome(plan), judgement: judged(heard.surfaces) });
  page.clearsAfterMs = winner === "pixel" ? 600 : undefined;
  const tap = pixel.tap.bind(pixel);
  pixel.tap = async (id) => {
    const tapped = await tap(id);
    if (id === "call_answer" && winner !== "pixel") pixel.call = "disconnected";
    return tapped;
  };
  world.app.callLegs = async () => [
    { member: "qa-a-dispatcher", state: winner === "qa-a-dispatcher" ? "answered" : "failed", kind: "web" },
    { member: "qa-a-technician", state: winner === "pixel" ? "answered" : "failed", kind: "android" },
  ];
  return { ...world, heard };
}

describe("D09, the first-answer race", () => {
  it("passes when both answer together, the robot hears one code, one leg wins and the loser drops the call", async () => {
    for (const winner of ["pixel", "qa-a-dispatcher"] as const) {
      const { ctx, robot, browser, pixel, undo, undosAtChange } = d09World(winner);
      expect((await D09.run(ctx)).outcome).toBe("pass");
      expect(robot.plans[0]).toMatchObject({ direction: "outbound", role: "ROBOT-1", to: "DEV-A1", exclusive: true, lease_id: "lease-test" });
      expect(robot.plans[0]!.expect).toBeUndefined();
      expect(browser.actions).toContain("qa-a-dispatcher answer");
      expect(pixel.actions).toContain("tap call_answer");
      expect(undo).toEqual([{ kind: "app.ring-audience", params: { tenant: "QA-A", role: "DEV-A1", member: "qa-a-dispatcher", level: null } }]);
      expect(undosAtChange).toEqual([1]);
      expect(ctx.evidence.winner).toBe(winner);
      expect(ctx.evidence.answer_gap_ms).toBe(0);
    }
  });

  it("fails two answers bridged, and a robot that heard nobody or a stranger", async () => {
    const both = d09World("pixel");
    both.heard.surfaces = ["pixel", "qa-a-dispatcher"];
    expect(await D09.run(both.ctx)).toMatchObject({ failure_class: "both_answered" });

    const nobody = d09World("pixel");
    nobody.heard.surfaces = [];
    expect(await D09.run(nobody.ctx)).toMatchObject({ failure_class: "robot_heard_nobody" });

    const stranger = d09World("pixel");
    stranger.heard.surfaces = ["qa-w-owner"];
    expect(await D09.run(stranger.ctx)).toMatchObject({ failure_class: "robot_heard_wrong_surface" });
  });

  it("fails unless the database has one winner, the one the robot heard", async () => {
    const two = d09World("pixel");
    two.app.callLegs = async () => [
      { member: "qa-a-dispatcher", state: "answered", kind: "web" },
      { member: "qa-a-technician", state: "answered", kind: "android" },
    ];
    expect(await D09.run(two.ctx)).toMatchObject({ failure_class: "not_one_winner" });

    const disagree = d09World("pixel");
    disagree.heard.surfaces = ["qa-a-dispatcher"];
    expect(await D09.run(disagree.ctx)).toMatchObject({ failure_class: "wrong_winner" });
  });

  it("fails a loser that still shows the call", async () => {
    const page = d09World("pixel");
    page.page.clearsAfterMs = undefined;
    expect(await D09.run(page.ctx)).toMatchObject({ failure_class: "loser_kept_call" });

    const pixel = d09World("qa-a-dispatcher");
    pixel.pixel.tap = async (id) => {
      pixel.pixel.actions.push(`tap ${id}`);
      pixel.pixel.call = "active";
      return true;
    };
    expect(await D09.run(pixel.ctx)).toMatchObject({ failure_class: "loser_kept_call" });
  });

  it("calls answers more than 300 ms apart no race, unless something failed anyway", async () => {
    const late = d09World("pixel");
    const open = late.browser.open;
    late.browser.open = async (member, surface, path) => {
      const opened = await open(member, surface, path);
      const answer = opened.answer;
      opened.answer = async () => {
        await answer();
        late.time.now += 400;
      };
      return opened;
    };
    expect(await D09.run(late.ctx)).toMatchObject({ outcome: "infra", component: "race-timing" });
    expect(late.ctx.evidence.answer_gap_ms).toBe(400);
  });

  it("fails a surface that never rang, or a Pixel with no answer control", async () => {
    const page = d09World("pixel");
    page.browser.script.ringsAfterMs = undefined;
    expect(await D09.run(page.ctx)).toMatchObject({ failure_class: "page_did_not_ring" });

    const telecom = d09World("pixel");
    telecom.pixel.rings = undefined;
    expect(await D09.run(telecom.ctx)).toMatchObject({ failure_class: "pixel_not_ringing" });

    const control = d09World("pixel");
    control.pixel.onScreen.delete("call_answer");
    expect(await D09.run(control.ctx)).toMatchObject({ failure_class: "pixel_answer_control_missing" });
    expect(control.browser.actions).not.toContain("qa-a-dispatcher answer");

    // Offered when the race read the screen, gone by the tap.
    const vanished = d09World("qa-a-dispatcher");
    vanished.pixel.tap = async (id) => id !== "call_answer";
    expect(await D09.run(vanished.ctx)).toMatchObject({ failure_class: "pixel_answer_control_missing" });
  });

  it("blames the robot when it could not delete Telnyx's copy of the race's recording", async () => {
    const kept = d09World("pixel");
    const outcome = kept.robot.outcome;
    kept.robot.outcome = (plan) => ({ ...outcome(plan), recording_deleted: false });
    expect(await D09.run(kept.ctx)).toMatchObject({ outcome: "infra", component: "robot" });
  });

});

const ANSWERED_AT = Date.parse("2026-10-31T15:00:04.000Z");

function d13World(rtp: unknown = { inbound: { packet_count: "1620", skip_packet_count: "180", mos: "4.10" } }) {
  const world = fakeContext("D13");
  const { robot, rig, time, devices } = world;
  devices.pixelDevice.onScreen.add("call_hang_up");
  const call = { lastsMs: undefined as number | undefined, rtp };
  rig.networkOutage = async (ms) => {
    rig.outages.push(ms);
    await time.sleep(ms);
  };
  const outcome = robot.outcome;
  robot.outcome = (plan) => ({
    ...outcome(plan),
    from_role: "DEV-A1",
    ended_at: new Date(ANSWERED_AT + (call.lastsMs ?? plan.hangup_after_ms)).toISOString(),
    rtp: call.rtp,
  });
  return { ...world, call };
}

describe("D13, a bad network and a mid-call Wi-Fi drop", () => {
  it("passes when the call survives, the code is heard either side of the outage and loss stays under 5%", async () => {
    const { ctx, robot, rig, undo, devices } = d13World();
    let undosAtImpair = -1;
    const impair = rig.impairNetwork.bind(rig);
    rig.impairNetwork = async (impairment) => {
      undosAtImpair = undo.length;
      return impair(impairment);
    };
    expect((await D13.run(ctx)).outcome).toBe("pass");
    expect(undo).toEqual([
      { kind: "device.reset", params: { device: "pixel" } },
      { kind: "rig.network-clear", params: {} },
    ]);
    expect(undosAtImpair).toBe(2);
    expect(rig.impairment).toEqual({ lossPercent: 2, delayMs: 80, jitterMs: 20 });
    expect(rig.outages).toEqual([3_000]);
    expect(robot.plans[0]).toMatchObject({
      direction: "inbound",
      role: "ROBOT-1",
      expect: "pixel",
      segments: [
        { name: "before", start_ms: 2_000, end_ms: 12_000 },
        { name: "after", start_ms: 23_000, end_ms: 33_000 },
      ],
      hangup_after_ms: 36_000,
    });
    expect(devices.audio.played).toEqual(["pixel"]);
    expect(ctx.evidence.outage).toEqual({ start_ms: 15_000, end_ms: 18_000 });
    expect(ctx.evidence.robot_loss).toEqual({ received: 1_620, skipped: 180, outage_packets: 150, ratio: 0.0182 });
    expect(ctx.evidence.pixel_concealment).toMatchObject({ measured: false });
  });

  it("calls an access point it cannot shape infra, with the clear already registered and no call made", async () => {
    const world = d13World();
    world.rig.impairNetwork = async () => {
      throw new Error("rig: no access point interface is configured");
    };
    expect(await D13.run(world.ctx)).toMatchObject({ outcome: "infra", component: "network-shaper" });
    expect(world.undo.map((u) => u.kind)).toContain("rig.network-clear");
    expect(world.robot.plans).toEqual([]);
  });

  it("calls an outage the access point could not make infra", async () => {
    const world = d13World();
    world.rig.networkOutage = async () => {
      throw new Error("sudo: tc: command not found");
    };
    expect(await D13.run(world.ctx)).toMatchObject({ outcome: "infra", component: "network-shaper", detail: expect.stringContaining("outage") });
  });

  it("fails a call that dropped", async () => {
    const world = d13World();
    world.call.lastsMs = 16_000;
    expect(await D13.run(world.ctx)).toMatchObject({ failure_class: "call_dropped" });
  });

  it("fails codes missing before the outage, or not back within 5 s of it", async () => {
    const before = d13World();
    const quiet = before.robot.outcome;
    before.robot.outcome = (plan) => {
      const record = quiet(plan);
      return { ...record, judgement: { ...record.judgement!, segments: [{ name: "before", verdict: "silent", heard: [] }, { name: "after", verdict: "heard", heard: ["pixel"] }] } };
    };
    expect(await D13.run(before.ctx)).toMatchObject({ failure_class: "no_code_before_outage" });

    const after = d13World();
    const gone = after.robot.outcome;
    after.robot.outcome = (plan) => {
      const record = gone(plan);
      return { ...record, judgement: { ...record.judgement!, segments: [{ name: "before", verdict: "heard", heard: ["pixel"] }, { name: "after", verdict: "faint", heard: [] }] } };
    };
    expect(await D13.run(after.ctx)).toMatchObject({ failure_class: "codes_did_not_resume" });
  });

  it("fails loss outside the outage of 5% or more, and blames the robot for no statistics", async () => {
    const lossy = d13World({ inbound: { packet_count: "1500", skip_packet_count: "300" } });
    expect(await D13.run(lossy.ctx)).toMatchObject({ failure_class: "loss_over_limit" });

    const blind = d13World(null);
    expect(await D13.run(blind.ctx)).toMatchObject({ outcome: "infra", component: "robot" });
  });

  it("calls an outage that overran into the second window the rig's fault, not the app's", async () => {
    const world = d13World();
    world.rig.networkOutage = async (ms) => {
      await world.time.sleep(ms + 4_000);
    };
    expect(await D13.run(world.ctx)).toMatchObject({ outcome: "infra", component: "rig" });
  });
});

describe("lossOutsideOutage", () => {
  it("takes the outage's packets out of both counts and reads Telnyx's string counts", () => {
    expect(lossOutsideOutage({ inbound: { packet_count: "1650", skip_packet_count: "150" } }, 3_000)).toMatchObject({ outage_packets: 150, ratio: 0 });
    expect(lossOutsideOutage({ inbound: { packet_count: 1_568, skip_packet_count: 232 } }, 3_000)!.ratio).toBeCloseTo(82 / 1_650, 4);
    // Exactly the limit is not under it.
    const atLimit = lossOutsideOutage({ inbound: { packet_count: "950", skip_packet_count: "200" } }, 3_000)!;
    expect(atLimit.ratio).toBe(MAX_LOSS);
    expect(lossOutsideOutage({ inbound: { packet_count: "591" } }, 3_000)).toBeUndefined();
    expect(lossOutsideOutage(null, 3_000)).toBeUndefined();
  });
});
