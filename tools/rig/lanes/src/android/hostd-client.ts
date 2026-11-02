/**
 * hostd, the rig's supervisor on the Windows host, as the VM reaches it:
 * through the reverse tunnel at 127.0.0.1:15900, with the bearer token in the
 * store's `hostd-token`. hostd starts and stops the emulators, so the VM never
 * runs an emulator binary itself. Device names are the contract's
 * (tools/rig/host/contract.json), and nothing else is sent.
 *
 * A token never appears in an error: errors name the request and its status.
 */
import { HOSTD_PORT, isRigDevice, type RigDeviceName } from "./devices.ts";

export const HOSTD_ORIGIN = `http://127.0.0.1:${HOSTD_PORT}`;

/** What hostd's /v1/health reports about the host. */
export interface HostdHealth {
  /** `emulator -accel-check` says WHPX is usable. */
  whpx_usable: boolean;
  /** The reverse tunnel into the VM is connected. */
  tunnel_up: boolean;
  /** Windows has an update waiting on a reboot; reported, not a failure. */
  reboot_pending: boolean;
}

export interface DeviceTokens {
  /** The emulator console's auth token. */
  console: string;
  /** The emulator's gRPC bearer token. */
  grpc: string;
}

/** A cold emulator takes minutes to boot, and hostd answers only once it has (its own limit is five). */
const BOOT_REQUEST_TIMEOUT_MS = 6 * 60 * 1000;

export interface HostdOptions {
  /** `http://127.0.0.1:<port>`, the tunnel's end. */
  origin?: string;
  token: () => string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** RIG_HOSTD_ORIGIN: plain http on loopback, which only the tunnel serves. */
export function parseHostdOrigin(text: string): string {
  const url = new URL(text.trim());
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/" || url.search || url.username) {
    throw new Error(`hostd: ${text} is not http://127.0.0.1:<port>, the tunnel's end`);
  }
  return url.origin;
}

export class HostdClient {
  readonly origin: string;
  readonly #o: HostdOptions;

  constructor(options: HostdOptions) {
    this.origin = parseHostdOrigin(options.origin ?? HOSTD_ORIGIN);
    this.#o = options;
  }

  async health(): Promise<HostdHealth> {
    const body = (await this.#request("GET", "/v1/health")) as {
      whpx?: { usable?: unknown };
      tunnel?: { up?: unknown };
      reboot_pending?: unknown;
    } | null;
    const whpx = body?.whpx?.usable;
    const tunnel = body?.tunnel?.up;
    const reboot = body?.reboot_pending;
    if (typeof whpx !== "boolean") throw new Error("hostd: /v1/health does not report whpx.usable");
    if (typeof tunnel !== "boolean") throw new Error("hostd: /v1/health does not report tunnel.up");
    if (typeof reboot !== "boolean") throw new Error("hostd: /v1/health does not report reboot_pending");
    return { whpx_usable: whpx, tunnel_up: tunnel, reboot_pending: reboot };
  }

  /** Starts the device's emulator; `cold` skips the snapshot, `wipe` also erases its data. */
  async boot(name: RigDeviceName, options: { cold: boolean; wipe: boolean }): Promise<void> {
    await this.#request("POST", `/v1/devices/${device(name)}/boot`, { cold: options.cold === true, wipe: options.wipe === true }, BOOT_REQUEST_TIMEOUT_MS);
  }

  /** Stops the device's emulator: through its console, or `hard` by ending the process. */
  async kill(name: RigDeviceName, options: { hard: boolean }): Promise<void> {
    await this.#request("POST", `/v1/devices/${device(name)}/kill`, { hard: options.hard === true });
  }

  /** The running emulator's console and gRPC tokens; each boot makes new ones. */
  async tokens(name: RigDeviceName): Promise<DeviceTokens> {
    const body = (await this.#request("GET", `/v1/devices/${device(name)}/tokens`)) as { console_token?: unknown; grpc_token?: unknown } | null;
    const consoleToken = body?.console_token;
    const grpcToken = body?.grpc_token;
    if (typeof consoleToken !== "string" || consoleToken === "" || typeof grpcToken !== "string" || grpcToken === "") {
      throw new Error(`hostd: /v1/devices/${name}/tokens does not hold a console and a gRPC token`);
    }
    return { console: consoleToken, grpc: grpcToken };
  }

  async #request(method: "GET" | "POST", path: string, body?: Record<string, boolean>, minTimeoutMs = 0): Promise<unknown> {
    const token = this.#o.token().trim();
    if (!token) throw new Error("hostd: the store's hostd-token is empty");
    let response: Response;
    try {
      response = await (this.#o.fetch ?? fetch)(`${this.origin}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(Math.max(this.#o.timeoutMs ?? 30_000, minTimeoutMs)),
      });
    } catch (error) {
      throw new Error(`hostd: ${method} ${path} got no answer (${error instanceof Error ? error.name : "error"}); is the tunnel up?`);
    }
    const text = await response.text();
    if (!response.ok) throw new Error(`hostd: ${method} ${path} answered ${response.status}`);
    if (text === "") return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`hostd: ${method} ${path} answered with something that is not JSON`);
    }
  }
}

function device(name: string): string {
  if (!isRigDevice(name)) throw new Error(`hostd: ${name} is not one of the rig's devices`);
  return name;
}
