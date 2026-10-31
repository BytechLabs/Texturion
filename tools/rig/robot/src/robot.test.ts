import { describe, expect, it } from "vitest";
import { codeSamples } from "./audio/generate.ts";
import { delay, mix } from "./audio/simulate.ts";
import { encodeWav } from "./audio/wav.ts";
import { InlineProbe } from "./probe.ts";
import { Robot, type CallPlan } from "./robot.ts";
import { GuardRefusedError } from "./telnyx.ts";
import { FakeCallControl, ManualClock, TEST_NUMBERS, telnyxEvent } from "./test-support.ts";

const OWNER_HEARD = encodeWav({
  sampleRate: 8_000,
  channels: [
    mix(
      delay(codeSamples("qa-w-owner", { sampleRate: 8_000, cycles: 8 }), 8_000, 250),
      delay(codeSamples("robot", { sampleRate: 8_000, cycles: 8, amplitude: 0.02 }), 8_000, 400),
    ),
  ],
});

function setup(download: Uint8Array = OWNER_HEARD) {
  const telnyx = new FakeCallControl();
  const clock = new ManualClock();
  const downloads: string[] = [];
  const robot = new Robot({
    telnyx,
    numbers: TEST_NUMBERS,
    probe: new InlineProbe(),
    connectionId: () => "conn-robot",
    clock,
    newId: (() => {
      let n = 0;
      return () => `plan-${++n}`;
    })(),
    download: async (url) => {
      downloads.push(url);
      return download;
    },
  });
  return { telnyx, clock, robot, downloads };
}

const S02: CallPlan = {
  scenario: "S02",
  lease_id: "lease-1",
  direction: "outbound",
  role: "ROBOT-1",
  to: "DEV-W1",
  expect: "qa-w-owner",
  hangup_after_ms: 25_000,
};

const iso = (clock: ManualClock) => new Date(clock.now()).toISOString();

