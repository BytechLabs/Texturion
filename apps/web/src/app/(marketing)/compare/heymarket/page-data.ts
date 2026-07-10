/**
 * /compare/heymarket ledger data, dated and per-cell sourced (COVERAGE MAP:
 * ledger math $172 vs $29). Every Heymarket figure traces to
 * docs/marketing/competitor-site-teardowns.md and heymarket.com/pricing,
 * re-verified 2026-07-02: Standard $49/user/mo (annual), 2-user minimum,
 * SMS/MMS $0.03/segment, $10/mo-per-campaign 10DLC, "Book a free demo" CTAs,
 * annual headline up to 18% off. Kept in a plain module so
 * compare-facts.test.ts can guard the figures and the no-em-dash law.
 */

import type {
  LedgerColumn,
  LedgerTableRow,
} from "@/components/marketing/compare/ledger-table";

export const HEYMARKET_COLUMNS: LedgerColumn[] = [
  { label: "Loonext Starter", highlight: true },
  { label: "Heymarket Standard", sub: "as of July 2026" },
];

export const HEYMARKET_ROWS: LedgerTableRow[] = [
  {
    label: "Seats (3 people)",
    cells: [
      {
        value: "$29 flat, covers 3",
        note: "One price for the whole crew, not per seat.",
      },
      {
        value: "$49/user × 3 = $147",
        note: "Standard is $49/user/mo on annual billing with a 2-user minimum, so the floor is $98/mo before a single text.",
      },
    ],
  },
  {
    label: "500 texts a month",
    cells: [
      {
        value: "Included",
        note: "Starter's fair-use texting covers this workload comfortably, with room to spare; receiving texts is free and unlimited.",
      },
      {
        value: "~$15",
        note: "SMS/MMS billed separately at $0.03 per message segment; 500 single-segment texts assumed, longer texts cost more.",
      },
    ],
  },
  {
    label: "Carrier / 10DLC fee",
    cells: [
      {
        value: "$0/mo",
        note: "One $29 registration fee, charged once ever; Canadian-only texting never pays it.",
      },
      {
        value: "$10/mo per campaign",
        note: "A recurring compliance line item on their pricing page, not one-time.",
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
        value: "Book a free demo",
        note: "Prices are listed, but every paid tier CTA routes to a demo first.",
      },
    ],
  },
  {
    label: "Contract",
    cells: [
      {
        value: "Month to month",
        note: "Cancel anytime in billing settings.",
      },
      {
        value: "Annual headline",
        note: "Pricing leads with annual billing, save up to 18%.",
      },
    ],
  },
  {
    label: "Monthly total",
    total: true,
    cells: ["$29", "~$172/mo"],
  },
];

export const HEYMARKET_FOOTNOTE =
  "Loonext's numbers come straight from our published plans. Heymarket figures are from heymarket.com/pricing, re-verified 2026-07-02: Standard $49/user/mo (annual) with a 2-user minimum, SMS/MMS $0.03/segment, and a $10/mo-per-campaign 10DLC fee. The ~$172 total assumes 3 seats, 500 single-segment texts, and one campaign; texts over 160 characters count as multiple segments and cost more. One-time registration fees are excluded from both totals (ours is $29). If any figure changes, tell us and we'll correct it.";
