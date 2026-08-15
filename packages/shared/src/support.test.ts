/**
 * #382 — the pre-fill is the feature.
 *
 * "My texts aren't working" costs a round trip before anyone can act. The same
 * message carrying a workspace id does not.
 */
import { describe, expect, it } from "vitest";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

import {
  SUPPORT_EMAIL,
  SUPPORT_ERROR_LINES,
  SUPPORT_FIX_PROMISE_KEY,
  SUPPORT_RESPONSE_TIME_KEY,
  SUPPORT_TOPICS,
  feedbackMailto,
  supportBody,
  supportMailto,
  supportSituationKey,
  supportSubjectFor,
} from "./support";

/*
 * #228 — the two resolvers this module is built around.
 *
 * `say` answers in the reader's language and `sayEnglish` always in English.
 * That distinction is the feature rather than test scaffolding: the mail BODY
 * is read by the customer and the SUBJECT by the support inbox, and a subject
 * that varied by locale would scatter one failure across two headings.
 */
function lookUp(table: unknown, key: string, lang: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[name];
  if (typeof value !== "string") throw new Error(`no ${lang} for ${key}`);
  return value;
}

const say = (key: string): string => lookUp(WEB_EN, key, "English");
const sayFr = (key: string): string => lookUp(WEB_FR, key, "French");

const CTX = {
  companyId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  companyName: "Ace Plumbing",
  plan: "starter",
  platform: "web",
  appVersion: "1.4.0",
};

describe("what we ask the customer to send us", () => {
  it("carries the workspace, plan and platform", () => {
    const body = supportBody(CTX, say);
    expect(body).toContain("Ace Plumbing");
    expect(body).toContain(CTX.companyId);
    expect(body).toContain("starter");
    expect(body).toContain("web 1.4.0");
  });

  it("puts the customer's own words above our diagnostics", () => {
    // Nobody should have to scroll past our fields to write the sentence they
    // opened the app to write.
    const body = supportBody(CTX, say);
    expect(body.startsWith("\n\n")).toBe(true);
    expect(body.indexOf("---")).toBeLessThan(body.indexOf("Workspace:"));
  });

  it("still works for a workspace with no name or plan", () => {
    const body = supportBody({ companyId: "abc", platform: "ios" }, say);
    expect(body).toContain("(unnamed)");
    expect(body).toContain("abc");
    expect(body).not.toContain("Plan:");
    expect(body).toContain("App: ios");
  });

  it("builds a mailto the mail client can actually open", () => {
    const url = supportMailto(CTX, say, say);
    expect(url.startsWith(`mailto:${SUPPORT_EMAIL}?`)).toBe(true);
    const parsed = new URL(url);
    const params = new URLSearchParams(parsed.search);
    expect(params.get("subject")).toBe("Help with my Loonext workspace");
    expect(params.get("body")).toContain(CTX.companyId);
  });

  it("survives a workspace name with an apostrophe and an ampersand", () => {
    // A truncated body is a support request with no diagnostics in it.
    const url = supportMailto({
      ...CTX,
      companyName: "Bob's Heating & Air",
    }, say, say);
    const params = new URLSearchParams(new URL(url).search);
    expect(params.get("body")).toContain("Bob's Heating & Air");
  });

  it("lets a screen seed its own subject", () => {
    // The close-workspace card asks about ONE thing, and the subject should
    // say so rather than making a worried owner explain it.
    const url = supportMailto({ ...CTX, subject: "Please undo my closure" }, say, say);
    const params = new URLSearchParams(new URL(url).search);
    expect(params.get("subject")).toBe("Please undo my closure");
  });
});

describe("#253 a report from a failure banner", () => {
  it("names the situation the person was looking at", () => {
    // "It broke" costs three round trips. "US registration is pending
    // approval" costs none, and the person did not have to know that is what
    // the screen was telling them.
    const body = supportBody(
      { ...CTX, situation: say(supportSituationKey("registration_pending")!) },
      say,
    );
    expect(body).toContain("Screen: US registration is pending approval");
  });

  it("gives the same failure the same subject on every client", () => {
    // Five reports of one carrier suspension in a morning is a signal. It is
    // invisible if they arrive under five different names.
    expect(supportSubjectFor("registration_suspended", say)).toBe(
      "Problem: the carrier suspended our US registration",
    );
    expect(supportSubjectFor("usage_cap", say)).toBe(
      "Problem: sending is paused at the spending cap",
    );
  });

  it("says nothing rather than guessing for a banner it has not heard of", () => {
    // An invented sentence in a support email is worse than none: the reader
    // trusts it, and it came from nowhere.
    expect(supportSituationKey("something_new")).toBeNull();
    expect(supportSubjectFor("something_new", say)).toBe("Help with my Loonext workspace");
  });

  it("carries recent errors without the customer assembling them", () => {
    const body = supportBody({
      ...CTX,
      recentErrors: ["12:04 send failed: carrier_rejected", "12:03 GET /v1/usage 500"],
    }, say);
    expect(body).toContain("Recent errors on this device (newest first):");
    expect(body).toContain("carrier_rejected");
    expect(body).toContain("GET /v1/usage 500");
  });

  it("caps the error list, because a truncated body carries NO diagnostics", () => {
    // Some mail clients cut a mailto body around 2000 characters. Fewer lines
    // that arrive beat more that do not.
    const many = Array.from({ length: 20 }, (_, i) => `error ${i}`);
    const body = supportBody({ ...CTX, recentErrors: many }, say);
    expect(body).toContain("error 0");
    expect(body).toContain(`error ${SUPPORT_ERROR_LINES - 1}`);
    expect(body).not.toContain(`error ${SUPPORT_ERROR_LINES}`);
  });

  it("omits the error block entirely when there is nothing to report", () => {
    // A heading over an empty list reads as "we looked and found nothing",
    // which is a different claim from "we did not look".
    expect(supportBody({ ...CTX, recentErrors: [] }, say)).not.toContain("Recent errors");
    expect(supportBody({ ...CTX, recentErrors: ["  "] }, say)).not.toContain("Recent errors");
  });

  it("keeps the customer's own words at the top even with diagnostics attached", () => {
    const body = supportBody({
      ...CTX,
      situation: "the carrier suspended our US registration",
      recentErrors: ["boom"],
    }, say);
    expect(body.startsWith("\n\n")).toBe(true);
    expect(body.indexOf("---")).toBeLessThan(body.indexOf("Screen:"));
  });
});

