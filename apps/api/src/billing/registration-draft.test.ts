/**
 * Checkout registration-draft gate suite (SPEC §4.1 step 4, §4.4 field
 * mapping): who owes registration, and what counts as a submittable draft.
 */
import { describe, expect, it } from "vitest";

import {
  owesUsRegistration,
  registrationDraftComplete,
  type RegistrationRow,
} from "./registration-draft";

const brandData = {
  displayName: "Acme Plumbing",
  email: "owner@acmeplumbing.example",
  phone: "+15125550100",
  vertical: "PROFESSIONAL",
  street: "1 Main St",
  city: "Austin",
  state: "TX",
  postalCode: "78701",
  country: "US",
  companyName: "Acme Plumbing LLC",
  ein: "12-3456789",
};
const campaignData = {
  messageFlow: "Customers text our business number first.",
  sample1: "Hi — your quote is ready.",
  sample2: "Reminder: we arrive at 9am tomorrow.",
};

function brand(overrides: Partial<RegistrationRow> = {}): RegistrationRow {
  return {
    kind: "brand",
    status: "draft",
    sole_proprietor: false,
    data: brandData,
    ...overrides,
  };
}
function campaign(overrides: Partial<RegistrationRow> = {}): RegistrationRow {
  return {
    kind: "campaign",
    status: "draft",
    sole_proprietor: false,
    data: campaignData,
    ...overrides,
  };
}

describe("owesUsRegistration (SPEC §4.2 table)", () => {
  it.each([
    ["US", true, true],
    ["US", false, true], // every US company owes it, regardless of the flag
    ["CA", true, true],
    ["CA", false, false],
  ] as const)("country=%s us_texting_enabled=%s → %s", (country, flag, expected) => {
    expect(
      owesUsRegistration({ country, us_texting_enabled: flag }),
    ).toBe(expected);
  });
});

describe("registrationDraftComplete", () => {
  it("passes a complete standard-path brand + campaign draft", () => {
    expect(registrationDraftComplete([brand(), campaign()])).toBe(true);
  });

  it("fails when either row is missing", () => {
    expect(registrationDraftComplete([])).toBe(false);
    expect(registrationDraftComplete([brand()])).toBe(false);
    expect(registrationDraftComplete([campaign()])).toBe(false);
  });

  it.each(["companyName", "ein", "email", "phone", "vertical", "street", "city", "state", "postalCode", "country", "displayName"])(
    "fails a standard brand draft missing %s",
    (key) => {
      const data: Record<string, unknown> = { ...brandData };
      delete data[key];
      expect(registrationDraftComplete([brand({ data }), campaign()])).toBe(false);
    },
  );

  it("treats whitespace-only values as missing", () => {
    expect(
      registrationDraftComplete([
        brand({ data: { ...brandData, ein: "   " } }),
        campaign(),
      ]),
    ).toBe(false);
  });

  it("sole-prop path needs firstName/lastName/ein/mobilePhone instead of companyName", () => {
    const soleData: Record<string, unknown> = {
      ...brandData,
      companyName: undefined,
      firstName: "Pat",
      lastName: "Doe",
      ein: "1234", // last-4 identifier
      mobilePhone: "+15125550111",
    };
    expect(
      registrationDraftComplete([
        brand({ sole_proprietor: true, data: soleData }),
        campaign(),
      ]),
    ).toBe(true);
    const missingMobile = { ...soleData, mobilePhone: "" };
    expect(
      registrationDraftComplete([
        brand({ sole_proprietor: true, data: missingMobile }),
        campaign(),
      ]),
    ).toBe(false);
  });

  it.each(["messageFlow", "sample1", "sample2"])(
    "fails a campaign draft missing %s",
    (key) => {
      const data: Record<string, unknown> = { ...campaignData };
      delete data[key];
      expect(registrationDraftComplete([brand(), campaign({ data })])).toBe(false);
    },
  );

  it("already-submitted/approved rows are submittable regardless of data (resubscribe path)", () => {
    expect(
      registrationDraftComplete([
        brand({ status: "approved", data: {} }),
        campaign({ status: "submitted", data: {} }),
      ]),
    ).toBe(true);
  });

  it("rejected rows must carry complete (fixed) data to resubmit", () => {
    expect(
      registrationDraftComplete([
        brand({ status: "rejected" }),
        campaign({ status: "rejected" }),
      ]),
    ).toBe(true);
    expect(
      registrationDraftComplete([
        brand({ status: "rejected", data: {} }),
        campaign({ status: "rejected" }),
      ]),
    ).toBe(false);
  });
});
