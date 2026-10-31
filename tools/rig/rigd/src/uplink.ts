/**
 * The rig's one connection to the internet that anything arrives on: a
 * WebSocket rigd dials out to the edge (EDGE_PATHS.ctlUplink), so nothing on
 * the rig listens publicly.
 *
 * The edge (tools/edge/src/uplink.ts) waits 9 s for a call event, 20 s for
 * media and 60 s for an rpc, and keeps one socket: a new connection closes the
 * old one. Call and robot-call events are answered inside
 * CALL_EVENT_RELAY_TIMEOUT_MS whatever happens locally; a late answer is a 503,
 * which Telnyx retries and fails over. Texts, robot webhooks and mail are
 * queued at the edge and acked only once the local side has taken them, so a
 * failure here leaves the frame in the edge's queue for its next attempt.
 */
import {
  CALL_EVENT_RELAY_TIMEOUT_MS,
  EDGE_PATHS,
  type EdgeToRig,
  type HeartbeatComponent,
  type RigToEdge,
  WEBHOOK_KINDS,
} from "@loonext/rig-protocol";
import { systemClock, type Clock } from "@loonext/rig-robot";

export type WebhookFrame = Extract<EdgeToRig, { t: "webhook" }>;
export type MediaFrame = Extract<EdgeToRig, { t: "media" }>;
export type MailFrame = Extract<EdgeToRig, { t: "mail" }>;
export type RpcFrame = Extract<EdgeToRig, { t: "rpc" }>;
export type MediaResult = Omit<Extract<RigToEdge, { t: "media-result" }>, "t" | "id">;

export interface WebhookResult {
  status: number;
  body?: string;
  /**
   * Refused only because Telnyx's genuine signature aged out in the queue:
   * recorded, never acked. The edge offers such a text once and drops it.
   */
  late?: boolean;
}

export interface UplinkHandlers {
  webhook(frame: WebhookFrame): Promise<WebhookResult>;
  media(frame: MediaFrame): Promise<MediaResult>;
  mail(frame: MailFrame): Promise<void>;
  /** Throws to answer with an error. */
  rpc(frame: RpcFrame): Promise<unknown>;
}

/** The part of a WebSocket the uplink uses, so tests can hand it a fake. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "error", listener: () => void): void;
  addEventListener(type: "close", listener: (event: { code?: number }) => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

export type SocketFactory = (url: string, token: string) => SocketLike;

/**
 * Node's own WebSocket (undici). Its second argument may be an init object
 * with headers, which the DOM signature does not declare; that is how the
 * bearer reaches the edge without a query string.
 */
const NodeWebSocket = WebSocket as unknown as new (
  url: string,
  init: { headers: Record<string, string> },
) => SocketLike;

export const nodeSocket: SocketFactory = (url, token) =>
  new NodeWebSocket(url, { headers: { authorization: `Bearer ${token}` } });

const OPEN = 1;

export interface UplinkOptions {
  edgeOrigin: string;
  token: string;
  handlers: UplinkHandlers;
  socket?: SocketFactory;
  clock?: Clock;
  heartbeatMs?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /** A connection must stay up this long before the backoff resets. */
  stableMs?: number;
  random?: () => number;
  log?: (line: string) => void;
  /** Told whenever the socket opens, drops or beats, for `state/uplink.json`. */
  onState?: (connected: boolean) => void;
}

/** The edge stops waiting for an rpc at 60 s; answering first keeps the error ours. */
const RPC_DEADLINE_MS = 55_000;
/** The edge's close code when a newer rig connection replaced this one. */
const REPLACED = 4000;

export function uplinkUrl(edgeOrigin: string): string {
  return `${edgeOrigin.replace(/\/+$/, "").replace(/^http/, "ws")}${EDGE_PATHS.ctlUplink}`;
}

export class Uplink {
  readonly #o: UplinkOptions;
  readonly #clock: Clock;
  readonly #factory: SocketFactory;
  #socket: SocketLike | undefined;
  #attempt = 0;
  #stopped = true;
  #cancelReconnect: (() => void) | undefined;
  #cancelHeartbeat: (() => void) | undefined;
  #cancelStable: (() => void) | undefined;
  /** Queued frames being handled now; a redelivery during handling is not handled twice. */
  readonly #inFlight = new Set<string>();

  constructor(options: UplinkOptions) {
    this.#o = options;
    this.#clock = options.clock ?? systemClock;
    this.#factory = options.socket ?? nodeSocket;
  }

  get connected(): boolean {
    return this.#socket?.readyState === OPEN;
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    this.#cancelReconnect?.();
    this.#cancelHeartbeat?.();
    this.#cancelStable?.();
    this.#socket?.close(1000, "rigd stopping");
    this.#socket = undefined;
  }

  /** `at` is when the component last did its work; the rig's own beat is now. */
  heartbeat(component: HeartbeatComponent, at: number = this.#clock.now()): void {
    this.#send({ t: "heartbeat", component, at: new Date(at).toISOString() });
  }

