/**
 * #515: the vectors the Kotlin and Swift ports run too. The bug being fenced
 * is "the nominee sees nothing" — so the cases that matter most are the ones
 * that must return a prompt, not the ones that must not.
 */
import { describe, expect, it } from "vitest";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

import {
  handoverPromptCancelLabel,
  handoverPromptHeadline,
  handoverPromptIsUrgent,
  viewerHandoverPrompt,
  type HandoverPromptKind,
  type HandoverViewer,
} from "./handover";

const ALL: HandoverPromptKind[] = [
  "accept_offer",
  "complete_claim",
  "claim_waiting",
  "backup_standing",
];

const nobody: HandoverViewer = { can_claim: false, pending: null };

describe("viewerHandoverPrompt", () => {
  it("gives the named backup somewhere to start", () => {
    expect(viewerHandoverPrompt({ can_claim: true, pending: null })).toBe(
      "backup_standing",
    );
  });

  it("gives the recipient of an offer the accept prompt", () => {
    expect(
      viewerHandoverPrompt({
        can_claim: false,
        pending: { kind: "offer", mine: true, ready: true },
      }),
    ).toBe("accept_offer");
  });

  it("holds a claim at 'waiting' until the veto window closes", () => {
    expect(
      viewerHandoverPrompt({
        can_claim: false,
        pending: { kind: "claim", mine: true, ready: false },
      }),
    ).toBe("claim_waiting");
  });

  it("releases the claim once it has ripened", () => {
    expect(
      viewerHandoverPrompt({
        can_claim: false,
        pending: { kind: "claim", mine: true, ready: true },
      }),
    ).toBe("complete_claim");
  });

  it("says nothing to somebody who is not party to it", () => {
    expect(viewerHandoverPrompt(nobody)).toBeNull();
    // A handover between two other people is real news, but it is not this
    // person's prompt — the surface shows it separately, without an action.
    expect(
      viewerHandoverPrompt({
        can_claim: false,
        pending: { kind: "claim", mine: false, ready: true },
      }),
    ).toBeNull();
  });

  it("prefers what is in flight over the standing nomination", () => {
    // can_claim is false while anything is pending, so this pairing cannot
    // arrive from the server — pinned anyway, because a client that ever
    // reorders these branches would offer a second takeover mid-handover.
    expect(
      viewerHandoverPrompt({
        can_claim: true,
        pending: { kind: "offer", mine: true, ready: true },
      }),
    ).toBe("accept_offer");
  });
});

/** #228 — the module names keys now, so the tests resolve them. */
function look(table: unknown, key: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[
    name
  ];
  if (typeof value !== "string") throw new Error(`no entry for ${key}`);
  return value;
}

const sayEn = (key: string): string => look(WEB_EN, key);
const sayFr = (key: string): string => look(WEB_FR, key);

describe("handoverPromptHeadline", () => {
  it("speaks to the reader in every state", () => {
    for (const kind of ALL) {
      const line = handoverPromptHeadline(kind, sayEn);
      expect(line, kind).toMatch(/^You(r)? /);
      expect(line.endsWith("."), kind).toBe(true);
    }
  });

  it("#228: speaks to the reader in French too, which is not the same test", () => {
    // "Starts with You" is a property of ENGLISH, not of the second person.
    // The French offer is passive — "La propriété … vous a été offerte" — and
    // asserting the same shape would have forced a worse translation to make
    // a test pass. What actually has to hold is that every one of these
    // addresses the person it is happening to.
    for (const kind of ALL) {
      const line = handoverPromptHeadline(kind, sayFr);
      expect(line, kind).toMatch(/\b(vous|votre)\b/i);
      expect(line.endsWith("."), kind).toBe(true);
      expect(line, kind).not.toBe(handoverPromptHeadline(kind, sayEn));
    }
  });
});

describe("handoverPromptCancelLabel", () => {
  it("never tells somebody to decline their own request", () => {
    expect(handoverPromptCancelLabel("complete_claim", sayEn)).toBe(
      "Withdraw my request",
    );
    expect(handoverPromptCancelLabel("claim_waiting", sayEn)).toBe(
      "Withdraw my request",
    );
    expect(handoverPromptCancelLabel("accept_offer", sayEn)).toBe("Decline");
  });

  it("#228: keeps the two apart in French, which is the whole distinction", () => {
    // The reason this function exists at all: refusing an offer and calling
    // off your own request are different acts, and a client that used one
    // word for both would be misreading the room in either direction. A
    // translation that collapsed them would do the same damage silently.
    const withdraw = handoverPromptCancelLabel("claim_waiting", sayFr);
    const decline = handoverPromptCancelLabel("accept_offer", sayFr);
    expect(withdraw).toBe("Retirer ma demande");
    expect(decline).toBe("Refuser");
    expect(withdraw).not.toBe(decline);
  });

  it("offers nothing to call off on a standing nomination", () => {
    expect(handoverPromptCancelLabel("backup_standing", sayEn)).toBeNull();
    expect(handoverPromptCancelLabel("backup_standing", sayFr)).toBeNull();
  });
});

describe("handoverPromptIsUrgent", () => {
  it("interrupts only for the states on a clock", () => {
    expect(handoverPromptIsUrgent("accept_offer")).toBe(true);
    expect(handoverPromptIsUrgent("complete_claim")).toBe(true);
    expect(handoverPromptIsUrgent("claim_waiting")).toBe(true);
    // A nomination can sit unused for years. A permanent banner for it would
    // be a nag for a state that needs nothing done.
    expect(handoverPromptIsUrgent("backup_standing")).toBe(false);
  });
});
