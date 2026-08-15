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

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/**
 * #228 — the two statements are catalogue keys now, so this resolves them.
 *
 * And it checks BOTH languages. "Somebody softens the words" was already the
 * second failure this file names; a translation is the easiest place in the
 * product for that to happen, because the person doing it is optimising for
 * how a sentence reads rather than for what it has to keep saying.
 */
function look(table: unknown, key: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[
    name
  ];
  if (typeof value !== "string") throw new Error(`no entry for ${key}`);
  return value;
}

describe("the inference-location disclosure", () => {
  it("says we cannot confine it, not merely that it is global", () => {
    // The load-bearing half. "Runs on a global network" is a description of an
    // architecture; "cannot be pinned to a country" is the fact with a legal
    // consequence, and it is the one that must survive an edit.
    const en = look(WEB_EN, AI_INFERENCE_LOCATION_STATEMENT);
    expect(en).toMatch(/not restricted to any one country/i);
    expect(en).toMatch(/cannot pin it/i);
    // Names the mechanism, so the claim is checkable rather than asserted.
    expect(en).toMatch(/Regional Services/);

    // The same three facts in French. A translation that said only "s'exécute
    // sur le réseau mondial" would describe the architecture and drop the
    // consequence — which is the whole reason this statement exists, and the
    // reason it matters most to the reader who needs the French.
    const fr = look(WEB_FR, AI_INFERENCE_LOCATION_STATEMENT);
    expect(fr).toMatch(/restreinte à aucun pays/i);
    expect(fr).toMatch(/ne pouvons donc pas la limiter/i);
    expect(fr).toMatch(/Regional Services/);
  });

  it("answers the retention half too", () => {
    // "Where does it go" and "how long does it stay" are one question in a
    // customer's head; answering only the first invites the worst assumption
    // about the second.
    expect(look(WEB_EN, AI_INFERENCE_RETENTION_STATEMENT)).toMatch(/does not store/i);
    expect(look(WEB_FR, AI_INFERENCE_RETENTION_STATEMENT)).toMatch(
      /ne conserve pas/i,
    );
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