  #connect(): void {
    const socket = this.#factory(uplinkUrl(this.#o.edgeOrigin), this.#o.token);
    this.#socket = socket;
    socket.addEventListener("open", () => {
      this.#log("uplink open");
      this.#cancelStable = this.#clock.after(this.#o.stableMs ?? 10_000, () => {
        this.#attempt = 0;
      });
      this.heartbeat("rig");
      this.#o.onState?.(true);
      this.#scheduleHeartbeat();
    });
    socket.addEventListener("message", (event) => {
      void this.#onMessage(event.data);
    });
    const lost = (event?: { code?: number }) => {
      if (this.#socket !== socket) return;
      if (event?.code === REPLACED) this.#log("uplink replaced by another rig connection");
      this.#socket = undefined;
      this.#o.onState?.(false);
      this.#cancelHeartbeat?.();
      this.#cancelStable?.();
      if (!this.#stopped) this.#scheduleReconnect();
    };
    socket.addEventListener("close", lost);
    socket.addEventListener("error", () => lost());
  }

  #scheduleReconnect(): void {
    const initial = this.#o.initialBackoffMs ?? 1_000;
    const max = this.#o.maxBackoffMs ?? 60_000;
    const ceiling = Math.min(max, initial * 2 ** this.#attempt);
    this.#attempt++;
    // Full jitter, never under the initial delay: a fleet of one still should not hammer.
    const wait = Math.max(initial, Math.round((this.#o.random ?? Math.random)() * ceiling));
    this.#log(`uplink lost; reconnecting in ${wait} ms`);
    this.#cancelReconnect = this.#clock.after(wait, () => {
      if (!this.#stopped) this.#connect();
    });
  }

  #scheduleHeartbeat(): void {
    this.#cancelHeartbeat = this.#clock.after(this.#o.heartbeatMs ?? 60_000, () => {
      if (!this.connected) return;
      this.heartbeat("rig");
      this.#o.onState?.(true);
      this.#scheduleHeartbeat();
    });
  }

  async #onMessage(data: unknown): Promise<void> {
    const frame = parseFrame(data);
    if (!frame) {
      this.#log("uplink: dropped a frame that is not a known shape");
      return;
    }
    switch (frame.t) {
      case "ping":
        this.heartbeat("rig");
        return;
      case "webhook":
        return frame.kind === "call" || frame.kind === "robot-call"
          ? this.#callEvent(frame)
          : this.#queued(frame.id, () => this.#webhookAck(frame));
      case "mail":
        return this.#queued(frame.id, async () => {
          await this.#o.handlers.mail(frame);
          return true;
        });
      case "media":
        return this.#media(frame);
      case "rpc":
        return this.#rpc(frame);
    }
  }

  async #callEvent(frame: WebhookFrame): Promise<void> {
    let cancel: (() => void) | undefined;
    const late = new Promise<{ status: number; body?: string }>((resolve) => {
      cancel = this.#clock.after(CALL_EVENT_RELAY_TIMEOUT_MS, () => resolve({ status: 503 }));
    });
    const result: { status: number; body?: string } = await Promise.race([
      this.#o.handlers.webhook(frame).catch(() => ({ status: 503 })),
      late,
    ]);
    cancel?.();
    this.#send({ t: "webhook-result", id: frame.id, status: result.status, body: result.body });
  }

  async #webhookAck(frame: WebhookFrame): Promise<boolean> {
    const result = await this.#o.handlers.webhook(frame);
    return result.status >= 200 && result.status < 300;
  }

  async #queued(id: string, handle: () => Promise<boolean>): Promise<void> {
    if (this.#inFlight.has(id)) return;
    this.#inFlight.add(id);
    try {
      if (await handle()) this.#send({ t: "ack", id });
    } catch (error) {
      this.#log(`uplink: queued ${id} not taken (${error instanceof Error ? error.message : "error"}); the edge retries`);
    } finally {
      this.#inFlight.delete(id);
    }
  }

  async #media(frame: MediaFrame): Promise<void> {
    const result = await this.#o.handlers.media(frame).catch(() => ({ status: 502 }) as MediaResult);
    this.#send({ t: "media-result", id: frame.id, ...result });
  }

  async #rpc(frame: RpcFrame): Promise<void> {
    let cancel: (() => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      cancel = this.#clock.after(RPC_DEADLINE_MS, () => reject(new Error("rpc_timeout")));
    });
    try {
      const result = await Promise.race([this.#o.handlers.rpc(frame), deadline]);
      this.#send({ t: "rpc-result", id: frame.id, ok: true, result: result ?? null });
    } catch (error) {
      this.#send({ t: "rpc-result", id: frame.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      cancel?.();
    }
  }

  #send(frame: RigToEdge): void {
    const socket = this.#socket;
    if (!socket || socket.readyState !== OPEN) return;
    socket.send(JSON.stringify(frame));
  }

  #log(line: string): void {
    this.#o.log?.(line);
  }
}

/** A frame from the edge, or undefined for anything not in the protocol. */
export function parseFrame(data: unknown): EdgeToRig | undefined {
  let value: unknown;
  try {
    value = JSON.parse(typeof data === "string" ? data : Buffer.from(data as ArrayBuffer).toString("utf8"));
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const f = value as Record<string, unknown>;
  const s = (key: string) => typeof f[key] === "string";
  switch (f.t) {
    case "webhook":
      return s("id") &&
        typeof f.kind === "string" &&
        (WEBHOOK_KINDS as readonly string[]).includes(f.kind) &&
        s("path") &&
        s("body") &&
        typeof f.attempt === "number" &&
        isStringMap(f.headers)
        ? (value as EdgeToRig)
        : undefined;
    case "media":
      return s("id") && s("path") ? (value as EdgeToRig) : undefined;
    case "mail":
      return s("id") && s("to") && s("from") && s("subject") && s("raw") ? (value as EdgeToRig) : undefined;
    case "rpc":
      return s("id") && s("method") ? (value as EdgeToRig) : undefined;
    case "ping":
      return s("at") ? (value as EdgeToRig) : undefined;
    default:
      return undefined;
  }
}

function isStringMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}
