/**
 * /compare/podium ledger data, dated and per-cell sourced (COVERAGE MAP: the
 * "Not published" column IS the argument). Every Podium cell traces to
 * docs/marketing/competitor-site-teardowns.md §6 and podium.com/pricing,
 * re-verified 2026-07-02: no dollar amounts anywhere on the pricing page
 * ("talk to our sales team for details"), a sales phone number in the nav,
 * "Watch a demo" CTAs, no self-serve signup, and a pricing FAQ that mentions
 * Bulk Message credits and a base 10DLC fee without numbers. We print no
 * reported/estimated Podium dollar figure: the visible price is the argument
 * (Law 7, factual only). Kept in a plain module so compare-facts.test.ts can
 * guard the figures and the no-em-dash law.
 */

import type {
  LedgerColumn,
  LedgerTableRow,
} from "@/components/marketing/compare/ledger-table";

export const PODIUM_COLUMNS: LedgerColumn[] = [
  { label: "Loonext Starter", highlight: true },
  { label: "Podium", sub: "as of July 2026" },
];

export const PODIUM_ROWS: LedgerTableRow[] = [
  {
    label: "Monthly software",
    cells: [
      {
        value: "$29 flat, covers 3",
        note: "One price for the whole crew; $79 covers 10 and a second number.",
      },
      {
        value: "Not published",
        note: 'Their pricing page shows no dollar amounts: "talk to our sales team for details."',
      },
    ],
  },
  {
    label: "500 texts a month",
    cells: [
      {
        value: "Included",
        note: "500 outgoing texts ship with Starter; receiving is free and unlimited.",
      },
      {
        value: "Not published",
        note: 'Their pricing FAQ mentions "Bulk Messages credits" without a price.',
      },
    ],
  },
  {
    label: "Carrier / 10DLC fee",
    cells: [
      {
        value: "$29 one time, ever",
        note: "Charged once, even if you cancel and come back; Canadian-only texting never pays it.",
      },
      {
        value: "Not published",
        note: 'Their pricing FAQ references a "base 10DLC fee" without an amount.',
      },
    ],
  },
  {
    label: "Contract terms",
    cells: [
      {
        value: "Month to month",
        note: "Cancel anytime in billing settings, no phone call.",
      },
      {
        value: "Not published",
        note: "No trial or contract terms appear on their pricing page.",
      },
    ],
  },
  {
    label: "How you buy",
    cells: [
      {
        value: "Self-serve, pay online",
        note: "The price is on the page and the button starts your account.",
      },
      {
        value: "Watch a demo",
        note: "No self-serve signup; a sales phone number sits in their site nav.",
      },
    ],
  },
  {
    label: "Monthly total",
    total: true,
    cells: ["$29", "Ask their sales team"],
  },
];

export const PODIUM_FOOTNOTE =
  "Loonext's numbers come straight from our published plans. Every Podium cell reflects podium.com/pricing as re-verified 2026-07-02, which publishes no dollar amounts, no trial terms, and no contract terms; we won't print a Podium price they haven't. One-time registration fees are excluded from the totals (ours is $29). If Podium publishes prices, tell us and we'll put them in this table.";
