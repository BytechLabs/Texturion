/**
 * #248 round 3 — the per-column declaration that replaced the classifier.
 *
 * Two rounds of "does this dropped column mean do-not-contact" lost, once to a
 * vocabulary of words and once to a vocabulary of numbers. These are the tests
 * for the thing that has no vocabulary: every column is answered, by index.
 */
import { describe, expect, it } from "vitest";

import {
  CONTACT_IMPORT_COLUMN_FIELD,
  CONTACT_IMPORT_IGNORE,
  CONTACT_IMPORT_UNREADABLE_ENCODING,
  CONTACT_IMPORT_VCARD_PROPERTY_FIELD,
  contactImportColumnMismatchMessage,
  contactImportUndeclaredColumnsMessage,
  contactImportUndeclaredPropertiesMessage,
  contactImportUnterminatedQuoteMessage,
  defaultContactImportColumns,
  formatContactImportColumn,
  formatVCardProperty,
  mappingFromDeclarations,
  parseContactImportColumn,
  parseVCardProperty,
  vcardParameterProperty,
  VCARD_MAPPED_PROPERTIES,
} from "./contact-import";

describe("#248 the wire form of a column declaration", () => {
  it("round-trips a plain declaration", () => {
    const declaration = { index: 2, action: "opted_out" as const, header: "Do Not Call" };
    expect(formatContactImportColumn(declaration)).toBe("2:opted_out:Do Not Call");
    expect(parseContactImportColumn("2:opted_out:Do Not Call")).toEqual(declaration);
  });

  it("keeps a header containing colons, commas and quotes whole", () => {
    // The header is LAST in the string for exactly this reason: it may contain
    // anything a spreadsheet allows, and the two splits before it are on fixed
    // tokens. A format that split on every colon would truncate this header and
    // then report it as not matching the file.
    const raw = `0:${CONTACT_IMPORT_IGNORE}:Region: EU, "west"`;
    expect(parseContactImportColumn(raw)).toEqual({
      index: 0,
      action: CONTACT_IMPORT_IGNORE,
      header: `Region: EU, "west"`,
    });
  });

  it("carries a NAMELESS column, which is the whole reason it is index-first", () => {
    // Round two matched its field on `normalizeContactHeader`, which strips
    // everything but [a-z0-9] — so "", "—", "#" and "★" all normalised to the
    // SAME EMPTY STRING and two nameless columns could not be told apart. A
    // position cannot collide with another position.
    expect(parseContactImportColumn("3:ignore:")).toEqual({
      index: 3,
      action: CONTACT_IMPORT_IGNORE,
      header: "",
    });
    const first = parseContactImportColumn("2:ignore:—");
    const second = parseContactImportColumn("3:ignore:★");
    expect(first?.index).not.toBe(second?.index);
  });

  it("refuses anything that is not a declaration", () => {
    for (const raw of [
      "",
      "2",
      "2:opted_out",
      "two:ignore:x",
      " 2:ignore:x", // a lenient Number() would read this as column two
      "+2:ignore:x",
      // NO INDEX AT ALL. The one the strictness above missed, because
      // `Number("")` is 0: a single `rawIndex !== ""` escape hatch turns every
      // indexless declaration into a confident answer about column ZERO, which
      // is identity-by-header again under a new spelling — and header identity
      // is what could not tell two nameless columns apart.
      ":ignore:x",
      ":ignore:",
      "::x",
      "2:phone_number:x", // not a field this importer has
      "2::x",
      "-1:ignore:x",
    ]) {
      expect(parseContactImportColumn(raw)).toBeNull();
    }
  });
});

