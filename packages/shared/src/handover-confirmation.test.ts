import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "./error-codes";
import {
  HANDOVER_CODE_DESTINATION,
  HANDOVER_CONFIRM_FIELD,
  HANDOVER_CONFIRM_REJECTED,
  HANDOVER_CONFIRM_RESEND,
  HANDOVER_CONFIRM_SUBMIT,
  HANDOVER_CONFIRM_TITLE,
  HANDOVER_CONFIRM_WHERE,
  handoverConfirmationKind,
  isHandoverCode,
} from "./handover-confirmation";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/*
 * #228 — the dialog names keys, so these resolve them through the catalogue it
 * reads. Better than the assertions they replace: those read the module's own
 * English back to itself, and these read what somebody is shown while being
 * asked to prove they are the owner of a business.
 */
function lookUp(table: unknown, key: string, lang: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[name];
  if (typeof value !== "string") throw new Error(`no ${lang} for ${key}`);
  return value;
}

const say = (key: string): string => lookUp(WEB_EN, key, "English");
const sayFr = (key: string): string => lookUp(WEB_FR, key, "French");

describe("which prompt to show (#537)", () => {
  it("#581/#7: a stale factor is its OWN kind, not an alias for the wall", () => {
    /**
     * The copy is identical and the mechanism is not, which is exactly why this
     * cannot be folded into `authenticator`.
     *
     * `mfa_challenge_required` is the workspace-wide wall and its six digits go to
     * our API. `mfa_reprove_required` says this act needs a factor proved in the
     * last five minutes, and its six digits go to SUPABASE in the client — which
     * refreshes the session and stamps a new proof time — after which the action
     * is retried with no code at all. Posting those digits at our API instead
     * would loop forever, because nothing there is checking a code.
     */
    expect(handoverConfirmationKind("mfa_reprove_required")).toBe("reprove");
    expect(handoverConfirmationKind("mfa_challenge_required")).toBe(
      "authenticator",
    );
    // Same words for the same physical act. A second phrasing would read as a
    // different demand to somebody who meets both in one afternoon.
    expect(say(HANDOVER_CONFIRM_WHERE.reprove)).toBe(
      say(HANDOVER_CONFIRM_WHERE.authenticator),
    );
  });

  it("#581/#7: every kind has copy — a new one cannot ship without words", () => {
    // Derived from the function rather than listed here: a fourth code added to
    // the mapping with no entry in the record fails this, instead of rendering an
    // empty sentence under the heading on three clients.
    for (const code of [
      "mfa_challenge_required",
      "mfa_reprove_required",
      "confirmation_code_required",
    ]) {
      const kind = handoverConfirmationKind(code);
      expect(kind, `${code} maps to no kind`).not.toBeNull();
      expect(
        HANDOVER_CONFIRM_WHERE[kind!],
        `${kind} has no sentence telling the reader where to find the code`,
      ).toBeTruthy();
    }
  });

  it("sends somebody with an authenticator to their app", () => {
    expect(handoverConfirmationKind("mfa_challenge_required")).toBe(
      "authenticator",
    );
  });

  it("sends somebody without one to their inbox", () => {
    expect(handoverConfirmationKind("confirmation_code_required")).toBe("email");
  });

  it("asks for nothing when the refusal was about something else", () => {
    // THE CASE THAT MATTERS. A handover is also refused when a transfer is
    // already in flight, or when the caller is not the owner. A client that
    // treated every refusal as "ask for a code" would prompt for a code that
    // could never help, and hide the real reason behind it.
    for (const code of ["conflict", "forbidden", "validation_failed", "not_found"]) {
      expect(handoverConfirmationKind(code), code).toBeNull();
    }
    expect(handoverConfirmationKind(null)).toBeNull();
    expect(handoverConfirmationKind(undefined)).toBeNull();
  });

  it("keys on codes the API actually has", () => {
    // A prompt keyed on a code that no longer exists is a prompt that never
    // shows. Checked against the real union rather than a copy of it.
    expect(ERROR_CODES).toContain("mfa_challenge_required");
    expect(ERROR_CODES).toContain("confirmation_code_required");
  });
});

