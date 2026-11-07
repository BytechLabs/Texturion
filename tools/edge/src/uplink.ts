import { DurableObject } from "cloudflare:workers";
import {
  type ControlClass,
  type EdgeToRig,
  MEDIA_MAX_BYTES,
  QUEUED_DELIVERY_MAX_AGE_MS,
  type RigToEdge,
  TELNYX_SIGNATURE_WINDOW_S,
} from "@loonext/rig-protocol";

import type { Env } from "./env";
import { relayStatus } from "./http";

/**
 * One Durable Object holding `rigd`'s outbound WebSocket, hibernating between
 * frames, plus everything the edge remembers between requests.
 *
 * Call events, media and rpc are exchanges: a frame goes down and the edge
 * waits for the answer with the same id. Text events, robot webhooks and mail
 * are stored before the sender is told "accepted", then redelivered until the
 * rig acks them or {@link QUEUED_DELIVERY_MAX_AGE_MS} passes. A text event
 * carries Telnyx's own signature, which the rig's API accepts for five minutes
 * only, so a text is offered once more after that and then dropped.
 *
 * It never calls the guard; the Worker does, so policy stays in one place.
 */

type WebhookFrame = Extract<EdgeToRig, { t: "webhook" }>;
type MailFrame = Extract<EdgeToRig, { t: "mail" }>;
type QueuedFrame = Omit<WebhookFrame, "id" | "attempt"> | Omit<MailFrame, "id">;
type RpcFrame = Extract<EdgeToRig, { t: "rpc" }>;