describe("#248 the default guess a client shows before anybody answers", () => {
  it("H1: guesses a FIELD or nothing, and never a dismissal", () => {
    // THE SHIP BLOCKER of round three, in one assertion. This used to answer
    // `ignore` for every column it did not recognise, so `Phone,Name,Notes`
    // over a Notes column reading "DO NOT CALL - asked us to stop" came back a
    // COMPLETE declaration: all three clients posted it with no interaction,
    // the API accepted it because complete is all it can check, and the send
    // returned 201 with a message row. A dismissal is an answer — "I saw these
    // values and they decide nothing" — and a detector has seen nothing.
    const headers = ["Phone Number", "Full Name", "Marketing Status"];
    expect(defaultContactImportColumns(headers)).toEqual([
      { index: 0, action: "phone", header: "Phone Number" },
      { index: 1, action: "name", header: "Full Name" },
      { index: 2, action: null, header: "Marketing Status" },
    ]);
    // And it is not merely "not this literal": nothing this function returns is
    // an action at all unless the detector recognised a field. Asserted against
    // the shipped constant, so a rename of `ignore` moves the guard with it.
    for (const guess of defaultContactImportColumns([
      "Notes",
      "Marketing Status",
      "Owner",
    ])) {
      expect(guess.action).not.toBe(CONTACT_IMPORT_IGNORE);
    }
  });

  it("still lists EVERY column, including one that exists only in the data", () => {
    // Unanswered is not absent: the client renders these by position, so a
    // column missing from this list is a column missing from the screen — and
    // a cell past the end of the header row is exactly the column somebody
    // annotated one row with.
    const guesses = defaultContactImportColumns(
      ["Phone", "Name"],
      [["+12065550101", "Ann", "DO NOT CALL"]],
    );
    expect(guesses).toHaveLength(3);
    expect(guesses[2]).toEqual({ index: 2, action: null, header: "" });
    // A MIX: the recognised columns keep their guess in the same answer, so
    // nobody retypes `Phone` → phone on a clean export. A gate that fires on
    // every file is a gate people learn to click through.
    expect(guesses.map((guess) => guess.action)).toEqual([
      "phone",
      "name",
      null,
    ]);
  });
});

describe("#248 the mapping the declarations describe", () => {
  it("is the person's answer, not the detector's", () => {
    // `Description` is claimed by `notes` on every header pattern we own, so a
    // row reading "DO NOT CONTACT" under it was filed as a note and the person
    // was texted. Round two's gate only examined UNMAPPED columns, so a wrong
    // mapping was invisible to it. Here the human's answer wins outright.
    expect(
      mappingFromDeclarations([
        { index: 0, action: "phone", header: "Phone" },
        { index: 1, action: "opted_out", header: "Description" },
        { index: 2, action: CONTACT_IMPORT_IGNORE, header: "Owner" },
      ]),
    ).toEqual({ phone: 0, opted_out: 1 });
  });

  it("drops the ignored columns entirely", () => {
    expect(
      mappingFromDeclarations([
        { index: 0, action: CONTACT_IMPORT_IGNORE, header: "a" },
      ]),
    ).toEqual({});
  });
});

describe("#248 what the refusals say", () => {
  it("names each undeclared column by position, header or not", () => {
    const message = contactImportUndeclaredColumnsMessage(
      [
        { index: 2, header: "Marketing Status" },
        { index: 3, header: "" },
      ],
      4,
    );
    expect(message).toContain(`column 3 ("Marketing Status")`);
    expect(message).toContain("column 4 (no header)");
    // The field name comes from the shipped constant, so a rename moves the
    // sentence with it rather than leaving a caller following stale advice.
    expect(message).toContain(`\`${CONTACT_IMPORT_COLUMN_FIELD}\``);
    expect(message).toContain("Nothing was imported.");
  });

  it("says the plural and the singular", () => {
    expect(
      contactImportUndeclaredColumnsMessage([{ index: 0, header: "x" }], 1),
    ).toContain("was not declared");
    expect(
      contactImportUndeclaredColumnsMessage(
        [
          { index: 0, header: "x" },
          { index: 1, header: "y" },
        ],
        2,
      ),
    ).toContain("were not declared");
    // The grammar every refused workspace reads. Round two shipped "this import
    // does not know what those columns means" to exactly these people.
    expect(
      contactImportUndeclaredColumnsMessage([{ index: 0, header: "x" }], 1),
    ).not.toMatch(/columns means|column mean\b/);
  });

  it("keeps the mismatch sentence one sentence, whatever went wrong", () => {
    const message = contactImportColumnMismatchMessage("column 2 is declared twice");
    expect(message).toContain("column 2 is declared twice");
    expect(message).toContain("Nothing was imported.");
  });
});

