import { describe, expect, it } from "vitest";

import type {
  LedgerColumn,
  LedgerTableRow,
} from "@/components/marketing/compare/ledger-table";

import {
  HEYMARKET_COLUMNS,
  HEYMARKET_FOOTNOTE,
  HEYMARKET_ROWS,
  HEYMARKET_SEAT_PRICING,
} from "./heymarket/page-data";
import {
  QUO_COLUMNS,
  QUO_FOOTNOTE,
  QUO_ROWS,
  QUO_SEAT_PRICING,
} from "./quo/page-data";
import {
  COMPARE_AS_OF,
  COMPARE_RECHECK_AFTER,
  COMPARE_VERIFIED_ON,
  asOfLabel,
} from "./verification";

interface PageData {
  name: string;
  columns: LedgerColumn[];
  rows: LedgerTableRow[];
  footnote: string;
}

const PAGES: PageData[] = [
  {
    name: "heymarket",
    columns: HEYMARKET_COLUMNS,
    rows: HEYMARKET_ROWS,
    footnote: HEYMARKET_FOOTNOTE,
  },
  { name: "quo", columns: QUO_COLUMNS, rows: QUO_ROWS, footnote: QUO_FOOTNOTE },
];

function allStrings(page: PageData): string[] {
  const out: string[] = [page.footnote];
  for (const col of page.columns) {
    out.push(col.label);
    if (col.sub) out.push(col.sub);
  }
  for (const row of page.rows) {
    out.push(row.label);
    for (const cell of row.cells) {
      out.push(typeof cell === "string" ? cell : cell.value);
      if (typeof cell !== "string" && cell.note) out.push(cell.note);
    }
  }
  return out;
}

describe("compare ledgers (shared laws)", () => {
  for (const page of PAGES) {
    it(`${page.name}: no em-dashes or en-dash ranges in any rendered string (Law 6)`, () => {
      for (const s of allStrings(page)) {
        expect(s, s).not.toMatch(/[—–]/);
      }
    });

    it(`${page.name}: the competitor column is dated and the footnote states the verification date`, () => {
      // #403: derived from COMPARE_VERIFIED_ON, never a literal. The old
      // assertions pinned "as of July 2026" and "2026-07-02" as strings, so the
      // suite would have passed forever asserting a verification nobody had
      // repeated — it guaranteed the page CLAIMS a date, not that the date is
      // true. Deriving both means the dateline cannot drift from the data.
      const competitor = page.columns.find((c) => !c.highlight);
      expect(competitor?.sub).toBe(COMPARE_AS_OF);
      expect(page.footnote).toContain(COMPARE_VERIFIED_ON);
      expect(page.footnote).toContain("tell us and we'll");
    });

    it(`${page.name}: states the Canada day-one row nobody else can fill (#369)`, () => {
      const row = page.rows.find((r) => r.label === "Starting up in Canada");
      expect(row, "the Canada row is the one differentiator competitors cannot match").toBeDefined();
      const ours = row?.cells[0];
      const value = typeof ours === "string" ? ours : ours?.value;
      const note = typeof ours === "string" ? "" : (ours?.note ?? "");
      expect(value).toBe("Day one, no registration");
      // The claim is a trap without its boundary: instant applies to CANADIAN
      // destinations, and the US$29 plus the carrier wait return the moment
      // they text a US number. #369 says to be exact about this or not say it.
      expect(note).toContain("Canadian customers");
      expect(note).toContain("US texting later");
      expect(note).toContain("$29");
    });

    it(`${page.name}: the Loonext column is the highlighted one and totals $29`, () => {
      expect(page.columns[0]?.highlight).toBe(true);
      expect(page.columns[0]?.label).toBe("Loonext Starter");
      const total = page.rows.find((r) => r.total);
      const loonextTotal = total?.cells[0];
      expect(
        typeof loonextTotal === "string" ? loonextTotal : loonextTotal?.value,
      ).toBe("$29");
    });

    it(`${page.name}: the 500-texts row is an explicit workload scenario, never an allowance claim (#121)`, () => {
      const workload = page.rows.find((r) => r.label.includes("500"));
      expect(workload?.label).toBe("500 texts a month, the workload");
      const loonextCell = workload?.cells[0];
      const note =
        typeof loonextCell === "string" ? "" : (loonextCell?.note ?? "");
      expect(note).toContain("fair-use texting covers this workload");
    });
  }
});

describe("heymarket ledger facts (their published prices, July 2026)", () => {
  const flat = HEYMARKET_ROWS.flatMap((r) =>
    r.cells.map((c) => (typeof c === "string" ? c : `${c.value} ${c.note ?? ""}`)),
  ).join(" ");

  it("carries the $49/user × 3 = $147 seat math and the 2-user minimum", () => {
    expect(flat).toContain("$49/user × 3 = $147");
    expect(flat).toContain("2-user minimum");
  });

  it("states their 3¢/segment texting and $10/mo campaign fee, and the ~$172 total", () => {
    expect(flat).toContain("$0.03 per message segment");
    expect(flat).toContain("$10/mo per campaign");
    const total = HEYMARKET_ROWS.find((r) => r.total);
    expect(JSON.stringify(total?.cells)).toContain("~$172");
  });

  it("labels the single-segment assumption instead of hiding it", () => {
    expect(flat + HEYMARKET_FOOTNOTE).toContain("single-segment");
  });
});

