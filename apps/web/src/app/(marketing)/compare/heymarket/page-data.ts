/**
 * /compare/heymarket ledger data, dated and per-cell sourced (COVERAGE MAP:
 * ledger math $172 vs $29). Every Heymarket figure traces to
 * docs/marketing/competitor-site-teardowns.md and heymarket.com/pricing,
 * re-verified 2026-07-29: Standard $49/user/mo (annual), 2-user minimum,
 * SMS/MMS $0.03/segment, $10/mo-per-campaign 10DLC, "Book a free demo" CTAs,
 * annual headline up to 18% off. Kept in a plain module so
 * compare-facts.test.ts can guard the figures and the no-em-dash law.
 */

import type {
  LedgerColumn,
  LedgerTableRow,
} from "@/components/marketing/compare/ledger-table";

import { COMPARE_AS_OF, COMPARE_VERIFIED_ON } from "../verification";

export const HEYMARKET_COLUMNS: LedgerColumn[] = [
  { label: "Loonext Starter", highlight: true },
  { label: "Heymarket Standard", sub: COMPARE_AS_OF },
];

/**
 * #370: the seat figures the crew-size chart draws, from the same verification
 * pass as the ledger below. Stated here rather than inside the slider because
 * the slider is shared — it previously carried ONE hardcoded rate, so this page
 * drew Quo's $19 line under prose that correctly said $98.
 */
export const HEYMARKET_SEAT_PRICING = {
  perUserMonthly: 49,
  /** They will not sell one seat, so a solo operator pays for two. */
  minimumSeats: 2,
} as const;

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
    label: "500 texts a month, the workload",
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
        value: "$10/mo campaign, either way",
        note: "Their pricing publishes one compliance path, a monthly per-campaign 10DLC charge, and does not mention Canada at all.",
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
        note: "Their published pricing covers seats, message segments and AI Agent messages. Voicemail transcription is not one of the things it prices.",
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
        value: "3x the base rate",
        note: "Their pricing page prices each AI Agent message at three times the $0.03 base rate, charged on top of seats.",
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
  `Loonext's numbers come straight from our published plans. Heymarket figures are from heymarket.com/pricing, re-verified ${COMPARE_VERIFIED_ON}: Standard $49/user/mo (annual) with a 2-user minimum, SMS/MMS $0.03/segment, and a $10/mo-per-campaign 10DLC fee. The ~$172 total assumes 3 seats, 500 single-segment texts, and one campaign; texts over 160 characters count as multiple segments and cost more. Neither total includes any AI usage: theirs bills AI Agent messages at 3x the base rate, and ours is included. One-time registration fees are excluded from both totals (ours is $29). If any figure changes, tell us and we'll correct it.`;
