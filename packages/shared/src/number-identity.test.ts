/**
 * #307 — which identity a caller actually meets.
 *
 * NI-2 and NI-6 are the pair that carry this. Null means INHERIT, never
 * "empty": clearing an override has to restore the workspace value rather
 * than silence the line, and an owner who empties a greeting box must not get
 * silence on a live call. NI-6 is the same failure arriving through the UI —
 * a form posting `""` where the schema expected `null`.
 */
import { describe, expect, it } from "vitest";

import {
  inheritedFields,
  resolveNumberIdentity,
  type CompanyIdentity,
} from "./number-identity";

const company: CompanyIdentity = {
  name: "Reed Roofing",
  timezone: "America/Toronto",
  voicemailGreeting: "You've reached Reed Roofing. Leave a message.",
  awayMessage: "We're closed. We'll reply in the morning.",
  awayEnabled: true,
  businessHours: { mon: ["08:00", "17:00"] },
  businessHoursExceptions: [],
  mctbEnabled: true,
  mctbMessage: "Sorry we missed your call.",
  voicemailGreetingId: null,
};

describe("#307 resolving a number's identity", () => {
  it("NI-0b: #309 — a line can play its own recording, or the workspace's", () => {
    // Null is not "no greeting": it is the WRITTEN words, spoken aloud, which
    // is what every line does until somebody records something. The runtime
    // falls back to those words anyway when a recording will not play, so this
    // is a preference rather than a switch.
    const inherited = resolveNumberIdentity(
      { ...company, voicemailGreetingId: "workspace-greeting" },
      {},
    );
    expect(inherited.voicemailGreetingId).toEqual({
      value: "workspace-greeting",
      inherited: true,
    });

    const own = resolveNumberIdentity(
      { ...company, voicemailGreetingId: "workspace-greeting" },
      { voicemailGreetingId: "sales-line-greeting" },
    );
    expect(own.voicemailGreetingId).toEqual({
      value: "sales-line-greeting",
      inherited: false,
    });
  });

  it("NI-0: the missed-call toggle and text inherit like everything else", () => {
    // The last two behaviours in #307's Scope. A tracked number on a yard sign
    // is missed for a different reason than the office line, and the owner may
    // want no text from it at all — which no company-wide toggle can say.
    const untouched = resolveNumberIdentity(company, {});
    expect(untouched.mctbEnabled).toEqual({ value: true, inherited: true });
    expect(untouched.mctbMessage.value).toBe("Sorry we missed your call.");

    const silent = resolveNumberIdentity(company, { mctbEnabled: false });
    expect(silent.mctbEnabled).toEqual({ value: false, inherited: false });
    // And it did not disturb the text, which the owner may still want kept.
    expect(silent.mctbMessage.inherited).toBe(true);

    // A blank message is a CLEAR, not an override that silences the line —
    // the same rule every text field here follows, and the reason the column
    // is nullable rather than defaulted to ''.
    const blank = resolveNumberIdentity(company, { mctbMessage: "   " });
    expect(blank.mctbMessage).toEqual({
      value: "Sorry we missed your call.",
      inherited: true,
    });
  });

  it("NI-1: a number with no overrides is the workspace, entirely", () => {
    // The migration's no-op guarantee, as a test. Every existing number is
    // all-null, so nobody's greeting changes on deploy.
    const identity = resolveNumberIdentity(company, {});
    expect(identity.label.value).toBe("Reed Roofing");
    expect(identity.voicemailGreeting.value).toBe(company.voicemailGreeting);
    expect(identity.awayEnabled.value).toBe(true);
    // Against the field COUNT, not a literal. A literal here is a ceiling:
        // it passes today, and the next field added to the identity makes this
        // fail for being right rather than catching anything. What the test
        // means is "every field", so that is what it says.
    expect(inheritedFields(identity)).toHaveLength(Object.keys(identity).length);
  });

  it("NI-2: null is INHERIT, not empty", () => {
    // THE ONE THAT MATTERS. If null resolved to "no greeting", clearing an
    // override would silence a live call — and the owner's only evidence
    // would be a customer saying nobody answered.
    const identity = resolveNumberIdentity(company, {
      voicemailGreeting: null,
      awayMessage: null,
    });
    expect(identity.voicemailGreeting.value).toBe(company.voicemailGreeting);
    expect(identity.voicemailGreeting.inherited).toBe(true);
    expect(identity.awayMessage.value).toBe(company.awayMessage);
  });

  it("NI-3: an override wins, and says it is not inherited", () => {
    const identity = resolveNumberIdentity(company, {
      label: "Reed Roofing Sales",
      voicemailGreeting: "Sales line. Leave your number and we'll call back.",
    });
    expect(identity.label.value).toBe("Reed Roofing Sales");
    expect(identity.label.inherited).toBe(false);
    expect(identity.voicemailGreeting.inherited).toBe(false);
    // And untouched fields still follow the workspace.
    expect(identity.timezone.inherited).toBe(true);
  });

  it("NI-4: awayEnabled is TRI-state, so a line can opt out", () => {
    // A boolean that could only be true or false could not express "follow
    // the workspace", which is what every existing number must keep doing.
    // And `false` has to be a real override, not read as absent — a sales
    // line that never sends an away reply is a legitimate setup.
    expect(resolveNumberIdentity(company, {}).awayEnabled).toEqual({
      value: true,
      inherited: true,
    });
    expect(resolveNumberIdentity(company, { awayEnabled: false }).awayEnabled).toEqual({
      value: false,
      inherited: false,
    });
    expect(resolveNumberIdentity(company, { awayEnabled: null }).awayEnabled).toEqual({
      value: true,
      inherited: true,
    });
  });

  it("NI-5: an ABSENT key resolves the same as an explicit null", () => {
    // A row read with a narrower select has no key at all. "The column was
    // not fetched" must mean inherit for the same reason "the owner set
    // nothing" does — otherwise a partial read silently becomes an override.
    const identity = resolveNumberIdentity(company, {
      label: "Sales",
    });
    expect(identity.voicemailGreeting.value).toBe(company.voicemailGreeting);
    expect(identity.voicemailGreeting.inherited).toBe(true);
  });

  it("NI-6: a whitespace-only override is not an override", () => {
    // The same failure as NI-2, arriving through the UI instead of the
    // schema: a form posts "" when somebody clears a box, "" is not null, so
    // it resolves as a real override and the line goes silent while the
    // database still says the workspace has a greeting.
    for (const blank of ["", "   ", "\n\t "]) {
      const identity = resolveNumberIdentity(company, {
        voicemailGreeting: blank,
        label: blank,
      });
      expect(identity.voicemailGreeting.value, JSON.stringify(blank)).toBe(
        company.voicemailGreeting,
      );
      expect(identity.label.value).toBe("Reed Roofing");
      expect(identity.label.inherited).toBe(true);
    }
  });

  it("NI-7: a null number resolves to the workspace rather than throwing", () => {
    // A conversation with no number, or a read that could not find one. The
    // caller of this is on the live-call path, where an exception is silence.
    expect(resolveNumberIdentity(company, null).label.value).toBe("Reed Roofing");
    expect(resolveNumberIdentity(company, undefined).timezone.value).toBe(
      "America/Toronto",
    );
  });

  it("NI-8: the identity is COHERENT — one name across every surface", () => {
    // The acceptance criterion that is really about the caller: a line that
    // introduces itself two different ways in one interaction is worse than
    // one that is generic. Everything reads `label`, so there is only one
    // name to be wrong.
    const identity = resolveNumberIdentity(company, { label: "Reed Roofing Sales" });
    expect(identity.label.value).toBe("Reed Roofing Sales");
    // Nothing else carries a name of its own that could disagree with it.
    expect(Object.keys(identity).filter((k) => /name|label/i.test(k))).toEqual([
      "label",
    ]);
  });

  it("NI-9: a workspace with nothing set still resolves, without inventing", () => {
    // A greeting of null on both sides is "no recorded greeting", and the
    // runtime's own TTS fallback handles it. This must not become an empty
    // string that reads as a configured, silent greeting.
    const bare: CompanyIdentity = {
      ...company,
      voicemailGreeting: null,
      awayMessage: null,
    };
    const identity = resolveNumberIdentity(bare, {});
    expect(identity.voicemailGreeting.value).toBeNull();
    expect(identity.voicemailGreeting.inherited).toBe(true);
  });
});
