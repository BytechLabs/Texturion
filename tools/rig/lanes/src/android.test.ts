import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import { connect, createServer, type AddressInfo, type Server } from "node:net";
import grpc from "@grpc/grpc-js";
import { afterEach, describe, expect, it } from "vitest";
import { Adb, passedMaintenance, tcpAnswers, type Exec } from "./android/adb.ts";
import {
  AndroidDevice,
  CALL_TEST_IDS,
  hasFullScreenNotification,
  parseEnabled,
  parseFcmToken,
  parseSdkInt,
  parseTelecomState,
  parseUiDump,
  parseVersionCode,
} from "./android/device.ts";
import {
  assemble,
  AUDIO_UNPROVEN,
  EmulatorAudioLink,
  emulatorController,
  pcmFromS16,
  readAudioProof,
  recordingActive,
  type AudioPacket,
  type ControllerClient,
} from "./android/emulator-audio.ts";
import { EmulatorConsole, PACKET_LOSS_REFUSED } from "./android/emulator-console.ts";
import { HostdClient, parseHostdOrigin } from "./android/hostd-client.ts";
import { loadContract, rigPaths } from "../../host/src/config.mjs";
import { createDevices } from "../../host/src/emulator.mjs";
import { healthReport } from "../../host/src/host-facts.mjs";
import { createHostdServer, listen } from "../../host/src/server.mjs";

const PKG = "com.loonext.android.nonprod";
const SERIAL = "emulator-5560";
const ADB = `adb -H 127.0.0.1 -P 15037 -s ${SERIAL}`;

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

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

const tunnelUp = async () => true;

