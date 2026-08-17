import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Quote } from "@/lib/api/quotes";

/**
 * #287 — the queue an owner opens every morning.
 *
 * The issue calls outstanding quotes "the highest-value thing in the business"
 * and says the product "cannot tell you which ones are outstanding". A count
 * cannot answer that: "3 waiting" is a fact, and the work is knowing WHICH
 * three.
 *
 * What these pin is the ORDER, which is the part that makes it a queue rather
 * than a list. A quote sent this morning needs nothing; one sent nine days ago
 * is the one going cold, and it belongs at the top.
 */

let rows: Quote[] = [];

vi.mock("@/lib/api/quotes", () => ({
  useOutstandingQuotes: () => ({ data: { data: rows } }),
}));

vi.mock("@/lib/api/calls", () => ({ useCalls: () => ({ data: undefined }) }));

import { OutstandingQuotesSection } from "./outstanding-quotes-section";

const quote = (over: Partial<Quote>): Quote =>
  ({
    id: "q1",
    conversation_id: "c1",
    contact_id: "k1",
    amount_cents: 45_000,
    currency: "usd",
    description: "Water heater",
    status: "sent",
    effective_status: "sent",
    expires_at: "2026-09-01T00:00:00Z",
    sent_at: "2026-08-10T09:00:00Z",
    viewed_at: null,
    decided_at: null,
    created_at: "2026-08-10T09:00:00Z",
    ...over,
  }) as Quote;

const render = () => renderToStaticMarkup(<OutstandingQuotesSection />);

describe("#287 outstanding quotes", () => {
  it("says nothing at all when everything has been answered", () => {
    // Not an encouraging zero. A workspace that has answered everything is
    // told nothing, the same way the measures disappear rather than
    // congratulating somebody for an empty list.
    rows = [];
    expect(render()).toBe("");
  });

  it("puts the oldest at the top, because that is the one going cold", () => {
    rows = [
      quote({ id: "new", description: "Sent today", sent_at: "2026-08-16T09:00:00Z" }),
      quote({ id: "old", description: "Sent nine days ago", sent_at: "2026-08-07T09:00:00Z" }),
    ];
    const html = render();
    expect(html.indexOf("Sent nine days ago")).toBeLessThan(
      html.indexOf("Sent today"),
    );
  });

  it("carries the amount and links into the thread it was quoted in", () => {
    // A row that names a price and cannot be acted on is a notification. The
    // whole value is being one tap from the conversation.
    rows = [quote({ conversation_id: "conv-42", amount_cents: 125_00 })];
    const html = render();
    expect(html).toContain("/inbox/conv-42");
    expect(html).toContain("125");
  });

  it("shows when it went out, not when it expires", () => {
    // "Sent 9 days ago" is the fact that decides whether to chase. The
    // deadline is the reason the row will vanish on its own, which is not a
    // thing anybody acts on.
    rows = [quote({ sent_at: "2026-08-07T09:00:00Z", expires_at: "2099-01-01T00:00:00Z" })];
    expect(render()).not.toContain("2099");
  });
});