describe("where the digits go (#581/#7)", () => {
  it("checks only the code we emailed, and proves both factor demands at Supabase", () => {
    /**
     * THE ASSERTION THAT WAS MISSING, and its absence is the whole reason this
     * shipped broken on three clients at once.
     *
     * Every other test on this module checks the WORDING, and the wording was right:
     * `reprove` and `authenticator` say the same sentence on purpose, because the
     * person does the identical thing. So the tests stayed green while all three
     * clients posted the reprove digits to our API, where nothing reads them, and the
     * dialog answered every correct code with "that code didn't work" — forever.
     *
     * Identical copy can hide a different mechanism. This is the mechanism.
     *
     * `authenticator` is here for the second half of the same lesson. The first fix
     * left it as `api`, and that is equally untrue: `mfa_challenge_required` is raised
     * on the SESSION's assurance level before a route body runs, and no route reads a
     * confirmation code in answer to it. Only the emailed code is ours to check.
     */
    expect(HANDOVER_CODE_DESTINATION.email).toBe("api");
    expect(HANDOVER_CODE_DESTINATION.reprove).toBe("supabase");
    expect(HANDOVER_CODE_DESTINATION.authenticator).toBe("supabase");
  });

  it("keeps our API off every demand that is about the session, not a secret", () => {
    // Both authenticator demands refuse on a property of the session — was a factor
    // proved, and how long ago — and a code in a request body moves neither. Stated as
    // its own assertion so the reasoning survives someone editing the table: whatever
    // else changes, a client must never be told to post digits at one of these.
    for (const code of ["mfa_challenge_required", "mfa_reprove_required"]) {
      const kind = handoverConfirmationKind(code);
      expect(kind, `${code} maps to no kind`).not.toBeNull();
      expect(
        HANDOVER_CODE_DESTINATION[kind!],
        `${code} is refused on the session's own state; our API has no code to check`,
      ).toBe("supabase");
    }
  });

  it("refuses to let a new kind ship without saying who checks its code", () => {
    // Derived from the mapping rather than listed here, so a fourth refusal code
    // added upstream fails this instead of quietly inheriting a destination.
    for (const code of [
      "mfa_challenge_required",
      "mfa_reprove_required",
      "confirmation_code_required",
    ]) {
      const kind = handoverConfirmationKind(code);
      expect(kind, `${code} maps to no kind`).not.toBeNull();
      expect(
        HANDOVER_CODE_DESTINATION[kind!],
        `${kind} does not say where its six digits are checked`,
      ).toMatch(/^(api|supabase)$/);
    }
  });

  it("keeps the copy and the destination independent", () => {
    // Same sentence, and the reader is doing the same thing, so they are told the same
    // thing. That the two now agree on a destination as well is a fact about the
    // server, not a licence to collapse them: they are different refusals, raised by
    // different code, and one of them ALSO wants the retry to happen within five
    // minutes. A client that switched on the sentence rather than the kind would be
    // right today and wrong the next time either half moved.
    expect(say(HANDOVER_CONFIRM_WHERE.reprove)).toBe(
      say(HANDOVER_CONFIRM_WHERE.authenticator),
    );
    expect(handoverConfirmationKind("mfa_reprove_required")).not.toBe(
      handoverConfirmationKind("mfa_challenge_required"),
    );
    // And the one that genuinely differs still differs, in both directions.
    expect(say(HANDOVER_CONFIRM_WHERE.email)).not.toBe(
      say(HANDOVER_CONFIRM_WHERE.authenticator),
    );
    expect(HANDOVER_CODE_DESTINATION.email).not.toBe(
      HANDOVER_CODE_DESTINATION.authenticator,
    );
  });
});

