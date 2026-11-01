/**
 * An emulator's console, the telnet-style port the emulator opens beside adb.
 * hostd tunnels each console port to the same port on the VM's loopback.
 *
 * Every connection authenticates with the console's token, and every reply
 * ends in a line that is `OK` or `KO: <why>`, so a reply in any other shape
 * is an error rather than a guess. Only the commands below are ever sent.
 *
 * The console shapes the emulated cellular and Ethernet paths: delay and
 * bandwidth. It has no packet-loss control and nothing for Wi-Fi, which adb's
 * `svc wifi` turns off and on instead. A loss is refused (X27) rather than
 * approximated.
 */
import { connect, type Socket } from "node:net";
import type { Adb } from "./adb.ts";

export const PACKET_LOSS_REFUSED = "emulator: packet loss has no emulator control (X27)";

const COMMANDS: readonly RegExp[] = [
  /^network delay (?:none|\d{1,4})$/,
  /^network speed (?:full|\d{1,7}:\d{1,7})$/,
  /^gsm data (?:unregistered|home)$/,
  /^power ac (?:on|off)$/,
  /^power status (?:discharging|charging)$/,
  /^power capacity (?:100|[1-9]?\d)$/,
  // The emulated modem's calls go nowhere, and the number is a fictional one anyway.
  /^gsm (?:call|cancel) \+1\d{3}55501\d{2}$/,
  /^kill$/,
];

export interface NetworkShape {
  delayMs: number;
  speedKbps: { up: number; down: number };
  /** Never honoured: present only so a request for loss is refused by name. */
  lossPercent?: number;
}

export interface ConsoleReply {
  status: "OK" | "KO";
  /** The text after `OK:` or `KO:`, if any. */
  message: string;
  /** The lines before the status line. */
  body: string[];
}

export interface EmulatorConsoleOptions {
  /** The console port, which is also the device's adb serial's number. */
  port: number;
  /** The console's auth token, from hostd. */
  token: () => string | Promise<string>;
  /** For Wi-Fi, which the console does not reach. */
  adb: Pick<Adb, "shell">;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  connect?: (port: number) => Socket;
}

/** Reads a console's replies line by line, each ending at its OK or KO line. */
class Replies {
  #partial = "";
  readonly #lines: string[] = [];
  #closed = false;
  #error: Error | undefined;
  #wake: (() => void) | undefined;

