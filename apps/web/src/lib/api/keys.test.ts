/**
 * #607 — the two payment keys are shaped differently on purpose, and the
 * difference is worth exactly one thing: whether a broad `[companyId]`
 * invalidation reaches them.
 *
 * That is only observable through React Query's own prefix matching, so these
 * assertions go through a real QueryClient rather than reading the tuples back.
 * A test that compared the arrays would pass for any two tuples somebody typed
 * consistently in both places, including the wrong ones — which is precisely how
 * the requests key spent its whole life outside every self-heal path in the app.
 */
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { keys } from "./keys";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const CONVERSATION = "33333333-3333-3333-3333-333333333333";

/**
 * Did `invalidateQueries` actually mark this one?
 *
 * `state.isInvalidated` and not `isStale()`: a cached query with the default
 * staleTime is stale the instant it lands, so `isStale` would read true whether
 * or not the invalidation ever matched it.
 */
function invalidated(client: QueryClient, key: readonly unknown[]): boolean {
  const query = client.getQueryCache().find({ queryKey: [...key] });
  if (!query) throw new Error(`nothing cached at ${JSON.stringify(key)}`);
  return query.state.isInvalidated;
}

describe("keys.payments", () => {
  it("puts a thread's payment requests where the company-wide sweep reaches them", async () => {
    // The sweep is `refetchFirstPages` (reconnect) and `resyncActive` (the
    // away-tab net) in lib/realtime/provider.tsx, both of which invalidate the
    // `[companyId]` prefix and nothing else. Since #607 made the payment strip
    // live off a broadcast, a key outside that prefix has no net under it: one
    // dropped frame and "Requested" stays on screen for money that has arrived.
    const client = new QueryClient();
    client.setQueryData(keys.payments.requests(COMPANY, CONVERSATION), {
      payment_requests: [],
    });

    await client.invalidateQueries({ queryKey: [COMPANY] });

    expect(invalidated(client, keys.payments.requests(COMPANY, CONVERSATION))).toBe(
      true,
    );
  });

  it("keeps the Stripe-backed account read OUT of that sweep", async () => {
    // The opposite rule, and it costs real money to get wrong. GET
    // /v1/payments/account refreshes from Stripe on every read, and
    // `usePayoutAccount` is mounted by the composer — so on every open thread,
    // for every member. Under the company prefix, each away-tab resync would
    // spend a Stripe API call per member to re-read a workspace setting that
    // moves when an owner finishes onboarding and at no other time.
    const client = new QueryClient();
    client.setQueryData(keys.payments.account(COMPANY), { connected: true });

    await client.invalidateQueries({ queryKey: [COMPANY] });

    expect(invalidated(client, keys.payments.account(COMPANY))).toBe(false);
  });

  it("still separates the two workspaces a member belongs to", async () => {
    // G12. Both keys carry the company id somewhere; the point of checking is
    // that neither shape lost it while being moved.
    const other = "22222222-2222-2222-2222-222222222222";
    const client = new QueryClient();
    client.setQueryData(keys.payments.requests(other, CONVERSATION), {
      payment_requests: [],
    });
    client.setQueryData(keys.payments.account(other), { connected: true });

    await client.invalidateQueries({ queryKey: [COMPANY] });
    await client.invalidateQueries({
      queryKey: keys.payments.requests(COMPANY, CONVERSATION),
    });
    await client.invalidateQueries({ queryKey: keys.payments.account(COMPANY) });

    expect(invalidated(client, keys.payments.requests(other, CONVERSATION))).toBe(
      false,
    );
    expect(invalidated(client, keys.payments.account(other))).toBe(false);
  });
});
