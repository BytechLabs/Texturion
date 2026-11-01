/**
 * The `loonext-rig` Stripe sandbox, for S29's test clock and S32's
 * subscription. Only a test-mode key is ever used, refused before any
 * request otherwise, and only the paths those scenarios need are allowed:
 * a runner cannot reach payouts, transfers or account settings through it.
 */
import type { StripeApi } from "./scenarios/context.ts";

export const STRIPE_API = "https://api.stripe.com";

const ALLOWED: readonly [string, RegExp][] = [
  ["GET", /^\/v1\/(customers|subscriptions|invoices|prices|products|billing\/meters|test_helpers\/test_clocks)(\/[A-Za-z0-9_]+)?$/],
  ["GET", /^\/v1\/invoices\/upcoming$/],
  ["GET", /^\/v1\/billing\/meters\/[A-Za-z0-9_]+\/event_summaries$/],
  ["POST", /^\/v1\/(customers|subscriptions|test_helpers\/test_clocks|billing\/meter_events|invoices)$/],
  ["POST", /^\/v1\/test_helpers\/test_clocks\/[A-Za-z0-9_]+\/advance$/],
  ["POST", /^\/v1\/invoices\/[A-Za-z0-9_]+\/finalize$/],
  ["DELETE", /^\/v1\/(test_helpers\/test_clocks|customers|subscriptions)\/[A-Za-z0-9_]+$/],
];

/** Form encoding as Stripe reads it: `a[b][0]=c`. */
export function formEncode(params: Record<string, unknown>, prefix = ""): string[] {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined) continue;
    if (value !== null && typeof value === "object") {
      const entries = Array.isArray(value) ? Object.fromEntries(value.map((item, i) => [String(i), item])) : (value as Record<string, unknown>);
      pairs.push(...formEncode(entries, name));
    } else {
      pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(value === null ? "" : String(value))}`);
    }
  }
  return pairs;
}

export interface StripeSandboxOptions {
  key: () => string;
  /** The tenant's `stripe_subscription_id`, read from the local database. */
  subscriptionIdOf: (tenant: string) => Promise<string | null>;
  fetch?: typeof fetch;
}

export class StripeSandbox implements StripeApi {
  readonly #o: StripeSandboxOptions;
  readonly #fetch: typeof fetch;

  constructor(options: StripeSandboxOptions) {
    this.#o = options;
    this.#fetch = options.fetch ?? fetch;
  }

  async request<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!ALLOWED.some(([allowedMethod, pattern]) => allowedMethod === method && pattern.test(path))) {
      throw new Error(`stripe sandbox: ${method} ${path.split("/").slice(0, 3).join("/")} is not a path the rig uses`);
    }
    const key = this.#o.key();
    if (!/^(sk|rk)_test_/.test(key)) throw new Error("stripe sandbox: the key is not a test-mode key; nothing was sent");
    const encoded = formEncode(params).join("&");
    const url = `${STRIPE_API}${path}${method === "POST" || !encoded ? "" : `?${encoded}`}`;
    const response = await this.#fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      },
      body: method === "POST" ? encoded : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await response.json().catch(() => ({}))) as T & { error?: { code?: string; type?: string } };
    if (!response.ok) throw new Error(`stripe sandbox: ${method} answered ${response.status} ${json.error?.code ?? json.error?.type ?? ""}`.trim());
    if ((json as { livemode?: unknown }).livemode === true) throw new Error("stripe sandbox: Stripe answered in live mode");
    return json;
  }

  async subscriptionOf(tenant: string): Promise<{ id: string; status: string } | null> {
    const id = await this.#o.subscriptionIdOf(tenant);
    if (!id) return null;
    const subscription = await this.request<{ id?: string; status?: string }>("GET", `/v1/subscriptions/${encodeURIComponent(id)}`);
    return subscription.id && subscription.status ? { id: subscription.id, status: subscription.status } : null;
  }
}
