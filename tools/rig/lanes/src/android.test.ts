import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Adb, type Exec } from "./android/adb.ts";
import {
  AndroidDevice,
  CALL_TEST_IDS,
  hasFullScreenNotification,
  parseBonded,
  parseSdkInt,
  parseTelecomState,
  parseUiDump,
  parseVersionCode,
} from "./android/device.ts";
import { AccessPointShaper, BluetoothAudioLink, netemArgs, pcmFromS16, recordArgs, UsbHub, type Spawn } from "./android/host.ts";

const PKG = "com.loonext.android.nonprod";

function fakeExec(answers: Record<string, string> = {}) {
  const calls: string[] = [];
  const exec: Exec = async (file, args) => {
    const line = [file, ...args].join(" ");
    calls.push(line);
    const match = Object.keys(answers).find((part) => line.includes(part));
    return match ? answers[match]! : "";
  };
  return { exec, calls };
}

function device(answers: Record<string, string> = {}) {
  const { exec, calls } = fakeExec(answers);
  let now = 0;
  const android = new AndroidDevice({
    name: "pixel",
    serial: "PIXEL123",
    pkg: PKG,
    pin: () => "2468",
    apks: { current: "/rig/apk/current.apk", previous: "/rig/apk/previous.apk" },
    exec,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  return { android, calls };
}

const UI = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" content-desc="" bounds="[0,0][1080,2400]">
<node index="1" text="Answer" resource-id="call_answer" class="android.view.View" content-desc="" bounds="[100,1800][400,2000]" />
<node index="2" text="" resource-id="${PKG}:id/call_decline" class="android.view.View" content-desc="Decline &amp; text" bounds="[680,1800][980,2000]" />
</node></hierarchy>`;

describe("the device driver's readings", () => {
  it("knows the call controls by the ids the nonprod build exposes, exactly as test-ids.json lists them", () => {
    const registry = JSON.parse(readFileSync(new URL("../../test-ids.json", import.meta.url), "utf8")) as {
      platforms: { platform: string; ids: { id: string }[] }[];
    };
    const android = registry.platforms.find((platform) => platform.platform === "android")!;
    expect([...CALL_TEST_IDS].sort()).toEqual(android.ids.map((entry) => entry.id).sort());
  });

  it("reads a UIAutomator dump's ids, text and bounds", () => {
    const nodes = parseUiDump(UI);
    expect(nodes.map((node) => node.resourceId)).toEqual(["", "call_answer", `${PKG}:id/call_decline`]);
    expect(nodes[2]!.description).toBe("Decline & text");
    expect(nodes[1]!.bounds).toEqual({ left: 100, top: 1800, right: 400, bottom: 2000 });
  });

  it("reads Telecom's state for the app's own call only", () => {
    const dump = ["  Call TC@1: {state: ACTIVE, connectionService: com.other.dialer}", `  Call TC@2: {state: RINGING, connectionService: ${PKG}/.Calls}`].join("\n");
    expect(parseTelecomState(dump, PKG)).toBe("ringing");
    expect(parseTelecomState(dump.replace("RINGING", "ON_HOLD"), PKG)).toBe("holding");
    expect(parseTelecomState("  Call TC@1: {state: ACTIVE, connectionService: com.other.dialer}", PKG)).toBe("none");
  });

  it("finds the app's full-screen ring among the notifications", () => {
    const dump = [
      "  NotificationRecord(0x1: pkg=com.other user=UserHandle{0} id=1)",
      "    fullscreenIntent=PendingIntent{1: x}",
      `  NotificationRecord(0x2: pkg=${PKG} user=UserHandle{0} id=7)`,
      "    fullscreenIntent=null",
    ].join("\n");
    expect(hasFullScreenNotification(dump, PKG)).toBe(false);
    expect(hasFullScreenNotification(dump.replace("fullscreenIntent=null", "fullscreenIntent=PendingIntent{2: y}"), PKG)).toBe(true);
  });

  it("reads version codes and bonded Bluetooth devices", () => {
    expect(parseVersionCode("    versionCode=251234000 minSdk=30 targetSdk=35")).toBe(251234000);
    expect(parseBonded("Bonded devices:\n  XX:XX:XX:XX:AA:BB [BR/EDR][ 0x240404 ] rig\n\nOther:")).toBe(1);
    expect(parseBonded("nothing here")).toBeNull();
  });

  it("reads the Android release a device runs, and nothing from a property that is not a level", async () => {
    expect(parseSdkInt("35\n")).toBe(35);
    expect(parseSdkInt("")).toBeNull();
    expect(parseSdkInt("Baklava")).toBeNull();
    const { android, calls } = device({ "getprop ro.build.version.sdk": "36\n" });
    expect((await android.state()).sdk_int).toBe(36);
    expect(calls).toContain("adb -s PIXEL123 shell getprop ro.build.version.sdk");
  });

  it("reads the installed build's Play services minimum from its own manifest entry", async () => {
    const meta = [
      "      E: meta-data (line=44)",
      '        A: android:name(0x01010003)="com.google.android.gms.version" (Raw: "com.google.android.gms.version")',
      "        A: android:value(0x01010024)=(type 0x10)0xbdfcb8",
    ].join("\n");
    const { android, calls } = device({ "pm path": `package:/data/app/${PKG}/base.apk`, "dump xmltree": meta });
    expect(await android.playServicesMinimum()).toBe(12_451_000);
    expect(calls.find((c) => c.includes("dump xmltree"))).toMatch(/^aapt2 dump xmltree --file AndroidManifest\.xml /);
    expect(calls[0]).toBe(`adb -s PIXEL123 shell pm path ${PKG}`);
  });
});

describe("the device driver's commands (no device has run them)", () => {
  it("taps a call control at its centre, and reports one that is not on screen", async () => {
    const { android, calls } = device({ "cat /sdcard/rig-ui.xml": UI });
    expect(await android.tap("call_decline")).toBe(true);
    expect(calls.slice(-1)).toEqual(["adb -s PIXEL123 shell input tap 830 1900"]);
    expect(await android.tap("call_hang_up")).toBe(false);
    expect(await android.tapText("Answer")).toBe(true);
    expect(calls.slice(-1)).toEqual(["adb -s PIXEL123 shell input tap 250 1900"]);
  });

  it("waits for Telecom's ring and the full-screen notification, timing each", async () => {
    let polls = 0;
    let notes = 0;
    const exec: Exec = async (_file, args) => {
      const line = args.join(" ");
      if (line.includes("dumpsys telecom")) return ++polls >= 3 ? `Call: {state: RINGING, connectionService: ${PKG}}` : "";
      if (line.includes("dumpsys notification")) return ++notes >= 4 ? `  NotificationRecord(0x2: pkg=${PKG})\n    fullscreenIntent=PendingIntent{x}` : "";
      return "";
    };
    let now = 0;
    const android = new AndroidDevice({
      name: "pixel",
      serial: "PIXEL123",
      pkg: PKG,
      pin: () => undefined,
      apks: { current: "a.apk", previous: "b.apk" },
      exec,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    expect(await android.waitForRinging(12_000)).toEqual({ telecom_ms: 1_000, full_screen_ms: 1_500 });
    polls = -100;
    notes = -100;
    now = 0;
    expect(await android.waitForRinging(2_000)).toBeUndefined();
  });

  it("puts the app in each state a wake variant needs, and opens it by deep link to the inert host", async () => {
    const { android, calls } = device();
    await android.hibernate(true);
    await android.notificationsAllowed(false);
    await android.idleNaturally();
    await android.launch("/calls");
    expect(calls).toEqual([
      `adb -s PIXEL123 shell cmd app_hibernation set-state ${PKG} true`,
      `adb -s PIXEL123 shell pm revoke ${PKG} android.permission.POST_NOTIFICATIONS`,
      "adb -s PIXEL123 shell dumpsys battery unplug",
      "adb -s PIXEL123 shell input keyevent KEYCODE_SLEEP",
      `adb -s PIXEL123 shell am start -a android.intent.action.VIEW -d https://nonprod.invalid/calls ${PKG}`,
    ]);
    await expect(android.launch("/calls?x=1")).rejects.toThrow(/not an app path/);
  });

  it("drives only a nonprod package, and types only plain text", async () => {
    expect(() => new AndroidDevice({ name: "p", serial: "S", pkg: "com.loonext.android", pin: () => "1", apks: { current: "", previous: "" } })).toThrow(/nonprod/);
    const { android, calls } = device();
    await android.type("rig owner");
    expect(calls).toEqual(["adb -s PIXEL123 shell input text rig%sowner"]);
    await expect(android.type("a;rm")).rejects.toThrow(/plain text/);
  });

  it("never repeats a typed password or the PIN in the error of a command that failed", async () => {
    // Node's execFile error names the whole command line, which a verdict's detail would carry to Sentry.
    const failing = (killed: boolean): Exec => async (file, args) => {
      const line = [file, ...args].join(" ");
      if (!line.includes(" input text ") && !line.includes(" set-pin ")) return "";
      throw Object.assign(new Error(`Command failed: ${line}\nerror: device offline`), { code: killed ? null : 1, killed, signal: killed ? "SIGTERM" : null, cmd: line });
    };
    for (const killed of [false, true]) {
      const android = new AndroidDevice({ name: "pixel", serial: "PIXEL123", pkg: PKG, pin: () => "2468", apks: { current: "", previous: "" }, exec: failing(killed) });
      const typed = await android.type("Qx7Tz2SeedPassword_-").catch((error: Error) => error);
      expect(typed).toBeInstanceOf(Error);
      expect((typed as Error).message).toBe(`adb: typing text on PIXEL123 ${killed ? "timed out" : "exited 1"}`);
      const unlocked = await android.unlock().catch((error: Error) => error);
      expect((unlocked as Error).message).toBe(`adb: typing the PIN on PIXEL123 ${killed ? "timed out" : "exited 1"}`);
      const adb = new Adb({ serial: "PIXEL123", exec: failing(killed) });
      const pinned = await adb.setPin("1357", "2468").catch((error: Error) => error);
      for (const message of [(typed as Error).message, (unlocked as Error).message, (pinned as Error).message]) {
        expect(message).not.toMatch(/Qx7Tz2SeedPassword|2468|1357|Command failed/);
      }
    }
    // A refusal before anything runs still says why.
    await expect(new Adb({ serial: "PIXEL123", exec: failing(false) }).secretShell("typing text", "input", "text", "a;b")).rejects.toThrow(/special characters/);
  });

  it("unlocks with the store's PIN and refuses without one", async () => {
    const { android, calls } = device();
    await android.unlock();
    expect(calls).toContain("adb -s PIXEL123 shell input text 2468");
    const locked = new AndroidDevice({ name: "p", serial: "S", pkg: PKG, pin: () => undefined, apks: { current: "", previous: "" }, exec: fakeExec().exec });
    await expect(locked.unlock()).rejects.toThrow(/no lock PIN/);
  });
});

