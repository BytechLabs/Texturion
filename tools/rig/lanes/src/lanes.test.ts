import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { codeSamples, delay, mix } from "@loonext/rig-robot";
import { afterAll, describe, expect, it } from "vitest";
import { Adb, emulatorArgs, integerResource, manifestMetaValue, parsePackagePath, type Exec } from "./android/adb.ts";
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

/** aapt2 dump xmltree's shape for a manifest's application meta-data (aapt2 34). */
const MANIFEST = `N: android=http://schemas.android.com/apk/res/android (line=2)
  E: manifest (line=2)
    A: http://schemas.android.com/apk/res/android:versionCode(0x0101021b)=(type 0x10)0x1
    E: application (line=12)
      E: meta-data (line=40)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)="com.google.firebase.messaging.default_notification_channel_id" (Raw: "com.google.firebase.messaging.default_notification_channel_id")
        A: http://schemas.android.com/apk/res/android:value(0x01010024)="calls" (Raw: "calls")
      E: meta-data (line=44)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)="com.google.android.gms.version" (Raw: "com.google.android.gms.version")
        A: http://schemas.android.com/apk/res/android:value(0x01010024)=@0x7f0b0005
`;
/** aapt2 dump resources' shape for an integer resource. */
const RESOURCES = `Binary APK
Package name=com.loonext.android.nonprod id=7f
  type integer id=0b entryCount=6
    resource 0x7f0b0004 integer/m3_sys_motion_duration_long1
      () 450
    resource 0x7f0b0005 integer/google_play_services_version
      () 12451000
  type layout id=0c entryCount=1
`;

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

  it("reads an installed app's manifest integer from a pulled copy of its APK, resolving a resource reference", async () => {
    const { exec, calls } = fakeExec({
      "pm path": `package:/data/app/~~aB==/${PKG}-cD==/split_config.en.apk\npackage:/data/app/~~aB==/${PKG}-cD==/base.apk\n`,
      "dump xmltree": MANIFEST,
      "dump resources": RESOURCES,
    });
    expect(await new Adb({ serial: "PIXEL123", exec }).manifestInteger(PKG, "com.google.android.gms.version")).toBe(12_451_000);
    const pull = calls.find((c) => c.includes(" pull "))!;
    expect(pull).toMatch(new RegExp(`^adb -s PIXEL123 pull /data/app/~~aB==/${PKG}-cD==/base\\.apk .*rig-apk-.*base\\.apk$`));
    expect(calls.filter((c) => c.startsWith("aapt2 dump"))).toHaveLength(2);
    expect(existsSync(dirname(pull.split(" ").at(-1)!))).toBe(false);

    const undeclared = fakeExec({ "pm path": `package:/data/app/${PKG}/base.apk`, "dump xmltree": MANIFEST.replaceAll("com.google.android.gms.version", "com.other") });
    expect(await new Adb({ serial: "PIXEL123", exec: undeclared.exec }).manifestInteger(PKG, "com.google.android.gms.version")).toBeNull();
    expect(undeclared.calls.some((c) => c.includes("dump resources"))).toBe(false);

    const unresolved = fakeExec({ "pm path": `package:/data/app/${PKG}/base.apk`, "dump xmltree": MANIFEST, "dump resources": "Package name=x id=7f\n" });
    await expect(new Adb({ serial: "PIXEL123", exec: unresolved.exec }).manifestInteger(PKG, "com.google.android.gms.version")).rejects.toThrow(/does not hold/);
    await expect(new Adb({ serial: "PIXEL123", exec: fakeExec().exec }).manifestInteger(PKG, "com.google.android.gms.version")).rejects.toThrow(/not installed/);
  });

  it("reads a meta-data value whether the manifest states it or names a resource", () => {
    expect(manifestMetaValue(MANIFEST, "com.google.android.gms.version")).toBe("0x7f0b0005");
    expect(manifestMetaValue(MANIFEST.replace("=@0x7f0b0005", "=(type 0x10)0xbdfcb8"), "com.google.android.gms.version")).toBe(12_451_000);
    expect(manifestMetaValue(MANIFEST, "com.google.firebase.messaging.default_notification_channel_id")).toBe(null);
    expect(integerResource(RESOURCES, "0x7f0b0005")).toBe(12_451_000);
    expect(integerResource(RESOURCES.replace("() 12451000", "() (integer) 0xbdfcb8"), "0x7f0b0005")).toBe(12_451_000);
    expect(integerResource(RESOURCES, "0x7f0b0006")).toBeNull();
    expect(parsePackagePath("")).toBeNull();
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
