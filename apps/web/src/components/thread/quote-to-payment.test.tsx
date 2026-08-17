import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Quote } from "@/lib/api/quotes";

/**
 * #287 — accepted, then paid, without retyping the figure.
 *
 * The issue calls this the loop that "makes both features worth more than
 * either alone". The reason it matters is not convenience: a deposit typed by
 * hand against a price the customer already agreed to is how the two figures
 * come apart, and the dispute that follows is the exact one this whole feature
 * exists to prevent.
 */

let rows: Quote[] = [];
const asked: { amountCents: number; description: string }[] = [];

vi.mock("@/lib/api/quotes", () => ({
  useQuotes: () => ({ data: { data: rows } }),
  useCreateQuote: () => ({ mutate: vi.fn(), isPending: false }),
  useSendQuote: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));

vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: "owner" }),
  useCompanyId: () => "company-1",
}));

import { QuoteStrip } from "./quote-strip";

const quote = (over: Partial<Quote>): Quote =>
  ({
    id: "q1",
    conversation_id: "c1",
    contact_id: "k1",
    amount_cents: 45_000,
    currency: "usd",
    description: "Replace the water heater",
    status: "accepted",
    effective_status: "accepted",
    expires_at: "2026-09-01T00:00:00Z",
    sent_at: "2026-08-10T09:00:00Z",
    viewed_at: null,
    decided_at: new Date().toISOString(),
    created_at: "2026-08-10T09:00:00Z",
    ...over,
  }) as Quote;

const render = () =>
  renderToStaticMarkup(
    <QuoteStrip
      conversationId="c1"
      onAskForPayment={(prefill) => asked.push(prefill)}
    />,
  );

describe("#287 accepted → pay now", () => {
  it("offers to take payment on an accepted quote", () => {
    rows = [quote({})];
    expect(render()).toContain("Ask for payment");
  });

  it("does not offer it on a quote nobody has answered", () => {
    // Asking for money against an unanswered price is the ask this product
    // does not make. The control is absent rather than disabled: a button that
    // should not be pressed is better not drawn.
    rows = [quote({ status: "sent", effective_status: "sent", decided_at: null })];
    expect(render()).not.toContain("Ask for payment");
  });

  it("does not offer it on a lapsed quote", () => {
    rows = [
      quote({ status: "sent", effective_status: "expired", decided_at: null }),
    ];
    expect(render()).not.toContain("Ask for payment");
  });

  it("does not offer it on one the customer declined", () => {
    rows = [quote({ status: "declined", effective_status: "declined" })];
    expect(render()).not.toContain("Ask for payment");
  });
});
