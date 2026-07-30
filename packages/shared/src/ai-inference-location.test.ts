/**
 * #318 V7 — the location disclosure, and the staleness guard on it.
 *
 * The claim on `/legal/privacy` and `/legal/subprocessors` is now that AI
 * inference is NOT confined to a country, sourced from Cloudflare's own
 * data-localization compatibility list. Two ways that goes wrong later:
 *
 *   1. **Cloudflare changes it.** Regional Services gaining Workers AI support
 *      would make our page assert a limitation that no longer exists — and
 *      understating what we can offer is a smaller harm than the reverse, but
 *      it is still a legal page saying something untrue. Hence the recheck date,
 *      the same guard the carrier ceilings and voice-AI costs carry.
 *
 *   2. **Somebody softens the words.** "Processed globally for performance"
 *      reads better and answers a different question. The statement has to keep
 *      saying that we cannot pin it, because that is what a Quebec customer
 *      under Law 25 actually needs to know before #228 opens that market.
 */
import { describe, expect, it } from "vitest";

import {
  AI_INFERENCE_LOCATION_RECHECK_AFTER,
  AI_INFERENCE_LOCATION_SOURCE,
  AI_INFERENCE_LOCATION_STATEMENT,
  AI_INFERENCE_LOCATION_VERIFIED_ON,
  AI_INFERENCE_RETENTION_STATEMENT,
} from "./ai-disclosure";

describe("the inference-location disclosure", () => {
  it("says we cannot confine it, not merely that it is global", () => {
    // The load-bearing half. "Runs on a global network" is a description of an
    // architecture; "cannot be pinned to a country" is the fact with a legal
    // consequence, and it is the one that must survive an edit.
    expect(AI_INFERENCE_LOCATION_STATEMENT).toMatch(/not restricted to any one country/i);
    expect(AI_INFERENCE_LOCATION_STATEMENT).toMatch(/cannot pin it/i);
    // Names the mechanism, so the claim is checkable rather than asserted.
    expect(AI_INFERENCE_LOCATION_STATEMENT).toMatch(/Regional Services/);
  });

  it("answers the retention half too", () => {
    // "Where does it go" and "how long does it stay" are one question in a
    // customer's head; answering only the first invites the worst assumption
    // about the second.
    expect(AI_INFERENCE_RETENTION_STATEMENT).toMatch(/does not store/i);
  });

  it("cites a primary source a reader can open", () => {
    expect(AI_INFERENCE_LOCATION_SOURCE).toMatch(
      /^https:\/\/developers\.cloudflare\.com\//,
    );
  });

  it("has not passed its re-check date", () => {
    // When this fails, the job is to re-read Cloudflare's compatibility list and
    // move BOTH dates — not to push this one forward. A vendor capability being
    // six months unverified is the thing being reported.
    expect(
      new Date(AI_INFERENCE_LOCATION_RECHECK_AFTER).getTime(),
      `inference location was verified on ${AI_INFERENCE_LOCATION_VERIFIED_ON} and is due a re-check`,
    ).toBeGreaterThan(Date.now());
  });

  it("re-checks within a year of verifying", () => {
    const verified = new Date(AI_INFERENCE_LOCATION_VERIFIED_ON).getTime();
    const recheck = new Date(AI_INFERENCE_LOCATION_RECHECK_AFTER).getTime();
    expect(recheck).toBeGreaterThan(verified);
    expect(recheck - verified).toBeLessThanOrEqual(366 * 24 * 60 * 60 * 1000);
  });
});
