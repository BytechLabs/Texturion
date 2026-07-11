/**
 * /compare/quo ledger data, dated and per-cell sourced (COVERAGE MAP: ledger
 * math $57 seats + ~$5 metered texting + $5/mo per extra number, vs $29 flat;
 * their $19.50 registration disclosure stays in the footnote). Every Quo cell
 * traces to docs/marketing/competitor-site-teardowns.md §5 and
 * quo.com/pricing, re-verified 2026-07-02: Starter $15/user annual or
 * $19/user monthly (Business $23/$33, Scale $35/$47), automated SMS metered
 * at $0.01/segment, extra numbers $5/mo each, $19.50 one-time Campaign
 * Registry review plus $1.50 to $3/mo carrier maintenance, US/Canada calling
 * included. NEVER claim a bundled texting allowance for Quo: it doesn't sell
 * one. Kept in a plain module so compare-facts.test.ts can guard the figures
 * and the no-em-dash law.
 */

import type {
  LedgerColumn,
  LedgerTableRow,
} from "@/components/marketing/compare/ledger-table";

export const QUO_COLUMNS: LedgerColumn[] = [
  { label: "Loonext Starter", highlight: true },
  { label: "Quo Starter", sub: "as of July 2026" },
];

export const QUO_ROWS: LedgerTableRow[] = [
  {
    label: "Seats (3 people)",
    cells: [
      {
        value: "$29 flat, covers 3",
        note: "One price for the whole crew, not per seat.",
      },
      {
        value: "$19/user × 3 = $57",
        note: "Their Starter is $19/user on monthly billing, $15/user if you commit to annual.",
      },
    ],
  },
  {
    label: "500 texts a month, the workload",
    cells: [
      {
        value: "Included",
        note: "Starter's fair-use texting covers this workload comfortably, with room to spare; receiving texts is free and unlimited.",
      },
      {
        value: "~$5, metered",
        note: "No bundled allowance: automated SMS is billed at 1¢ per segment; 500 single-segment texts assumed.",
      },
    ],
  },
  {
    label: "A second number",
    cells: [
      {
        value: "Included on Pro ($79)",
        note: "Pro carries two numbers: two locations, or office and field.",
      },
      {
        value: "$5/mo each",
        note: "Their pricing page lists additional phone numbers at $5 a month.",
      },
    ],
  },
  {
    label: "Monthly carrier maintenance",
    cells: [
      {
        value: "$0",
        note: "Loonext has no recurring carrier line item; registration is $29 once, ever.",
      },
      {
        value: "$1.50 to $3/mo",
        note: "Their published monthly SMS maintenance fee, disclosed plainly on their pricing page.",
      },
    ],
  },
  {
    label: "Phone calls",
    cells: [
      {
        value: "Add-on: Calling, $8/mo",
        note: "Calls to your number forward to your cell, missed ones get a text-back, and you can call customers back from the business number.",
      },
      {
        value: "Included, US and Canada",
        note: "Quo is a full phone system; unlimited US/Canada calling ships on every tier. A real advantage.",
      },
    ],
  },
  {
    label: "Monthly total",
    total: true,
    cells: [
      "$29",
      {
        value: "~$64",
        note: "$57 seats + ~$5 texting + their $1.50 to $3 maintenance; extra numbers $5 each on top.",
      },
    ],
  },
];

export const QUO_FOOTNOTE =
  "Loonext's numbers come straight from our published plans. Quo figures are from quo.com/pricing, re-verified 2026-07-02: Starter $15/user/mo on annual billing or $19/user/mo monthly, automated SMS at $0.01/segment, extra numbers $5/mo each, and a $1.50 to $3 monthly carrier maintenance fee. One-time registration fees are excluded from both totals: ours is $29, and Quo discloses a $19.50 one-time Campaign Registry review right on its pricing page, disclosure done right. If any figure changes, tell us and we'll fix it.";
