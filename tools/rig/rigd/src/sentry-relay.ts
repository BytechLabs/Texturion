/**
 * The rig's only way into Sentry. Rig and synthetic
 * events share the org's quota with production, so the relay caps them: 100
 * events a day and 3,000 a month in all, at most 50 from one run, and one per
 * fingerprint every 6 hours. It raises its own alert once at 70% of either cap,
 * before the cap drops anything.
 *
 * It sends envelopes by DSN only; no Sentry API token exists on the rig. The
 * counters live in one file under a lock, because scenario runs are separate
 * processes and each may report. An envelope Sentry did not take is kept
 * there too, and the daemon sends it again until it goes or is a day old:
 * the fingerprint it holds stays suppressed meanwhile, so it must not be lost.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { systemClock, type Clock } from "@loonext/rig-robot";

export interface RelayLimits {
  daily: number;
  monthly: number;
  /** The share of either cap at which the relay raises its own alert. */
  alertAt: number;
  perRun: number;
  suppressMs: number;
}

export const RELAY_LIMITS: Readonly<RelayLimits> = {
  daily: 100,
  monthly: 3_000,
  alertAt: 0.7,
  perRun: 50,
  suppressMs: 6 * 60 * 60 * 1000,
};

export interface Dsn {
  raw: string;
  publicKey: string;
  projectId: string;
  /** `<protocol>://<host>/api/<project>/envelope/` */
  envelopeUrl: string;
}

