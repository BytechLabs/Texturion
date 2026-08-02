/**
 * #382 — the pre-fill is the feature.
 *
 * "My texts aren't working" costs a round trip before anyone can act. The same
 * message carrying a workspace id does not.
 */
import { describe, expect, it } from "vitest";

import {
  SUPPORT_EMAIL,
  SUPPORT_ERROR_LINES,
  SUPPORT_RESPONSE_TIME,
  SUPPORT_TOPICS,
  feedbackMailto,
  supportBody,
  supportMailto,
  supportSituation,
  supportSubjectFor,
} from "./support";

const CTX = {
  companyId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  companyName: "Ace Plumbing",
  plan: "starter",
  platform: "web",
  appVersion: "1.4.0",
};

describe("what we ask the customer to send us", () => {
  it("carries the workspace, plan and platform", () => {
    const body = supportBody(CTX);
    expect(body).toContain("Ace Plumbing");
    expect(body).toContain(CTX.companyId);
    expect(body).toContain("starter");
    expect(body).toContain("web 1.4.0");
  });

  it("puts the customer's own words above our diagnostics", () => {
    // Nobody should have to scroll past our fields to write the sentence they
    // opened the app to write.
    const body = supportBody(CTX);
    expect(body.startsWith("\n\n")).toBe(true);
    expect(body.indexOf("---")).toBeLessThan(body.indexOf("Workspace:"));
  });

  it("still works for a workspace with no name or plan", () => {
    const body = supportBody({ companyId: "abc", platform: "ios" });
    expect(body).toContain("(unnamed)");
    expect(body).toContain("abc");
    expect(body).not.toContain("Plan:");
    expect(body).toContain("App: ios");
  });

  it("builds a mailto the mail client can actually open", () => {
    const url = supportMailto(CTX);
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
    });
    const params = new URLSearchParams(new URL(url).search);
    expect(params.get("body")).toContain("Bob's Heating & Air");
  });

  it("lets a screen seed its own subject", () => {
    // The close-workspace card asks about ONE thing, and the subject should
    // say so rather than making a worried owner explain it.
    const url = supportMailto({ ...CTX, subject: "Please undo my closure" });
    const params = new URLSearchParams(new URL(url).search);
    expect(params.get("subject")).toBe("Please undo my closure");
  });
});

describe("#253 a report from a failure banner", () => {
  it("names the situation the person was looking at", () => {
    // "It broke" costs three round trips. "US registration is pending
    // approval" costs none, and the person did not have to know that is what
    // the screen was telling them.
    const body = supportBody({ ...CTX, situation: supportSituation("registration_pending") });
    expect(body).toContain("Screen: US registration is pending approval");
  });

  it("gives the same failure the same subject on every client", () => {
    // Five reports of one carrier suspension in a morning is a signal. It is
    // invisible if they arrive under five different names.
    expect(supportSubjectFor("registration_suspended")).toBe(
      "Problem: the carrier suspended our US registration",
    );
    expect(supportSubjectFor("usage_cap")).toBe(
      "Problem: sending is paused at the spending cap",
    );
  });

  it("says nothing rather than guessing for a banner it has not heard of", () => {
    // An invented sentence in a support email is worse than none: the reader
    // trusts it, and it came from nowhere.
    expect(supportSituation("something_new")).toBeNull();
    expect(supportSubjectFor("something_new")).toBe("Help with my Loonext workspace");
  });

  it("carries recent errors without the customer assembling them", () => {
    const body = supportBody({
      ...CTX,
      recentErrors: ["12:04 send failed: carrier_rejected", "12:03 GET /v1/usage 500"],
    });
    expect(body).toContain("Recent errors on this device (newest first):");
    expect(body).toContain("carrier_rejected");
    expect(body).toContain("GET /v1/usage 500");
  });

  it("caps the error list, because a truncated body carries NO diagnostics", () => {
    // Some mail clients cut a mailto body around 2000 characters. Fewer lines
    // that arrive beat more that do not.
    const many = Array.from({ length: 20 }, (_, i) => `error ${i}`);
    const body = supportBody({ ...CTX, recentErrors: many });
    expect(body).toContain("error 0");
    expect(body).toContain(`error ${SUPPORT_ERROR_LINES - 1}`);
    expect(body).not.toContain(`error ${SUPPORT_ERROR_LINES}`);
  });

  it("omits the error block entirely when there is nothing to report", () => {
    // A heading over an empty list reads as "we looked and found nothing",
    // which is a different claim from "we did not look".
    expect(supportBody({ ...CTX, recentErrors: [] })).not.toContain("Recent errors");
    expect(supportBody({ ...CTX, recentErrors: ["  "] })).not.toContain("Recent errors");
  });

  it("keeps the customer's own words at the top even with diagnostics attached", () => {
    const body = supportBody({
      ...CTX,
      situation: "the carrier suspended our US registration",
      recentErrors: ["boom"],
    });
    expect(body.startsWith("\n\n")).toBe(true);
    expect(body.indexOf("---")).toBeLessThan(body.indexOf("Screen:"));
  });
});

describe("#253 the feedback channel is not a bug report", () => {
  it("arrives under its own subject", () => {
    // Somebody with an idea does not write to an address labelled support:
    // they correctly read that as being for things that are broken, and their
    // idea is not a complaint.
    const params = new URLSearchParams(new URL(feedbackMailto(CTX)).search);
    expect(params.get("subject")).toBe("Idea for Loonext");
    expect(params.get("body")).toContain(CTX.companyId);
  });
});

describe("#253 the response time is stated, not implied", () => {
  it("is one sentence every surface renders", () => {
    // A number typed into three clients separately is a number that drifts,
    // and the drifted one is a promise somebody made without knowing it.
    expect(SUPPORT_RESPONSE_TIME).toContain("two business days");
  });

  it("promises what a bad week can still keep", () => {
    // "A support channel a solo founder cannot service is worse than none."
    // Never an hours-scale commitment, which one flight breaks.
    expect(SUPPORT_RESPONSE_TIME).not.toMatch(/hour|minute|immediately|instantly/i);
  });
});

describe("#253 the answers people go looking for", () => {
  it("covers the confusions the issue names", () => {
    const all = SUPPORT_TOPICS.map((t) => `${t.question} ${t.answer}`).join(" ").toLowerCase();
    for (const subject of ["registration", "spending cap", "stop", "port"]) {
      expect(all, `no answer mentions ${subject}`).toContain(subject);
    }
  });

  it("answers in sentences, not in stubs", () => {
    // A help index whose answers are shorter than the question is a search
    // result, and the reader already had the question.
    for (const topic of SUPPORT_TOPICS) {
      expect(topic.question.endsWith("?"), topic.question).toBe(true);
      expect(topic.answer.length).toBeGreaterThan(topic.question.length);
    }
  });

  it("never promises an approval time we do not control as a certainty", () => {
    // The carriers own that queue. "Usually" is the honest word and it has to
    // survive an edit — a stated certainty here becomes a broken promise on
    // day eight, which is exactly when the customer is already unhappy.
    const registration = SUPPORT_TOPICS.find((t) =>
      t.question.includes("registration pending"),
    );
    expect(registration).toBeDefined();
    expect(registration?.answer).not.toMatch(/guarantee|always takes|will take exactly/i);
  });
});
