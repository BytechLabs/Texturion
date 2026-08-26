import type {
  LedgerColumn,
  LedgerTableRow,
} from "@/components/marketing/compare/ledger-table";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { compareQuoCopy } from "@/i18n/marketing/compare-quo";

import {
  compareAsOf,
  COMPARE_VERIFIED_ON,
} from "../verification";

export const QUO_SEAT_PRICING = {
  perUserMonthly: 19,
  minimumSeats: 1,
} as const;

export function quoColumns(locale: MarketingLocale = "en"): LedgerColumn[] {
  const copy = compareQuoCopy(locale);
  return [
    { label: copy.colLoonext, highlight: true },
    { label: copy.colRival, sub: compareAsOf(locale) },
  ];
}

export function quoRows(locale: MarketingLocale = "en"): LedgerTableRow[] {
  const c = compareQuoCopy(locale);
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
      label: c.numberLabel,
      cells: [
        { value: c.numberOursValue, note: c.numberOursNote },
        { value: c.numberRivalValue, note: c.numberRivalNote },
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
      label: c.callsLabel,
      cells: [
        { value: c.callsOursValue, note: c.callsOursNote },
        { value: c.callsRivalValue, note: c.callsRivalNote },
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
      cells: [
        "$29",
        { value: "~$64", note: c.totalRivalNote },
      ],
    },
  ];
}

export function quoFootnote(locale: MarketingLocale = "en"): string {
  return compareQuoCopy(locale).footnote.replace("{date}", COMPARE_VERIFIED_ON);
}

export const QUO_COLUMNS = quoColumns();
export const QUO_ROWS = quoRows();
export const QUO_FOOTNOTE = quoFootnote();
