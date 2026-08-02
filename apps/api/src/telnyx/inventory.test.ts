import { afterEach, describe, expect, it, vi } from "vitest";

import { searchInventory } from "./inventory";
import { TelnyxMock, telnyxError } from "./test-support";
import { completeEnv, stubFetch } from "../test/support";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchInventory (number-picker feed)", () => {
  it("maps Telnyx numbers to sanitized DTOs and sends the right filters", async () => {
    const env = completeEnv();
    const telnyx = new TelnyxMock();
    telnyx.on("GET", /^\/v2\/available_phone_numbers$/, () => ({
      data: [
        {
          phone_number: "+14165550100",
          // Cost + any vendor internals must NOT leak into the DTO.
          cost_information: { monthly_cost: "1.00", currency: "USD" },
          region_information: [
            { region_type: "locality", region_name: "Toronto" },
            { region_type: "state", region_name: "ON" },
          ],
          features: [{ name: "sms" }, { name: "mms" }],
        },
      ],
    }));
    stubFetch(telnyx.route());

    const result = await searchInventory(env, {
      country: "CA",
      areaCode: "416",
    });
    expect(result.best_effort_exhausted).toBe(false);
    expect(result.data).toEqual([
      { phone_number: "+14165550100", region: "Toronto", features: ["sms", "mms"] },
    ]);

    const call = telnyx.callsTo("GET", /available_phone_numbers/)[0];
    expect(call.query.get("filter[country_code]")).toBe("CA");
    expect(call.query.get("filter[features]")).toBe("sms");
    expect(call.query.get("filter[phone_number_type]")).toBe("local");
    expect(call.query.get("filter[national_destination_code]")).toBe("416");
  });

  it("omits the area-code filter for a broad, country-wide search (#86)", async () => {
    const env = completeEnv();
    const telnyx = new TelnyxMock();
    telnyx.on("GET", /^\/v2\/available_phone_numbers$/, () => ({
      data: [
        {
          phone_number: "+13035550123",
          region_information: [
            { region_type: "locality", region_name: "Denver" },
          ],
          features: [{ name: "sms" }],
        },
      ],
    }));
    stubFetch(telnyx.route());

    // No areaCode: the picker browses all numbers in the country.
    const result = await searchInventory(env, { country: "US" });
    expect(result.data).toEqual([
      { phone_number: "+13035550123", region: "Denver", features: ["sms"] },
    ]);
    const call = telnyx.callsTo("GET", /available_phone_numbers/)[0];
    expect(call.query.get("filter[country_code]")).toBe("US");
    expect(call.query.get("filter[national_destination_code]")).toBeNull();
  });

  it("returns an empty list with best_effort_exhausted on a no-inventory 400 (10031)", async () => {
    const env = completeEnv();
    const telnyx = new TelnyxMock();
    telnyx.on("GET", /^\/v2\/available_phone_numbers$/, () =>
      telnyxError(400, "10031"),
    );
    stubFetch(telnyx.route());

    const result = await searchInventory(env, {
      country: "CA",
      areaCode: "416",
    });
    expect(result).toEqual({
      data: [],
      best_effort_exhausted: true,
      masked: false,
    });
  });

  it("flags masked (Canadian) inventory and drops the un-orderable numbers", async () => {
    const env = completeEnv();
    const telnyx = new TelnyxMock();
    // Telnyx masks Canadian available numbers — "+14375------" — so none is
    // individually orderable.
    telnyx.on("GET", /^\/v2\/available_phone_numbers$/, () => ({
      data: [
        { phone_number: "+14375------" },
        { phone_number: "+14375------" },
      ],
    }));
    stubFetch(telnyx.route());

    const result = await searchInventory(env, {
      country: "CA",
      areaCode: "647",
      bestEffort: true,
    });
    expect(result).toEqual({
      data: [],
      best_effort_exhausted: false,
      masked: true,
    });
  });

  it("adds filter[best_effort] only when requested (the 'show nearby' toggle)", async () => {
    const env = completeEnv();
    const telnyx = new TelnyxMock();
    telnyx.on("GET", /^\/v2\/available_phone_numbers$/, () => ({ data: [] }));
    stubFetch(telnyx.route());

    await searchInventory(env, {
      country: "US",
      areaCode: "212",
      bestEffort: true,
    });
    const call = telnyx.callsTo("GET", /available_phone_numbers/)[0];
    expect(call.query.get("filter[best_effort]")).toBe("true");
  });

  it("rethrows a non-inventory Telnyx error (e.g. 503) — not swallowed", async () => {
    const env = completeEnv();
    const telnyx = new TelnyxMock();
    telnyx.on("GET", /^\/v2\/available_phone_numbers$/, () =>
      telnyxError(503, "service_unavailable"),
    );
    stubFetch(telnyx.route());

    await expect(
      searchInventory(env, { country: "US", areaCode: "212" }),
    ).rejects.toThrow();
  });
});

/**
 * #513 — the search honours what was typed.
 *
 * Reported as: the digit filter "applies to numbers already fetched which is
 * nice, but when refresh is clicked to ask for a new batch, we should include
 * that filter in the request". Exactly right — the picker was narrowing a list
 * it already held, so asking for a fresh batch quietly discarded the search and
 * handed back twenty numbers chosen without reference to it.
 *
 * `filter[phone_number][contains]` was verified against the live Telnyx API
 * before this was built: it is accepted and it narrows the result set.
 */
describe("searchInventory digit filter (#513)", () => {
  it("asks Telnyx for numbers containing the digits, not just the batch", async () => {
    const env = completeEnv();
    const telnyx = new TelnyxMock();
    telnyx.on("GET", /^\/v2\/available_phone_numbers$/, () => ({ data: [] }));
    stubFetch(telnyx.route());

    await searchInventory(env, { country: "US", areaCode: "212", contains: "777" });

    const call = telnyx.callsTo("GET", /available_phone_numbers/)[0];
    expect(call.query.get("filter[phone_number][contains]")).toBe("777");
    // ...and the area code still applies, so the two narrow together rather
    // than one replacing the other.
    expect(call.query.get("filter[national_destination_code]")).toBe("212");
  });

  it("sends no digit filter when nothing was typed", async () => {
    const env = completeEnv();
    const telnyx = new TelnyxMock();
    telnyx.on("GET", /^\/v2\/available_phone_numbers$/, () => ({ data: [] }));
    stubFetch(telnyx.route());

    await searchInventory(env, { country: "US" });

    // The negative control for the test above: an unconditional parameter
    // would make that assertion pass while proving nothing.
    const call = telnyx.callsTo("GET", /available_phone_numbers/)[0];
    expect(call.query.get("filter[phone_number][contains]")).toBeNull();
  });
});