function device(answers: Record<string, string> = {}) {
  const { exec, calls } = fakeExec(answers);
  let now = 0;
  const android = new AndroidDevice({
    name: "pixel",
    serial: SERIAL,
    pkg: PKG,
    pin: () => "2468",
    apks: { current: "/rig/apk/current.apk", previous: "/rig/apk/previous.apk" },
    exec,
    portCheck: tunnelUp,
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

  it("reads Play services' version code and name, and whether deep Doze is enabled", async () => {
    expect(parseVersionCode("    versionCode=251234000 minSdk=30 targetSdk=35")).toBe(251234000);
    expect(parseEnabled("1\n")).toBe(true);
    expect(parseEnabled("0\n")).toBe(false);
    expect(parseEnabled("Unknown command\n")).toBeNull();
    const { android, calls } = device({
      "dumpsys package com.google.android.gms": "    versionCode=251234000 minSdk=30\n    versionName=25.12.34 (190400-123456789)\n",
      "deviceidle enabled deep": "0\n",
    });
    const state = await android.state();
    expect(state).toMatchObject({ play_services_version: 251_234_000, play_services_version_name: "25.12.34", deep_idle_enabled: false });
    expect(Object.keys(state).sort()).toEqual(["app_version", "battery_saver", "boot_completed", "deep_idle_enabled", "doze", "locked", "play_services_version", "play_services_version_name", "sdk_int", "standby_bucket"]);
    expect(calls).toContain(`${ADB} shell dumpsys deviceidle enabled deep`);
  });

  it("reads the app's FCM token from its own preferences, in either of firebase-messaging's shapes", async () => {
    const json = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n    <string name="|S||P|">1:2:android:3</string>\n    <string name="|T|987654321|*">{&quot;token&quot;:&quot;fcm-AbC_1:xyz&quot;,&quot;appVersion&quot;:&quot;1&quot;,&quot;timestamp&quot;:1761998400000}</string>\n</map>`;
    expect(parseFcmToken(json)).toBe("fcm-AbC_1:xyz");
    expect(parseFcmToken(`<map><string name="|T|987654321|*">fcm-plain</string></map>`)).toBe("fcm-plain");
    expect(parseFcmToken(`<map><string name="|S||P|">1:2:android:3</string></map>`)).toBeNull();
    const { android, calls } = device({ "run-as": `<map><string name="|T|1|*">fcm-plain</string></map>`, "ro.crypto.type": "file\n" });
    expect(await android.pushToken()).toBe("fcm-plain");
    expect(await android.cryptoType()).toBe("file");
    expect(calls).toEqual([`${ADB} shell run-as ${PKG} cat shared_prefs/com.google.android.gms.appid.xml`, `${ADB} shell getprop ro.crypto.type`]);
  });

  it("reads the Android release a device runs, and nothing from a property that is not a level", async () => {
    expect(parseSdkInt("35\n")).toBe(35);
    expect(parseSdkInt("")).toBeNull();
    expect(parseSdkInt("Baklava")).toBeNull();
    const { android, calls } = device({ "getprop ro.build.version.sdk": "36\n" });
    expect((await android.state()).sdk_int).toBe(36);
    expect(calls).toContain(`${ADB} shell getprop ro.build.version.sdk`);
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
    expect(calls[0]).toBe(`${ADB} shell pm path ${PKG}`);
  });
});

describe("adb through hostd's tunnel", () => {
  it("refuses every call while the tunnel's port does not answer, so adb never starts a server of its own", async () => {
    const { exec, calls } = fakeExec();
    const asked: string[] = [];
    const adb = new Adb({
      serial: SERIAL,
      exec,
      portCheck: async (host, port, timeoutMs) => (asked.push(`${host}:${port}/${timeoutMs}`), false),
    });
    const refusal = "adb: the rig's adb server (hostd tunnel 127.0.0.1:15037) is not answering";
    await expect(adb.shell("getprop", "sys.boot_completed")).rejects.toThrow(refusal);
    await expect(adb.reboot()).rejects.toThrow(refusal);
    await expect(adb.secretShell("typing the PIN", "input", "text", "2468")).rejects.toThrow(refusal);
    expect(calls).toEqual([]);
    expect(asked).toEqual(["127.0.0.1:15037/2000", "127.0.0.1:15037/2000", "127.0.0.1:15037/2000"]);
  });

  it("measures the port with a real connection", async () => {
    const server = createServer((socket) => socket.end());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    expect(await tcpAnswers("127.0.0.1", port, 2_000)).toBe(true);
    await new Promise((resolve) => server.close(resolve));
    expect(await tcpAnswers("127.0.0.1", port, 2_000)).toBe(false);
  });

  it("talks only to a loopback server", () => {
    expect(() => new Adb({ serial: SERIAL, server: { host: "10.0.0.1" as "127.0.0.1", port: 15037 } })).toThrow(/tunnel/);
    const { exec, calls } = fakeExec();
    return new Adb({ serial: SERIAL, exec, portCheck: tunnelUp, server: { host: "127.0.0.1", port: 15999 } })
      .shell("getprop", "x")
      .then(() => expect(calls).toEqual([`adb -H 127.0.0.1 -P 15999 -s ${SERIAL} shell getprop x`]));
  });
});

describe("Doze and battery saver on an emulator", () => {
  const adbWith = (answers: Record<string, string>) => {
    const { exec, calls } = fakeExec(answers);
    return { adb: new Adb({ serial: SERIAL, exec, portCheck: tunnelUp }), calls };
  };

  it("fails force-idle that Android did not carry out, or that left deep Doze anywhere but IDLE", async () => {
    const disabled = adbWith({ "force-idle": "Unable to go deep idle; not enabled\n", "get deep": "ACTIVE\n" });
    await expect(disabled.adb.forceDoze()).rejects.toThrow(/did not force deep idle \(Unable to go deep idle; not enabled\)/);
    const pending = adbWith({ "force-idle": "Now forced in to deep idle mode\n", "get deep": "IDLE_PENDING\n" });
    await expect(pending.adb.forceDoze()).rejects.toThrow(/reads IDLE_PENDING after force-idle/);
    const idle = adbWith({ "force-idle": "Now forced in to deep idle mode\n", "get deep": "IDLE\n" });
    await idle.adb.forceDoze();
    expect(idle.calls.slice(0, 3)).toEqual([
      `${ADB} shell dumpsys battery unplug`,
      `${ADB} shell dumpsys deviceidle enable all`,
      `${ADB} shell dumpsys deviceidle force-idle`,
    ]);
  });

  it("steps deep Doze to IDLE, through a maintenance window and back, and stops at its cap", async () => {
    const states = ["INACTIVE", "IDLE_PENDING", "SENSING", "LOCATING", "IDLE", "IDLE_MAINTENANCE", "IDLE", "IDLE_MAINTENANCE"];
    let step = 0;
    const calls: string[] = [];
    const exec: Exec = async (file, args) => {
      const line = [file, ...args].join(" ");
      calls.push(line);
      return line.endsWith("step deep") ? `Stepped to deep: ${states[step++]}\n` : "";
    };
    const adb = new Adb({ serial: SERIAL, exec, portCheck: tunnelUp });
    expect(await adb.stepDeepIdle()).toEqual(states.slice(0, 7));
    expect(calls.slice(0, 3)).toEqual([`${ADB} shell dumpsys deviceidle enable all`, `${ADB} shell input keyevent KEYCODE_SLEEP`, `${ADB} shell dumpsys battery unplug`]);

    step = 0;
    expect(await adb.stepDeepIdle(3)).toEqual(states.slice(0, 3));
    expect(passedMaintenance(states.slice(0, 7))).toBe(true);
    expect(passedMaintenance(["IDLE", "IDLE_MAINTENANCE"])).toBe(false);
    expect(passedMaintenance(["IDLE_MAINTENANCE", "IDLE"])).toBe(false);

    const silent = new Adb({ serial: SERIAL, exec: async () => "", portCheck: tunnelUp });
    await expect(silent.stepDeepIdle()).rejects.toThrow(/printed no state/);
  });

  it("returns a device's stepped Doze states", async () => {
    let step = 0;
    const states = ["IDLE", "IDLE_MAINTENANCE", "IDLE"];
    const android = new AndroidDevice({
      name: "pixel",
      serial: SERIAL,
      pkg: PKG,
      pin: () => undefined,
      apks: { current: "", previous: "" },
      exec: async (_file, args) => (args.at(-1) === "deep" && args.includes("step") ? `Stepped to deep: ${states[step++]}` : ""),
      portCheck: tunnelUp,
    });
    expect(await android.stepDoze()).toEqual(states);
  });

  it("turns battery saver on unplugged and reads it back, and off by resetting the battery", async () => {
    const on = adbWith({ "settings get global low_power": "1\n" });
    await on.adb.batterySaver(true);
    expect(on.calls).toEqual([
      `${ADB} shell dumpsys battery unplug`,
      `${ADB} shell settings put global low_power 1`,
      `${ADB} shell settings get global low_power`,
    ]);
    const off = adbWith({ "settings get global low_power": "0\n" });
    await off.adb.batterySaver(false);
    expect(off.calls).toEqual([
      `${ADB} shell settings put global low_power 0`,
      `${ADB} shell dumpsys battery reset`,
      `${ADB} shell settings get global low_power`,
    ]);
    // Powered, AOSP turns saver straight back off.
    const powered = adbWith({ "settings get global low_power": "0\n" });
    await expect(powered.adb.batterySaver(true)).rejects.toThrow(/reads 0 after turning it on/);
  });
});

describe("the device driver's commands (no device has run them)", () => {
  it("taps a call control at its centre, and reports one that is not on screen", async () => {
    const { android, calls } = device({ "cat /sdcard/rig-ui.xml": UI });
    expect(await android.tap("call_decline")).toBe(true);
    expect(calls.slice(-1)).toEqual([`${ADB} shell input tap 830 1900`]);
    expect(await android.tap("call_hang_up")).toBe(false);
    expect(await android.tapText("Answer")).toBe(true);
    expect(calls.slice(-1)).toEqual([`${ADB} shell input tap 250 1900`]);
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
      serial: SERIAL,
      pkg: PKG,
      pin: () => undefined,
      apks: { current: "a.apk", previous: "b.apk" },
      exec,
      portCheck: tunnelUp,
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
    await android.launch("/calls");
    expect(calls).toEqual([
      `${ADB} shell cmd app_hibernation set-state ${PKG} true`,
      `${ADB} shell pm revoke ${PKG} android.permission.POST_NOTIFICATIONS`,
      `${ADB} shell am start -a android.intent.action.VIEW -d https://nonprod.invalid/calls ${PKG}`,
    ]);
    await expect(android.launch("/calls?x=1")).rejects.toThrow(/not an app path/);
  });

  it("drives only a nonprod package, and types only plain text", async () => {
    expect(() => new AndroidDevice({ name: "p", serial: "S", pkg: "com.loonext.android", pin: () => "1", apks: { current: "", previous: "" } })).toThrow(/nonprod/);
    const { android, calls } = device();
    await android.type("rig owner");
    expect(calls).toEqual([`${ADB} shell input text rig%sowner`]);
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
      const android = new AndroidDevice({ name: "pixel", serial: SERIAL, pkg: PKG, pin: () => "2468", apks: { current: "", previous: "" }, exec: failing(killed), portCheck: tunnelUp });
      const typed = await android.type("Qx7Tz2SeedPassword_-").catch((error: Error) => error);
      expect(typed).toBeInstanceOf(Error);
      expect((typed as Error).message).toBe(`adb: typing text on ${SERIAL} ${killed ? "timed out" : "exited 1"}`);
      const unlocked = await android.unlock().catch((error: Error) => error);
      expect((unlocked as Error).message).toBe(`adb: typing the PIN on ${SERIAL} ${killed ? "timed out" : "exited 1"}`);
      const adb = new Adb({ serial: SERIAL, exec: failing(killed), portCheck: tunnelUp });
      const pinned = await adb.setPin("1357", "2468").catch((error: Error) => error);
      for (const message of [(typed as Error).message, (unlocked as Error).message, (pinned as Error).message]) {
        expect(message).not.toMatch(/Qx7Tz2SeedPassword|2468|1357|Command failed/);
      }
    }
    // A refusal before anything runs still says why.
    await expect(new Adb({ serial: SERIAL, exec: failing(false), portCheck: tunnelUp }).secretShell("typing text", "input", "text", "a;b")).rejects.toThrow(/special characters/);
  });

  it("unlocks with the store's PIN and refuses without one", async () => {
    const { android, calls } = device();
    await android.unlock();
    expect(calls).toContain(`${ADB} shell input text 2468`);
    const locked = new AndroidDevice({ name: "p", serial: "S", pkg: PKG, pin: () => undefined, apks: { current: "", previous: "" }, exec: fakeExec().exec, portCheck: tunnelUp });
    await expect(locked.unlock()).rejects.toThrow(/no lock PIN/);
  });
});

