import { describe, expect, it } from "vitest";

import { canadaEn, canadaFr } from "./canada";

/**
 * D138 Rule 9 — /canada's words, checked before the page reads them.
 *
 * The translation lands one commit ahead of the wiring, which is the shape
 * this repo already uses for catalogues (the app's `domain.scheduledHold*`
 * keys sat ahead of the server field that fills them). What that costs is a
 * commit where the copy is not rendered anywhere; what it buys is that the
 * copy is checked on its own terms, which is where its mistakes are.
 *
 * The assertions below are about the mistakes a French marketing page actually
 * makes, not about whether the object has the right shape — `tsc` already
 * refuses a missing key.
 */

const KEYS = Object.keys(canadaEn) as (keyof typeof canadaEn)[];

describe("the French /canada is French", () => {
  it("translates every key", () => {
    // The failure a type cannot see: a French entry pasted from the English.
    // Named exceptions rather than a blanket allowance, so a NEW identical pair
    // fails here instead of joining a silent list.
    const SAME_IN_BOTH = new Set([
      "breadcrumbSelf", // "Canada" is the country's name in both languages.
      "ledgerProvinceHeading", // "Province" likewise.
      "provinceAb",
      "provinceSk",
      "provinceMb",
      "provinceOn",
    ]);
    const identical = KEYS.filter(
      (key) => canadaEn[key] === canadaFr[key] && !SAME_IN_BOTH.has(key),
    );
    expect(identical, "these are still the English string").toEqual([]);
  });

  it("uses the French names of the laws", () => {
    // The tell. Canada's anti-spam law is CASL in English and LCAP in French;
    // the federal privacy act is PIPEDA and LPRPDE. A Quebec business looking
    // up its obligations is searching for the French names, and a page that
    // says "CASL" throughout was translated by somebody who does not work here.
    expect(canadaFr.caslTitle).toContain("LCAP");
    expect(canadaFr.faqCaslQ).toContain("LCAP");
    expect(canadaFr.dataBody).toContain("LPRPDE");
    // Both carry the English in brackets on first use, because the English is
    // what the reader will meet on a US vendor's site next.
    expect(canadaFr.caslBody).toContain("LCAP (CASL)");
    expect(canadaFr.dataBody).toContain("LPRPDE (PIPEDA)");
  });

  it("keeps Law 25's number, because the number is the name", () => {
    expect(canadaEn.faqDataA).toContain("Law 25");
    expect(canadaFr.faqDataA).toContain("Loi 25");
  });

  it("holds the careful CASL line in both languages", () => {
    // The whole page is built on not overstating this: Loonext HELPS YOU
    // FOLLOW the law, it does not make you compliant. A French version that
    // softened it into "vous rend conforme" would be a legal claim we do not
    // make, in a language the person reviewing it may not read.
    expect(canadaEn.caslCarefulEmphasis).toBe("helps you follow");
    expect(canadaFr.caslCarefulEmphasis).toBe("vous aide à respecter");
    expect(canadaFr.caslCarefulAfter).toContain("ne vous rend pas");
    expect(canadaFr.faqCaslA).toContain("vous aide à respecter");
  });

  it("uses the official French province names", () => {
    // Not stylings — the names of the places, as Canada Post writes them.
    expect(canadaFr.provinceBc).toBe("Colombie-Britannique");
    expect(canadaFr.provinceQc).toBe("Québec");
    expect(canadaFr.provinceNs).toBe("Nouvelle-Écosse");
    expect(canadaFr.provincePe).toBe("Île-du-Prince-Édouard");
    expect(canadaFr.provinceNl).toBe("Terre-Neuve-et-Labrador");
    expect(canadaFr.provinceTerritories).toContain("Territoires du Nord-Ouest");
  });

  it("writes French punctuation with the space it takes", () => {
    // A question mark with no space before it is the other tell, and this page
    // asks six questions.
    const questions = [
      canadaFr.h1,
      canadaFr.faqSameDayQ,
      canadaFr.faqNumberQ,
      canadaFr.faqCaslQ,
      canadaFr.faqDataQ,
      canadaFr.faqCurrencyQ,
      canadaFr.usTitle,
    ].filter((line) => line.includes("?"));
    expect(questions.length).toBeGreaterThan(5);
    for (const line of questions) {
      expect(line, `no space before the question mark: ${line}`).toMatch(/ \?/);
    }
  });

  it("keeps the product and place names", () => {
    // Loonext is the name we shipped; STOP is the carrier keyword a customer
    // types and is matched literally, so translating it would break the thing
    // the sentence describes.
    expect(canadaFr.caslBody).toContain("Loonext");
    expect(canadaFr.caslBody).toContain("STOP");
    expect(canadaFr.numbersBodyOne).toContain("Toronto");
    expect(canadaFr.numbersBodyOne).toContain("(416)");
  });
});