describe("what the dialog says (#537)", () => {
  it("tells each kind where to look, in different words", () => {
    // "Enter your code" is useless to somebody who does not know which code, and
    // the two live in completely different places.
    expect(say(HANDOVER_CONFIRM_WHERE.authenticator)).toContain("authenticator app");
    expect(say(HANDOVER_CONFIRM_WHERE.email)).toContain("emailed");
    expect(say(HANDOVER_CONFIRM_WHERE.authenticator)).not.toBe(
      say(HANDOVER_CONFIRM_WHERE.email),
    );
  });

  it("mentions the email code's limits where somebody can act on them", () => {
    // Ten minutes and one use are the two things that turn "it didn't work" into
    // "ask for another", which is the next thing they need to do.
    expect(say(HANDOVER_CONFIRM_WHERE.email)).toContain("once");
    expect(say(HANDOVER_CONFIRM_WHERE.email)).toContain("ten minutes");
  });

  it("never promises to resend an authenticator code", () => {
    // There is nothing to resend — the app generates them. A Resend button on
    // that path would imply we could send one, which we cannot.
    expect(say(HANDOVER_CONFIRM_RESEND).toLowerCase()).toContain("again");
    expect(say(HANDOVER_CONFIRM_WHERE.authenticator)).not.toContain("again");
  });

  it("says one thing when a code is refused, inventing no distinction", () => {
    // The server deliberately answers the same way for wrong, expired, spent and
    // out-of-attempts, because telling somebody which would tell an attacker
    // whether they had the right digits. The client must not undo that.
    for (const leak of ["expired", "already", "attempts", "wrong"]) {
      expect(HANDOVER_CONFIRM_REJECTED.toLowerCase(), leak).not.toContain(leak);
    }
  });
});

describe("isHandoverCode (#537)", () => {
  it("accepts six digits", () => {
    expect(isHandoverCode("123456")).toBe(true);
    expect(isHandoverCode("000000")).toBe(true);
  });

  it("tolerates the whitespace a pasted code arrives with", () => {
    expect(isHandoverCode("  123456 ")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of ["", "12345", "1234567", "12345a", "abcdef", "12 34 56"]) {
      expect(isHandoverCode(bad), bad).toBe(false);
    }
  });
});

/*
 * #228 — the dialog reads in French too.
 *
 * This is the screen where somebody proves they are the person a business is
 * being handed to. A half-translated challenge reads as a phishing page, which
 * is the one impression this dialog cannot afford.
 */
describe("#228 the handover challenge reads in both languages", () => {
  it("resolves every line, and translates it", () => {
    const keys = [
      HANDOVER_CONFIRM_TITLE,
      HANDOVER_CONFIRM_FIELD,
      HANDOVER_CONFIRM_SUBMIT,
      HANDOVER_CONFIRM_RESEND,
      HANDOVER_CONFIRM_REJECTED,
      ...Object.values(HANDOVER_CONFIRM_WHERE),
    ];
    for (const key of keys) {
      expect(say(key).length, key).toBeGreaterThan(0);
      expect(sayFr(key).length, key).toBeGreaterThan(0);
      expect(sayFr(key), `${key} is not translated`).not.toBe(say(key));
    }
  });

  it("still sends the two kinds to different places in French", () => {
    // The whole job of these two sentences. A catalogue that answered the same
    // string for both would send somebody to their inbox for a code their
    // authenticator is showing.
    expect(sayFr(HANDOVER_CONFIRM_WHERE.authenticator)).not.toBe(
      sayFr(HANDOVER_CONFIRM_WHERE.email),
    );
  });

  it("keeps the email code's limits in the French too", () => {
    // "Once, and expires in ten minutes" is the part somebody acts on. A
    // translation that dropped it would leave a French reader waiting on a code
    // that died while they looked for it.
    expect(sayFr(HANDOVER_CONFIRM_WHERE.email)).toMatch(/dix minutes|10 minutes/i);
  });
});
