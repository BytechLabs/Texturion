import { describe, expect, it } from "vitest";

import type { ComposerGateInput } from "./composer-banner";
import {
  destinationCountry,
  selectComposerBanner,
  usSendApproved,
} from "./composer-banner";

const clear: ComposerGateInput = {
  contactOptedOut: false,
  contactOptOutSource: null,
  subscriptionStatus: "active",
  destinationCountry: "US",
  usApproved: true,
  usTextingOff: false,
  usage: { used_segments: 100, cap_segments: 1500 },
  optOutHint: false,
};

describe("selectComposerBanner precedence", () => {
  it("names the switch that is off rather than an approval that isn't coming", () => {
    // A Canadian workspace that never added US texting has no registration to
    // approve, so "usually 3 to 7 business days" describes a wait that never
    // ends. Same blocked composer, a different thing to do about it.
    expect(
      selectComposerBanner({
        ...clear,
        usApproved: false,
        usTextingOff: true,
      }),
    ).toEqual({ kind: "us_texting_off" });

    expect(
      selectComposerBanner({ ...clear, usApproved: false, usTextingOff: false }),
    ).toEqual({ kind: "registration_pending" });
  });

  it("leaves a Canadian destination alone whatever US texting says", () => {
    expect(
      selectComposerBanner({
        ...clear,
        destinationCountry: "CA",
        usApproved: false,
        usTextingOff: true,
      }),
    ).toBeNull();
  });

  it("returns null when every gate is open", () => {
    expect(selectComposerBanner(clear)).toBeNull();
  });

  it("opted-out wins over everything", () => {
    expect(
      selectComposerBanner({
        ...clear,
        contactOptedOut: true,
        contactOptOutSource: "stop_keyword",
        subscriptionStatus: "past_due",
        usApproved: false,
        usage: { used_segments: 2000, cap_segments: 1500 },
      }),
    ).toEqual({ kind: "opted_out", carrierBlocked: true });
  });

  it("tells the two opt-outs apart, because only one has a way out", () => {
    // A STOP is the customer's to undo. A hand-recorded opt-out is the crew's,
    // and telling them to wait for a START they will never get is a dead end.
    expect(
      selectComposerBanner({
        ...clear,
        contactOptedOut: true,
        contactOptOutSource: "manual",
      }),
    ).toEqual({ kind: "opted_out", carrierBlocked: false });
  });

  it("treats a carrier-sourced opt-out as a carrier block", () => {
    // #331: Telnyx refused the send, or the nightly reconciliation found the
    // number on their list. The customer said stop either way, so offering an
    // undo here would promise something the API answers with a 409.
    expect(
      selectComposerBanner({
        ...clear,
        contactOptedOut: true,
        contactOptOutSource: "carrier",
      }),
    ).toEqual({ kind: "opted_out", carrierBlocked: true });
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

describe("#396 — a plain-English opt-out on the thread", () => {
  it("warns when nothing else is blocking the composer", () => {
    // The whole point: this is the moment somebody is about to reply to a
    // person who asked them not to.
    expect(selectComposerBanner({ ...clear, optOutHint: true })).toEqual({
      kind: "opt_out_hint",
    });
  });

  it("never outranks a real opt-out", () => {
    // A recorded opt-out is a fact; this is a reading of one. The fact wins,
    // and its copy is the one that says who can lift it.
    const banner = selectComposerBanner({
      ...clear,
      contactOptedOut: true,
      contactOptOutSource: "stop_keyword",
      optOutHint: true,
    });
    expect(banner).toMatchObject({ kind: "opted_out" });
  });

  it("yields to anything that actually blocks the send", () => {
    // Where no message can go, no obligation can be breached — so the banner
    // that explains why sending is off is the more useful one to show.
    const banner = selectComposerBanner({
      ...clear,
      subscriptionStatus: "past_due",
      optOutHint: true,
    });
    expect(banner).toMatchObject({ kind: "subscription" });
  });

  it("stays silent without the flag", () => {
    expect(selectComposerBanner({ ...clear, optOutHint: false })).toBeNull();
  });
});
