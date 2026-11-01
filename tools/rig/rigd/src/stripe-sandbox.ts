/**
 * The existing Stripe account's test mode, for S29's test clock and S32's
 * subscription (FA5: no sandbox of the rig's own). Only a test-mode key is
 * ever used, refused before any request otherwise, and only the paths those
 * scenarios need are allowed: a runner cannot reach payouts, transfers or
 * account settings through it.
 *
 * Test mode is shared with developers, so every customer and subscription the
 * rig creates carries metadata[loonext_rig]=1, and every test clock a name
 * starting `loonext_rig ` (Stripe keeps no metadata on a clock). Before a
 * delete or a clock advance the object is read, and the change is refused
 * unless it carries the tag: the rig never changes what a developer made.
 * S32's subscription comes from the app's Checkout, which sets no metadata;
 * it is tagged once the rig's own database shows that S32's sign-up owns it.
 */
import { SIGN_UP_ADDRESS } from "./app-probe.ts";
import type { StripeApi } from "./scenarios/context.ts";

export const STRIPE_API = "https://api.stripe.com";

const RIG_TAG = "loonext_rig";
const RIG_CLOCK_PREFIX = `${RIG_TAG} `;
const TEST_CLOCKS = "/v1/test_helpers/test_clocks";

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
  /** The `stripe_subscription_id` of the workspace a sign-up address owns, read from the local database. */
  checkoutSubscriptionOf: (ownerEmail: string) => Promise<string | null>;
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
    const changed = method === "DELETE" ? path : method === "POST" && path.endsWith("/advance") ? path.slice(0, -"/advance".length) : null;
    if (changed !== null) await this.#requireRigTag(changed);
    return this.#send<T>(method, path, method === "POST" ? tagged(path, params) : params, key);
  }

  /** Reads the object a change is about to touch, and refuses unless the rig made it. */
  async #requireRigTag(path: string): Promise<void> {
    const object = await this.request<{ metadata?: Record<string, unknown>; name?: unknown }>("GET", path);
    const ours = path.startsWith(`${TEST_CLOCKS}/`)
      ? typeof object.name === "string" && object.name.startsWith(RIG_CLOCK_PREFIX)
      : object.metadata?.[RIG_TAG] === "1";
    if (!ours) throw new Error(`stripe sandbox: ${path.split("/").slice(0, -1).join("/")} object is not tagged as the rig's; nothing was changed`);
  }

  async adoptCheckoutSubscription(args: { ownerEmail: string; subscriptionId: string }): Promise<void> {
    if (!SIGN_UP_ADDRESS.test(args.ownerEmail)) throw new Error("stripe sandbox: only a sign-up scenario's own subscription can be adopted");
    if (!/^sub_[A-Za-z0-9]+$/.test(args.subscriptionId)) throw new Error("stripe sandbox: that is not a subscription id");
    const recorded = await this.#o.checkoutSubscriptionOf(args.ownerEmail);
    if (recorded !== args.subscriptionId) throw new Error("stripe sandbox: the rig's database does not give that subscription to the sign-up; nothing was changed");
    const key = this.#o.key();
    if (!/^(sk|rk)_test_/.test(key)) throw new Error("stripe sandbox: the key is not a test-mode key; nothing was sent");
    const path = `/v1/subscriptions/${args.subscriptionId}`;
    const current = await this.request<{ metadata?: Record<string, unknown> }>("GET", path);
    if (current.metadata?.[RIG_TAG] !== "1") await this.#send("POST", path, { metadata: { [RIG_TAG]: "1" } }, key);
  }

  async #send<T>(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, unknown>, key: string): Promise<T> {
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

/**
 * A create's parameters with the rig's tag added: metadata on a customer or a
 * subscription, the name's prefix on a test clock. An unnamed clock stays
 * untagged, so the rig can neither advance nor delete it.
 */
function tagged(path: string, params: Record<string, unknown>): Record<string, unknown> {
  if (path === "/v1/customers" || path === "/v1/subscriptions") {
    const metadata = params.metadata && typeof params.metadata === "object" ? (params.metadata as Record<string, unknown>) : {};
    return { ...params, metadata: { ...metadata, [RIG_TAG]: "1" } };
  }
  if (path === TEST_CLOCKS && typeof params.name === "string" && !params.name.startsWith(RIG_CLOCK_PREFIX)) {
    return { ...params, name: `${RIG_CLOCK_PREFIX}${params.name}` };
  }
  return params;
}

/** The undo for a sandbox object a run made, a subscription or a test clock; its handler is deleteStripeObject. */
export const STRIPE_DELETE_UNDO = "stripe.delete";
const STRIPE_UNDO_PATH = /^\/v1\/(subscriptions|test_helpers\/test_clocks)\/[A-Za-z0-9_]+$/;

/**
 * Removes a subscription or a test clock a run made, as the `stripe.delete`
 * undo and as each run's own cleanup. Already gone is done, so both may run.
 */
export async function deleteStripeObject(stripe: Pick<StripeApi, "request">, params: Record<string, unknown>): Promise<void> {
  const path = params.path;
  if (typeof path !== "string" || !STRIPE_UNDO_PATH.test(path)) throw new Error("stripe.delete undo needs a subscription or test clock path");
  let current: { deleted?: boolean; status?: string };
  try {
    current = await stripe.request<{ deleted?: boolean; status?: string }>("GET", path);
  } catch (error) {
    if (/ answered 404\b/.test((error as Error).message)) return;
    throw error;
  }
  if (current.deleted === true || current.status === "canceled" || current.status === "incomplete_expired") return;
  await stripe.request("DELETE", path);
}
