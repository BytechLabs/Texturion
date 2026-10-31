import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codeSamples, delay, mix } from "@loonext/rig-robot";
import { afterAll, describe, expect, it } from "vitest";
import { Adb, emulatorArgs, type Exec } from "./android/adb.ts";
import { BLOCKED_HOSTS, chromiumArgs, hostResolverRules } from "./browser/args.ts";
import { judgeCapture } from "./browser/lane.ts";
import type { PageCapture } from "./browser/page-judge.ts";

describe("Chromium's launch arguments", () => {
  it("fake the microphone with the member's code and answer the prompt", () => {
    const args = chromiumArgs({ fakeMicWav: "/var/lib/rig/fake-mic/qa-w-owner.wav" });
    expect(args).toContain("--use-fake-ui-for-media-stream");
    expect(args).toContain("--use-fake-device-for-media-stream");
    expect(args).toContain("--use-file-for-fake-audio-capture=/var/lib/rig/fake-mic/qa-w-owner.wav");
  });

  it("make production's hosts fail to resolve", () => {
    expect(BLOCKED_HOSTS).toEqual(["loonext.com", "*.loonext.com", "supabase.co", "*.supabase.co"]);
    expect(hostResolverRules()).toBe(
      "MAP loonext.com ~NOTFOUND, MAP *.loonext.com ~NOTFOUND, MAP supabase.co ~NOTFOUND, MAP *.supabase.co ~NOTFOUND",
    );
    expect(chromiumArgs({ fakeMicWav: "/x.wav" })).toContain(`--host-resolver-rules=${hostResolverRules()}`);
  });

  it("refuse a path or a host pattern that could smuggle another argument", () => {
    expect(() => chromiumArgs({ fakeMicWav: "/tmp/a b.wav" })).toThrow(/spaces/);
    expect(() => hostResolverRules(["evil.com ~NOTFOUND, MAP *"])).toThrow(/not a host pattern/);
  });
});

function fakeExec(answers: Record<string, string> = {}) {
  const calls: string[] = [];
  const exec: Exec = async (file, args) => {
    const line = [file, ...args].join(" ");
    calls.push(line);
    const match = Object.keys(answers).find((prefix) => line.includes(prefix));
    return match ? answers[match]! : "";
  };
  return { exec, calls };
}

describe("the adb wrappers (commands only; no device has run them)", () => {
  const PKG = "com.loonext.android.nonprod";

  it("kills the app as memory pressure would, apart from force-stop", async () => {
    const { exec, calls } = fakeExec();
    const adb = new Adb({ serial: "emulator-5554", exec });
    await adb.kill(PKG);
    await adb.forceStop(PKG);
    expect(calls).toEqual([
      "adb -s emulator-5554 shell input keyevent KEYCODE_HOME",
      `adb -s emulator-5554 shell am kill ${PKG}`,
      `adb -s emulator-5554 shell am force-stop ${PKG}`,
    ]);
  });

  it("forces Doze and puts the app in a standby bucket", async () => {
    const { exec, calls } = fakeExec({ "deviceidle get deep": "IDLE\n" });
    const adb = new Adb({ serial: "PIXEL123", exec });
    await adb.forceDoze();
    expect(await adb.dozeState()).toBe("IDLE");
    await adb.setStandbyBucket(PKG, "rare");
    await adb.exitDoze();
    expect(calls).toEqual([
      "adb -s PIXEL123 shell dumpsys battery unplug",
      "adb -s PIXEL123 shell dumpsys deviceidle force-idle",
      "adb -s PIXEL123 shell dumpsys deviceidle get deep",
      `adb -s PIXEL123 shell am set-standby-bucket ${PKG} rare`,
      "adb -s PIXEL123 shell dumpsys deviceidle unforce",
      "adb -s PIXEL123 shell dumpsys battery reset",
    ]);
    await expect(adb.setStandbyBucket(PKG, "nap" as never)).rejects.toThrow(/standby bucket/);
  });

  it("locks, and unlocks by typing the PIN", async () => {
    const { exec, calls } = fakeExec();
    const adb = new Adb({ serial: "PIXEL123", exec });
    await adb.lock();
    await adb.unlock("2468");
    expect(calls).toEqual([
      "adb -s PIXEL123 shell input keyevent KEYCODE_SLEEP",
      "adb -s PIXEL123 shell input keyevent KEYCODE_WAKEUP",
      "adb -s PIXEL123 shell wm dismiss-keyguard",
      "adb -s PIXEL123 shell input text 2468",
      "adb -s PIXEL123 shell input keyevent KEYCODE_ENTER",
    ]);
    await expect(adb.unlock("12; reboot")).rejects.toThrow(/PIN/);
  });

  it("reboots and waits for boot to complete", async () => {
    const { exec, calls } = fakeExec({ "getprop sys.boot_completed": "1\n" });
    await new Adb({ serial: "PIXEL123", exec }).reboot();
    expect(calls.slice(0, 2)).toEqual(["adb -s PIXEL123 reboot", "adb -s PIXEL123 wait-for-device"]);
  });

  const dir = mkdtempSync(join(tmpdir(), "rig-apk-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("installs a .nonprod build, from a copy, and confirms it is listed", async () => {
    const apk = join(dir, "app-nonprod.apk");
    writeFileSync(apk, "not really an apk");
    const { exec, calls } = fakeExec({ "dump packagename": `${PKG}\n`, "pm list packages": `package:${PKG}\n` });
    expect(await new Adb({ serial: "PIXEL123", exec }).install(apk)).toBe(PKG);
    const install = calls.find((c) => c.includes(" install -r "))!;
    expect(install).not.toContain(apk);
    expect(install).toMatch(/rig-apk-.*app-nonprod\.apk$/);
  });

  it("refuses to install the production app", async () => {
    const apk = join(dir, "app-release.apk");
    writeFileSync(apk, "not really an apk");
    const { exec, calls } = fakeExec({ "dump packagename": "com.loonext.android\n" });
    await expect(new Adb({ serial: "PIXEL123", exec }).install(apk)).rejects.toThrow(/only \.nonprod builds/);
    expect(calls.some((c) => c.includes(" install "))).toBe(false);
  });

  it("refuses shell arguments that a shell would interpret", async () => {
    const adb = new Adb({ serial: "PIXEL123", exec: fakeExec().exec });
    await expect(adb.shell("echo", "$(reboot)")).rejects.toThrow(/special characters/);
    expect(() => new Adb({ serial: "a;b" })).toThrow(/serial/);
  });

  it("starts emulators headless on an even console port", () => {
    expect(emulatorArgs("rig-api35", 5556)).toEqual([
      "-avd",
      "rig-api35",
      "-port",
      "5556",
      "-no-window",
      "-no-snapshot-save",
      "-no-boot-anim",
      "-gpu",
      "swiftshader_indirect",
    ]);
    expect(() => emulatorArgs("rig-api35", 5555)).toThrow(/even/);
  });
});

