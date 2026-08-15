import { describe, expect, it } from "vitest";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

import {
  explainRejection,
  needsHumanHelp,
  REJECTIONS_BEFORE_HELP,
  RESUBMISSION_WAIT_KEY,
} from "./rejection-guidance";

/**
 * #228 — the catalogue holds keys now, so the assertions resolve them.
 *
 * That is a better test than the one it replaces, not merely a translated one:
 * it used to read the module's own English back to itself, and now it reads
 * what a person is actually shown. A key with no entry behind it fails here
 * rather than reaching somebody as `domain.rejectRegEinWhat`.
 */
const say = (key: string): string => {
  const name = key.slice("domain.".length) as keyof typeof WEB_EN.domain;
  const value = WEB_EN.domain[name];
  if (typeof value !== "string") throw new Error(`no English for ${key}`);
  return value;
};

const sayFr = (key: string): string => {
  const name = key.slice("domain.".length) as keyof typeof WEB_FR.domain;
  const value = WEB_FR.domain[name];
  if (typeof value !== "string") throw new Error(`no French for ${key}`);
  return value;
};

/**
 * #352. The value of this module is entirely in whether it recognises the
 * strings carriers actually send, so the tests are mostly real-shaped reasons
 * rather than the catalogue's own vocabulary read back to it.
 */

describe("explainRejection — registration", () => {
  it("translates the sole trader's rejection, which is the reason it exists", () => {
    // #352's worked example: registered as "Dave's Plumbing" while the registry
    // holds "D. Chen Holdings Ltd". The raw string names neither the mismatch
    // nor the fix.
    const guidance = explainRejection("registration", "BRAND_LEGAL_NAME_MISMATCH");
    expect(say(guidance!.whatKey)).toContain("does not match");
    expect(say(guidance!.fixKey)).toContain("legal name");
    expect(guidance?.field).toBe("companyName");
  });

  it("recognises the same objection however the carrier phrases it", () => {
    // The same rejection arrives coded, as prose, and with a ticket number.
    for (const reason of [
      "EIN_MISMATCH",
      "The Tax ID provided does not match IRS records.",
      "Rejected (ref 88213): federal tax id could not be verified",
      "tax-id invalid",
    ]) {
      expect(explainRejection("registration", reason)?.field, reason).toBe("ein");
    }
  });

  it("points at a field for every reason whose fix IS a field", () => {
    const cases: [string, string][] = [
      ["CAMPAIGN_OPT_IN_INSUFFICIENT", "messageFlow"],
      ["Website does not describe the business", "website"],
      ["SAMPLE_MESSAGE_CONTENT_MISMATCH", "sample1"],
      ["USE_CASE_MISMATCH", "vertical"],
      ["Business address could not be verified", "street"],
      ["Contact email unreachable", "email"],
    ];
    for (const [reason, field] of cases) {
      expect(explainRejection("registration", reason)?.field, reason).toBe(field);
    }
  });

  it("refuses to point at a field when no field can fix it", () => {
    // A brand registered by a previous provider is not fixable from this form.
    // Sending them round it again costs another carrier review and changes
    // nothing, so the guidance says so instead.
    const guidance = explainRejection("registration", "DUPLICATE_BRAND");
    expect(guidance).not.toBeNull();
    expect(guidance?.field).toBeNull();
    expect(say(guidance!.fixKey)).toContain("Reply to us");
  });
});

describe("explainRejection — port", () => {
  it("translates the account-number mismatch seen in the porting tests", () => {
    // `ACCOUNT_NUMBER_MISMATCH` is the literal string the Telnyx porting suite
    // asserts on, so this is a reason we know reaches customers.
    const guidance = explainRejection("port", "ACCOUNT_NUMBER_MISMATCH");
    expect(say(guidance!.fixKey)).toContain("bill");
    expect(guidance?.field).toBe("account_number");
  });

  it("explains a PIN, including that it expires", () => {
    const guidance = explainRejection("port", "Invalid port-out PIN supplied");
    expect(say(guidance!.fixKey)).toContain("expires");
  });

  it("does not claim a field for a number that is not portable", () => {
    expect(explainRejection("port", "NUMBER_NOT_ACTIVE")?.field).toBeNull();
    expect(explainRejection("port", "PENDING_ORDER_EXISTS")?.field).toBeNull();
  });
});