const CONSOLE_TOKEN = "c0nsoleT0ken";

/** An emulator console: its banner, `auth`, and an OK or a KO for each command. */
async function fakeConsole(options: { ko?: RegExp } = {}) {
  const lines: string[] = [];
  const server: Server = createServer((socket) => {
    let authed = false;
    let partial = "";
    socket.write("Android Console: Authentication required\r\nAndroid Console: type 'auth <auth_token>' to authenticate\r\n");
    socket.write("Android Console: you can find your <auth_token> in\r\n'/home/rig/.emulator_console_auth_token'\r\nOK\r\n");
    socket.on("data", (chunk) => {
      const parts = (partial + chunk.toString()).split("\n");
      partial = parts.pop()!;
      for (const line of parts.map((part) => part.trim())) {
        lines.push(line.startsWith("auth ") ? "auth <token>" : line);
        if (line.startsWith("auth ")) {
          authed = line === `auth ${CONSOLE_TOKEN}`;
          socket.write(authed ? "Android Console: type 'help' for a list of commands\r\nOK\r\n" : "KO: authentication token does not match ~/.emulator_console_auth_token\r\n");
        } else if (!authed) socket.write("KO: unknown command, try 'help'\r\n");
        else if (line === "kill") socket.end("OK: killing emulator, bye bye\r\n");
        else if (options.ko?.test(line)) socket.write("KO: bad network delay value\r\n");
        else socket.write("OK\r\n");
      }
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const shells: string[] = [];
  const make = (token = CONSOLE_TOKEN, shell?: (args: string[]) => Promise<string>) =>
    new EmulatorConsole({
      port: 5560,
      token: () => token,
      adb: { shell: async (...args: string[]) => (shells.push(args.join(" ")), shell ? shell(args) : "") },
      connect: () => connect({ host: "127.0.0.1", port }),
      sleep: async () => undefined,
    });
  return { lines, shells, make };
}

describe("the emulator console", () => {
  it("authenticates, then sends each command and reads its OK", async () => {
    const world = await fakeConsole();
    const shell = world.make();
    await shell.shape({ delayMs: 80, speedKbps: { up: 512, down: 2_048 } });
    expect(world.lines).toEqual(["auth <token>", "network delay 80", "network speed 512:2048"]);
    expect(shell.shaped).toEqual({ delayMs: 80, speedKbps: { up: 512, down: 2_048 } });
    await shell.powerAc(false);
    await shell.powerStatus("discharging");
    await shell.powerCapacity(15);
    await shell.gsmCall("+14165550199");
    await shell.gsmCancel("+14165550199");
    expect(world.lines.filter((line) => line !== "auth <token>").slice(2)).toEqual([
      "power ac off",
      "power status discharging",
      "power capacity 15",
      "gsm call +14165550199",
      "gsm cancel +14165550199",
    ]);
  });

  it("fails on a wrong token and on a KO, naming neither the token nor guessing", async () => {
    const world = await fakeConsole({ ko: /^network delay/ });
    const wrong = await world.make("not-the-token").networkDelay(80).catch((error: Error) => error);
    expect((wrong as Error).message).toBe("emulator console on 5560 refused the auth token");
    expect((wrong as Error).message).not.toContain("not-the-token");
    await expect(world.make().networkDelay(80)).rejects.toThrow('emulator console: "network delay 80" answered KO: bad network delay value');
  });

  it("refuses any command outside its list, any real-looking number and any packet loss", async () => {
    const world = await fakeConsole();
    const shell = world.make();
    await expect(shell.send("avd snapshot delete default_boot")).rejects.toThrow(/refusing/);
    await expect(shell.send("network delay 80; kill")).rejects.toThrow(/refusing/);
    // Assembled from parts so this file holds no real-looking number (check-rig-no-e164).
    await expect(shell.gsmCall(["+1416", "5551234"].join(""))).rejects.toThrow(/refusing/);
    await expect(shell.shape({ delayMs: 80, speedKbps: { up: 512, down: 512 }, lossPercent: 2 })).rejects.toThrow(PACKET_LOSS_REFUSED);
    await expect(shell.networkDelay(9_000)).rejects.toThrow(/0-5000/);
    expect(world.lines).toEqual([]);
  });

  it("takes the network away for an outage and gives both paths back, even when one fails", async () => {
    const world = await fakeConsole();
    await world.make().outage(3_000);
    expect(world.shells).toEqual(["svc wifi disable", "svc wifi enable"]);
    expect(world.lines).toEqual(["auth <token>", "gsm data unregistered", "auth <token>", "gsm data home"]);

    const broken = await fakeConsole({ ko: /^gsm data unregistered/ });
    await expect(broken.make().outage(3_000)).rejects.toThrow(/gsm data unregistered/);
    expect(broken.shells).toEqual(["svc wifi disable", "svc wifi enable"]);
    expect(broken.lines.filter((line) => line.startsWith("gsm"))).toEqual(["gsm data unregistered", "gsm data home"]);

    const stuck = await fakeConsole();
    const failing = stuck.make(CONSOLE_TOKEN, async (args) => {
      if (args.join(" ") === "svc wifi enable") throw new Error("adb: device offline");
      return "";
    });
    await expect(failing.outage(1_000)).rejects.toThrow(/could not restore Wi-Fi: adb: device offline/);
    expect(stuck.lines).toContain("gsm data home");
  });

  it("drops only Wi-Fi for a Wi-Fi drop, and puts the whole network back at rest on a clear", async () => {
    const world = await fakeConsole();
    await world.make().wifiDrop(2_000);
    expect(world.shells).toEqual(["svc wifi disable", "svc wifi enable"]);
    expect(world.lines).toEqual([]);
    await world.make().shape(null);
    expect(world.lines).toEqual(["auth <token>", "network delay none", "network speed full", "gsm data home"]);
    expect(world.shells.at(-1)).toBe("svc wifi enable");
  });

  it("counts the connection closing as kill's answer", async () => {
    const world = await fakeConsole();
    await world.make().kill();
    expect(world.lines).toEqual(["auth <token>", "kill"]);
  });
});

const GRPC_TOKEN = "grpcT0ken";
const RECORDING = [
  "Audio event log: recording activity received by AudioService",
  "",
  "RecordActivityMonitor dump time: 3:00:04 PM",
  "  session:57 -- source client=VOICE_COMMUNICATION -- uid:10123 -- silenced:false",
  "",
].join("\n");
const PROVEN = JSON.stringify({ date: "2026-11-01", flags: ["-no-audio", "-grpc-use-token"] });

/** An EmulatorController that plays back, on streamAudio, whatever was injected. */
async function fakeController() {
  const injected: AudioPacket[] = [];
  const echo: Buffer[] = [];
  const auth: string[] = [];
  const authorized = (metadata: grpc.Metadata) => {
    const value = String(metadata.get("authorization")[0] ?? "");
    auth.push(value === `Bearer ${GRPC_TOKEN}` ? "ok" : "wrong");
    return value === `Bearer ${GRPC_TOKEN}`;
  };
  const denied = { code: grpc.status.UNAUTHENTICATED, details: "bad token" };
  const server = new grpc.Server();
  server.addService(emulatorController().service, {
    getStatus(call: grpc.ServerUnaryCall<object, object>, callback: grpc.sendUnaryData<object>) {
      if (!authorized(call.metadata)) return callback(denied);
      callback(null, { version: "37.2.13", booted: true });
    },
    injectAudio(call: grpc.ServerReadableStream<AudioPacket, object>, callback: grpc.sendUnaryData<object>) {
      if (!authorized(call.metadata)) return callback(denied);
      call.on("data", (packet: AudioPacket) => {
        injected.push(packet);
        echo.push(Buffer.from(packet.audio));
      });
      call.on("end", () => callback(null, {}));
    },
    streamAudio(call: grpc.ServerWritableStream<{ samplingRate: number }, AudioPacket>) {
      if (!authorized(call.metadata)) return call.destroy(Object.assign(new Error("bad token"), denied));
      let timestamp = 1_761_998_400_000_000;
      const timer = setInterval(() => {
        for (const audio of echo.splice(0)) {
          call.write({ format: { samplingRate: 48_000, channels: "Mono", format: "AUD_FMT_S16" }, timestamp, audio });
          timestamp += Math.round(((audio.length / 2) * 1e6) / 48_000);
        }
      }, 1);
      call.on("cancelled", () => clearInterval(timer));
      call.on("close", () => clearInterval(timer));
    },
  });
  const port = await new Promise<number>((resolve, reject) =>
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (error, bound) => (error ? reject(error) : resolve(bound))),
  );
  cleanups.push(() => new Promise<void>((resolve) => server.tryShutdown(() => resolve())));
  return { port, injected, auth };
}

function audioLink(port: number, options: { proof?: string; dump?: () => string; token?: string; transcribed?: Uint8Array[] } = {}) {
  const shells: string[] = [];
  const client = () => new (emulatorController())(`127.0.0.1:${port}`, grpc.credentials.createInsecure()) as unknown as ControllerClient;
  const link = new EmulatorAudioLink({
    port: 8560,
    token: () => options.token ?? GRPC_TOKEN,
    adb: { shell: async (...args: string[]) => (shells.push(args.join(" ")), options.dump ? options.dump() : RECORDING) },
    proof: () => ("proof" in options ? options.proof : PROVEN),
    client,
    transcriber: { transcribe: async (wav) => (options.transcribed?.push(wav), "hello this is the rig robot") },
    sleep: () => new Promise((resolve) => setImmediate(resolve)),
    micWaitMs: 2_000,
  });
  cleanups.push(() => link.close());
  return { link, shells };
}

describe("the emulator's gRPC audio", () => {
  it("injects the surface's code at 48 kHz in real-time mode, and hears 2,300 Hz back as the pixel's code", async () => {
    const controller = await fakeController();
    const { link } = audioLink(controller.port);
    expect(await link.connected()).toBe(true);
    await link.playCode("pixel");
    const heard = await link.hear({ stream: "call", ms: 8_000 });
    link.stop();
    expect(heard).toMatchObject({ verdict: "heard", answered: "pixel" });
    expect(controller.injected[0]!.format).toMatchObject({ samplingRate: 48_000, channels: "Mono", format: "AUD_FMT_S16", mode: "MODE_REAL_TIME" });
    expect(controller.injected[0]!.audio.length).toBe(1_920);
    expect(controller.injected[1]!.format).toBeNull();
    expect(controller.auth.every((answer) => answer === "ok")).toBe(true);
    // Its own code, as the far end would hear it back, is echo and not an answer.
    await link.playCode("pixel");
    expect(await link.hear({ stream: "call", ms: 8_000, own: "pixel" })).toMatchObject({ answered: null, echo: { surface: "pixel" } });
  });

  it("injects nothing until the guest's microphone is open", async () => {
    const controller = await fakeController();
    let open = false;
    const { link, shells } = audioLink(controller.port, { dump: () => (open ? RECORDING : "RecordActivityMonitor dump time: 3:00:04 PM\n\n") });
    await link.playCode("pixel");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(controller.injected).toEqual([]);
    expect(shells.every((line) => line === "dumpsys audio")).toBe(true);
    open = true;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(controller.injected.length).toBeGreaterThan(0);
    link.stop();
  });

  it("refuses to play or hear until EA1 has proven the path, and calls a wrong token not connected", async () => {
    const controller = await fakeController();
    for (const proof of [undefined, "yes", JSON.stringify({ date: "soon", flags: [] }), JSON.stringify({ date: "2026-11-01", flags: ["; rm"] })]) {
      const { link } = audioLink(controller.port, { proof });
      expect(await link.proven()).toBe(false);
      await expect(link.playCode("pixel")).rejects.toThrow(AUDIO_UNPROVEN);
      await expect(link.hear({ stream: "call", ms: 1_000 })).rejects.toThrow(AUDIO_UNPROVEN);
      await expect(link.transcribe({ stream: "media", ms: 1_000 })).rejects.toThrow(AUDIO_UNPROVEN);
    }
    expect(controller.injected).toEqual([]);
    expect(readAudioProof(PROVEN)).toEqual({ date: "2026-11-01", flags: ["-no-audio", "-grpc-use-token"] });
    expect(await audioLink(controller.port, { token: "wrongT0ken" }).link.connected()).toBe(false);
  });

  it("transcribes the media stream from 48 kHz down to whisper's 16 kHz", async () => {
    const controller = await fakeController();
    const transcribed: Uint8Array[] = [];
    const { link } = audioLink(controller.port, { transcribed });
    await link.playCode("emulator");
    expect(await link.transcribe({ stream: "media", ms: 1_000 })).toBe("hello this is the rig robot");
    link.stop();
    const wav = Buffer.from(transcribed[0]!);
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt32LE(40)).toBe(16_000 * 2);
  });

  it("reads an active recording from dumpsys audio, and lays packets on their timestamps", () => {
    expect(recordingActive(RECORDING)).toBe(true);
    expect(recordingActive(RECORDING.replace("silenced:false", "silenced:true"))).toBe(false);
    expect(recordingActive("Audio event log\n  session:57 -- source client=MIC\n")).toBe(false);
    expect([...pcmFromS16(Buffer.from([0x00, 0x40, 0x00, 0xc0]))]).toEqual([0.5, -0.5]);
    const packet = (timestamp: number) => ({ timestamp, samples: new Float32Array(960).fill(0.5) });
    // A 40 ms stall between the packets becomes silence, not a splice.
    const laid = assemble([packet(0), packet(60_000)], 48_000, 4_800);
    expect(laid[959]).toBe(0.5);
    expect(laid[960]).toBe(0);
    expect(laid[2_879]).toBe(0);
    expect(laid[2_880]).toBe(0.5);
  });
});

const HOSTD_TOKEN = "h0stdT0ken";

async function fakeHostd(answers: Record<string, { status?: number; body?: unknown }>) {
  const requests: { method: string; url: string; auth: string; body: string }[] = [];
  const server = createHttpServer(async (request: IncomingMessage, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method!, url: request.url!, auth: String(request.headers.authorization), body });
    const answer = answers[`${request.method} ${request.url}`];
    if (request.headers.authorization !== `Bearer ${HOSTD_TOKEN}`) return response.writeHead(401).end();
    response.writeHead(answer?.status ?? (answer ? 200 : 404), { "content-type": "application/json" });
    response.end(answer?.body === undefined ? "" : JSON.stringify(answer.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return { requests, client: (token = HOSTD_TOKEN) => new HostdClient({ origin: `http://127.0.0.1:${port}`, token: () => token }) };
}

describe("the hostd client", () => {
  it("boots, kills and reads tokens for the contract's devices, with the store's bearer token", async () => {
    const hostd = await fakeHostd({
      "POST /v1/devices/pixel/boot": {},
      "POST /v1/devices/emulator-35/kill": {},
      "GET /v1/devices/pixel/tokens": { body: { console_token: CONSOLE_TOKEN, grpc_token: GRPC_TOKEN } },
      "GET /v1/health": { body: { whpx: { usable: true }, tunnel: { up: true }, reboot_pending: true } },
    });
    const client = hostd.client();
    await client.boot("pixel", { cold: true, wipe: false });
    await client.kill("emulator-35", { hard: true });
    expect(await client.tokens("pixel")).toEqual({ console: CONSOLE_TOKEN, grpc: GRPC_TOKEN });
    expect(await client.health()).toEqual({ whpx_usable: true, tunnel_up: true, reboot_pending: true });
    expect(hostd.requests.map((r) => [r.method, r.url, r.body])).toEqual([
      ["POST", "/v1/devices/pixel/boot", '{"cold":true,"wipe":false}'],
      ["POST", "/v1/devices/emulator-35/kill", '{"hard":true}'],
      ["GET", "/v1/devices/pixel/tokens", ""],
      ["GET", "/v1/health", ""],
    ]);
    expect(hostd.requests.every((r) => r.auth === `Bearer ${HOSTD_TOKEN}`)).toBe(true);
  });

  it("speaks hostd's own server: its routes, bodies, token answer and health report", async () => {
    const devices = createDevices({
      contract: loadContract(),
      paths: rigPaths(mkdtempSync(join(tmpdir(), "rig-hostd-"))),
      sdk: "sdk",
      spawn: () => Object.assign(new EventEmitter(), { pid: 4242 }),
      exec: async () => ({ code: 0, stdout: "1\n", stderr: "" }),
      sleep: async () => {},
      isAlive: () => false,
      killPid: () => true,
      discover: () => ({ path: "p", pid: 4242, grpcToken: GRPC_TOKEN }),
      consoleToken: () => ({ path: "p", token: CONSOLE_TOKEN }),
    });
    const facts = { whpx: { usable: true, detail: "" }, host: { pending_reboot: true } };
    const health = async () => healthReport({ facts, adbUp: true, tunnel: { up: true, since: null }, devices: devices.list() });
    const server = createHostdServer({ token: HOSTD_TOKEN, devices, health });
    const { port } = await listen(server, 0);
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const client = new HostdClient({ origin: `http://127.0.0.1:${port}`, token: () => HOSTD_TOKEN });
    await client.boot("pixel", { cold: false, wipe: false });
    expect(await client.tokens("pixel")).toEqual({ console: CONSOLE_TOKEN, grpc: GRPC_TOKEN });
    await client.kill("pixel", { hard: true });
    expect(await client.health()).toEqual({ whpx_usable: true, tunnel_up: true, reboot_pending: true });
    await expect(new HostdClient({ origin: `http://127.0.0.1:${port}`, token: () => "wrong" }).health()).rejects.toThrow(/answered 401/);
  });

  it("refuses a device the contract does not name before any request, and an origin off loopback", async () => {
    const hostd = await fakeHostd({});
    await expect(hostd.client().boot("emulator-33" as never, { cold: false, wipe: false })).rejects.toThrow(/not one of the rig's devices/);
    await expect(hostd.client().kill("../health" as never, { hard: false })).rejects.toThrow(/not one of the rig's devices/);
    expect(hostd.requests).toEqual([]);
    expect(() => parseHostdOrigin("http://192.168.70.1:15900")).toThrow(/tunnel's end/);
    expect(() => parseHostdOrigin("https://127.0.0.1:15900")).toThrow(/tunnel's end/);
    expect(parseHostdOrigin("http://127.0.0.1:15900/")).toBe("http://127.0.0.1:15900");
  });

  it("fails a refusal by status, a health that leaves a fact out, and tokens that are not there, never quoting the token", async () => {
    const hostd = await fakeHostd({
      "GET /v1/health": { body: { whpx: { usable: true }, reboot_pending: false } },
      "GET /v1/devices/pixel/tokens": { body: { console_token: "" } },
      "POST /v1/devices/pixel/boot": { status: 409 },
    });
    await expect(hostd.client().health()).rejects.toThrow("hostd: /v1/health does not report tunnel.up");
    await expect(hostd.client().tokens("pixel")).rejects.toThrow(/does not hold a console and a gRPC token/);
    await expect(hostd.client().boot("pixel", { cold: true, wipe: false })).rejects.toThrow("hostd: POST /v1/devices/pixel/boot answered 409");
    const refused = await hostd.client("wrong-token").health().catch((error: Error) => error);
    expect((refused as Error).message).toBe("hostd: GET /v1/health answered 401");
    await expect(new HostdClient({ origin: "http://127.0.0.1:9", token: () => HOSTD_TOKEN }).health()).rejects.toThrow(/got no answer/);
  });
});
