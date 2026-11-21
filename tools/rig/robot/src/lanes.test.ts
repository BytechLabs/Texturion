import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { codeSamples } from "./audio/generate.ts";
import { whisperArgs, WhisperTranscriber } from "./audio/transcribe.ts";
import { encodeWav } from "./audio/wav.ts";
import { Inbox } from "./inbox.ts";
import { heldNumber } from "./main.ts";
import { gpsJpeg, hasGpsExif, sha256Hex } from "./media.ts";
import { InlineProbe } from "./probe.ts";
import { judgeRecording } from "./judge.ts";
import { Robot } from './robot.ts';
import type { CallPlan } from './robot.ts';
import { FakeCallControl, ManualClock, telnyxEvent, TEST_NUMBERS } from "./test-support.ts";

describe("the S22 picture", () => {
  it("is a JPEG whose EXIF points at a GPS position", () => {
    const jpeg = gpsJpeg();
    expect([...jpeg.subarray(0, 2)]).toEqual([0xFF, 0xD8]);
    expect([...jpeg.subarray(-2)]).toEqual([0xFF, 0xD9]);
    expect(hasGpsExif(jpeg)).toBe(true);
    expect(sha256Hex(jpeg)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads as stripped once the EXIF block is gone", () => {
    const jpeg = Buffer.from(gpsJpeg());
    const app1 = jpeg.indexOf(Buffer.from([0xFF, 0xE1]));
    const length = jpeg.readUInt16BE(app1 + 2);
    const stripped = Buffer.concat([jpeg.subarray(0, app1), jpeg.subarray(app1 + 2 + length)]);
    expect(hasGpsExif(stripped)).toBe(false);
    expect(hasGpsExif(Buffer.from("not a jpeg"))).toBe(false);

    // EXIF that keeps only a camera tag, the way a stripper that drops GPS alone leaves it.
    const cameraOnly = Buffer.from(gpsJpeg());
    const gpsPointer = cameraOnly.indexOf(Buffer.from([0x25, 0x88, 0x04, 0x00]));
    cameraOnly.writeUInt16LE(0x01_0F, gpsPointer);
    expect(hasGpsExif(cameraOnly)).toBe(false);
  });
});

describe("local transcription", () => {
  it("hands whisper.cpp a WAV in a private directory it removes afterwards, converting anything else first", async () => {
    const seen: { file: string; args: readonly string[]; existed: boolean }[] = [];
    const transcriber = new WhisperTranscriber({
      binary: "whisper-cli",
      model: "/models/ggml-base.en.bin",
      exec: async (file, args) => {
        const path = args[args.indexOf("-f") + 1] ?? args[args.indexOf("-i") + 1]!;
        seen.push({ file, args, existed: existsSync(path) });
        return file === "whisper-cli" ? "  Hello, this is\n the rig robot. \n" : "";
      },
    });
    const wav = encodeWav({ sampleRate: 16_000, channels: [new Float32Array(800)] });
    await expect(transcriber.transcribe(wav)).resolves.toBe("Hello, this is the rig robot.");
    expect(seen.map((call) => call.file)).toEqual(["whisper-cli"]);
    expect(seen[0]!.existed).toBe(true);
    expect(existsSync(dirname(seen[0]!.args[3]!))).toBe(false);

    seen.length = 0;
    await transcriber.transcribe(new Uint8Array([0x49, 0x44, 0x33, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(seen.map((call) => call.file)).toEqual(["ffmpeg", "whisper-cli"]);
    expect(seen[1]!.args[3]).toMatch(/converted\.wav$/);
    expect(whisperArgs({ model: "m" }, "/a.wav")).toEqual(["-m", "m", "-f", "/a.wav", "-l", "en", "-nt", "-np"]);

    seen.length = 0;
    const carrierWav = encodeWav({ sampleRate: 8000, channels: [new Float32Array(800)] });
    await transcriber.transcribe(carrierWav, "fr");
    expect(seen.map((call) => call.file)).toEqual(["ffmpeg", "whisper-cli"]);
    expect(seen[1]!.args.slice(4, 6)).toEqual(["-l", "fr"]);
  });
});

describe("judging named windows", () => {
  it("says which codes each window of the call holds", () => {
    const owner = codeSamples("qa-w-owner", { sampleRate: 8000, cycles: 8 });
    const silence = new Float32Array(owner.length);
    const samples = new Float32Array(owner.length * 2);
    samples.set(owner, 0);
    samples.set(silence, owner.length);
    const seconds = owner.length / 8000;
    const judgement = judgeRecording(encodeWav({ sampleRate: 8000, channels: [samples] }), {
      own: "robot",
      expect: "qa-w-owner",
      segments: [
        { name: "talking", start_ms: 0, end_ms: seconds * 1000 },
        { name: "hold", start_ms: seconds * 1000 + 500, end_ms: seconds * 2000 },
      ],
    });
    expect(judgement.segments).toEqual([
      { name: "talking", verdict: "heard", heard: ["qa-w-owner"] },
      { name: "hold", verdict: "silent", heard: [] },
    ]);
  });
});

describe("dialing a number held for one scenario", () => {
  const plan = (to: string): CallPlan => ({ scenario: "S28", lease_id: "lease-1", direction: "outbound", role: "ROBOT-1", to, hangup_after_ms: 20_000 });
  const robotWith = (resolveNumberId?: (id: string) => Promise<string | undefined>) => {
    const telnyx = new FakeCallControl();
    const robot = new Robot({
      telnyx,
      numbers: TEST_NUMBERS,
      probe: new InlineProbe(),
      connectionId: () => "conn-robot",
      clock: new ManualClock(),
      download: async () => new Uint8Array(),
      resolveNumberId,
    });
    return { telnyx, robot };
  };

  it("looks the number up by its Telnyx id and never takes digits", async () => {
    const { telnyx, robot } = robotWith(async (id) => (id === "2345678901" ? "+14165550120" : undefined));
    expect((await robot.dial(plan("number-id:2345678901"))).state).toBe("ringing");
    expect(telnyx.named("dial")[0]!.body).toMatchObject({ to: "+14165550120" });
    await expect(robot.dial(plan("number-id:999"))).resolves.toMatchObject({ state: "failed", errors: ["dial: the guard does not list that number in the partition"] });
    await expect(robot.dial(plan("number-id:+14165550120"))).resolves.toMatchObject({ state: "failed", errors: ["dial: not a Telnyx number id"] });
    await expect(robot.dial(plan("+14165550120"))).resolves.toMatchObject({ state: "failed" });
    await expect(robotWith().robot.dial(plan("number-id:1"))).resolves.toMatchObject({ errors: ["dial: this robot cannot look a held number up"] });
  });

  it("asks the guard's read class, which answers only for the partition's numbers", async () => {
    const urls: string[] = [];
    const doFetch = (async (url: string) => {
      urls.push(url);
      return url.endsWith("/777")
        ? Response.json({ data: { id: "777", phone_number: "+14165550120" } })
        : Response.json({ error: "guard_refused", rule: "read.not_in_partition" }, { status: 403 });
    }) as typeof fetch;
    await expect(heldNumber("https://edge.example", "t", "777", doFetch)).resolves.toBe("+14165550120");
    await expect(heldNumber("https://edge.example", "t", "778", doFetch)).resolves.toBeUndefined();
    expect(urls[0]).toBe("https://edge.example/g/telnyx/v2/phone_numbers/777");
  });

  it("keeps and transcribes the requested French track before deleting the carrier copy", async () => {
    const telnyx = new FakeCallControl();
    const clock = new ManualClock();
    const wav = encodeWav({ sampleRate: 8000, channels: [new Float32Array(8000)] });
    const saveRecording = vi.fn(() => "plan-1.wav");
    const transcribe = vi.fn(async () => "Nos bureaux sont fermés.");
    const robot = new Robot({
      telnyx,
      numbers: TEST_NUMBERS,
      probe: new InlineProbe(),
      connectionId: () => "conn-robot",
      clock,
      newId: () => "plan-1",
      download: async () => wav,
      transcriber: { transcribe },
      saveRecording,
    });
    await robot.dial({ ...plan("DEV-W1"), transcribe: "fr", capture_recording: true, expect: null });
    robot.handleEvent(telnyxEvent("call.answered", { call_control_id: "ccid-1" }));
    robot.handleEvent(telnyxEvent("call.hangup", { call_control_id: "ccid-1" }));
    telnyx.recordings.set("leg-1", ["rec-1"]);
    robot.handleEvent(telnyxEvent("call.recording.saved", { call_control_id: "ccid-1", recording_urls: { wav: "https://r.test/1.wav" } }));
    await expect(robot.wait("plan-1", 1000)).resolves.toMatchObject({
      transcript: "Nos bureaux sont fermés.",
      recording_file: "plan-1.wav",
      recording_deleted: true,
    });
    expect(saveRecording).toHaveBeenCalledWith("plan-1", wav);
    expect(transcribe).toHaveBeenCalledWith(wav, "fr");
  });
});

describe("a picture message at the robot", () => {
  it("keeps each item's type, size and the hash Telnyx reports, never its URL", () => {
    const inbox = new Inbox(TEST_NUMBERS, () => 1);
    inbox.handle({
      data: {
        event_type: "message.received",
        payload: {
          id: "m1",
          text: "Rig S22",
          from: { phone_number: TEST_NUMBERS.number("DEV-W1") },
          to: [{ phone_number: TEST_NUMBERS.number("ROBOT-1") }],
          media: [{ url: "https://media.telnyx.test/x?token=secret", content_type: "image/jpeg", size: 412, hash_sha256: "AB12" }],
        },
      },
    });
    const [message] = inbox.list();
    expect(message!.media).toEqual([{ content_type: "image/jpeg", size: 412, sha256: "ab12" }]);
    expect(JSON.stringify(message)).not.toContain("secret");
  });
});