describe("an outbound call, end to end", () => {
  it("dials through the lease, plays, records, hangs up, judges and deletes Telnyx's copy", async () => {
    const { telnyx, clock, robot, downloads } = setup();
    const record = await robot.dial(S02);
    expect(record.state).toBe("ringing");

    const [dial] = telnyx.named("dial");
    expect(dial!.body).toMatchObject({
      connection_id: "conn-robot",
      from: TEST_NUMBERS.number("ROBOT-1"),
      to: TEST_NUMBERS.number("DEV-W1"),
      command_id: "plan-1:dial",
    });
    expect(dial!.context).toEqual({ lease: "lease-1", scenario: "S02" });

    clock.advance(4_000);
    robot.handleEvent(telnyxEvent("call.answered", { call_control_id: "ccid-1" }, iso(clock)));
    await robot.idle();
    expect(telnyx.named("playback_start")[0]!.body).toMatchObject({ audio_type: "wav", loop: "infinity", target_legs: "self" });
    expect(telnyx.named("record_start")[0]!.body).toEqual({ format: "wav", channels: "single", recording_track: "inbound" });

    clock.advance(25_000);
    await robot.idle();
    expect(telnyx.named("hangup")).toHaveLength(1);

    const stats = { inbound: { packet_count: "1250", skip_packet_count: "3", mos: "4.40" } };
    robot.handleEvent(
      telnyxEvent("call.hangup", { call_control_id: "ccid-1", hangup_cause: "normal_clearing", hangup_source: "caller", call_quality_stats: stats }, iso(clock)),
    );
    expect(robot.get("plan-1")!.state).toBe("ended");

    telnyx.recordings.set("leg-1", ["rec-1"]);
    robot.handleEvent(
      telnyxEvent("call.recording.saved", {
        call_control_id: "ccid-1",
        call_leg_id: "leg-1",
        recording_started_at: robot.get("plan-1")!.answered_at,
        recording_urls: { wav: "https://recordings.vendor.test/rec-1.wav" },
      }),
    );
    const done = await robot.wait("plan-1", 1_000);
    expect(downloads).toEqual(["https://recordings.vendor.test/rec-1.wav"]);
    expect(done).toMatchObject({
      state: "done",
      ids: { call_control_id: "ccid-1", call_leg_id: "leg-1", call_session_id: "session-1" },
      hangup: { cause: "normal_clearing", source: "caller" },
      rtp: stats,
      recording_deleted: true,
    });
    expect(done!.judgement).toMatchObject({ verdict: "heard", answered: "qa-w-owner", pass: true });
    expect(done!.judgement!.echo).toMatchObject({ surface: "robot" });
    expect(done!.judgement!.frames).toBeUndefined();
    expect(telnyx.named("delete_recording").map((c) => c.id)).toEqual(["rec-1"]);
  });

  it("keeps the per-frame numbers, and nothing else, when the judgement fails", async () => {
    const { telnyx, robot } = setup();
    await robot.dial({ ...S02, expect: "pixel" });
    robot.handleEvent(telnyxEvent("call.answered", { call_control_id: "ccid-1" }));
    robot.handleEvent(telnyxEvent("call.hangup", { call_control_id: "ccid-1" }));
    robot.handleEvent(
      telnyxEvent("call.recording.saved", {
        call_control_id: "ccid-1",
        recording_id: "rec-9",
        recording_urls: { wav: "https://recordings.vendor.test/rec-9.wav" },
      }),
    );
    const done = await robot.wait("plan-1", 1_000);
    expect(done!.judgement!.pass).toBe(false);
    expect(done!.judgement!.frames!.share_db).toHaveLength(7);
    expect(JSON.stringify(done)).not.toMatch(/RIFF|UklGR/);
    expect(telnyx.named("delete_recording").map((c) => c.id)).toEqual(["rec-9"]);
  });

  it("fails a call whose recording never arrives", async () => {
    const { clock, robot } = setup();
    await robot.dial(S02);
    robot.handleEvent(telnyxEvent("call.answered", { call_control_id: "ccid-1" }));
    robot.handleEvent(telnyxEvent("call.hangup", { call_control_id: "ccid-1" }));
    clock.advance(120_000);
    expect(robot.get("plan-1")).toMatchObject({ state: "failed", errors: ["the recording never arrived"] });
  });

  it("hangs up while ringing when the plan says the caller gives up", async () => {
    const { telnyx, clock, robot } = setup();
    await robot.dial({ ...S02, hangup_before_answer_ms: 8_000 });
    clock.advance(8_000);
    await robot.idle();
    expect(telnyx.named("hangup")).toHaveLength(1);
    robot.handleEvent(telnyxEvent("call.hangup", { call_control_id: "ccid-1", hangup_cause: "originator_cancel" }));
    expect(robot.get("plan-1")!.state).toBe("done");
  });
});

describe("what the robot refuses to do", () => {
  it("never dials without a run lease", async () => {
    const { telnyx, robot } = setup();
    const record = await robot.dial({ ...S02, lease_id: undefined });
    expect(record).toMatchObject({ state: "failed", errors: ["dial: a run lease is required"] });
    expect(telnyx.commands).toEqual([]);
  });

  it("never dials a raw number, only a role or a sip address", async () => {
    const { telnyx, robot } = setup();
    const record = await robot.dial({ ...S02, to: "+14165550199" });
    expect(record.state).toBe("failed");
    expect(record.errors[0]).toMatch(/never raw numbers/);
    expect(telnyx.commands).toEqual([]);
    expect((await robot.dial({ ...S02, to: "sip:qa-w-owner@sip.telnyx.test" })).state).toBe("ringing");
  });

  it("dials only from a robot line", async () => {
    const { robot } = setup();
    const record = await robot.dial({ ...S02, role: "DEV-W1" as never });
    expect(record.errors[0]).toMatch(/not a robot line/);
  });

  it("records the guard's rule when the guard refuses", async () => {
    const { telnyx, robot } = setup();
    telnyx.failNext = new GuardRefusedError(403, "dial.to_not_owned");
    const record = await robot.dial(S02);
    expect(record).toMatchObject({ state: "failed", errors: ["guard_refused:dial.to_not_owned"] });
  });
});