export interface CallRelay {
  eventId: string;
  kind: "call" | "robot-call";
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface QueuedWebhook {
  dedupeKey: string;
  kind: "message" | "robot-webhook";
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface QueuedMail {
  dedupeKey: string;
  to: string;
  from: string;
  subject: string;
  raw: string;
}

export type EnqueueOutcome = "queued" | "duplicate" | "full";

export interface MediaOutcome {
  status: number;
  contentType?: string;
  body?: Uint8Array;
}

export type RpcOutcome =
  | { status: "ok"; result: unknown }
  | { status: "error"; error: string }
  | { status: "offline" }
  | { status: "timeout" };

export interface StrangerRecord {
  kind: "call" | "text";
  /** Our number the stranger reached, when the event names one. */
  ours: string | null;
  /** Their number. Kept only as a keyed hash. */
  theirs: string;
}

export interface UplinkSnapshot {
  connected: boolean;
  queueDepth: number;
  counters: Record<string, number>;
}

const RIG_TAG = "rig";
const OPEN = 1;

const QUEUE_MAX = 2_000;
const FLUSH_BATCH = 50;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 15 * 60 * 1000;
const MEDIA_TIMEOUT_MS = 20_000;
const RPC_TIMEOUT_MS = 60_000;
const SEEN_TTL_MS = QUEUED_DELIVERY_MAX_AGE_MS;

/** Stranger calls and texts to one of our numbers in a day before the guard detaches it. */
export const STRANGER_DETACH_THRESHOLD = 5;
export const STRANGER_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A detach the guard did not act on is asked for again after this long. */
const DETACH_REPEAT_MS = 60 * 60 * 1000;
const STRANGER_SENDERS_MAX = 1_000;
const NOTICES_MAX = 100;
/** How long a call relay that timed out can still be answered and remembered. */
const LATE_CALL_MEMORY_MS = 15 * 60 * 1000;
const TELNYX_SIGNATURE_WINDOW_MS = TELNYX_SIGNATURE_WINDOW_S * 1000;
/** Redelivery backoff after the nth unacked attempt: 30 s doubling to 15 min. */
export function retryDelay(attempts: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

/** At most {@link MEDIA_MAX_BYTES} of decoded media, or null. */
export function decodeMedia(bodyB64: unknown): Uint8Array | null {
  if (bodyB64 === undefined) return new Uint8Array(0);
  if (typeof bodyB64 !== "string") return null;
  if (bodyB64.length > Math.ceil(MEDIA_MAX_BYTES / 3) * 4) return null;
  try {
    const bytes = Uint8Array.from(atob(bodyB64), (char) => char.charCodeAt(0));
    return bytes.byteLength <= MEDIA_MAX_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

/** A frame from the rig, or null when it is not one. */
export function parseRigFrame(message: string | ArrayBuffer): RigToEdge | null {
  if (typeof message !== "string") return null;
  let frame: unknown;
  try {
    frame = JSON.parse(message);
  } catch {
    return null;
  }
  const f = frame as Record<string, unknown> | null;
  if (!f || typeof f !== "object") return null;
  if (typeof f.id !== "string" || f.id === "") return null;
  if (f.t === "ack") return f as unknown as RigToEdge;
  if (f.t === "webhook-result" || f.t === "media-result") {
    return typeof f.status === "number" ? (f as unknown as RigToEdge) : null;
  }
  if (f.t === "rpc-result") {
    if (f.ok === true) return f as unknown as RigToEdge;
    return f.ok === false && typeof f.error === "string" ? (f as unknown as RigToEdge) : null;
  }
  return null;
}

/** Whether a queued frame carries a Telnyx signature the rig's API would now refuse as too old. */
export function signatureLapsed(frame: EdgeToRig, now: number): boolean {
  if (frame.t !== "webhook") return false;
  const header = frame.headers["telnyx-timestamp"];
  if (header === undefined || !/^\d{1,12}$/.test(header)) return false;
  return now - Number(header) * 1000 > TELNYX_SIGNATURE_WINDOW_MS;
}

interface Pending {
  resolve: (frame: RigToEdge | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RigUplink extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private readonly pending = new Map<string, Pending>();
  /** Call events relayed and not yet answered, by dedupe key. */
  private readonly inFlight = new Set<string>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    for (const statement of [
      "CREATE TABLE IF NOT EXISTS queue (id TEXT PRIMARY KEY, frame TEXT NOT NULL, first_at INTEGER NOT NULL, next_at INTEGER NOT NULL, attempts INTEGER NOT NULL)",
      "CREATE TABLE IF NOT EXISTS seen (key TEXT PRIMARY KEY, at INTEGER NOT NULL)",
      "CREATE TABLE IF NOT EXISTS late_calls (id TEXT PRIMARY KEY, key TEXT NOT NULL, at INTEGER NOT NULL)",
      "CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, n INTEGER NOT NULL)",
      "CREATE TABLE IF NOT EXISTS strangers (e164 TEXT PRIMARY KEY, window_start INTEGER NOT NULL, n INTEGER NOT NULL, detach_at INTEGER)",
      "CREATE TABLE IF NOT EXISTS stranger_senders (hash TEXT PRIMARY KEY, n INTEGER NOT NULL, last_at INTEGER NOT NULL)",
      "CREATE TABLE IF NOT EXISTS notices (key TEXT PRIMARY KEY, name TEXT NOT NULL, at INTEGER NOT NULL, outcome TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    ]) {
      this.sql.exec(statement);
    }
    // Drop what older edges kept: heartbeat rows, the arming time, and the
    // alert times and daily event counts that once throttled PostHog sends.
    this.sql.exec("DROP TABLE IF EXISTS heartbeats");
    this.sql.exec("DELETE FROM meta WHERE key = 'armed_at' OR key LIKE 'alert:%' OR key LIKE 'alert-failed:%'");
    this.sql.exec("DELETE FROM counters WHERE name LIKE 'events.sent.%'");
  }

  // ---------------------------------------------------------------------------
  // The socket.

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response(null, { status: 426 });
    }
    const now = Date.now();
    for (const old of this.ctx.getWebSockets(RIG_TAG)) {
      try {
        old.close(4000, "replaced");
      } catch {
        // Already closing.
      }
    }
    // Frames sent on the old socket will never be answered on the new one.
    this.failPending();

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [RIG_TAG]);
    server.serializeAttachment({ connectedAt: now });
    this.count("uplink.connected");

    this.sql.exec("UPDATE queue SET next_at = ?", now);
    this.flush(now);
    await this.schedule(now);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const frame = parseRigFrame(message);
    if (!frame) {
      this.count("uplink.bad_frame");
      return;
    }
    if (frame.t === "ack") {
      this.acked(frame.id);
      return;
    }
    if (this.settle(frame.id, frame)) return;
    if (frame.t !== "webhook-result") return;
    if (this.lateCallAnswer(frame.id, frame.status)) return;
    if (frame.status >= 200 && frame.status < 300) this.acked(frame.id);
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.count("uplink.closed");
    try {
      ws.close(1000, "closed");
    } catch {
      // The peer is gone; nothing to complete.
    }
    if (!this.socket()) this.failPending();
    await this.schedule(Date.now());
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    await this.webSocketClose(ws, 1011, "error", false);
  }

  /** The newest open rig socket, if any. */
  private socket(): WebSocket | null {
    let best: WebSocket | null = null;
    let bestAt = -1;
    for (const ws of this.ctx.getWebSockets(RIG_TAG)) {
      if (ws.readyState !== OPEN) continue;
      const at = (ws.deserializeAttachment() as { connectedAt?: number } | null)?.connectedAt ?? 0;
      if (at > bestAt) {
        best = ws;
        bestAt = at;
      }
    }
    return best;
  }

  /** Sends a frame and waits for the rig's frame with the same id; null on silence. */
  private exchange(ws: WebSocket, frame: EdgeToRig & { id: string }, timeoutMs: number): Promise<RigToEdge | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(frame.id);
        resolve(null);
      }, timeoutMs);
      this.pending.set(frame.id, { resolve, timer });
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        this.settle(frame.id, null);
      }
    });
  }

  private settle(id: string, frame: RigToEdge | null): boolean {
    const waiting = this.pending.get(id);
    if (!waiting) return false;
    clearTimeout(waiting.timer);
    this.pending.delete(id);
    waiting.resolve(frame);
    return true;
  }

  private failPending(): void {
    for (const id of [...this.pending.keys()]) this.settle(id, null);
  }

  // ---------------------------------------------------------------------------
  // Call events: synchronous, answered with the rig's own status.

  /** Relays a call event and waits up to `timeoutMs`, what is left of Telnyx's 10 seconds. */
  async relayCall(input: CallRelay, timeoutMs: number): Promise<{ status: number; duplicate: boolean }> {
    const key = `event:${input.eventId}`;
    if (this.isSeen(key, Date.now())) {
      this.count("call.duplicate");
      return { status: 200, duplicate: true };
    }
    // Telnyx's retry or failover of an event the rig is still handling: 503
    // brings it back once the first answer has decided whether it is needed.
    if (this.inFlight.has(key)) {
      this.count("call.in_flight");
      return { status: 503, duplicate: false };
    }
    const ws = this.socket();
    if (!ws) {
      this.count("call.rig_offline");
      return { status: 503, duplicate: false };
    }
    const id = crypto.randomUUID();
    this.inFlight.add(key);
    let reply: RigToEdge | null;
    try {
      reply = await this.exchange(
        ws,
        { t: "webhook", id, kind: input.kind, path: input.path, headers: input.headers, body: input.body, attempt: 1 },
        timeoutMs,
      );
    } finally {
      this.inFlight.delete(key);
    }
    if (!reply || reply.t !== "webhook-result") {
      // The rig may still answer. A late 2xx means the event was handled, so
      // Telnyx's retry of it must not be relayed again.
      this.sql.exec("INSERT OR REPLACE INTO late_calls (id, key, at) VALUES (?, ?, ?)", id, key, Date.now());
      this.count("call.no_answer");
      return { status: 503, duplicate: false };
    }
    const status = relayStatus(reply.status);
    if (status >= 200 && status < 300) this.markSeen(key, Date.now());
    this.count("call.relayed");
    return { status, duplicate: false };
  }

  /** True when `id` was a call relay that had timed out; a 2xx then marks its event seen. */
  private lateCallAnswer(id: string, status: number): boolean {
    const row = this.sql.exec<{ key: string }>("SELECT key FROM late_calls WHERE id = ?", id).toArray()[0];
    if (!row) return false;
    this.sql.exec("DELETE FROM late_calls WHERE id = ?", id);
    this.count("call.late_answer");
    if (status >= 200 && status < 300) this.markSeen(row.key, Date.now());
    return true;
  }

  // ---------------------------------------------------------------------------
  // Queued deliveries: acked to the sender once stored, retried until acked.

  async enqueueWebhook(item: QueuedWebhook): Promise<EnqueueOutcome> {
    return this.enqueue(item.dedupeKey, {
      t: "webhook",
      kind: item.kind,
      path: item.path,
      headers: item.headers,
      body: item.body,
    });
  }

  async enqueueMail(item: QueuedMail): Promise<EnqueueOutcome> {
    return this.enqueue(item.dedupeKey, {
      t: "mail",
      to: item.to,
      from: item.from,
      subject: item.subject,
      raw: item.raw,
    });
  }

  private async enqueue(dedupeKey: string, frame: QueuedFrame): Promise<EnqueueOutcome> {
    const now = Date.now();
    if (this.isSeen(dedupeKey, now)) {
      this.count("queue.duplicate");
      return "duplicate";
    }
    if (this.number("SELECT COUNT(*) AS n FROM queue") >= QUEUE_MAX) {
      this.count("queue.full");
      return "full";
    }
    const id = crypto.randomUUID();
    this.sql.exec(
      "INSERT INTO queue (id, frame, first_at, next_at, attempts) VALUES (?, ?, ?, ?, 0)",
      id,
      JSON.stringify({ ...frame, id }),
      now,
      now,
    );
    this.markSeen(dedupeKey, now);
    this.count("queue.accepted");
    this.flush(now);
    await this.schedule(now);
    return "queued";
  }

  private flush(now: number): void {
    this.expire(now);
    const ws = this.socket();
    if (!ws) return;
    const due = this.sql
      .exec<{ id: string; frame: string; attempts: number }>(
        "SELECT id, frame, attempts FROM queue WHERE next_at <= ? ORDER BY first_at LIMIT ?",
        now,
        FLUSH_BATCH,
      )
      .toArray();
    for (const row of due) {
      const attempts = row.attempts + 1;
      const frame = JSON.parse(row.frame) as EdgeToRig;
      if (frame.t === "webhook") frame.attempt = attempts;
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        return;
      }
      if (signatureLapsed(frame, now)) {
        // The rig's API refuses this signature from now on, so this was the
        // last offer; rigd records the text as lost to the delay.
        this.sql.exec("DELETE FROM queue WHERE id = ?", row.id);
        this.count("queue.signature_lapsed");
        continue;
      }
      this.sql.exec(
        "UPDATE queue SET attempts = ?, next_at = ? WHERE id = ?",
        attempts,
        now + retryDelay(attempts),
        row.id,
      );
    }
  }

  private expire(now: number): void {
    const cutoff = now - QUEUED_DELIVERY_MAX_AGE_MS;
    const expired = this.number("SELECT COUNT(*) AS n FROM queue WHERE first_at <= ?", cutoff);
    if (expired > 0) {
      this.sql.exec("DELETE FROM queue WHERE first_at <= ?", cutoff);
      this.count("queue.expired", expired);
    }
  }

  private acked(id: string): void {
    if (this.sql.exec("DELETE FROM queue WHERE id = ?", id).rowsWritten > 0) {
      this.count("queue.delivered");
    }
  }

  /**
   * Connected: wake for the next redelivery. Offline: wake only when the
   * oldest entry expires; reconnecting flushes everything at once.
   */
  private async schedule(now: number): Promise<void> {
    const connected = this.socket() !== null;
    const at = this.sql
      .exec<{ at: number | null }>(
        connected ? "SELECT MIN(next_at) AS at FROM queue" : "SELECT MIN(first_at) AS at FROM queue",
      )
      .one().at;
    if (at === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const wake = connected ? at : at + QUEUED_DELIVERY_MAX_AGE_MS;
    await this.ctx.storage.setAlarm(Math.max(wake, now));
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    this.flush(now);
    await this.schedule(now);
  }

  // ---------------------------------------------------------------------------
  // Media and rpc: exchanges with their own timeouts.

  async fetchMedia(path: string): Promise<MediaOutcome> {
    const ws = this.socket();
    if (!ws) {
      this.count("media.rig_offline");
      return { status: 503 };
    }
    const reply = await this.exchange(ws, { t: "media", id: crypto.randomUUID(), path }, MEDIA_TIMEOUT_MS);
    if (!reply || reply.t !== "media-result") {
      this.count("media.no_answer");
      return { status: 504 };
    }
    const status = relayStatus(reply.status);
    if (status !== 200) return { status: status < 300 ? 502 : status };
    const body = decodeMedia(reply.body_b64);
    if (!body) {
      this.count("media.refused_body");
      return { status: 502 };
    }
    this.count("media.relayed");
    return { status: 200, contentType: reply.content_type, body };
  }

  async rigRpc(method: string, params: unknown, caller: ControlClass): Promise<RpcOutcome> {
    const ws = this.socket();
    if (!ws) return { status: "offline" };
    const frame: RpcFrame = { t: "rpc", id: crypto.randomUUID(), method, params, caller };
    const reply = await this.exchange(ws, frame, RPC_TIMEOUT_MS);
    if (!reply || reply.t !== "rpc-result") return { status: "timeout" };
    return reply.ok ? { status: "ok", result: reply.result } : { status: "error", error: reply.error };
  }

  // ---------------------------------------------------------------------------
  // Strangers: a count and a keyed hash, never the number.

  async recordStranger(input: StrangerRecord): Promise<{ detach: boolean; strangers: number }> {
    const now = Date.now();
    const hash = await this.senderHash(input.theirs);
    this.sql.exec(
      "INSERT INTO stranger_senders (hash, n, last_at) VALUES (?, 1, ?) ON CONFLICT(hash) DO UPDATE SET n = n + 1, last_at = excluded.last_at",
      hash,
      now,
    );
    this.count(`stranger.${input.kind}`);
    if (!input.ours) return { detach: false, strangers: 0 };

    const row = this.sql
      .exec<{ window_start: number; n: number; detach_at: number | null }>(
        "SELECT window_start, n, detach_at FROM strangers WHERE e164 = ?",
        input.ours,
      )
      .toArray()[0];
    const fresh = !row || now - row.window_start >= STRANGER_WINDOW_MS;
    const strangers = fresh ? 1 : row.n + 1;
    const lastDetach = fresh ? null : row.detach_at;
    const detach =
      strangers >= STRANGER_DETACH_THRESHOLD && (lastDetach === null || now - lastDetach >= DETACH_REPEAT_MS);
    this.sql.exec(
      "INSERT OR REPLACE INTO strangers (e164, window_start, n, detach_at) VALUES (?, ?, ?, ?)",
      input.ours,
      fresh ? now : row.window_start,
      strangers,
      detach ? now : lastDetach,
    );
    return { detach, strangers };
  }

  /**
   * HMAC-SHA-256 under a key this object made for itself. A plain hash of a
   * phone number is reversible by enumerating ten billion numbers; this one
   * can be compared with itself, and with nothing outside.
   */
  private async senderHash(value: string): Promise<string> {
    let encoded = this.meta("stranger_key");
    if (encoded === null) {
      encoded = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
      this.setMeta("stranger_key", encoded);
    }
    const key = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
    return [...mac.subarray(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ---------------------------------------------------------------------------
  // Account notices.

  async noticeSeen(key: string): Promise<boolean> {
    return this.isSeen(`notice:${key}`, Date.now());
  }

  async recordNotice(key: string, name: string, outcome: string): Promise<void> {
    const now = Date.now();
    this.markSeen(`notice:${key}`, now);
    this.sql.exec(
      "INSERT OR REPLACE INTO notices (key, name, at, outcome) VALUES (?, ?, ?, ?)",
      key,
      name.slice(0, 200),
      now,
      outcome,
    );
    this.count(`notice.${outcome}`);
  }

  /** The cron's housekeeping: expire, purge and ping the rig. */
  async tick(now: number): Promise<void> {
    this.sql.exec("DELETE FROM seen WHERE at <= ?", now - SEEN_TTL_MS);
    this.sql.exec("DELETE FROM late_calls WHERE at <= ?", now - LATE_CALL_MEMORY_MS);
    this.sql.exec("DELETE FROM strangers WHERE window_start <= ?", now - 2 * STRANGER_WINDOW_MS);
    this.sql.exec(
      "DELETE FROM stranger_senders WHERE hash NOT IN (SELECT hash FROM stranger_senders ORDER BY last_at DESC LIMIT ?)",
      STRANGER_SENDERS_MAX,
    );
    this.sql.exec(
      "DELETE FROM notices WHERE key NOT IN (SELECT key FROM notices ORDER BY at DESC LIMIT ?)",
      NOTICES_MAX,
    );
    this.flush(now);
    const ws = this.socket();
    if (ws) {
      try {
        ws.send(JSON.stringify({ t: "ping", at: new Date(now).toISOString() } satisfies EdgeToRig));
      } catch {
        // The close handler will run.
      }
    }
    await this.schedule(now);
  }

  // ---------------------------------------------------------------------------
  // Counters and small helpers.

  async bump(name: string): Promise<void> {
    this.count(name);
  }

  async snapshot(): Promise<UplinkSnapshot> {
    const counters: Record<string, number> = {};
    for (const row of this.sql.exec<{ name: string; n: number }>("SELECT name, n FROM counters")) {
      counters[row.name] = row.n;
    }
    return {
      connected: this.socket() !== null,
      queueDepth: this.number("SELECT COUNT(*) AS n FROM queue"),
      counters,
    };
  }

  private count(name: string, by = 1): void {
    this.sql.exec(
      "INSERT INTO counters (name, n) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET n = n + excluded.n",
      name,
      by,
    );
  }

  private isSeen(key: string, now: number): boolean {
    return this.number("SELECT COUNT(*) AS n FROM seen WHERE key = ? AND at > ?", key, now - SEEN_TTL_MS) > 0;
  }

  private markSeen(key: string, now: number): void {
    this.sql.exec("INSERT OR REPLACE INTO seen (key, at) VALUES (?, ?)", key, now);
  }

  private number(query: string, ...bindings: SqlStorageValue[]): number {
    return Number(this.sql.exec<{ n: number }>(query, ...bindings).one().n);
  }

  private meta(key: string): string | null {
    return this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
  }
}
