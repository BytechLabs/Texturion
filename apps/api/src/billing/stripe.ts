import Stripe from "stripe";

import type { Env } from "../env";

/**
 * stripe-node configured for Cloudflare Workers (SPEC §3, §10):
 *
 * - `createFetchHttpClient` — Workers have no Node sockets; the client must
 *   ride the platform `fetch`. The fetch function is resolved from the global
 *   at call time (same pattern as db.ts) so the Worker always uses the live
 *   binding and tests can stub the network edge.
 * - `createSubtleCryptoProvider` — webhook signature verification must use
 *   WebCrypto (`constructEventAsync`); the sync Node-crypto variant fails on
 *   Workers (SPEC §7, §10).
 *
 * No `apiVersion` override: the pinned stripe package (22.3.0) speaks its own
 * pinned API version (2026-06-24.dahlia) and its types match it.
 */
const clients = new WeakMap<Env, Stripe>();

export function getStripe(env: Env): Stripe {
  const cached = clients.get(env);
  if (cached) return cached;

  // Vendor host is api.stripe.com unless STRIPE_API_BASE overrides it (unset in
  // production; the E2E launch-pass harness points it at a fake — D31). Parsing
  // the full origin into stripe-node's host/protocol/port keeps the SDK's
  // request-building intact while retargeting the network edge.
  const override = env.STRIPE_API_BASE ? new URL(env.STRIPE_API_BASE) : null;

  const client = new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient((...args: Parameters<typeof fetch>) =>
      globalThis.fetch(...args),
    ),
    // Webhook ingestion acks within 2s and Workers cap wall-clock generously,
    // but keep retries to Stripe's own client default behavior deterministic:
    // the webhook_events ledger + sweeper cron owns retry durability, not the
    // HTTP client.
    maxNetworkRetries: 1,
    ...(override
      ? {
          host: override.hostname,
          protocol: override.protocol.replace(":", "") as "http" | "https",
          port: override.port
            ? Number(override.port)
            : override.protocol === "https:"
              ? 443
              : 80,
        }
      : {}),
  });
  clients.set(env, client);
  return client;
}

/**
 * One SubtleCryptoProvider per isolate — it is stateless; sharing avoids
 * re-instantiating on every webhook delivery.
 */
export const stripeCryptoProvider = Stripe.createSubtleCryptoProvider();

export { Stripe };
