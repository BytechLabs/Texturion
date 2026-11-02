/**
 * One Android emulator as a scenario drives it, over adb: the device lane's
 * rig-pixel or one of E01's AVDs. Controls are found the way UIAutomator sees
 * them: the call surfaces by the ids in tools/rig/test-ids.json (the nonprod
 * build exposes Compose test tags as resource ids), and everything else by
 * its text or description.
 *
 * Readings come from `dumpsys`, whose text is not a contract, so each parser
 * here reads the narrowest line it can and says what it could not find
 * rather than guessing. None of this has met a device yet; the tests pin the
 * command lines and the parsers against captured shapes.
 */
import { Adb, NONPROD_SUFFIX, type AdbServer, type Exec, type PortCheck, type StandbyBucket } from "./adb.ts";

/** The values of CallTestTags.kt; lanes.test.ts keeps this equal to tools/rig/test-ids.json. */
export const CALL_TEST_IDS = [
  "call_ringing",
  "call_in_call",
  "call_answer",
  "call_decline",
  "call_hang_up",
  "call_mute",
  "call_keypad",
  "call_hold",
] as const;
export type CallTestId = (typeof CALL_TEST_IDS)[number];

/** How long a launched app is given to draw its first frame before the launcher is put in front of it. */
const APP_SETTLE_MS = 2_000;

/** The app asks for these at the dialer and at answer. */
const CALL_PERMISSIONS = ["RECORD_AUDIO", "READ_CONTACTS", "WRITE_CONTACTS"] as const;

export const PLAY_SERVICES = "com.google.android.gms";
/** The manifest entry play-services-basement merges in: the Play services versionCode the app's Google libraries require. */
export const PLAY_SERVICES_VERSION_META = "com.google.android.gms.version";

export interface DeviceState {
  boot_completed: boolean;
  /** `ro.build.version.sdk`, the Android release a verdict about the device holds for. */
  sdk_int: number | null;
  locked: boolean | null;
  /** `dumpsys deviceidle get deep`: ACTIVE, IDLE_PENDING, ..., IDLE. */
  doze: string | null;
  /** `dumpsys deviceidle enabled deep`. Emulator images ship deep Doze off, and every boot turns it off again. */
  deep_idle_enabled: boolean | null;
  battery_saver: boolean | null;
  standby_bucket: string | null;
  app_version: string | null;
  /** Google Play services' versionCode, the number the app's minimum is stated in. */
  play_services_version: number | null;
  /** Google Play services' versionName, which the system image fixes: headless and signed out, nothing updates it. */
  play_services_version_name: string | null;
}

export interface UiNode {
  resourceId: string;
  className: string;
  text: string;
  description: string;
  bounds: { left: number; top: number; right: number; bottom: number };
}

/** The nodes of a `uiautomator dump` hierarchy, in document order. */
export function parseUiDump(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  for (const match of xml.matchAll(/<node\b([^>]*?)\/?>/g)) {
    const attrs = match[1]!;
    const attr = (name: string) => decodeXml(new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? "");
    const bounds = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr("bounds"));
    if (!bounds) continue;
    nodes.push({
      resourceId: attr("resource-id"),
      className: attr("class"),
      text: attr("text"),
      description: attr("content-desc"),
      bounds: { left: Number(bounds[1]), top: Number(bounds[2]), right: Number(bounds[3]), bottom: Number(bounds[4]) },
    });
  }
  return nodes;
}

/** A test tag as UIAutomator reports it: the bare tag, or `<package>:id/<tag>`. */
export function hasTestId(node: UiNode, id: string): boolean {
  return node.resourceId === id || node.resourceId.endsWith(`:id/${id}`);
}

export function centre(node: UiNode): { x: number; y: number } {
  return {
    x: Math.round((node.bounds.left + node.bounds.right) / 2),
    y: Math.round((node.bounds.top + node.bounds.bottom) / 2),
  };
}

/**
 * The app's calls as `dumpsys telecom` lists them: the state of the newest
 * call whose connection service is the app's own, or `none`.
 */