describe("the box's side of the Pixel lane", () => {
  it("shapes the access point and gives back what was in force after an outage", async () => {
    const { exec, calls } = fakeExec();
    const shaper = new AccessPointShaper({ iface: "wlan1", exec, sleep: async () => undefined });
    await shaper.impair({ lossPercent: 2, delayMs: 80, jitterMs: 20 });
    await shaper.outage(3_000);
    await shaper.impair(null);
    expect(calls).toEqual([
      "sudo -n tc qdisc replace dev wlan1 root netem loss 2% delay 80ms 20ms",
      "sudo -n tc qdisc replace dev wlan1 root netem loss 100% delay 0ms",
      "sudo -n tc qdisc replace dev wlan1 root netem loss 2% delay 80ms 20ms",
      "sudo -n tc qdisc del dev wlan1 root",
    ]);
    expect(() => netemArgs("wlan1", { lossPercent: 101, delayMs: 0 })).toThrow(/loss/);
    expect(() => new AccessPointShaper({ iface: "wlan1; reboot", exec })).toThrow(/interface/);
  });

  it("power-cycles the Pixel's hub port through sudo", async () => {
    const { exec, calls } = fakeExec();
    await new UsbHub({ location: "1-1.4", port: 2, exec }).powerCycle();
    expect(calls).toEqual(["sudo -n uhubctl -l 1-1.4 -p 2 -a cycle -d 5"]);
    expect(() => new UsbHub({ location: "1-1; x", port: 2, exec })).toThrow(/hub location/);
  });

  it("records the call for a fixed time as raw mono, and plays the code until stopped", async () => {
    expect(recordArgs("bluez_input.pixel", 2_500)).toEqual([
      "--preserve-status",
      "-s",
      "INT",
      "3",
      "pw-record",
      "--target",
      "bluez_input.pixel",
      "--rate",
      "16000",
      "--channels",
      "1",
      "--format",
      "s16",
      "--raw",
      "-",
    ]);
    expect([...pcmFromS16(Buffer.from([0x00, 0x40, 0x00, 0xc0]))]).toEqual([0.5, -0.5]);

    const started: string[][] = [];
    let exit: (() => void) | undefined;
    const spawn: Spawn = (file, args, onExit) => {
      started.push([file, ...args]);
      exit = onExit;
      return { stop: () => undefined };
    };
    const link = new BluetoothAudioLink({
      mac: "AA:BB:CC:DD:EE:FF",
      nodes: { callSource: "src", callSink: "sink", mediaSource: "media" },
      fakeMicDir: "/rig/fake-mic",
      exec: fakeExec({ "bluetoothctl info": "Device AA:BB\n\tConnected: yes\n" }).exec,
      spawn,
    });
    expect(await link.connected()).toBe(true);
    await link.playCode("pixel");
    exit?.();
    expect(started).toHaveLength(2);
    expect(started[0]!.slice(0, 3)).toEqual(["pw-play", "--target", "sink"]);
    link.stop();
    exit?.();
    expect(started).toHaveLength(2);
  });
});
