/**
 * #379 ask 4 — the only signal that would ever tell us Canadian traffic is
 * being filtered.
 *
 * A carrier dropping unregistered A2P messages returns no error: accepted,
 * billed, marked sent, never arrives. There is nothing to catch except the
 * shape of the numbers, and only when they are split by where they were going.
 */
import { describe, expect, it } from "vitest";

import {
  DELIVERY_MIN_SAMPLE,
  summarize,
  underperforming,
} from "./delivery-by-country";

/** A settled outbound message to a given destination. */
function msg(phone: string, status: "delivered" | "failed") {
  return { status, conversations: { contacts: { phone_e164: phone } } };
}

// 613 is Ottawa (CA), 415 is San Francisco (US), 246 is Barbados — all +1.
const CA = "+16135551001";
const US = "+14155551001";
const CARIBBEAN = "+12465551001";

describe("splitting delivery by where the message was going", () => {
  it("counts pending separately from settled", () => {
    // #426: a message we have accepted but no carrier has acknowledged is not
    // a failure, and calling it one would be the product lying about itself.
    const rows = summarize([
      { status: "queued", conversations: { contacts: { phone_e164: CA } } },
      { status: "sent", conversations: { contacts: { phone_e164: CA } } },
      msg(CA, "delivered"),
    ]);
    expect(rows[0]).toMatchObject({ pending: 2, delivered: 1, failed: 0 });
  });

  it("separates Canada from the US even though both are +1", () => {
    // The whole point: one +1 bucket would average the filtered country away
    // against the healthy one and show nothing wrong.
    const rows = summarize([
      msg(CA, "delivered"),
      msg(CA, "failed"),
      msg(US, "delivered"),
      msg(US, "delivered"),
    ]);
    const ca = rows.find((r) => r.country === "CA");
    const us = rows.find((r) => r.country === "US");
    // Counts split correctly. The RATE is null on both because four messages
    // is not evidence — see the small-sample test below.
    expect(ca).toMatchObject({ delivered: 1, failed: 1, rate: null });
    expect(us).toMatchObject({ delivered: 2, failed: 0, rate: null });
  });

  it("keeps unrecognised NANP destinations visible rather than dropping them", () => {
    // The Caribbean shares +1 and bills at international rates, so a surprise
    // there is worth seeing.
    const rows = summarize([msg(CARIBBEAN, "delivered")]);
    expect(rows.find((r) => r.country === "other")?.delivered).toBe(1);
  });

  it("ignores a message with no contact number", () => {
    const rows = summarize([
      { status: "delivered", conversations: null },
      { status: "delivered", conversations: { contacts: null } },
      msg(CA, "delivered"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sent).toBe(1);
  });
});

describe("what is worth waking someone for", () => {
  function bulk(phone: string, delivered: number, failed: number) {
    return [
      ...Array.from({ length: delivered }, () => msg(phone, "delivered")),
      ...Array.from({ length: failed }, () => msg(phone, "failed")),
    ];
  }

  it("flags a country below the floor once the sample is big enough", () => {
    // 60 sends, 70% delivered — the shape of carrier filtering.
    const rows = summarize(bulk(CA, 42, 18));
    const bad = underperforming(rows);
    expect(bad).toHaveLength(1);
    expect(bad[0].country).toBe("CA");
  });

  it("reports no rate at all over a tiny sample", () => {
    // Three sends and one failure is 67%, which means nothing — and #426 shows
    // this figure to CUSTOMERS, where a scary percentage over four messages
    // manufactures the exact anxiety the number exists to remove. Below the
    // sample line there is no rate to render, so clients show counts.
    const rows = summarize(bulk(CA, 2, 1));
    expect(rows[0].rate).toBeNull();
    expect(underperforming(rows)).toHaveLength(0);
  });

  it("says nothing about a healthy country with plenty of volume", () => {
    const rows = summarize(bulk(US, DELIVERY_MIN_SAMPLE * 2, 3));
    expect(underperforming(rows)).toHaveLength(0);
  });

  it("flags only the country that is failing, not the whole account", () => {
    // Canada filtered, the US fine — which is exactly the pattern #379 says to
    // expect if D2 has gone stale, and the case a single overall rate hides.
    const rows = summarize([...bulk(CA, 40, 20), ...bulk(US, 200, 2)]);
    expect(underperforming(rows).map((r) => r.country)).toEqual(["CA"]);
  });

  it("treats a country with nothing settled as no evidence", () => {
    expect(underperforming(summarize([]))).toHaveLength(0);
  });
});
