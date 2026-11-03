/**
 * #379/#426: the delivery split a customer sees on the usage page, by where
 * each message was going.
 */
import { describe, expect, it } from "vitest";

import { DELIVERY_MIN_SAMPLE, summarize } from "./delivery-by-country";

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

describe("the rate a customer is shown", () => {
  function bulk(phone: string, delivered: number, failed: number) {
    return [
      ...Array.from({ length: delivered }, () => msg(phone, "delivered")),
      ...Array.from({ length: failed }, () => msg(phone, "failed")),
    ];
  }

  it("is a rate once the sample is big enough", () => {
    const [ca] = summarize(bulk(CA, 42, 18));
    expect(ca.rate).toBeCloseTo(0.7);
  });

  it("is no rate at all over a tiny sample", () => {
    // Three sends and one failure is 67%, which means nothing, and a scary
    // percentage over four messages manufactures the anxiety the number exists
    // to remove. Below the sample line clients show counts.
    const rows = summarize(bulk(CA, 2, 1));
    expect(rows[0].rate).toBeNull();
    expect(summarize(bulk(US, DELIVERY_MIN_SAMPLE, 0))[0].rate).toBe(1);
  });
});
