import { describe, expect, it } from "vitest";

import {
  buildCampaignContent,
  buildCampaignContentUpdate,
  buildReviewSample,
  REVIEW_SAMPLE_LINK,
  TCR_UPDATE_SAMPLE_MAX_LENGTH,
  type CampaignDraft,
} from "./wizard";

/**
 * The campaign content builders' Telnyx-schema guarantees. The create path
 * (`POST /v2/10dlc/campaignBuilder`) allows 1024-char samples and accepts
 * `description`/`embeddedLink`; the UPDATE path (`UpdateCampaignRequest` on
 * `PUT /v2/10dlc/campaign/{id}`) caps every sampleN at 255 and accepts ONLY
 * resellerId / sample1..5 / messageFlow / helpMessage / autoRenewal / webhook
 * URLs — anything longer or wider 422s the Step 0c migration forever.
 */

const DRAFT: CampaignDraft = {
  messageFlow:
    "Customers text our business number first, or ask us in person / by phone to text them.",
  sample1:
    "Hi, this is Acme Plumbing — we can come Tuesday at 3pm, does that work for you?",
  sample2:
    "Your appointment is confirmed for tomorrow at 9am. Reply STOP to opt out.",
};

describe("buildReviewSample", () => {
  it("embeds the business name and the review deep link", () => {
    const sample = buildReviewSample("Acme Plumbing");
    expect(sample).toBe(
      "Thanks for choosing Acme Plumbing! A quick Google review means a lot: " +
        REVIEW_SAMPLE_LINK,
    );
    expect(sample.length).toBeLessThanOrEqual(TCR_UPDATE_SAMPLE_MAX_LENGTH);
  });

  it("never exceeds 255 chars — the name is truncated, the link never is", () => {
    // displayName allows up to 255 chars; fixed copy + link + a max-length
    // name would blow the update schema's cap without truncation.
    const longName = "Very Long Business Name ".repeat(11).trim(); // 263 chars
    expect(longName.length).toBeGreaterThan(TCR_UPDATE_SAMPLE_MAX_LENGTH);

    const sample = buildReviewSample(longName);
    expect(sample.length).toBeLessThanOrEqual(TCR_UPDATE_SAMPLE_MAX_LENGTH);
    expect(sample.startsWith("Thanks for choosing ")).toBe(true);
    // The enforceable part — the declared review link — survives intact.
    expect(sample.endsWith(REVIEW_SAMPLE_LINK)).toBe(true);
  });
});

describe("buildCampaignContentUpdate — UpdateCampaignRequest-safe block", () => {
  it("contains ONLY the sample fields (description/embeddedLink are create-only)", () => {
    const body = buildCampaignContentUpdate({
      campaign: DRAFT,
      businessName: "Acme Plumbing",
    });
    expect(Object.keys(body).sort()).toEqual(["sample1", "sample2", "sample3"]);
    expect(body.sample1).toBe(DRAFT.sample1);
    expect(body.sample2).toBe(DRAFT.sample2);
    expect(body.sample3).toBe(buildReviewSample("Acme Plumbing"));
  });

  it("clamps 1024-char create-path samples to the update schema's 255 cap", () => {
    const long = "x".repeat(1024);
    const body = buildCampaignContentUpdate({
      campaign: { ...DRAFT, sample1: long, sample2: long },
      businessName: "Acme Plumbing",
    }) as Record<string, string>;
    expect(body.sample1).toBe(long.slice(0, TCR_UPDATE_SAMPLE_MAX_LENGTH));
    expect(body.sample1.length).toBe(TCR_UPDATE_SAMPLE_MAX_LENGTH);
    expect(body.sample2.length).toBe(TCR_UPDATE_SAMPLE_MAX_LENGTH);
    expect(body.sample3.length).toBeLessThanOrEqual(
      TCR_UPDATE_SAMPLE_MAX_LENGTH,
    );
  });
});

describe("buildCampaignContent — create-path block", () => {
  it("keeps the full-length samples plus the create-only description", () => {
    const long = "y".repeat(1024);
    const body = buildCampaignContent({
      campaign: { ...DRAFT, sample1: long },
      businessName: "Acme Plumbing",
    }) as Record<string, string>;
    expect(body.sample1).toBe(long); // create path allows 1024
    expect(body.messageFlow).toBe(DRAFT.messageFlow);
    expect(body.description).toContain("post-service review requests");
    // sample3 rides both create and update payloads → always ≤255.
    expect(body.sample3).toBe(buildReviewSample("Acme Plumbing"));
    expect(body.sample3.length).toBeLessThanOrEqual(
      TCR_UPDATE_SAMPLE_MAX_LENGTH,
    );
  });
});
