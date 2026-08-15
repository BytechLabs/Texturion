import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

import {
  CARRIER_OPT_OUT_ERROR_CODE,
  GENERIC_SEND_FAILURE_KEY,
  SEND_FAILURE_KEYS_BY_CODE,
  SEND_FAILURE_MESSAGE_KEYS,
  sendFailureMessageKey,
} from "./send-failures";

describe("sendFailureMessageKey", () => {
  it("keeps the opt-out wording the clients already shipped", () => {
    expect(sendFailureMessageKey(CARRIER_OPT_OUT_ERROR_CODE)).toBe(
      "domain.sendFailureOptedOut",
    );
  });

  it("explains the codes a small business actually hits", () => {
    expect(sendFailureMessageKey("40012")).toBe("domain.sendFailureNotTextable");
    expect(sendFailureMessageKey("40010")).toBe("domain.sendFailureRegistration");
    expect(sendFailureMessageKey("40003")).toBe("domain.sendFailureSpam");
  });

  it("separates a temporary carrier block from a permanent one", () => {
    // Worth rewording and retrying vs not worth trying again: the two must not
    // read the same, or the sentence is no better than "Not delivered".
    expect(sendFailureMessageKey("40002")).not.toBe(sendFailureMessageKey("40003"));
    expect(WEB_EN.domain.sendFailureBlockedNow).not.toBe(WEB_EN.domain.sendFailureSpam);
    expect(WEB_FR.domain.sendFailureBlockedNow).not.toBe(WEB_FR.domain.sendFailureSpam);
  });

  it("falls back rather than inventing a reason", () => {
    // An unknown code is exactly when a confident sentence would be a lie.
    expect(sendFailureMessageKey("99999")).toBe(GENERIC_SEND_FAILURE_KEY);
    expect(sendFailureMessageKey(null)).toBe(GENERIC_SEND_FAILURE_KEY);
    expect(sendFailureMessageKey(undefined)).toBe(GENERIC_SEND_FAILURE_KEY);
    expect(sendFailureMessageKey("")).toBe(GENERIC_SEND_FAILURE_KEY);
  });

  it("tolerates whitespace around a stored code", () => {
    expect(sendFailureMessageKey(" 40300 ")).toBe("domain.sendFailureOptedOut");
  });
});

/*
 * #228 — the half of this that `tsc` cannot reach.
 *
 * The return type is a union of the literal keys, so a key the web catalogue
 * lacks is a compile error at the call site. What the type CANNOT see is the
 * opposite direction and the other two clients: a key present in English and
 * missing in French renders as an English sentence to a French reader, and the
 * phones hold their own catalogues that no TypeScript type reaches at all.
 */
describe("the key every client must be able to answer", () => {
  it("names a real English string on the web, for every code", () => {
    const missing = SEND_FAILURE_MESSAGE_KEYS.filter((key) => {
      const name = key.slice("domain.".length) as keyof typeof WEB_EN.domain;
      return typeof WEB_EN.domain[name] !== "string";
    });
    expect(missing).toEqual([]);
  });

  it("names a real FRENCH string too, which is the direction that goes quiet", () => {
    // A missing French key falls back to English by design, so this failure
    // never surfaces as a broken screen — it surfaces as a French reader
    // meeting an English sentence and assuming the app is just like that.
    const missing = SEND_FAILURE_MESSAGE_KEYS.filter((key) => {
      const name = key.slice("domain.".length) as keyof typeof WEB_FR.domain;
      return typeof WEB_FR.domain[name] !== "string";
    });
    expect(missing).toEqual([]);
  });

  /*
   * The three tables the header of send-failures.ts asks somebody to keep
   * identical, checked instead of asked.
   *
   * A carrier code that maps to one sentence on the web and a different one on
   * a phone is not a visible bug — each client looks right on its own. It
   * surfaces when a crew compares two screens and the app tells them two
   * different things about the same failed text.
   *
   * The phones are read from source and the web from its runtime table. That
   * asymmetry is deliberate: one TypeScript entry is written with a computed
   * key, and reading this file as text reported the opt-out mapping missing —
   * the one mapping with a legal meaning behind it.
   */
  it("maps every carrier code to the same key on all three clients", () => {
    const pairs = (source: string) =>
      [...source.matchAll(/"(\d{5})"\s*(?:to|:)\s*"(domain\.\w+)"/g)]
        .map(([, code, key]) => `${code}=${key}`)
        .sort();

    const kotlin = pairs(
      readFileSync(
        join(
          REPO,
          "apps/android/app/src/main/kotlin/com/loonext/android/core/model/SendFailures.kt",
        ),
        "utf8",
      ),
    );
    const swift = pairs(
      readFileSync(join(REPO, "apps/ios/Loonext/Core/Model/SendFailures.swift"), "utf8"),
    );
    const ts = Object.entries(SEND_FAILURE_KEYS_BY_CODE)
      .map(([code, key]) => `${code}=${key}`)
      .sort();

    // A guard that read nothing would agree with itself three times over.
    expect(ts.length).toBeGreaterThan(25);
    expect(kotlin).toEqual(ts);
    expect(swift).toEqual(ts);
  });

  it("is not a French catalogue that merely repeats the English one", () => {
    // The failure mode a presence check cannot see: a key filled in by copying
    // the English across. Only the generic "Not delivered" has any business
    // being close, and it is not identical either.
    const untranslated = SEND_FAILURE_MESSAGE_KEYS.filter((key) => {
      const name = key.slice("domain.".length) as keyof typeof WEB_EN.domain;
      return WEB_EN.domain[name] === WEB_FR.domain[name];
    });
    expect(untranslated).toEqual([]);
  });
});
