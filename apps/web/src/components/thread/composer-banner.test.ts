import { describe, expect, it } from "vitest";

import type { ComposerGateInput } from "./composer-banner";
import {
  destinationCountry,
  selectComposerBanner,
  usSendApproved,
} from "./composer-banner";

const clear: ComposerGateInput = {
  contactOptedOut: false,
  subscriptionStatus: "active",
  destinationCountry: "US",
  usApproved: true,
  usage: { used_segments: 100, cap_segments: 1500 },
};

describe("selectComposerBanner precedence", () => {
  it("returns null when every gate is open", () => {
    expect(selectComposerBanner(clear)).toBeNull();
  });

  it("opted-out wins over everything", () => {
    expect(
      selectComposerBanner({
        ...clear,
        contactOptedOut: true,
        subscriptionStatus: "past_due",
        usApproved: false,
        usage: { used_segments: 2000, cap_segments: 1500 },
      }),
    ).toEqual({ kind: "opted_out" });
  });

  it("subscription beats registration and cap", () => {
    expect(
      selectComposerBanner({
        ...clear,
        subscriptionStatus: "past_due",
        usApproved: false,
        usage: { used_segments: 2000, cap_segments: 1500 },
      }),
    ).toEqual({ kind: "subscription", status: "past_due" });
    expect(
      selectComposerBanner({ ...clear, subscriptionStatus: "canceled" }),
    ).toEqual({ kind: "subscription", status: "canceled" });
  });

  it("registration pending applies to US destinations only", () => {
    expect(
      selectComposerBanner({ ...clear, usApproved: false }),
    ).toEqual({ kind: "registration_pending" });
    expect(
      selectComposerBanner({
        ...clear,
        usApproved: false,
        destinationCountry: "CA",
      }),
    ).toBeNull();
  });

  it("usage cap fires at the cap, never without one, never while loading", () => {
    expect(
      selectComposerBanner({
        ...clear,
        usage: { used_segments: 1500, cap_segments: 1500 },
      }),
    ).toEqual({ kind: "usage_cap" });
    expect(
      selectComposerBanner({
        ...clear,
        usage: { used_segments: 99999, cap_segments: null },
      }),
    ).toBeNull();
    expect(selectComposerBanner({ ...clear, usage: null })).toBeNull();
  });
});

describe("usSendApproved (mirror of the API's getSendGates)", () => {
  const campaign = {
    kind: "campaign" as const,
    status: "approved" as const,
    sole_proprietor: false,
    rejection_reason: null,
    submission_count: 1,
    submitted_at: "2026-06-01T00:00:00Z",
    approved_at: "2026-06-04T00:00:00Z",
    rejected_at: null,
    deactivated_at: null,
  };

  it("requires an approved, non-deactivated campaign", () => {
    expect(
      usSendApproved({
        country: "US",
        us_texting_enabled: true,
        registration: { brand: null, campaign },
      }),
    ).toBe(true);
    expect(
      usSendApproved({
        country: "US",
        us_texting_enabled: true,
        registration: { brand: null, campaign: null },
      }),
    ).toBe(false);
    expect(
      usSendApproved({
        country: "US",
        us_texting_enabled: true,
        registration: {
          brand: null,
          campaign: { ...campaign, status: "pending" },
        },
      }),
    ).toBe(false);
    expect(
      usSendApproved({
        country: "US",
        us_texting_enabled: true,
        registration: {
          brand: null,
          campaign: { ...campaign, deactivated_at: "2026-06-20T00:00:00Z" },
        },
      }),
    ).toBe(false);
  });

  it("CA companies need us_texting_enabled", () => {
    expect(
      usSendApproved({
        country: "CA",
        us_texting_enabled: false,
        registration: { brand: null, campaign },
      }),
    ).toBe(false);
    expect(
      usSendApproved({
        country: "CA",
        us_texting_enabled: true,
        registration: { brand: null, campaign },
      }),
    ).toBe(true);
  });
});

describe("destinationCountry", () => {
  it("classifies via the shared NANP table", () => {
    expect(destinationCountry("+14165550182")).toBe("CA"); // 416 Toronto
    expect(destinationCountry("+12125550100")).toBe("US");
    expect(destinationCountry("+18765550100")).toBeNull(); // Jamaica
  });
});