describe("an inbound call", () => {
  it("answers the expected call after its ring time and rejects any other", async () => {
    const { telnyx, clock, robot } = setup();
    const record = robot.expect({
      scenario: "S01",
      direction: "inbound",
      role: "ROBOT-1",
      answer_after_ms: 4_000,
      expect: "qa-w-owner",
      hangup_after_ms: 20_000,
    });
    expect(record.state).toBe("waiting");

    robot.handleEvent(
      telnyxEvent("call.initiated", { direction: "incoming", call_control_id: "in-1", call_leg_id: "leg-in-1", to: TEST_NUMBERS.number("ROBOT-2") }),
    );
    await robot.idle();
    expect(telnyx.named("reject")).toMatchObject([{ id: "in-1", body: { cause: "USER_BUSY" } }]);

    robot.handleEvent(
      telnyxEvent("call.initiated", { direction: "incoming", call_control_id: "in-2", call_leg_id: "leg-in-2", to: TEST_NUMBERS.number("ROBOT-1") }),
    );
    clock.advance(3_999);
    await robot.idle();
    expect(telnyx.named("answer")).toEqual([]);
    clock.advance(1);
    await robot.idle();
    expect(telnyx.named("answer")).toMatchObject([{ id: "in-2" }]);
    expect(robot.get(record.plan_id)!.ids.call_leg_id).toBe("leg-in-2");
  });

  it("gives up when no call arrives", () => {
    const { clock, robot } = setup();
    const record = robot.expect({ scenario: "S01", direction: "inbound", role: "ROBOT-1", hangup_after_ms: 1, expect_within_ms: 60_000 });
    clock.advance(60_000);
    expect(robot.get(record.plan_id)).toMatchObject({ state: "failed", errors: ["no call arrived"] });
  });
});

describe("voicemail and keypad", () => {
  it("waits for the beep, speaks the phrase, and hangs up after it", async () => {
    const { telnyx, clock, robot } = setup();
    await robot.dial({ ...S02, play: null, expect: undefined, voicemail: { phrase: "Rig check, please call back." } });
    expect(telnyx.named("dial")[0]!.body).toMatchObject({ answering_machine_detection: "detect_beep" });
    robot.handleEvent(telnyxEvent("call.answered", { call_control_id: "ccid-1" }));
    await robot.idle();
    expect(telnyx.named("playback_start")).toEqual([]);
    expect(telnyx.named("speak")).toEqual([]);

    robot.handleEvent(telnyxEvent("call.machine.greeting.ended", { call_control_id: "ccid-1", result: "beep_detected" }));
    await robot.idle();
    expect(telnyx.named("speak")[0]!.body).toMatchObject({ payload: "Rig check, please call back.", language: "en-US" });

    robot.handleEvent(telnyxEvent("call.speak.ended", { call_control_id: "ccid-1" }));
    clock.advance(1_500);
    await robot.idle();
    expect(telnyx.named("hangup")).toHaveLength(1);
    expect(robot.get("plan-1")!.amd).toEqual({ greeting: "beep_detected" });
  });

  it("speaks anyway when no beep is heard in time", async () => {
    const { telnyx, clock, robot } = setup();
    await robot.dial({ ...S02, play: null, voicemail: { phrase: "Rig check.", beep_timeout_ms: 20_000 } });
    robot.handleEvent(telnyxEvent("call.answered", { call_control_id: "ccid-1" }));
    clock.advance(20_000);
    await robot.idle();
    expect(telnyx.named("speak")).toHaveLength(1);
    expect(robot.get("plan-1")!.amd).toEqual({ greeting: "timeout" });
  });

  it("collects keypad digits as events and as a gather", async () => {
    const { telnyx, robot } = setup();
    await robot.dial({ ...S02, gather: { max_digits: 4 } });
    robot.handleEvent(telnyxEvent("call.answered", { call_control_id: "ccid-1" }));
    await robot.idle();
    expect(telnyx.named("gather")[0]!.body).toMatchObject({ maximum_digits: 4, terminating_digit: "#" });
    for (const digit of ["1", "2", "3", "#"]) {
      robot.handleEvent(telnyxEvent("call.dtmf.received", { call_control_id: "ccid-1", digit }));
    }
    robot.handleEvent(telnyxEvent("call.gather.ended", { call_control_id: "ccid-1", digits: "123", status: "valid" }));
    expect(robot.get("plan-1")).toMatchObject({ dtmf: "123#", gathered: { digits: "123", status: "valid" } });
  });
});
