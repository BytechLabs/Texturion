import { describe, expect, it } from "vitest";

import type {
  LedgerColumn,
  LedgerTableRow,
} from "@/components/marketing/compare/ledger-table";

import {
  HEYMARKET_COLUMNS,
  HEYMARKET_FOOTNOTE,
  HEYMARKET_ROWS,
} from "./heymarket/page-data";
import {
  PODIUM_COLUMNS,
  PODIUM_FOOTNOTE,
  PODIUM_ROWS,
} from "./podium/page-data";
import { QUO_COLUMNS, QUO_FOOTNOTE, QUO_ROWS } from "./quo/page-data";

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
  {
    name: "podium",
    columns: PODIUM_COLUMNS,
    rows: PODIUM_ROWS,
    footnote: PODIUM_FOOTNOTE,
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
      const competitor = page.columns.find((c) => !c.highlight);
      expect(competitor?.sub).toBe("as of July 2026");
      expect(page.footnote).toContain("2026-07-02");
      expect(page.footnote).toContain("tell us and we'll");
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

describe("podium ledger facts (the Not published column is the argument)", () => {
  it("every Podium cell except the total reads exactly Not published", () => {
    for (const row of PODIUM_ROWS) {
      if (row.total) continue;
      const cell = row.cells[1];
      const value = typeof cell === "string" ? cell : cell.value;
      if (row.label === "How you buy") {
        expect(value).toBe("Watch a demo");
      } else {
        expect(value).toBe("Not published");
      }
    }
    const total = PODIUM_ROWS.find((r) => r.total);
    expect(JSON.stringify(total?.cells)).toContain("Ask their sales team");
  });

  it("prints no invented Podium dollar figure anywhere (Law 7)", () => {
    for (const s of allStrings(PAGES[1]!)) {
      // The only dollars on this page's data are Loonext's own $29/$79.
      const dollars = s.match(/\$\d+(?:\.\d+)?/g) ?? [];
      for (const d of dollars) {
        expect(["$29", "$79"], `${d} in: ${s}`).toContain(d);
      }
    }
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

  it("concedes Quo's included calling outright and states our $8/mo forwarding add-on", () => {
    expect(flat).toContain("Included, US and Canada");
    expect(flat).toContain("$8/mo");
  });

  it("credits their $19.50 registration disclosure in the footnote (deck order)", () => {
    expect(QUO_FOOTNOTE).toContain("$19.50");
    expect(QUO_FOOTNOTE).toContain("disclosure done right");
  });
});
