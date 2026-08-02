/**
 * /compare/quo ledger data, dated and per-cell sourced (COVERAGE MAP: ledger
 * math $57 seats + ~$5 metered texting + $5/mo per extra number, vs $29 flat;
 * their $19.50 registration disclosure stays in the footnote). Every Quo cell
 * traces to docs/marketing/competitor-site-teardowns.md §5 and
 * quo.com/pricing, re-verified 2026-07-29: Starter $15/user annual or
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

import { COMPARE_AS_OF, COMPARE_VERIFIED_ON } from "../verification";

export const QUO_COLUMNS: LedgerColumn[] = [
  { label: "Loonext Starter", highlight: true },
  { label: "Quo Starter", sub: COMPARE_AS_OF },
];

/** #370: the seat figures the crew-size chart draws, from the same pass. */
export const QUO_SEAT_PRICING = {
  /** Their Starter on MONTHLY billing — the price without a year's commitment. */
  perUserMonthly: 19,
  minimumSeats: 1,
} as const;

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
        value: "Included on every plan",
        note: "Incoming calls ring the crew inside the app and whoever is free answers, missed ones leave a voicemail and get a text-back, and you call customers back from the business number. Generous minutes under fair use; still not a call center.",
      },
      {
        value: "Included, US and Canada",
        note: "Quo is a full phone system; unlimited US/Canada calling ships on every tier. A real advantage if voice is your front door.",
      },
    ],
  },
  {
    // #369: the row nobody else in the category can fill. Our side is verified
    // (#379: no CA->CA registration exists on any network). Their side states
    // only what their own pricing page publishes, because what a competitor
    // does internally for a Canada-only account is not ours to assert.
    label: "Starting up in Canada",
    cells: [
      {
        value: "Day one, no registration",
        note: "A Canadian business texting Canadian customers files no US registration and pays no registration fee, so the number is live and sending the same day. Turning on US texting later is where the $29 and the carrier wait apply.",
      },
      {
        value: "$19.50 review, either way",
        note: "Their pricing publishes one registration path, the US Campaign Registry review, and states no separate route for a Canadian business texting Canadian customers.",
      },
    ],
  },
  {
    // #435: the first row here that is not a price. Our cell is a claim about
    // OUR product; theirs states only what their pricing page prices, because
    // "they cannot do this" is a competitor claim that carries #403's
    // verification burden and goes stale the day they ship it.
    label: "Voicemail you can read",
    cells: [
      {
        value: "Every one, written down",
        note: "A missed call takes a voicemail and we write it out into the thread, so you read it in the inbox instead of dialling in to listen. Included under fair use, not an add-on.",
      },
      {
        value: "Not a priced line",
        note: "Their published pricing covers seats, automated SMS, extra numbers and Sona automation credits. Voicemail transcription is not one of the things it prices.",
      },
    ],
  },
  {
    // #435: the row a discount cannot erase. Both competitors ship AI heavily,
    // so "we have AI and they do not" would be plainly false. What differs is
    // that they METER it and we cap ours, and that is structural.
    label: "AI in the plan, not on the meter",
    cells: [
      {
        value: "Included, never per use",
        note: "Lou drafts a reply for you to send or change, and writes your voicemails down, inside the plan price. We cap what our own AI costs us rather than billing you for each message it touches.",
      },
      {
        value: "1,000 credits, then per call",
        note: "Sona ships on every plan with 1,000 automation credits included. A call costs 100 credits, so past about ten calls it bills from $1.00 down to $0.45 each depending on the credit tier you buy.",
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
  `Loonext's numbers come straight from our published plans. Quo figures are from quo.com/pricing, re-verified ${COMPARE_VERIFIED_ON}: Starter $15/user/mo on annual billing or $19/user/mo monthly, automated SMS at $0.01/segment, extra numbers $5/mo each, and a $1.50 to $3 monthly carrier maintenance fee. Neither total includes AI usage beyond Quo's 1,000 included automation credits, which is about ten calls at 100 credits each. One-time registration fees are excluded from both totals: ours is $29, and Quo discloses a $19.50 one-time Campaign Registry review right on its pricing page, disclosure done right. If any figure changes, tell us and we'll fix it.`;