export function parseDsn(raw: string): Dsn {
  const url = new URL(raw);
  const projectId = url.pathname.replace(/^\/+|\/+$/g, "").split("/").pop() ?? "";
  if (!url.username || !/^\d+$/.test(projectId)) throw new Error("sentry relay: not a DSN");
  const prefix = url.pathname.replace(/\/?[^/]*\/?$/, "");
  return {
    raw,
    publicKey: url.username,
    projectId,
    envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`,
  };
}

export type Fingerprint = readonly string[];

export function syntheticFingerprint(scenario: string, failureClass: string): Fingerprint {
  return ["synthetic", scenario, failureClass];
}

export function infraFingerprint(component: string): Fingerprint {
  return ["synthetic-infra", component];
}

type Refusal = "suppressed" | "daily_cap" | "monthly_cap" | "run_cap";

export type RelayDecision =
  | { sent: true; eventId: string }
  | { sent: false; reason: Refusal | "empty" }
  /** Admitted, but Sentry did not take it yet: it waits in the relay's state for the next flush. */
  | { sent: false; reason: "send_failed"; pending: true };

/** What the relay keeps of an API event, for the cron registry to explain it (cron-events.ts). */
export interface SeenEvent {
  at: number;
  level?: string;
  message?: string;
  fingerprint?: string[];
  tags?: Record<string, string>;
  /** Every exception in the event, a linked error's included. */
  exceptions?: { type: string; value: string }[];
}

/** Why an API event is no surprise, or undefined when nothing explains it. */
export type Explanation = { kind: "expected" } | { kind: "defect"; means: string };

interface PendingEnvelope {
  url: string;
  publicKey: string;
  envelope: string;
  at: number;
}

const PENDING_MAX = 50;

interface RelayState {
  day: string;
  dayCount: number;
  month: string;
  monthCount: number;
  alertedDay?: string;
  alertedMonth?: string;
  fingerprints: Record<string, number>;
  runs: Record<string, { count: number; at: number }>;
  /** The local API's events by key, as last seen, for R00's "unexplained in 24 hours". */
  apiSeen?: Record<string, number | SeenEvent>;
  pending?: PendingEnvelope[];
}

/** What `rig health` reads from `state/sentry-relay.json`. */
export interface RelayReport {
  at: string;
  unexplained_24h: string[];
  /** Events the cron registry names as a defect of the rig's seed or setup, with its cause. */
  defects_24h: { key: string; means: string }[];
  /** Envelopes Sentry has not taken yet. */
  pending: number;
  day_count: number;
  month_count: number;
  daily_cap: number;
  monthly_cap: number;
}

export interface SyntheticEvent {
  fingerprint: Fingerprint;
  message: string;
  level?: "fatal" | "error" | "warning" | "info";
  runId?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  release?: string;
}

export interface SentryRelayOptions {
  statePath: string;
  /** Where the relay's own 70% alert goes: the `loonext-synthetic` DSN. */
  alertDsn: Dsn;
  fetch?: typeof fetch;
  clock?: Clock;
  limits?: Partial<RelayLimits>;
}

const LOCK_STALE_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const LOCK_WAIT_MS = 10_000;

export class SentryRelay {
  readonly #o: SentryRelayOptions;
  readonly #fetch: typeof fetch;
  readonly #clock: Clock;
  readonly #limits: RelayLimits;

  constructor(options: SentryRelayOptions) {
    this.#o = options;
    this.#fetch = options.fetch ?? fetch;
    this.#clock = options.clock ?? systemClock;
    this.#limits = { ...RELAY_LIMITS, ...options.limits };
    mkdirSync(dirname(options.statePath), { recursive: true });
  }

  /** One synthetic or infrastructure event, built here. */
  async send(dsn: Dsn, event: SyntheticEvent): Promise<RelayDecision> {
    const { keys, refused } = await this.#admit([JSON.stringify(event.fingerprint)], event.runId);
    if (keys.length === 0) return { sent: false, reason: refused ?? "suppressed" };
    return this.#deliver(dsn, buildEnvelope(dsn, event, this.#clock.now()));
  }

  /**
   * An envelope from the local API's own SDK. Only error events pass; tracing,
   * sessions and replays would spend quota on what the rig never reads.
   */
  async forwardEnvelope(dsn: Dsn, body: Uint8Array): Promise<RelayDecision> {
    const { header, items } = parseEnvelope(body);
    const events = items
      .filter((item) => item.type === "event")
      .map((item) => ({ payload: item.payload, key: eventKey(item.payload) }));
    if (events.length === 0) return { sent: false, reason: "empty" };
    const now = this.#clock.now();
    const { keys, refused } = await this.#admit(
      events.map((event) => event.key),
      undefined,
      events.map((event) => seenEvent(event.payload, now)),
    );
    const once = new Set<string>();
    const kept = events.filter((event) => keys.includes(event.key) && !once.has(event.key) && once.add(event.key));
    if (kept.length === 0) return { sent: false, reason: refused ?? "suppressed" };
    const lines = [rewriteDsn(header, dsn), ...kept.flatMap((event) => [JSON.stringify({ type: "event" }), event.payload])];
    return this.#deliver(dsn, `${lines.join("\n")}\n`);
  }

  /** Sends the envelopes Sentry did not take, dropping any a day old. */
  async flushPending(): Promise<{ sent: number; left: number }> {
    const now = this.#clock.now();
    const due = await this.#locked((state) => {
      const pending = (state.pending ?? []).filter((item) => now - item.at < DAY_MS);
      state.pending = [];
      return pending;
    });
    const failed: PendingEnvelope[] = [];
    for (const item of due) {
      const decision = await this.#post({ envelopeUrl: item.url, publicKey: item.publicKey }, item.envelope);
      if (!decision.sent) failed.push(item);
    }
    if (failed.length) {
      await this.#locked((state) => {
        state.pending = [...failed, ...(state.pending ?? [])].slice(-PENDING_MAX);
      });
    }
    return { sent: due.length - failed.length, left: failed.length };
  }

  /**
   * The local API's events from the last day that nothing explains. `explain`
   * is the cron registry's reading of an event (cron-events.ts); without one,
   * nothing is explained.
   */
  report(explain: (event: SeenEvent) => Explanation | undefined = () => undefined): RelayReport {
    const state = this.#read();
    const now = this.#clock.now();
    const unexplained: string[] = [];
    const defects: { key: string; means: string }[] = [];
    for (const [key, value] of Object.entries(state.apiSeen ?? {})) {
      const seen: SeenEvent = typeof value === "number" ? { at: value } : value;
      if (now - seen.at >= DAY_MS) continue;
      const explanation = explain(seen);
      if (explanation?.kind === "defect") defects.push({ key, means: explanation.means });
      else if (!explanation) unexplained.push(key);
    }
    return {
      at: new Date(now).toISOString(),
      unexplained_24h: unexplained.sort(),
      defects_24h: defects.sort((a, b) => a.key.localeCompare(b.key)),
      pending: state.pending?.length ?? 0,
      day_count: state.day === new Date(now).toISOString().slice(0, 10) ? state.dayCount : 0,
      month_count: state.month === new Date(now).toISOString().slice(0, 7) ? state.monthCount : 0,
      daily_cap: this.#limits.daily,
      monthly_cap: this.#limits.monthly,
    };
  }

  /** Counts what it admits and why it refused the rest. Sends the 70% alert when crossed. */
  async #admit(keys: string[], runId?: string, seen?: SeenEvent[]): Promise<{ keys: string[]; refused?: Refusal }> {
    let alert: string | undefined;
    let refused: Refusal | undefined;
    const admitted = await this.#locked((state) => {
      const now = this.#clock.now();
      const day = new Date(now).toISOString().slice(0, 10);
      const month = day.slice(0, 7);
      if (state.day !== day) Object.assign(state, { day, dayCount: 0 });
      if (state.month !== month) Object.assign(state, { month, monthCount: 0 });
      for (const [key, at] of Object.entries(state.fingerprints)) {
        if (now - at >= this.#limits.suppressMs) delete state.fingerprints[key];
      }
      for (const [id, run] of Object.entries(state.runs)) if (now - run.at > 2 * 86_400_000) delete state.runs[id];
      state.apiSeen ??= {};
      for (const [key, value] of Object.entries(state.apiSeen)) {
        if (now - (typeof value === "number" ? value : value.at) >= DAY_MS) delete state.apiSeen[key];
      }
      seen?.forEach((event, i) => {
        state.apiSeen![keys[i]!] = event;
      });

      const out: string[] = [];
      for (const key of keys) {
        if (state.fingerprints[key] !== undefined) refused = "suppressed";
        else if (state.dayCount >= this.#limits.daily) refused = "daily_cap";
        else if (state.monthCount >= this.#limits.monthly) refused = "monthly_cap";
        else if (runId && (state.runs[runId]?.count ?? 0) >= this.#limits.perRun) refused = "run_cap";
        else refused = undefined;
        if (refused) continue;
        state.fingerprints[key] = now;
        state.dayCount++;
        state.monthCount++;
        if (runId) state.runs[runId] = { count: (state.runs[runId]?.count ?? 0) + 1, at: now };
        out.push(key);
      }
      // The alert spends one event of the quota it warns about, once per period.
      const dayAlert = state.dayCount >= Math.ceil(this.#limits.daily * this.#limits.alertAt) && state.alertedDay !== day;
      const monthAlert =
        state.monthCount >= Math.ceil(this.#limits.monthly * this.#limits.alertAt) && state.alertedMonth !== month;
      if ((dayAlert || monthAlert) && state.dayCount < this.#limits.daily && state.monthCount < this.#limits.monthly) {
        if (dayAlert) state.alertedDay = day;
        if (monthAlert) state.alertedMonth = month;
        state.dayCount++;
        state.monthCount++;
        alert = dayAlert
          ? `rig Sentry relay at ${state.dayCount - 1} of ${this.#limits.daily} events today`
          : `rig Sentry relay at ${state.monthCount - 1} of ${this.#limits.monthly} events this month`;
      }
      return out;
    });
    if (alert) {
      await this.#deliver(
        this.#o.alertDsn,
        buildEnvelope(this.#o.alertDsn, { fingerprint: infraFingerprint("sentry-relay"), message: alert, level: "warning" }, this.#clock.now()),
      );
    }
    return { keys: admitted, refused };
  }

  /** Posts, and keeps the envelope for the next flush when Sentry does not take it. */
  async #deliver(dsn: Dsn, envelope: string): Promise<RelayDecision> {
    const decision = await this.#post(dsn, envelope);
    if (decision.sent) return decision;
    const item: PendingEnvelope = { url: dsn.envelopeUrl, publicKey: dsn.publicKey, envelope, at: this.#clock.now() };
    await this.#locked((state) => {
      state.pending = [...(state.pending ?? []), item].slice(-PENDING_MAX);
    });
    return { sent: false, reason: "send_failed", pending: true };
  }

  async #post(dsn: Pick<Dsn, "envelopeUrl" | "publicKey">, envelope: string): Promise<{ sent: true; eventId: string } | { sent: false }> {
    const eventId = (safeJson(envelope.split("\n")[0] ?? "") as { event_id?: string } | undefined)?.event_id ?? "";
    try {
      const response = await this.#fetch(dsn.envelopeUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-sentry-envelope",
          "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=loonext-rigd/0`,
        },
        body: envelope,
        signal: AbortSignal.timeout(10_000),
      });
      await response.body?.cancel();
      return response.ok ? { sent: true, eventId } : { sent: false };
    } catch {
      return { sent: false };
    }
  }

  async #locked<T>(update: (state: RelayState) => T): Promise<T> {
    const lock = `${this.#o.statePath}.lock`;
    const started = Date.now();
    for (;;) {
      try {
        mkdirSync(lock);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { recursive: true, force: true });
        } catch {
          // Released between the two calls.
        }
        if (Date.now() - started > LOCK_WAIT_MS) throw new Error("sentry relay: state lock is stuck");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    try {
      const state = this.#read();
      const result = update(state);
      const temp = `${this.#o.statePath}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(state));
      renameSync(temp, this.#o.statePath);
      return result;
    } finally {
      rmSync(lock, { recursive: true, force: true });
    }
  }

  #read(): RelayState {
    try {
      return JSON.parse(readFileSync(this.#o.statePath, "utf8")) as RelayState;
    } catch {
      return { day: "", dayCount: 0, month: "", monthCount: 0, fingerprints: {}, runs: {} };
    }
  }
}

function buildEnvelope(dsn: Dsn, event: SyntheticEvent, now: number): string {
  const eventId = randomBytes(16).toString("hex");
  const sentAt = new Date(now).toISOString();
  const payload = {
    event_id: eventId,
    timestamp: now / 1000,
    platform: "node",
    logger: "rigd",
    level: event.level ?? "error",
    environment: "rig",
    release: event.release,
    message: { formatted: event.message },
    fingerprint: [...event.fingerprint],
    tags: { ...event.tags, ...(event.runId ? { run_id: event.runId } : {}) },
    extra: event.extra,
  };
  return `${JSON.stringify({ event_id: eventId, sent_at: sentAt, dsn: dsn.raw })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(payload)}\n`;
}

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

/** The parts of an SDK event the cron registry matches on, clipped short. */
export function seenEvent(payload: string, at: number): SeenEvent {
  const event = (safeJson(payload) ?? {}) as {
    level?: unknown;
    message?: unknown;
    logentry?: { formatted?: unknown; message?: unknown };
    fingerprint?: unknown;
    tags?: unknown;
    exception?: { values?: { type?: unknown; value?: unknown }[] };
  };
  const seen: SeenEvent = { at };
  if (typeof event.level === "string") seen.level = event.level;
  const message =
    typeof event.message === "string"
      ? event.message
      : [(event.message as { formatted?: unknown } | undefined)?.formatted, event.logentry?.formatted, event.logentry?.message].find(
          (candidate): candidate is string => typeof candidate === "string",
        );
  if (message !== undefined) seen.message = clip(message, 500);
  if (Array.isArray(event.fingerprint) && event.fingerprint.every((part) => typeof part === "string")) {
    seen.fingerprint = event.fingerprint as string[];
  }
  // Tags arrive as an object, or as [key, value] pairs from some SDKs.
  const pairs = Array.isArray(event.tags)
    ? (event.tags as unknown[]).filter((pair): pair is [string, unknown] => Array.isArray(pair) && typeof pair[0] === "string")
    : Object.entries((event.tags ?? {}) as Record<string, unknown>);
  const tags = Object.fromEntries(pairs.slice(0, 30).map(([key, value]) => [key, clip(String(value), 200)]));
  if (Object.keys(tags).length) seen.tags = tags;
  const exceptions = (event.exception?.values ?? []).slice(0, 20).map((value) => ({
    type: typeof value?.type === "string" ? value.type : "",
    value: typeof value?.value === "string" ? clip(value.value, 500) : "",
  }));
  if (exceptions.length) seen.exceptions = exceptions;
  return seen;
}

/** The suppression key of an SDK event: its own fingerprint, else its first exception or message. */
function eventKey(payload: string): string {
  const event = safeJson(payload) as
    | { fingerprint?: unknown; exception?: { values?: { type?: unknown; value?: unknown }[] }; message?: unknown }
    | undefined;
  if (Array.isArray(event?.fingerprint) && event.fingerprint.length > 0) return JSON.stringify(event.fingerprint);
  const exception = event?.exception?.values?.[0];
  if (exception) return JSON.stringify(["exception", String(exception.type ?? ""), String(exception.value ?? "")]);
  const message = typeof event?.message === "string" ? event.message : JSON.stringify(event?.message ?? payload.slice(0, 200));
  return JSON.stringify(["message", message]);
}

/**
 * Sentry's envelope format: a header line, then items of a header line and a
 * payload. A payload is `length` bytes when the header says so (an attachment
 * may hold newlines), otherwise one line.
 */
export function parseEnvelope(body: Uint8Array): { header: string; items: { type?: string; payload: string }[] } {
  const bytes = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  let pos = 0;
  const line = (): string => {
    const end = bytes.indexOf(0x0a, pos);
    const text = bytes.toString("utf8", pos, end < 0 ? bytes.length : end);
    pos = end < 0 ? bytes.length : end + 1;
    return text;
  };
  const header = line();
  const items: { type?: string; payload: string }[] = [];
  while (pos < bytes.length) {
    const itemHeaderText = line();
    if (itemHeaderText.trim() === "") continue;
    const itemHeader = (safeJson(itemHeaderText) as { type?: unknown; length?: unknown } | undefined) ?? {};
    let payload: string;
    if (typeof itemHeader.length === "number" && itemHeader.length >= 0) {
      payload = bytes.toString("utf8", pos, Math.min(bytes.length, pos + itemHeader.length));
      pos = Math.min(bytes.length, pos + itemHeader.length);
      if (bytes[pos] === 0x0a) pos++;
    } else {
      payload = line();
    }
    items.push({ type: typeof itemHeader.type === "string" ? itemHeader.type : undefined, payload });
  }
  return { header, items };
}

function rewriteDsn(header: string, dsn: Dsn): string {
  const parsed = (safeJson(header) as Record<string, unknown> | undefined) ?? {};
  return JSON.stringify({ ...parsed, dsn: dsn.raw });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
