/**
 * #587 — the byte-order mark, asserted on the BYTES.
 *
 * The whole failure mode is a missing three-byte prefix, and a body-content
 * assertion cannot see it: `expect(text).toContain("Zoë")` passes identically
 * whether or not the mark is there, because decoding the response as UTF-8 is
 * exactly what Excel fails to do. So every assertion here reads the leading
 * bytes.
 *
 * The defect it pins: `GET /v1/audit-log?format=csv` shipped without the mark
 * while the contacts export had it, so an actor named `Zoë Fournier` arrived in
 * Excel as `ZoÃ« Fournier` — in the one file an owner hands to an insurer or
 * attaches to a security questionnaire.
 */
import { describe, expect, it } from "vitest";

import {
  csvBytes,
  csvResponse,
  csvUnguardText,
  parseCsv,
  serializeCsv,
} from "./csv";

/** EF BB BF. Written out so a failure message shows the bytes, not a constant. */
const BOM = [0xef, 0xbb, 0xbf];

const ACCENTED = [
  ["actor", "action"],
  ["Zoë Fournier", "member.invited"],
  ["José Álvarez", "number.released"],
];

describe("#587 csvBytes", () => {
  it("puts the mark first, before anything else", async () => {
    const bytes = csvBytes(ACCENTED);
    expect([...bytes.slice(0, 3)]).toEqual(BOM);
  });

  it("adds it exactly once, whatever the content", () => {
    // Two marks would show up in the first cell as an invisible character that
    // breaks a header match on re-import — a quieter defect than none at all.
    const bytes = csvBytes(ACCENTED);
    expect([...bytes.slice(3, 6)]).not.toEqual(BOM);
  });

  it("leaves the serialized text untouched behind the mark", () => {
    const bytes = csvBytes(ACCENTED);
    const behind = new TextDecoder().decode(bytes.slice(3));
    expect(behind).toBe(serializeCsv(ACCENTED));
    // And the accents are real UTF-8, which is the thing the mark tells Excel.
    expect(behind).toContain("Zoë Fournier");
  });

  it("still emits a mark for an empty export", () => {
    // A workspace with nothing to export still gets a file, and a spreadsheet
    // still has to be told how to read the header row.
    expect([...csvBytes([["actor", "action"]]).slice(0, 3)]).toEqual(BOM);
  });
});

describe("#587 csvResponse", () => {
  it("emits the mark on the wire, not just in the string", async () => {
    // Through the real Response, because that is the layer where a leading
    // U+FEFF character could in principle be dropped and where the bytes cannot.
    const response = csvResponse(ACCENTED, "audit-log.csv");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual(BOM);
  });

  it("carries the download headers with it", () => {
    // They travel together for the same reason the mark does: four things to
    // remember per route is how one of them goes missing.
    const response = csvResponse(ACCENTED, "audit-log.csv");
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="audit-log.csv"',
    );
    expect(response.status).toBe(200);
  });
});

describe("#587 the export → import round trip stays lossless", () => {
  /**
   * The reason adding a mark everywhere is safe, confirmed by running it rather
   * than by reading `parseCsv`. If the parser did NOT strip it, the first header
   * would come back with an invisible U+FEFF glued to it — matching no column name, so every row
   * would import with a missing first field and nobody would see why.
   */
  it("a contacts export re-imports with its first header intact", () => {
    const rows = [
      ["phone_e164", "name"],
      ["+14155550100", "Zoë Fournier"],
    ];
    /**
     * `ignoreBOM: true`, and it is the whole point of this test.
     *
     * A default `TextDecoder` CONSUMES a leading mark — the first version of this
     * assertion read code point `p` and failed, because it was measuring the
     * decoder rather than the export. That default is also why an assertion like
     * `expect(text).toContain("Zoë")` can never see this defect at all.
     *
     * Keeping the mark models the consumer that does NOT strip it, which is the
     * only input on which `parseCsv`'s own stripping means anything.
     */
    // `fatal` is required alongside it by the Workers type definitions.
    const exported = new TextDecoder("utf-8", {
      ignoreBOM: true,
      fatal: false,
    }).decode(csvBytes(rows));
    expect(exported.codePointAt(0)).toBe(0xfeff);

    const parsed = parseCsv(exported);
    // The header survives, which is the half the mark could have broken.
    expect(parsed[0][0]).toBe("phone_e164");
    expect(parsed[0][0].codePointAt(0)).not.toBe(0xfeff);

    /**
     * And the row survives THROUGH THE IMPORTER, which is the honest contract.
     *
     * `serializeCsv` guards a `+`-leading cell with an apostrophe (#580 — every
     * E.164 number we store begins with `+`, and a spreadsheet would otherwise
     * read it as a formula), so the exported number really is `'+14155550100`.
     * `csvUnguardText` is the other half, and the import path calls it. Asserting
     * the raw parse would have been asserting the injection guard was absent.
     */
    expect(parsed[1].map((cell) => csvUnguardText(cell))).toEqual([
      "+14155550100",
      "Zoë Fournier",
    ]);
  });

  it("a file WITHOUT a mark still parses the same way", () => {
    // The stripping must be conditional. A parser that unconditionally dropped
    // the first character would eat the `p` of `phone_e164` from every file
    // exported by anything that is not us.
    const parsed = parseCsv(serializeCsv([["phone_e164"], ["+14155550100"]]));
    expect(parsed[0][0]).toBe("phone_e164");
  });
});