function capture(samples: Float32Array, marks: PageCapture["marks"], stats: PageCapture["stats"] = []): PageCapture {
  const bytes = Buffer.alloc(samples.length * 2);
  samples.forEach((x, i) => bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 32767), i * 2));
  return { sampleRate: 16_000, startedAt: 1_000_000, pcm_b64: bytes.toString("base64"), marks, stats, remoteStreams: 1 };
}

describe("judgeCapture", () => {
  it("judges what the page heard from the answer mark, with the page's own code as echo", () => {
    // North American ringback, 440 + 480 Hz, for the three seconds before answer.
    const ringback = Float32Array.from({ length: 16_000 * 3 }, (_, i) =>
      0.05 * (Math.sin((2 * Math.PI * 440 * i) / 16_000) + Math.sin((2 * Math.PI * 480 * i) / 16_000)),
    );
    const heard = mix(
      ringback,
      delay(codeSamples("robot", { sampleRate: 16_000, cycles: 8 }), 16_000, 3_200),
      delay(codeSamples("qa-w-owner", { sampleRate: 16_000, cycles: 8, amplitude: 0.02 }), 16_000, 3_400),
    );
    const result = judgeCapture(
      capture(heard, [{ name: "answered", at: 1_003_000 }], [
        { at: 1_002_000, peer: 0, kind: "inbound", totalAudioEnergy: 0.25, concealedSamples: 0, totalSamplesReceived: 32_000 },
        { at: 1_020_000, peer: 0, kind: "inbound", totalAudioEnergy: 3.5, concealedSamples: 480, totalSamplesReceived: 320_000 },
      ]),
      "qa-w-owner",
    );
    expect(result.detection).toMatchObject({ verdict: "heard", answered: "robot" });
    expect(result.detection.echo).toMatchObject({ surface: "qa-w-owner" });
    // Two tones of amplitude 0.05 carry 0.0025 of power for 3 s.
    expect(result.energyBeforeAnswer).toBeCloseTo(0.0075, 3);
    expect(result.concealedRatio).toBeCloseTo(0.0015);
    expect(JSON.stringify(result)).not.toContain("pcm_b64");
  });

  it("counts from a far-end answer time when the page did not answer itself", () => {
    const late = delay(codeSamples("robot", { sampleRate: 16_000, cycles: 8 }), 16_000, 9_000);
    const raw = capture(late, []);
    expect(judgeCapture(raw, "qa-w-owner").detection.verdict).not.toBe("heard");
    const answered = judgeCapture(raw, "qa-w-owner", { answeredAt: 1_008_800 });
    expect(answered.detection.answered).toBe("robot");
    // Silence before answer: no ringback reached the page.
    expect(answered.energyBeforeAnswer).toBe(0);
  });
});