describe("the honest fall-through", () => {
  it("returns null for a reason it does not recognise", () => {
    // #352: "showing the raw reason with an offer to get help is better than a
    // generic message that hides it." A catalogue that pretends to understand
    // everything is worse than one that says which it does, because the reader
    // cannot tell the two answers apart.
    expect(explainRejection("registration", "TCR-9911 anomaly, see portal")).toBeNull();
    expect(explainRejection("port", "SPI_REJECT_47")).toBeNull();
  });

  it("returns null for nothing at all, rather than inventing a rejection", () => {
    for (const empty of [null, undefined, "", "   "]) {
      expect(explainRejection("registration", empty)).toBeNull();
    }
  });

  it("keeps the two catalogues apart", () => {
    // A port reason must not be answered with registration advice. `account
    // number` means nothing on a 10DLC brand, and being told to check a bill
    // would send the customer looking for the wrong document.
    expect(explainRejection("registration", "ACCOUNT_NUMBER_MISMATCH")).toBeNull();
    expect(explainRejection("port", "CAMPAIGN_OPT_IN_INSUFFICIENT")).toBeNull();
  });
});

describe("what happens next", () => {
  it("states a wait for both domains, because silence is where people give up", () => {
    expect(say(RESUBMISSION_WAIT_KEY.registration)).toMatch(/business day/);
    expect(say(RESUBMISSION_WAIT_KEY.port)).toMatch(/business day/);
    // And in French, where "jour ouvrable" is the same promise.
    expect(sayFr(RESUBMISSION_WAIT_KEY.registration)).toMatch(/jours? ouvrables?/);
    expect(sayFr(RESUBMISSION_WAIT_KEY.port)).toMatch(/jours? ouvrables?/);
  });

  it("asks for a person on the second rejection, not the third", () => {
    expect(REJECTIONS_BEFORE_HELP).toBe(2);
    expect(needsHumanHelp(1)).toBe(false);
    expect(needsHumanHelp(2)).toBe(true);
    expect(needsHumanHelp(5)).toBe(true);
    expect(needsHumanHelp(null)).toBe(false);
    expect(needsHumanHelp(undefined)).toBe(false);
  });
});

describe("every entry obeys G10", () => {
  it("says what happened and what to do, one sentence each", () => {
    // "Errors: what happened + what to do, one sentence each." A catalogue
    // entry that drifts into a paragraph is read by nobody who has just been
    // rejected.
    const reasons = [
      "EIN_MISMATCH",
      "BRAND_LEGAL_NAME_MISMATCH",
      "ADDRESS_MISMATCH",
      "WEBSITE_UNVERIFIED",
      "CAMPAIGN_OPT_IN_INSUFFICIENT",
      "SAMPLE_MESSAGE_CONTENT_MISMATCH",
      "USE_CASE_MISMATCH",
      "DUPLICATE_BRAND",
      "ENTITY_TYPE_MISMATCH",
      "CONTACT_UNREACHABLE",
      "ACCOUNT_NUMBER_MISMATCH",
      "PIN_INVALID",
      "LOA_SIGNATURE_INVALID",
      "ENTITY_NAME_MISMATCH",
      "SERVICE_ADDRESS_MISMATCH",
      "PENDING_ORDER_EXISTS",
      "NUMBER_NOT_ACTIVE",
    ];
    // Per domain, so this also proves every catalogue entry is reachable from a
    // realistically-shaped reason. Counting across both would hide a dead entry
    // behind the overlap: "ADDRESS_MISMATCH" legitimately matches in each, and
    // each correctly answers with its own advice.
    const reached: Record<string, Set<string>> = { registration: new Set(), port: new Set() };
    for (const domain of ["registration", "port"] as const) {
      for (const reason of reasons) {
        const guidance = explainRejection(domain, reason);
        if (!guidance) continue;
        reached[domain].add(guidance.whatKey);
        for (const [label, sentence] of [
          ["what", say(guidance.whatKey)],
          ["fix", say(guidance.fixKey)],
          // French is held to the same shape. A translation that runs to a
          // paragraph fails G10 just as an English one would, and this is the
          // half nobody re-reads after it lands.
          ["what-fr", sayFr(guidance.whatKey)],
          ["fix-fr", sayFr(guidance.fixKey)],
        ] as const) {
          const where = `${domain}/${reason}/${label}`;
          expect(sentence.trim(), where).toMatch(/[.!?]$/);
          // One sentence: no full stop followed by more prose. Em dashes and
          // commas are fine — a sentence may be complex without being two.
          expect(sentence.replace(/\.$/, ""), where).not.toMatch(/\.\s+[A-Z]/);
          expect(sentence.length, where).toBeLessThan(200);
        }
      }
    }
    // A loop that matched nothing would pass silently, and a catalogue entry no
    // realistic reason reaches is dead code pretending to be coverage.
    expect(reached.registration.size).toBe(10);
    expect(reached.port.size).toBe(7);
  });
});