  constructor(socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      const parts = (this.#partial + chunk).split(/\r?\n/);
      this.#partial = parts.pop() ?? "";
      this.#lines.push(...parts);
      this.#notify();
    });
    socket.on("close", () => {
      this.#closed = true;
      this.#notify();
    });
    socket.on("error", (error) => {
      this.#error = error;
      this.#notify();
    });
  }

  get closed(): boolean {
    return this.#closed;
  }

  async next(timeoutMs: number): Promise<ConsoleReply> {
    const body: string[] = [];
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      while (this.#lines.length > 0) {
        const line = this.#lines.shift()!;
        const status = /^(OK|KO)(?::\s?(.*))?$/.exec(line.trim());
        if (status) return { status: status[1] as "OK" | "KO", message: status[2]?.trim() ?? "", body };
        body.push(line);
      }
      if (this.#error) throw new Error(`emulator console: ${this.#error.message}`);
      if (this.#closed) throw new Error("emulator console: the connection closed before an OK or KO");
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("emulator console: no OK or KO in time");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.#wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }

  #notify(): void {
    const wake = this.#wake;
    this.#wake = undefined;
    wake?.();
  }
}

export class EmulatorConsole {
  readonly port: number;
  readonly #o: EmulatorConsoleOptions;
  readonly #sleep: (ms: number) => Promise<void>;
  #shaped: NetworkShape | null = null;

  constructor(options: EmulatorConsoleOptions) {
    if (!Number.isInteger(options.port) || options.port < 5554 || options.port > 5682 || options.port % 2) {
      throw new Error("emulator console: console ports are even, 5554-5682");
    }
    this.port = options.port;
    this.#o = options;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Sends commands on one authenticated connection; a KO stops there and throws. */
  async send(...commands: string[]): Promise<ConsoleReply[]> {
    for (const command of commands) {
      if (!COMMANDS.some((allowed) => allowed.test(command))) throw new Error(`emulator console: refusing "${command}"`);
    }
    const token = await this.#o.token();
    if (!/^[A-Za-z0-9+/=_-]{1,256}$/.test(token)) throw new Error("emulator console: the auth token is not a token");
    const timeoutMs = this.#o.timeoutMs ?? 10_000;
    const socket = (this.#o.connect ?? ((port) => connect({ host: "127.0.0.1", port })))(this.port);
    const replies = new Replies(socket);
    try {
      await replies.next(timeoutMs);
      socket.write(`auth ${token}\n`);
      const auth = await replies.next(timeoutMs);
      if (auth.status !== "OK") throw new Error(`emulator console on ${this.port} refused the auth token`);
      const answered: ConsoleReply[] = [];
      for (const command of commands) {
        socket.write(`${command}\n`);
        if (command === "kill") {
          // The emulator may exit before its OK reaches us; the connection closing is the answer.
          const reply = await replies.next(timeoutMs).catch((error: Error) => {
            if (replies.closed) return { status: "OK" as const, message: "closed", body: [] };
            throw error;
          });
          answered.push(reply);
          if (reply.status === "KO") throw new Error(`emulator console: kill answered KO: ${reply.message}`);
          break;
        }
        const reply = await replies.next(timeoutMs);
        if (reply.status === "KO") throw new Error(`emulator console: "${command}" answered KO: ${reply.message || "no reason"}`);
        answered.push(reply);
      }
      return answered;
    } finally {
      socket.destroy();
    }
  }

  async networkDelay(ms: number | null): Promise<void> {
    if (ms !== null && !(Number.isInteger(ms) && ms >= 0 && ms <= 5_000)) throw new Error("emulator console: a delay is 0-5000 ms");
    await this.send(`network delay ${ms ?? "none"}`);
  }

  async networkSpeed(kbps: { up: number; down: number } | null): Promise<void> {
    if (kbps !== null) assertKbps(kbps);
    await this.send(`network speed ${kbps ? `${kbps.up}:${kbps.down}` : "full"}`);
  }

  async gsmData(state: "unregistered" | "home"): Promise<void> {
    await this.send(`gsm data ${state}`);
  }

  async powerAc(on: boolean): Promise<void> {
    await this.send(`power ac ${on ? "on" : "off"}`);
  }

  async powerStatus(status: "discharging" | "charging"): Promise<void> {
    await this.send(`power status ${status}`);
  }

  async powerCapacity(percent: number): Promise<void> {
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error("emulator console: capacity is 0-100");
    await this.send(`power capacity ${percent}`);
  }

  async gsmCall(e164: string): Promise<void> {
    await this.send(`gsm call ${e164}`);
  }

  async gsmCancel(e164: string): Promise<void> {
    await this.send(`gsm cancel ${e164}`);
  }

  async kill(): Promise<void> {
    await this.send("kill");
  }

  /**
   * Delay and bandwidth on the emulated network, or null for the network at
   * rest: no delay, full speed, cellular registered and Wi-Fi on, whatever a
   * run killed half way left.
   */
  async shape(shape: NetworkShape | null): Promise<void> {
    if (shape === null) {
      await this.send("network delay none", "network speed full", "gsm data home");
      await this.#o.adb.shell("svc", "wifi", "enable");
      this.#shaped = null;
      return;
    }
    if (shape.lossPercent !== undefined && shape.lossPercent !== 0) throw new Error(PACKET_LOSS_REFUSED);
    if (!(Number.isInteger(shape.delayMs) && shape.delayMs >= 0 && shape.delayMs <= 5_000)) throw new Error("emulator console: a delay is 0-5000 ms");
    assertKbps(shape.speedKbps);
    await this.send(`network delay ${shape.delayMs}`, `network speed ${shape.speedKbps.up}:${shape.speedKbps.down}`);
    this.#shaped = { delayMs: shape.delayMs, speedKbps: { ...shape.speedKbps } };
  }

  /** The shaping in force, as `shape` last set it. */
  get shaped(): NetworkShape | null {
    return this.#shaped;
  }

  /** No network at all for that long: Wi-Fi off and cellular unregistered, both given back whatever happens. */
  async outage(ms: number): Promise<void> {
    await this.#without(ms, [
      { what: "Wi-Fi", off: () => this.#o.adb.shell("svc", "wifi", "disable"), on: () => this.#o.adb.shell("svc", "wifi", "enable") },
      { what: "cellular data", off: () => this.gsmData("unregistered"), on: () => this.gsmData("home") },
    ]);
  }

  /** Wi-Fi off for that long with cellular up, so Android moves the call to cellular. */
  async wifiDrop(ms: number): Promise<void> {
    await this.#without(ms, [
      { what: "Wi-Fi", off: () => this.#o.adb.shell("svc", "wifi", "disable"), on: () => this.#o.adb.shell("svc", "wifi", "enable") },
    ]);
  }

  async #without(ms: number, links: { what: string; off: () => Promise<unknown>; on: () => Promise<unknown> }[]): Promise<void> {
    if (!Number.isInteger(ms) || ms < 0 || ms > 60_000) throw new Error("emulator console: an outage is 0-60000 ms");
    let failure: unknown;
    try {
      for (const link of links) await link.off();
      await this.#sleep(ms);
    } catch (error) {
      failure = error;
    }
    const unrestored: string[] = [];
    for (const link of links) {
      try {
        await link.on();
      } catch (error) {
        unrestored.push(`${link.what}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (unrestored.length > 0) {
      const cause = failure instanceof Error ? `${failure.message}; ` : "";
      throw new Error(`emulator console: ${cause}could not restore ${unrestored.join("; ")}`);
    }
    if (failure) throw failure;
  }
}

function assertKbps(kbps: { up: number; down: number }): void {
  for (const value of [kbps.up, kbps.down]) {
    if (!Number.isInteger(value) || value < 1 || value > 1_000_000) throw new Error("emulator console: a speed is 1-1000000 kbps");
  }
}
