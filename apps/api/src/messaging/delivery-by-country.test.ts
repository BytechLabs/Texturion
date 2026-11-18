import { describe, expect, it } from "vitest";

import { DELIVERY_MIN_SAMPLE, summarize } from "./delivery-by-country";

function totals(areaCode: string | null, delivered: number, failed: number, pending = 0) {
  return { area_code: areaCode, delivered, failed, pending, sent: delivered + failed + pending };
}

describe("delivery totals by country", () => {
  it("counts pending separately from settled", () => {
    const rows = summarize([totals("613", 1, 0, 2)]);
    expect(rows[0]).toMatchObject({ pending: 2, delivered: 1, failed: 0 });
  });

  it("combines Canada's area codes separately from the US", () => {
    const rows = summarize([
      totals("613", 700, 25, 2),
      totals("416", 500, 25, 7),
      totals("415", 2, 0),
    ]);
    expect(rows.find((row) => row.country === "CA")).toMatchObject({
      sent: 1259, delivered: 1200, failed: 50, pending: 9, rate: 0.96,
    });
    expect(rows.find((row) => row.country === "US")).toMatchObject({
      delivered: 2, failed: 0, rate: null,
    });
  });

  it("keeps destinations without a known US or Canadian area code", () => {
    expect(summarize([totals("246", 1, 0), totals(null, 0, 1)])).toEqual([
      { country: "other", sent: 2, delivered: 1, failed: 1, pending: 0, rate: null },
    ]);
  });

  it("reports a rate once the settled sample reaches the minimum", () => {
    const [canada] = summarize([totals("613", 42, 18)]);
    expect(canada.rate).toBeCloseTo(0.7);
    expect(summarize([totals("415", DELIVERY_MIN_SAMPLE, 0)])[0].rate).toBe(1);
  });

  it("omits a rate for small settled samples", () => {
    const [canada] = summarize([totals("613", 2, 1)]);
    expect(canada.rate).toBeNull();
  });
});
