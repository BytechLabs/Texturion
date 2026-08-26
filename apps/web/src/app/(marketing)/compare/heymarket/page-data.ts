import type {
  LedgerColumn,
  LedgerTableRow,
} from "@/components/marketing/compare/ledger-table";
import { compareHeymarketCopy } from "@/i18n/marketing/compare-heymarket";
import type { MarketingLocale } from "@/i18n/marketing/footer";

import {
  compareAsOf,
  COMPARE_VERIFIED_ON,
} from "../verification";

export const HEYMARKET_SEAT_PRICING = {
  perUserMonthly: 49,
  minimumSeats: 2,
} as const;

export function heymarketColumns(
  locale: MarketingLocale = "en",
): LedgerColumn[] {
  const copy = compareHeymarketCopy(locale);
  return [
    { label: copy.colLoonext, highlight: true },
    { label: copy.colRival, sub: compareAsOf(locale) },
  ];
}

export function heymarketRows(
  locale: MarketingLocale = "en",
): LedgerTableRow[] {
  const c = compareHeymarketCopy(locale);
  return [
    {
      label: c.seatsLabel,
      cells: [
        { value: c.seatsOursValue, note: c.seatsOursNote },
        { value: c.seatsRivalValue, note: c.seatsRivalNote },
      ],
    },
    {
      label: c.workloadLabel,
      cells: [
        { value: c.workloadOursValue, note: c.workloadOursNote },
        { value: c.workloadRivalValue, note: c.workloadRivalNote },
      ],
    },
    {
      label: c.carrierLabel,
      cells: [
        { value: c.carrierOursValue, note: c.carrierOursNote },
        { value: c.carrierRivalValue, note: c.carrierRivalNote },
      ],
    },
    {
      label: c.buyLabel,
      cells: [
        { value: c.buyOursValue, note: c.buyOursNote },
        { value: c.buyRivalValue, note: c.buyRivalNote },
      ],
    },
    {
      label: c.contractLabel,
      cells: [
        { value: c.contractOursValue, note: c.contractOursNote },
        { value: c.contractRivalValue, note: c.contractRivalNote },
      ],
    },
    {
      label: c.canadaLabel,
      cells: [
        { value: c.canadaOursValue, note: c.canadaOursNote },
        { value: c.canadaRivalValue, note: c.canadaRivalNote },
      ],
    },
    {
      label: c.voicemailLabel,
      cells: [
        { value: c.voicemailOursValue, note: c.voicemailOursNote },
        { value: c.voicemailRivalValue, note: c.voicemailRivalNote },
      ],
    },
    {
      label: c.aiLabel,
      cells: [
        { value: c.aiOursValue, note: c.aiOursNote },
        { value: c.aiRivalValue, note: c.aiRivalNote },
      ],
    },
    {
      label: c.totalLabel,
      total: true,
      cells: ["$29", "~$172/mo"],
    },
  ];
}

export function heymarketFootnote(locale: MarketingLocale = "en"): string {
  return compareHeymarketCopy(locale).footnote.replace(
    "{date}",
    COMPARE_VERIFIED_ON,
  );
}

export const HEYMARKET_COLUMNS = heymarketColumns();
export const HEYMARKET_ROWS = heymarketRows();
export const HEYMARKET_FOOTNOTE = heymarketFootnote();
