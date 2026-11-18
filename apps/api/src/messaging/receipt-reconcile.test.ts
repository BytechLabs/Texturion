import { afterEach, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { restMatch, stubRoute } from "../test/messaging-support";
import { completeEnv, stubFetch } from "../test/support";
import { reconcileOutboundReceipts } from "./receipt-reconcile";

const NOW = new Date("2026-11-18T10:00:00Z");
const CARRIER_ID = "40385f64-5717-4562-b3fc-2c963f66afb6";
const MESSAGE_ID = "99999999-0000-4000-8000-000000000099";
const COMPLETED_AT = "2026-11-18T08:10:00Z";
const env: Env = { ...completeEnv(), DEPLOY_ENV: "production" };

afterEach(() => vi.unstubAllGlobals());

it("records a completed lookup for the existing webhook sweeper without storing text", async () => {
  const candidates = stubRoute(restMatch(env, "GET", "messages"), () => [
    { id: MESSAGE_ID, telnyx_message_id: CARRIER_ID },
  ]);
  const claim = stubRoute(restMatch(env, "PATCH", "messages"), () => [{ id: MESSAGE_ID }]);
  const ledger = stubRoute(restMatch(env, "POST", "webhook_events"), () => []);
  const carrier = stubRoute((url) => url.pathname === `/v2/messages/${CARRIER_ID}`, () => ({
    data: {
      id: CARRIER_ID,
      direction: "outbound",
      completed_at: COMPLETED_AT,
      type: "SMS",
      parts: 1,
      text: "A message body",
      to: [{ phone_number: "+14165550100", status: "delivered", carrier: "Example" }],
    },
  }));
  stubFetch(candidates.route, claim.route, ledger.route, carrier.route);

  await reconcileOutboundReceipts(env, NOW);

  const query = candidates.calls[0].url.searchParams;
  expect(query.get("limit")).toBe("40");
  expect(query.getAll("created_at")).toEqual([
    "gte.2026-11-08T10:00:00.000Z",
    "lte.2026-11-18T09:00:00.000Z",
  ]);
  expect(query.get("receipt_finalized_at")).toBe("is.null");
  expect(claim.calls[0].body).toEqual({ receipt_checked_at: NOW.toISOString() });
  expect(carrier.calls[0].method).toBe("GET");
  expect(ledger.calls[0].body).toEqual({
    provider: "telnyx",
    event_id: `reconciled:${CARRIER_ID}`,
    event_type: "message.finalized",
    payload: {
      data: {
        id: `reconciled:${CARRIER_ID}`,
        event_type: "message.finalized",
        occurred_at: COMPLETED_AT,
        payload: {
          id: CARRIER_ID,
          direction: "outbound",
          type: "SMS",
          parts: 1,
          to: [{ phone_number: "+14165550100", status: "delivered" }],
        },
      },
    },
  });
});

it("skips vendor calls when a webhook or another job has already claimed the row", async () => {
  const candidates = stubRoute(restMatch(env, "GET", "messages"), () => [
    { id: MESSAGE_ID, telnyx_message_id: CARRIER_ID },
  ]);
  const lostClaim = stubRoute(restMatch(env, "PATCH", "messages"), () => []);
  const carrier = stubRoute((url) => url.pathname === `/v2/messages/${CARRIER_ID}`, () => ({}));
  stubFetch(candidates.route, lostClaim.route, carrier.route);

  await reconcileOutboundReceipts(env, NOW);

  expect(lostClaim.calls).toHaveLength(1);
  expect(carrier.calls).toHaveLength(0);
});

it("does not look up messages on the rig", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await reconcileOutboundReceipts({ ...env, DEPLOY_ENV: "rig" }, NOW);
  expect(fetch).not.toHaveBeenCalled();
});