describe("#248 the vCard property declaration", () => {
  it("maps only the properties the importer actually reads", () => {
    // If `CATEGORIES` or `NOTE` ever appears here, the two places a .vcf can
    // say do-not-text stop being asked about.
    expect(VCARD_MAPPED_PROPERTIES).not.toContain("CATEGORIES");
    expect(VCARD_MAPPED_PROPERTIES).not.toContain("NOTE");
    expect([...VCARD_MAPPED_PROPERTIES].sort()).toEqual([
      "BEGIN",
      "END",
      "FN",
      "N",
      "TEL",
      "VERSION",
    ]);
  });

  it("round-trips, and upper-cases the property", () => {
    expect(formatVCardProperty({ property: "CATEGORIES", action: "opted_out" })).toBe(
      "CATEGORIES:opted_out",
    );
    expect(parseVCardProperty("categories:opted_out")).toEqual({
      property: "CATEGORIES",
      action: "opted_out",
    });
  });

  it("refuses anything that is not a property declaration", () => {
    for (const raw of ["", "NOTE", "NOTE:notes", ":ignore", "NOTE:IGNORE"]) {
      expect(parseVCardProperty(raw)).toBeNull();
    }
  });

  it("names the properties it will not read past", () => {
    const message = contactImportUndeclaredPropertiesMessage(["CATEGORIES", "NOTE"]);
    expect(message).toContain("`CATEGORIES`");
    expect(message).toContain("`NOTE`");
    expect(message).toContain(`\`${CONTACT_IMPORT_VCARD_PROPERTY_FIELD}\``);
    expect(message).toContain("Nothing was imported.");
  });

  it("H3: carries a PARAMETER as its own property, through the same wire form", () => {
    // `TEL;TYPE=CELL;X-ABLabel=DO NOT CALL:+1613…` is Apple's inline shape, and
    // the parameter is where the instruction sat. It is declared like any other
    // property, which works only because the wire form splits on the LAST colon
    // — a format that split on the first would read this as a property called
    // `TEL` and an action called `TYPE`.
    const token = vcardParameterProperty("TEL", "X-ABLABEL");
    expect(token).toBe("TEL;X-ABLABEL");
    expect(formatVCardProperty({ property: token, action: "opted_out" })).toBe(
      "TEL;X-ABLABEL:opted_out",
    );
    expect(parseVCardProperty("TEL;X-ABLABEL:opted_out")).toEqual({
      property: token,
      action: "opted_out",
    });
  });

  it("H3: says how many properties it did not print, rather than trailing off", () => {
    // A line with no colon is now a property, so a mangled file can carry
    // thousands of one-off tokens as long as the line. Printing them all is a
    // refusal nobody reads; printing some and saying nothing is #248 round 2's
    // B8 defect — a truncated list under a whole count, which people act on.
    const many = Array.from({ length: 25 }, (_, i) => `X-PROP-${i}`);
    const message = contactImportUndeclaredPropertiesMessage(many);
    expect(message).toContain("`X-PROP-0`");
    expect(message).toContain("and 5 more");
    expect(message).not.toContain("`X-PROP-24`");
    // One long token is shortened rather than reprinted whole, and says so.
    const long = `X-${"D".repeat(200)}`;
    const shortened = contactImportUndeclaredPropertiesMessage([long]);
    expect(shortened).not.toContain(long);
    expect(shortened).toContain("…");
    // A file with an ordinary number of unread properties prints all of them
    // and never says "more" — the branch has to have both sides.
    expect(
      contactImportUndeclaredPropertiesMessage(["CATEGORIES", "NOTE"]),
    ).not.toContain("more");
  });
});

describe("#248 H5 what the server says about a file it cannot read", () => {
  it("names the line a quote opened on, and says nothing was imported", () => {
    // The mangling shows up hundreds of lines later, where the file looks fine,
    // so the line the quote OPENED on is the only part a person can act on.
    const message = contactImportUnterminatedQuoteMessage(3);
    expect(message).toContain("line 3");
    expect(message).toContain("Nothing was imported.");
    // And it says what the silent version cost: rows that are neither imported
    // nor reported. A refusal that reads as "some rows were skipped" would send
    // somebody looking at the wrong thing.
    expect(message).toContain("would not be reported as skipped");
  });

  it("tells a UTF-16 save what to do instead of answering 500", () => {
    expect(CONTACT_IMPORT_UNREADABLE_ENCODING).toContain("UTF-16");
    expect(CONTACT_IMPORT_UNREADABLE_ENCODING).toContain("CSV UTF-8");
    expect(CONTACT_IMPORT_UNREADABLE_ENCODING).toContain("Nothing was imported.");
  });
});
