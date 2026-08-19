import { describe, expect, it } from "vitest";

import { apiErrorsEn, apiErrorsFr } from "@/i18n/sections/apiErrors";
import { makeTranslate } from "@/i18n/provider";

import { parseErrorBody } from "./error";

/**
 * #228 — a refusal in the language the reader chose.
 *
 * The API composes its 370 refusals in English. All three clients rendered them
 * exactly as they arrived, which is right for an English crew and useless for
 * the French one this issue exists for: the sentence lands at the moment
 * something has gone wrong, in a language they did not pick, on a workspace we
 * sell to Quebec on purpose.
 *
 * These assertions are about the ASYMMETRY, because that is the part somebody
 * would reasonably undo. Replacing a specific sentence with a generic one is a
 * loss, and it is only ever worth taking when the specific one could not be
 * read at all.
 */

const body = (code: string, message: string) => ({ error: { code, message } });

describe("an English reader keeps every word the server wrote", () => {
  it("passes the server's specific sentence through untouched", () => {
    const error = parseErrorBody(404, body("not_found", "No such API key."));
    // Not the catalogue's "We couldn't find that." — the server knew it was a
    // key, and that is the whole value of the sentence.
    expect(error.message).toBe("No such API key.");
  });

  it("does the same when a translator is passed explicitly", () => {
    const error = parseErrorBody(
      409,
      body("conflict", "This company already has a subscription."),
      makeTranslate("en"),
    );
    expect(error.message).toBe("This company already has a subscription.");
  });

  it("keeps the server's sentence for a code it does not recognise", () => {
    const error = parseErrorBody(418, body("teapot_error", "Short and stout."));
    expect(error.code).toBe("internal_error");
    expect(error.message).toBe("Short and stout.");
  });
});

describe("a French reader gets French", () => {
  const fr = makeTranslate("fr-CA");

  it("replaces the server's English with the code's own sentence", () => {
    const error = parseErrorBody(404, body("not_found", "No such API key."), fr);
    expect(error.message).toBe(apiErrorsFr.not_found);
    expect(error.message).not.toContain("No such");
  });

  it("keeps the code intact, because the UI routes on it", () => {
    // Several screens branch on the code — the quiet-hours confirm dialog most
    // visibly. Translating the sentence must not disturb that.
    const error = parseErrorBody(
      409,
      body("quiet_hours_confirmation_required", "It is quiet hours there."),
      fr,
    );
    expect(error.code).toBe("quiet_hours_confirmation_required");
    expect(error.message).toBe(apiErrorsFr.quiet_hours_confirmation_required);
  });

  it("translates an unrecognised code as an internal error", () => {
    const error = parseErrorBody(418, body("teapot_error", "Short and stout."), fr);
    expect(error.message).toBe(apiErrorsFr.internal_error);
  });

  it("never leaves a key showing", () => {
    // The catalogue fails open: a missing entry resolves to its own name. On
    // this path that would put `apiErrors.not_found` on screen, which is worse
    // than the English it replaced. Every code is checked, so adding one to
    // packages/shared without copy fails here as well as in tsc.
    for (const code of Object.keys(apiErrorsEn)) {
      const error = parseErrorBody(400, body(code, "English."), fr);
      expect(error.message, `${code} resolved to its own key`).not.toContain(
        "apiErrors.",
      );
      expect(error.message, `${code} was left in English`).not.toBe("English.");
    }
  });
});

describe("an unrecognised locale behaves as English", () => {
  it("keeps the server's specific sentence rather than English generic copy", () => {
    // makeTranslate falls back to the English catalogue for a locale it does
    // not have. If it also reported that locale as its own, this path would
    // swap a specific English sentence for a generic English one — a pure loss
    // with no French anywhere in it.
    const unknown = makeTranslate("de-DE" as "en");
    const error = parseErrorBody(404, body("not_found", "No such API key."), unknown);
    expect(error.message).toBe("No such API key.");
  });
});

describe("the two languages are actually different", () => {
  it("has a distinct French sentence for every code", () => {
    // A French entry copied from the English one is the failure this cannot
    // see any other way: it type-checks, it renders, and it is still English.
    const same = Object.keys(apiErrorsEn).filter(
      (code) =>
        apiErrorsEn[code as keyof typeof apiErrorsEn] ===
        apiErrorsFr[code as keyof typeof apiErrorsFr],
    );
    expect(same).toEqual([]);
  });
});

describe("the server's own reference for a 5xx", () => {
  const withId = {
    error: {
      code: "internal_error",
      message: "Something went wrong.",
      request_id: "8f2a1c9db4e60007",
    },
  };

  it("is shown, which web did not do at all before", () => {
    // Both phones already said this. Web dropped it, so the client a founder
    // is most likely to be looking at during an incident was the one that
    // could not quote the line to search for.
    const error = parseErrorBody(500, withId);
    expect(error.requestId).toBe("8f2a1c9db4e60007");
    expect(error.message).toBe("Something went wrong. Reference 8f2a1c9db4e60007.");
  });

  it("is said in French to a French reader, reference and all", () => {
    const error = parseErrorBody(500, withId, makeTranslate("fr-CA"));
    expect(error.message).toBe(
      `${apiErrorsFr.internal_error} Référence 8f2a1c9db4e60007.`,
    );
    expect(error.message).not.toContain("Reference ");
  });

  it("is left off a refusal that already names what is wrong", () => {
    // A 422 explaining which field is wrong needs no reference, and appending
    // one to every refusal would be noise on copy that is doing its job.
    const error = parseErrorBody(422, body("validation_failed", "country is required."));
    expect(error.requestId).toBeUndefined();
    expect(error.message).toBe("country is required.");
  });

  it("ignores an empty reference rather than printing a bare word", () => {
    const error = parseErrorBody(500, {
      error: { code: "internal_error", message: "Something went wrong.", request_id: "" },
    });
    expect(error.message).toBe("Something went wrong.");
  });
});
