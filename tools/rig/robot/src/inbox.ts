/**
 * What reaches the robot that is not a call: texts to its lines, and customer
 * webhooks the rig's API delivers to the robot's sink. Held in memory only and
 * bounded, because both are scenario evidence for minutes, not records.
 *
 * Numbers are kept as roles. A sender the book does not know is "unknown":
 * the edge drops strangers' texts before they reach the rig, so this is a
 * misconfiguration to see, never a number to keep.
 */
import type { NumberBook } from "./robot.ts";

export interface InboxMessage {
  id: string;
  event: string;
  from_role: string;
  to_role: string;
  text: string;
  status?: string;
  received_at: number;
}

export interface SinkDelivery {
  received_at: number;
  /** Header names lower-cased; values kept, since a scenario checks the signature. */
  headers: Record<string, string>;
  body: string;
  /** `type` from a JSON body, when it has one. */
  type?: string;
}

const MAX_ITEMS = 500;

class Waitable<T> {
  readonly items: T[] = [];
  readonly #waiters: { match: (item: T) => boolean; resolve: (item: T) => void }[] = [];

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > MAX_ITEMS) this.items.splice(0, this.items.length - MAX_ITEMS);
    for (const waiter of [...this.#waiters]) {
      if (waiter.match(item)) {
        this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
        waiter.resolve(item);
      }
    }
  }

  waitFor(match: (item: T) => boolean, timeoutMs: number): Promise<T | undefined> {
    const existing = this.items.find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const waiter = { match, resolve: (item: T) => (clearTimeout(timer), resolve(item)) };
      const timer = setTimeout(() => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
        resolve(undefined);
      }, timeoutMs);
      this.#waiters.push(waiter);
    });
  }
}

export class Inbox {
  readonly #numbers: NumberBook;
  readonly #now: () => number;
  readonly #messages = new Waitable<InboxMessage>();

  constructor(numbers: NumberBook, now: () => number = Date.now) {
    this.#numbers = numbers;
    this.#now = now;
  }

  /** A Telnyx `message.*` webhook body. Returns false for anything else. */
  handle(body: unknown): boolean {
    const data = (body as { data?: { event_type?: unknown; payload?: unknown } } | null)?.data;
    const type = typeof data?.event_type === "string" ? data.event_type : undefined;
    if (!type?.startsWith("message.")) return false;
    const payload = (data?.payload ?? {}) as {
      id?: unknown;
      text?: unknown;
      from?: { phone_number?: unknown };
      to?: { phone_number?: unknown; status?: unknown }[];
    };
    const from = typeof payload.from?.phone_number === "string" ? payload.from.phone_number : "";
    const first = payload.to?.[0];
    const to = typeof first?.phone_number === "string" ? first.phone_number : "";
    this.#messages.push({
      id: typeof payload.id === "string" ? payload.id : "",
      event: type,
      from_role: this.#numbers.role(from) ?? "unknown",
      to_role: this.#numbers.role(to) ?? "unknown",
      text: typeof payload.text === "string" ? payload.text : "",
      status: typeof first?.status === "string" ? first.status : undefined,
      received_at: this.#now(),
    });
    return true;
  }

  list(query: { to_role?: string; since?: number } = {}): InboxMessage[] {
    return this.#messages.items.filter(
      (m) => (!query.to_role || m.to_role === query.to_role) && (query.since === undefined || m.received_at >= query.since),
    );
  }

  waitFor(match: (message: InboxMessage) => boolean, timeoutMs: number): Promise<InboxMessage | undefined> {
    return this.#messages.waitFor(match, timeoutMs);
  }
}

export class WebhookSink {
  readonly #now: () => number;
  readonly #deliveries = new Waitable<SinkDelivery>();

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  record(headers: Record<string, string>, body: string): SinkDelivery {
    let type: string | undefined;
    try {
      const parsed = JSON.parse(body) as { type?: unknown };
      if (typeof parsed.type === "string") type = parsed.type;
    } catch {
      // A webhook with a non-JSON body is still a delivery.
    }
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const delivery = { received_at: this.#now(), headers: lower, body, type };
    this.#deliveries.push(delivery);
    return delivery;
  }

  list(query: { since?: number; type?: string } = {}): SinkDelivery[] {
    return this.#deliveries.items.filter(
      (d) => (query.since === undefined || d.received_at >= query.since) && (!query.type || d.type === query.type),
    );
  }

  waitFor(match: (delivery: SinkDelivery) => boolean, timeoutMs: number): Promise<SinkDelivery | undefined> {
    return this.#deliveries.waitFor(match, timeoutMs);
  }
}
