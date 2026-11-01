/**
 * The guard as scenarios read it: through the edge's `/g` path, with the
 * robot's caller token for reads and probes and the app's (`rig-api`) for the
 * one write a scenario's undo needs, the release of a number held for a run.
 *
 * What comes back is counts, statuses and rule names. A number is never
 * returned, and a webhook delivery keeps only each attempt's host and status:
 * its URL's path carries the edge's secret segments.
 */
import {
  EDGE_PATHS,
  GUARD_ROUTES,
  HEADER,
  type GuardHealth,
  type GuardRefusal,
  type LeaseActivity,
  type Partition,
} from "@loonext/rig-protocol";
import { FICTIONAL_E164, type GuardApi, type GuardProbe, type GuardProbeAnswer, type WebhookDelivery } from "./scenarios/context.ts";

export interface GuardClientOptions {
  edgeOrigin: string;
  /** The robot's caller token: reads, the lease's log and the negative probes. */
  robotToken: string;
  /** The app's caller token, the only class that may release a number. */
  rigApiToken: string;
  fetch?: typeof fetch;
}

/** A connection id no partition has, for the probe that a dial must name a nonprod connection. */
export const PROBE_FOREIGN_CONNECTION = "rig-g01-not-a-partition-connection";

export class GuardClient implements GuardApi {
  readonly #o: GuardClientOptions;
  readonly #fetch: typeof fetch;

  constructor(options: GuardClientOptions) {
    this.#o = options;
    this.#fetch = options.fetch ?? fetch;
  }

  health(): Promise<GuardHealth> {
    return this.#json<GuardHealth>(GUARD_ROUTES.health);
  }

  async partition(): Promise<{ owned: number; standing: number; messaging_profiles: number }> {
    const partition = await this.#json<Partition>(GUARD_ROUTES.partition);
    return {
      owned: partition.owned_e164.length,
      standing: partition.standing_e164.length,
      messaging_profiles: partition.messaging_profile_ids.length,
    };
  }

  activity(leaseId: string): Promise<LeaseActivity> {
    return this.#json<LeaseActivity>(`${GUARD_ROUTES.lease}/${encodeURIComponent(leaseId)}/activity`);
  }

  /**
   * Each probe names only roles the partition owns and the fictional range,
   * so even a guard that wrongly let one through could reach nobody real.
   */
  async probe(kind: GuardProbe, leaseId: string): Promise<GuardProbeAnswer> {
    const partition = await this.#json<Partition>(GUARD_ROUTES.partition);
    const role = (name: string) => {
      const entry = partition.standing?.find((standing) => standing.role === name);
      if (!entry) throw new Error(`guard probe: the partition lists no ${name}`);
      return entry;
    };
    const robot = role("ROBOT-1");
    const devW1 = role("DEV-W1");
    const [first, second] = FICTIONAL_E164;
    const request =
      kind === "foreign-connection"
        ? { path: "/v2/calls", body: { connection_id: PROBE_FOREIGN_CONNECTION, from: robot.e164, to: devW1.e164, timeout_secs: 30 } }
        : kind === "dial-to-unowned"
          ? { path: "/v2/calls", body: { connection_id: partition.connection_ids.robot, from: robot.e164, to: first, timeout_secs: 30 } }
          : {
              path: "/v2/messages",
              body: { from: second, to: devW1.e164, text: "Rig G01 probe", messaging_profile_id: robot.messaging_profile_id },
            };
    const response = await this.#fetch(this.#url(`${GUARD_ROUTES.telnyx}${request.path}`), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#o.robotToken}`,
        "content-type": "application/json",
        [HEADER.lease]: leaseId,
        [HEADER.scenario]: "G01",
      },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(10_000),
    });
    const refused = response.headers.get(HEADER.refusedBy) !== null;
    const body = (await response.json().catch(() => undefined)) as Partial<GuardRefusal> | undefined;
    return { status: response.status, refused_by_guard: refused, rule: refused && typeof body?.rule === "string" ? body.rule : null };
  }

  async numberStatus(telnyxPhoneNumberId: string): Promise<{ status: number; in_group: boolean }> {
    const response = await this.#fetch(this.#url(`${GUARD_ROUTES.telnyx}/v2/phone_numbers/${encodeURIComponent(telnyxPhoneNumberId)}`), {
      headers: { authorization: `Bearer ${this.#o.robotToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    // The read class keeps a number only when it is in the partition's billing group.
    await response.body?.cancel();
    return { status: response.status, in_group: response.status === 200 };
  }

  async releaseNumber(telnyxPhoneNumberId: string): Promise<{ status: number; rule: string | null }> {
    const response = await this.#fetch(this.#url(`${GUARD_ROUTES.telnyx}/v2/phone_numbers/${encodeURIComponent(telnyxPhoneNumberId)}`), {
      method: "DELETE",
      headers: { authorization: `Bearer ${this.#o.rigApiToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const refused = response.headers.get(HEADER.refusedBy) !== null;
    const body = (await response.json().catch(() => undefined)) as Partial<GuardRefusal> | undefined;
    return { status: response.status, rule: refused && typeof body?.rule === "string" ? body.rule : null };
  }

  async webhookDeliveries(args: { since: number }): Promise<WebhookDelivery[]> {
    const query = `filter[started_at][gte]=${encodeURIComponent(new Date(args.since).toISOString())}`;
    const { data } = await this.#json<{ data?: Record<string, unknown>[] }>(`${GUARD_ROUTES.telnyx}/v2/webhook_deliveries?${query}`);
    return (data ?? []).map(toDelivery);
  }

  #url(path: string): string {
    return `${this.#o.edgeOrigin.replace(/\/+$/, "")}${EDGE_PATHS.guardPrefix}${path}`;
  }

  async #json<T>(path: string): Promise<T> {
    const response = await this.#fetch(this.#url(path), {
      headers: { authorization: `Bearer ${this.#o.robotToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as Partial<GuardRefusal> | undefined;
      const rule = response.headers.get(HEADER.refusedBy) ? (body?.rule ?? "refused") : undefined;
      throw new Error(`guard: ${path.split("?")[0]} answered ${response.status}${rule ? ` (${rule})` : ""}`);
    }
    return (await response.json()) as T;
  }
}

/** One delivery, cut to what S17 judges: the event it carried, and each attempt's host and status. */
export function toDelivery(item: Record<string, unknown>): WebhookDelivery {
  const webhook = (item.webhook ?? {}) as { event_type?: unknown; id?: unknown };
  const attempts = Array.isArray(item.attempts) ? (item.attempts as Record<string, unknown>[]) : [];
  return {
    id: typeof item.id === "string" ? item.id : "",
    status: typeof item.status === "string" ? item.status : "unknown",
    event_type: typeof webhook.event_type === "string" ? webhook.event_type : null,
    event_id: typeof webhook.id === "string" ? webhook.id : null,
    attempts: attempts.map((attempt) => {
      const http = (attempt.http ?? {}) as { request?: { url?: unknown }; response?: { status?: unknown } };
      let host: string | null = null;
      try {
        host = typeof http.request?.url === "string" ? new URL(http.request.url).host : null;
      } catch {
        host = null;
      }
      return {
        host,
        http_status: typeof http.response?.status === "number" ? http.response.status : null,
        at: typeof attempt.started_at === "string" ? attempt.started_at : null,
      };
    }),
  };
}
