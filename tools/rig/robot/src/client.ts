/**
 * What a scenario run sees of the robot. `RobotClient` speaks to robotd over
 * loopback; tests hand scenarios a fake with the same shape.
 */
import type { InboxMessage, SinkDelivery } from "./inbox.ts";
import type { CallPlan, CallRecord, RobotRole } from "./robot.ts";
import { ROBOT_TOKEN_HEADER } from "./server.ts";

export interface RobotApi {
  dial(plan: CallPlan): Promise<CallRecord>;
  expect(plan: CallPlan): Promise<CallRecord>;
  /** The record once it is done or failed, or as it stands after `timeoutMs`. */
  wait(planId: string, timeoutMs: number): Promise<CallRecord>;
  sms(message: {
    from_role: RobotRole;
    to_role: string;
    text: string;
    scenario: string;
    lease_id?: string;
    /** Sends the robot's S22 picture with the text. */
    media?: "gps-jpeg";
  }): Promise<{ id: string; media_sha256?: string }>;
  inbox(query: { to_role?: string; since?: number }): Promise<InboxMessage[]>;
  sink(query: { since?: number; type?: string }): Promise<SinkDelivery[]>;
}

export class RobotClient implements RobotApi {
  readonly #base: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(options: { base: string; token: string; fetch?: typeof fetch }) {
    this.#base = options.base.replace(/\/+$/, "");
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
  }

  dial(plan: CallPlan) {
    return this.#json<CallRecord>("POST", "/calls/dial", plan);
  }

  expect(plan: CallPlan) {
    return this.#json<CallRecord>("POST", "/calls/expect", plan);
  }

  wait(planId: string, timeoutMs: number) {
    return this.#json<CallRecord>("GET", `/calls/${encodeURIComponent(planId)}?wait_ms=${timeoutMs}`, undefined, timeoutMs + 10_000);
  }

  sms(message: Parameters<RobotApi["sms"]>[0]) {
    return this.#json<{ id: string; media_sha256?: string }>("POST", "/sms", message);
  }

  inbox(query: { to_role?: string; since?: number }) {
    return this.#json<InboxMessage[]>("GET", `/inbox?${params(query)}`);
  }

  sink(query: { since?: number; type?: string }) {
    return this.#json<SinkDelivery[]>("GET", `/sink?${params(query)}`);
  }

  async #json<T>(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
    const response = await this.#fetch(`${this.#base}${path}`, {
      method,
      headers: {
        [ROBOT_TOKEN_HEADER]: this.#token,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`robotd ${method} ${path.split("?")[0]} -> ${response.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as T;
  }
}

function params(query: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) search.set(key, String(value));
  return search.toString();
}