export function parseTelecomState(dump: string, pkg: string): "ringing" | "active" | "holding" | "disconnected" | "none" {
  let state: string | undefined;
  for (const line of dump.split("\n")) {
    if (!line.includes(pkg)) continue;
    const found = /\bstate[=:]\s*([A-Z_]+)/.exec(line)?.[1];
    if (found) state = found;
  }
  switch (state) {
    case "RINGING":
    case "NEW":
      return "ringing";
    case "ACTIVE":
    case "DIALING":
    case "CONNECTING":
      return "active";
    case "ON_HOLD":
      return "holding";
    case "DISCONNECTED":
    case "DISCONNECTING":
    case "ABORTED":
      return "disconnected";
    default:
      return "none";
  }
}

/** Whether the app posts a notification with a full-screen intent, as its ring does. */
export function hasFullScreenNotification(dump: string, pkg: string): boolean {
  const records = dump.split(/\n(?=\s*NotificationRecord\()/);
  return records.some((record) => record.includes(`pkg=${pkg}`) && /fullscreenIntent=(?!null)\S+/.test(record));
}

export function parseVersionCode(dump: string): number | null {
  const code = /\bversionCode=(\d+)/.exec(dump)?.[1];
  return code ? Number(code) : null;
}

export function parseSdkInt(prop: string): number | null {
  const level = /^\s*(\d+)\s*$/.exec(prop)?.[1];
  return level ? Number(level) : null;
}

export function parseVersionName(dump: string): string | null {
  return /\bversionName=(\S+)/.exec(dump)?.[1] ?? null;
}

/** Where firebase-messaging keeps the app's FCM token, in the app's own data. */
export const FCM_TOKEN_PREFS = "shared_prefs/com.google.android.gms.appid.xml";

/**
 * The FCM token in firebase-messaging's preferences: the `|T|<sender>|*`
 * entry, which newer releases store as JSON with a `token` field. Null when
 * there is none.
 */
export function parseFcmToken(xml: string): string | null {
  for (const match of xml.matchAll(/<string name="\|T\|[^"|]+\|\*">([^<]*)<\/string>/g)) {
    const value = decodeXml(match[1]!).trim();
    if (!value) continue;
    if (!value.startsWith("{")) return value;
    try {
      const token = (JSON.parse(value) as { token?: unknown }).token;
      if (typeof token === "string" && token) return token;
    } catch {
      return null;
    }
  }
  return null;
}

/** `dumpsys deviceidle enabled deep` prints 1 or 0. */
export function parseEnabled(output: string): boolean | null {
  const value = output.trim();
  return value === "1" ? true : value === "0" ? false : null;
}

export interface AndroidDeviceOptions {
  name: string;
  serial: string;
  /** The `.nonprod` package; nothing else is ever driven. */
  pkg: string;
  /** The lock PIN, from the rig's store. */
  pin: () => string | undefined;
  /** The `.nonprod` APKs: the deployed ref's, and the previous release's. */
  apks: { current: string; previous: string };
  adb?: string;
  aapt2?: string;
  exec?: Exec;
  server?: AdbServer;
  portCheck?: PortCheck;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class AndroidDevice {
  readonly name: string;
  readonly adb: Adb;
  readonly #o: AndroidDeviceOptions;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(options: AndroidDeviceOptions) {
    if (!options.pkg.endsWith(NONPROD_SUFFIX)) throw new Error(`device: ${options.pkg} is not a ${NONPROD_SUFFIX} package`);
    this.name = options.name;
    this.#o = options;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.adb = new Adb({
      serial: options.serial,
      adb: options.adb,
      aapt2: options.aapt2,
      exec: options.exec,
      server: options.server,
      portCheck: options.portCheck,
    });
  }

  async reachable(): Promise<boolean> {
    try {
      return (await this.adb.shell("getprop", "sys.boot_completed")).trim() === "1";
    } catch {
      return false;
    }
  }

  async state(): Promise<DeviceState> {
    const read = async <T>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch {
        return null;
      }
    };
    const pkg = this.#o.pkg;
    return {
      boot_completed: await this.reachable(),
      sdk_int: await read(async () => parseSdkInt(await this.adb.shell("getprop", "ro.build.version.sdk"))),
      locked: await read(() => this.adb.isLocked()),
      doze: await read(() => this.adb.dozeState()),
      deep_idle_enabled: await read(async () => parseEnabled(await this.adb.shell("dumpsys", "deviceidle", "enabled", "deep"))),
      battery_saver: await read(async () => (await this.adb.shell("settings", "get", "global", "low_power")).trim() === "1"),
      standby_bucket: await read(() => this.adb.standbyBucket(pkg)),
      app_version: await read(async () => parseVersionName(await this.adb.shell("dumpsys", "package", pkg))),
      ...(await read(async () => {
        const dump = await this.adb.shell("dumpsys", "package", PLAY_SERVICES);
        return { play_services_version: parseVersionCode(dump), play_services_version_name: parseVersionName(dump) };
      })) ?? { play_services_version: null, play_services_version_name: null },
    };
  }

  kill(): Promise<void> {
    return this.adb.kill(this.#o.pkg);
  }

  forceStop(): Promise<void> {
    return this.adb.forceStop(this.#o.pkg);
  }

  forceDoze(): Promise<void> {
    return this.adb.forceDoze();
  }

  exitDoze(): Promise<void> {
    return this.adb.exitDoze();
  }

  /** Deep Doze stepped to IDLE and through a maintenance window; resolves with the states it went through. */
  stepDoze(): Promise<string[]> {
    return this.adb.stepDeepIdle();
  }

  enableDoze(): Promise<void> {
    return this.adb.enableDoze();
  }

  waitForBoot(timeoutMs?: number): Promise<void> {
    return this.adb.waitForBoot(timeoutMs);
  }

  setStandbyBucket(bucket: StandbyBucket): Promise<void> {
    return this.adb.setStandbyBucket(this.#o.pkg, bucket);
  }

  batterySaver(on: boolean): Promise<void> {
    return this.adb.batterySaver(on);
  }

  async hibernate(on: boolean): Promise<void> {
    await this.adb.shell("cmd", "app_hibernation", "set-state", this.#o.pkg, on ? "true" : "false");
  }

  async notificationsAllowed(on: boolean): Promise<void> {
    await this.adb.shell("pm", on ? "grant" : "revoke", this.#o.pkg, "android.permission.POST_NOTIFICATIONS");
  }

  async callPermissionsAllowed(): Promise<void> {
    for (const permission of CALL_PERMISSIONS) await this.adb.shell("pm", "grant", this.#o.pkg, `android.permission.${permission}`);
  }

  lock(): Promise<void> {
    return this.adb.lock();
  }

  async unlock(): Promise<void> {
    const pin = this.#o.pin();
    if (!pin) throw new Error(`device ${this.name}: the rig's store has no lock PIN`);
    await this.adb.unlock(pin);
  }

  async reboot(options: { unlock?: boolean } = {}): Promise<void> {
    await this.adb.reboot();
    if (options.unlock ?? true) await this.unlock();
  }

  install(build: "current" | "previous"): Promise<string> {
    return this.adb.install(this.#o.apks[build]);
  }

  /** The installed build's declared Play services minimum, from the APK on the device; null when it declares none. */
  playServicesMinimum(): Promise<number | null> {
    return this.adb.manifestInteger(this.#o.pkg, PLAY_SERVICES_VERSION_META);
  }

  /** `run-as` reads it, which only a debuggable build allows; the nonprod debug build is one. */
  async pushToken(): Promise<string | null> {
    return parseFcmToken(await this.adb.shell("run-as", this.#o.pkg, "cat", FCM_TOKEN_PREFS));
  }

  async cryptoType(): Promise<string | null> {
    return (await this.adb.shell("getprop", "ro.crypto.type")).trim() || null;
  }

  async uninstall(): Promise<void> {
    await this.adb.shell("pm", "uninstall", this.#o.pkg);
  }

  async launch(path?: string): Promise<void> {
    if (path === undefined) {
      await this.adb.shell("monkey", "-p", this.#o.pkg, "-c", "android.intent.category.LAUNCHER", "1");
      return;
    }
    if (!/^\/[A-Za-z0-9/_-]*$/.test(path)) throw new Error(`device ${this.name}: ${path} is not an app path`);
    // The nonprod build's app links answer the inert host, so a deep link opens the app and nothing else.
    await this.adb.shell("am", "start", "-a", "android.intent.action.VIEW", "-d", `https://nonprod.invalid${path}`, this.#o.pkg);
  }

  /**
   * The app back at a known state. A failed run can leave the dialer sheet
   * open, a ring up or the shade down, and the next run's first tap lands on
   * that. Force-stop drops all of it, and the Telecom call the app held. The
   * app is launched again, because a stopped app is sent no push, and the
   * launcher is put in front of it. A build that is not installed (D10 removes
   * it on purpose) is not an error.
   */
  async resetUi(): Promise<void> {
    await this.adb.forceStop(this.#o.pkg);
    await this.adb.shell("cmd", "statusbar", "collapse");
    try {
      await this.launch();
      await this.#sleep(APP_SETTLE_MS);
    } catch {
      // Nothing to launch; the home key below still leaves a known screen.
    }
    await this.adb.shell("input", "keyevent", "KEYCODE_HOME");
  }

  async callState(): Promise<"ringing" | "active" | "holding" | "disconnected" | "none"> {
    return parseTelecomState(await this.adb.shell("dumpsys", "telecom"), this.#o.pkg);
  }

  async waitForRinging(timeoutMs: number): Promise<{ telecom_ms?: number; full_screen_ms?: number } | undefined> {
    const started = this.#now();
    const seen: { telecom_ms?: number; full_screen_ms?: number } = {};
    while (this.#now() - started <= timeoutMs) {
      if (seen.telecom_ms === undefined && (await this.callState()) === "ringing") seen.telecom_ms = this.#now() - started;
      if (seen.full_screen_ms === undefined && hasFullScreenNotification(await this.adb.shell("dumpsys", "notification", "--noredact"), this.#o.pkg)) {
        seen.full_screen_ms = this.#now() - started;
      }
      if (seen.telecom_ms !== undefined && seen.full_screen_ms !== undefined) return seen;
      await this.#sleep(500);
    }
    return seen.telecom_ms === undefined && seen.full_screen_ms === undefined ? undefined : seen;
  }

  async tap(id: CallTestId): Promise<boolean> {
    return this.#tapWhere((node) => hasTestId(node, id));
  }

  async tapText(text: string): Promise<boolean> {
    return this.#tapWhere((node) => node.text === text || node.description === text);
  }

  /** Taps the text field after the label that holds `label`, ignoring case: the app draws a field's label as a separate text. */
  async tapFieldLabelled(label: string): Promise<boolean> {
    const nodes = await this.#nodes();
    const at = nodes.findIndex((node) => node.text.toLowerCase().includes(label.toLowerCase()));
    const field = at === -1 ? undefined : nodes.slice(at + 1).find((node) => node.className.endsWith("EditText"));
    if (!field) return false;
    await this.#tapNode(field);
    return true;
  }

  async showing(target: { id: CallTestId } | { text: string }): Promise<boolean> {
    const nodes = await this.#nodes();
    return "id" in target
      ? nodes.some((node) => hasTestId(node, target.id))
      : nodes.some((node) => node.text.includes(target.text) || node.description.includes(target.text));
  }

  async type(text: string): Promise<void> {
    if (!/^[A-Za-z0-9 .@+_-]+$/.test(text)) throw new Error(`device ${this.name}: only plain text can be typed`);
    await this.adb.inputText(text.replace(/ /g, "%s"));
  }

  async #nodes(): Promise<UiNode[]> {
    const path = "/sdcard/rig-ui.xml";
    await this.adb.shell("uiautomator", "dump", path);
    return parseUiDump(await this.adb.shell("cat", path));
  }

  async #tapWhere(match: (node: UiNode) => boolean): Promise<boolean> {
    const node = (await this.#nodes()).find(match);
    if (!node) return false;
    await this.#tapNode(node);
    return true;
  }

  async #tapNode(node: UiNode): Promise<void> {
    const { x, y } = centre(node);
    await this.adb.shell("input", "tap", String(x), String(y));
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