describe("quo ledger facts (their published prices, July 2026)", () => {
  const flat = QUO_ROWS.flatMap((r) =>
    r.cells.map((c) => (typeof c === "string" ? c : `${c.value} ${c.note ?? ""}`)),
  ).join(" ");

  it("carries the $19/user × 3 = $57 monthly-billing seat math", () => {
    expect(flat).toContain("$19/user × 3 = $57");
    expect(flat).toContain("monthly billing");
  });

  it("never claims a bundled texting allowance for Quo, only the 1¢/segment meter", () => {
    expect(flat).toContain("No bundled allowance");
    expect(flat).toContain("1¢ per segment");
  });

  it("keeps the $5/mo extra-number price and their carrier maintenance range", () => {
    expect(flat).toContain("$5/mo each");
    expect(flat).toContain("$1.50 to $3/mo");
  });

  it("concedes Quo's full-phone-system calling and states our included calling honestly (#134/D42)", () => {
    expect(flat).toContain("Included, US and Canada");
    // #134/D42: the $8 Calling add-on retired — calling is included on every
    // plan, and the cell must never sell it as an add-on again.
    expect(flat).toContain("Included on every plan");
    expect(flat).not.toContain("Add-on: Calling");
    expect(flat).not.toContain("$8");
    // #133/D38: calling covers both directions, not forwarding alone.
    expect(flat).toContain("call customers back from the business number");
    // #491/D43: cell forwarding is DELETED — the app is the phone. The row
    // used to say calls "forward to your cell", which sold a capability the
    // product had removed.
    expect(flat).not.toContain("forward");
    expect(flat).toContain("ring the crew inside the app");
    // Still honest about what it isn't. "Full phone system" was the wrong
    // disclaimer once a softphone shipped: what Loonext is not is a CALL
    // CENTER — no menus, no queues, no desk phones.
    expect(flat).toContain("not a call center");
  });

  it("credits their $19.50 registration disclosure in the footnote (deck order)", () => {
    expect(QUO_FOOTNOTE).toContain("$19.50");
    expect(QUO_FOOTNOTE).toContain("disclosure done right");
  });
});

/**
 * #403 — the staleness guard the literal made impossible.
 *
 * A comparative claim about somebody else's price is legally exposed and rots
 * without anyone touching the file. These fail when the ledgers are overdue,
 * which is the only kind of reminder that survives a busy quarter.
 */
describe("competitor claims stay fresh (#403)", () => {
  it("is still inside its recheck window", () => {
    expect(
      new Date(COMPARE_RECHECK_AFTER).getTime(),
      `The competitor ledgers were verified on ${COMPARE_VERIFIED_ON} and are overdue. ` +
        "Open heymarket.com/pricing and quo.com/pricing, check EVERY figure the " +
        "ledgers and footnotes state, then move COMPARE_VERIFIED_ON and " +
        "COMPARE_RECHECK_AFTER in compare/verification.ts. Do not move them " +
        "without looking: publishing a date is only worth anything if it is true.",
    ).toBeGreaterThan(Date.now());
  });

  it("recheck is after verification, and within a year of it", () => {
    const verified = new Date(COMPARE_VERIFIED_ON).getTime();
    const recheck = new Date(COMPARE_RECHECK_AFTER).getTime();
    expect(recheck).toBeGreaterThan(verified);
    // A window long enough to be useless is the literal's failure with extra
    // steps.
    expect(recheck - verified).toBeLessThanOrEqual(366 * 24 * 60 * 60 * 1000);
  });

  it("derives the dateline from the date", () => {
    expect(asOfLabel("2026-07-29")).toBe("as of July 2026");
    expect(asOfLabel("2027-01-02")).toBe("as of January 2027");
    expect(COMPARE_AS_OF).toBe(asOfLabel(COMPARE_VERIFIED_ON));
  });
});

describe("#370 the crew-size chart states THIS page's rival rate", () => {
  // The bug this exists to stop, which shipped: the slider carried one
  // hardcoded $19 rate and both comparison pages rendered it. On the Heymarket
  // page that drew Quo's seat price under prose correctly saying "$98 floor" —
  // the page argued against itself and understated a competitor by 2.6x.
  //
  // Understating a rival is the safe direction to be wrong in. It is still a
  // dated, sourced, public claim about somebody else's price, which is the kind
  // that gets expensive rather than merely wrong, and it is why every other
  // figure on these pages is already guarded.
  const cases = [
    { name: "Heymarket", pricing: HEYMARKET_SEAT_PRICING, rows: HEYMARKET_ROWS },
    { name: "Quo", pricing: QUO_SEAT_PRICING, rows: QUO_ROWS },
  ];

  it.each(cases)("$name's rate appears in its own ledger", ({ pricing, rows }) => {
    // The ledger's seat row spells the arithmetic out in prose. If the chart's
    // rate is right, that rate is a substring of it — which ties the two
    // together without asking the test to re-derive the sentence.
    const seatRow = rows.find((row) => /seat/i.test(row.label));
    expect(seatRow).toBeDefined();
    const prose = JSON.stringify(seatRow);
    expect(prose).toContain(`$${pricing.perUserMonthly}`);
  });

  it.each(cases)("$name's seat minimum is at least one", ({ pricing }) => {
    // A minimum below one is not a floor, it is a bug that would understate
    // their entry price for a solo operator — the exact figure this section is
    // most useful for.
    expect(pricing.minimumSeats).toBeGreaterThanOrEqual(1);
  });

  it("does not give two different rivals the same seat price", () => {
    // The shape of the original defect. If these ever match again it is far
    // likelier to be a copied constant than a coincidence.
    expect(HEYMARKET_SEAT_PRICING.perUserMonthly).not.toBe(
      QUO_SEAT_PRICING.perUserMonthly,
    );
  });
});