describe("#253 the feedback channel is not a bug report", () => {
  it("arrives under its own subject", () => {
    // Somebody with an idea does not write to an address labelled support:
    // they correctly read that as being for things that are broken, and their
    // idea is not a complaint.
    const params = new URLSearchParams(new URL(feedbackMailto(CTX, say, say)).search);
    expect(params.get("subject")).toBe("Idea for Loonext");
    expect(params.get("body")).toContain(CTX.companyId);
  });
});

describe("#253 the response time is stated, not implied", () => {
  it("is one sentence every surface renders", () => {
    // A number typed into three clients separately is a number that drifts,
    // and the drifted one is a promise somebody made without knowing it.
    expect(say(SUPPORT_RESPONSE_TIME_KEY)).toContain("two business days");
  });

  it("promises what a bad week can still keep", () => {
    // "A support channel a solo founder cannot service is worse than none."
    // Never an hours-scale commitment, which one flight breaks.
    expect(say(SUPPORT_RESPONSE_TIME_KEY)).not.toMatch(/hour|minute|immediately|instantly/i);
  });
});

describe("#253 the answers people go looking for", () => {
  it("covers the confusions the issue names", () => {
    const all = SUPPORT_TOPICS.map((t) => `${say(t.questionKey)} ${say(t.answerKey)}`)
      .join(" ")
      .toLowerCase();
    for (const subject of ["registration", "spending cap", "stop", "port"]) {
      expect(all, `no answer mentions ${subject}`).toContain(subject);
    }
  });

  it("says all five in French, which is the half nobody re-reads", () => {
    // A key present in English and missing in French falls back to English by
    // design, so this never surfaces as a broken help page — it surfaces as a
    // French reader deciding the app is only half translated.
    for (const topic of SUPPORT_TOPICS) {
      for (const key of [topic.questionKey, topic.answerKey]) {
        expect(sayFr(key), key).not.toBe(say(key));
      }
    }
  });

  it("answers in sentences, not in stubs", () => {
    // A help index whose answers are shorter than the question is a search
    // result, and the reader already had the question.
    for (const topic of SUPPORT_TOPICS) {
      // Both languages: a question that lost its mark in translation reads as
      // a heading, and the answer under it as unrelated prose.
      for (const words of [say, sayFr]) {
        const question = words(topic.questionKey);
        const answer = words(topic.answerKey);
        expect(question.endsWith("?"), question).toBe(true);
        expect(answer.length, question).toBeGreaterThan(question.length);
      }
    }
  });

  it("never promises an approval time we do not control as a certainty", () => {
    // The carriers own that queue. "Usually" is the honest word and it has to
    // survive an edit — a stated certainty here becomes a broken promise on
    // day eight, which is exactly when the customer is already unhappy.
    const registration = SUPPORT_TOPICS.find((t) =>
      say(t.questionKey).includes("registration pending"),
    );
    expect(registration).toBeDefined();
    expect(say(registration!.answerKey)).not.toMatch(
      /guarantee|always takes|will take exactly/i,
    );
  });
});

describe("#321 telling the reporter when it ships", () => {
  it("states the loop rather than implying it", () => {
    // The reason to bother writing in is knowing you will hear back. A promise
    // nobody is told about changes nobody's behaviour.
    expect(say(SUPPORT_FIX_PROMISE_KEY)).toMatch(/fixed/i);
  });

  it("promises a reply on the FIX, not merely on receipt", () => {
    // "We read everything that comes in" is not the loop #321 asks for — a
    // report that vanishes after an acknowledgement teaches the same lesson as
    // one that vanishes immediately.
    expect(say(SUPPORT_FIX_PROMISE_KEY)).toMatch(/not just when/i);
  });
});
