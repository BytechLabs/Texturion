import { describe, expect, it } from "vitest";

import { CONTACT_IMPORT_MAX_ROWS } from "./contact-import";
import {
  CONTACT_IMPORT_COLUMN_SAMPLE_LIMIT,
  CONTACT_IMPORT_COLUMN_VALUE_CEILING,
  contactImportAllColumnValues,
  contactImportColumnCount,
  contactImportColumnSamples,
  detectContactColumns,
  joinContactName,
  normalizeContactHeader,
  readContactFlag,
  unreadableFlagValues,
} from "./contact-import-headers";

describe("normalizeContactHeader", () => {
  it("drops case, spaces, and punctuation", () => {
    expect(normalizeContactHeader("Phone Number")).toBe("phonenumber");
    expect(normalizeContactHeader("  E-mail_Address ")).toBe("emailaddress");
  });
});

describe("detectContactColumns", () => {
  it("finds the canonical header", () => {
    expect(
      detectContactColumns(["phone", "name", "address", "notes", "opted_out"]),
    ).toEqual({ phone: 0, name: 1, address: 2, notes: 3, opted_out: 4 });
  });

  it("finds a third-party export's columns", () => {
    // The whole reason this is shared: a file like this imported from a laptop
    // and was rejected from a phone, because only the web rewrote the header.
    expect(
      detectContactColumns([
        "Full Name",
        "Mobile Number",
        "Street Address",
        "Comments",
      ]),
    ).toEqual({ name: 0, phone: 1, address: 2, notes: 3 });
  });

  it("claims a do-not-text column before phone can take it", () => {
    // "Do Not Contact" must not be swallowed by phone's broad `number` pattern.
    const mapping = detectContactColumns(["Do Not Contact", "Cell"]);
    expect(mapping.opted_out).toBe(0);
    expect(mapping.phone).toBe(1);
  });

  it("gives each column to at most one field", () => {
    const mapping = detectContactColumns(["Contact Name", "Contact Number"]);
    expect(mapping.name).toBe(0);
    expect(mapping.phone).toBe(1);
  });

  it("leaves a field absent when nothing matches", () => {
    const mapping = detectContactColumns(["phone"]);
    expect(mapping.phone).toBe(0);
    expect(mapping.name).toBeUndefined();
    expect(mapping.address).toBeUndefined();
  });

  it("returns nothing for an empty header row", () => {
    expect(detectContactColumns([])).toEqual({});
  });

  it("#248: reads split first/last columns as two fields, not one name", () => {
    // The shape of every CRM and phone export. It used to fail SILENTLY: the
    // broad `/name/` pattern claimed "First Name" as the whole name, every row
    // reported "ready", and the business ended up with a book of first names.
    const mapping = detectContactColumns([
      "First name",
      "Last name",
      "Company",
      "Role",
      "Emails",
      "Phone numbers",
    ]);
    expect(mapping.first_name).toBe(0);
    expect(mapping.last_name).toBe(1);
    expect(mapping.phone).toBe(5);
    expect(mapping.name).toBeUndefined();
  });

  it("#248: a Google export's full name and its given/family pair coexist", () => {
    const mapping = detectContactColumns([
      "Name",
      "Given Name",
      "Family Name",
      "Phone 1 - Value",
      "Address 1 - Formatted",
    ]);
    expect(mapping.name).toBe(0);
    expect(mapping.first_name).toBe(1);
    expect(mapping.last_name).toBe(2);
    expect(mapping.phone).toBe(3);
    expect(mapping.address).toBe(4);
  });

  it("#248: does not hand a company column to `name` when first/last are present", () => {
    // The reason the `/name/` catch-all is held back rather than just ordered
    // last: with the split columns claimed, "Company Name" is the only header
    // left containing "name", and a business texting a list of company names
    // instead of people is a worse outcome than storing no name at all.
    const mapping = detectContactColumns([
      "First Name",
      "Last Name",
      "Company Name",
      "Phone",
    ]);
    expect(mapping.name).toBeUndefined();
    expect(mapping.first_name).toBe(0);
    expect(mapping.last_name).toBe(1);
    expect(mapping.phone).toBe(3);
  });

  it("#248: guesses the restrictive spellings a real export uses", () => {
    // The DEFAULT guess and nothing more. Round three deleted the safety net
    // that stood behind this list, because a list of ways to say a thing can
    // never be finished — what stands behind it now is a person answering for
    // every column. "Do Not Call" is here because it is the commonest spelling
    // of all and none of the original patterns matched it: it normalises to
    // `donotcall`, which `donotcontact` misses.
    for (const header of ["Do Not Call", "Suppressed", "Stop", "DNC"]) {
      expect(detectContactColumns(["Phone", header]).opted_out).toBe(1);
    }
  });

  it("#248: never guesses a column whose direction it cannot know", () => {
    // "OK to Text" is the same fact inverted, so mapping it to `opted_out`
    // would block exactly the people who agreed. It is left unmapped, which
    // under round three means the person importing has to say what it is —
    // the honest answer, because we do not know.
    for (const header of ["OK to Text", "Contactable", "Marketing Status"]) {
      expect(detectContactColumns(["Phone", header]).opted_out).toBeUndefined();
    }
  });

  it("#248: keeps the catch-all for files with no split columns", () => {
    // "Customer Name" has no anchored pattern of its own, and a file carrying
    // only that must still import with a name.
    expect(detectContactColumns(["Customer Name", "Phone"]).name).toBe(0);
  });
});

describe("#248 how many columns a file has", () => {
  it("counts a cell PAST the end of the header row", () => {
    // Round two's every loop was bounded by `headers.length`, so this third
    // cell was not misread — it was never looked at, by any rule. Hand-edited
    // files do it constantly: somebody annotates one row and leaves the header
    // alone. The count has to come from the data, and the widest row is the
    // file's width.
    const headers = ["Phone", "Name"];
    const rows = [
      ["+12065550101", "Ann", "DO NOT CALL"],
      ["+12065550102", "Bo"],
    ];
    expect(contactImportColumnCount(headers, rows)).toBe(3);
  });

  it("is the header row when no row is wider, and survives no rows at all", () => {
    expect(contactImportColumnCount(["a", "b"], [["1", "2"]])).toBe(2);
    expect(contactImportColumnCount(["a", "b"], [])).toBe(2);
  });

  it("counts a trailing comma's column too, rather than judging it empty", () => {
    // The tempting exemption, refused: "a column with nothing in it decides
    // nothing" is a RULE about which columns may be skipped, and a rule about
    // which columns may be skipped is exactly what two rounds of this issue
    // lost to. One extra click on a malformed file is the whole cost.
    expect(contactImportColumnCount(["Phone"], [["+12065550101", ""]])).toBe(2);
  });

  it("reads EVERY row, not a sample of the first hundred", () => {
    // Every other fixture here puts the wide row within the first three, so
    // "sample the first 100 rows — 2000 is a lot of work for a column count"
    // passed all 1103 of them. It is the obvious performance refactor and it
    // resurrects round two's defect exactly: the annotated row in a real
    // hand-edited book is wherever the person happened to be scrolling, and a
    // 2000-row file has 1900 places to hide one.
    //
    // Asserted against the row cap this file will actually be run at, so the
    // fixture cannot quietly shrink under the sample somebody adds later.
    const rows: string[][] = [];
    for (let i = 0; i < CONTACT_IMPORT_MAX_ROWS - 1; i += 1) {
      rows.push([`+1206555${String(i).padStart(4, "0")}`, `Person ${i}`]);
    }
    rows.push(["+12065559999", "Zed", "DO NOT CALL"]);
    expect(contactImportColumnCount(["Phone", "Name"], rows)).toBe(3);
    // And the person is shown the value that made it a column — a count with no
    // sample beside it asks the question without the answer.
    expect(contactImportColumnSamples(rows, 2)).toEqual(["DO NOT CALL"]);
  });
});

describe("#248 what a person is shown before they dismiss a column", () => {
  const rows = [
    ["+14165550101", "Subscribed"],
    ["+14165550102", "DO NOT CALL"],
    ["+14165550103", "subscribed"],
    ["+14165550104", "   "],
    ["+14165550105", "Pending"],
  ];

  it("shows the values, distinct, in file order, blanks dropped", () => {
    // The whole design rests on somebody SEEING "DO NOT CALL" before they say
    // the column means nothing. A list of header names is the question without
    // the answer.
    expect(contactImportColumnSamples(rows, 1)).toEqual([
      "Subscribed",
      "DO NOT CALL",
      "Pending",
    ]);
  });

  it("stops at the limit rather than printing a column four hundred times", () => {
    expect(contactImportColumnSamples(rows, 1, 2)).toEqual([
      "Subscribed",
      "DO NOT CALL",
    ]);
  });

  it("says nothing for a column past the end of every row", () => {
    expect(contactImportColumnSamples(rows, 9)).toEqual([]);
  });
});

describe("#528 counting the values a column does not print", () => {
  it("answers for every column from one pass, distinct and in file order", () => {
    const held = contactImportAllColumnValues(
      [
        ["+14165550101", "Subscribed"],
        ["+14165550102", "DO NOT CALL"],
        ["+14165550103", "subscribed"],
        ["+14165550104", "   "],
        ["+14165550105", "Pending"],
      ],
      2,
    );
    expect(held[0]!.total).toBe(5);
    expect(held[1]!.values).toEqual(["Subscribed", "DO NOT CALL", "Pending"]);
    expect(held[1]!.total).toBe(3);
  });

  it("counts past the ceiling so the number on screen stays true", () => {
    // The list is bounded because thirty columns of four hundred values is a
    // screen nobody reads. The COUNT is not, because "and 12 more" is only worth
    // printing if the 12 is real — and a total that quietly equalled the ceiling
    // would read as a complete list to everybody who saw it.
    const size = CONTACT_IMPORT_COLUMN_VALUE_CEILING + 40;
    const rows = Array.from({ length: size }, (_, index) => [`v${index}`]);
    const [column] = contactImportAllColumnValues(rows, 1);
    expect(column!.values).toHaveLength(CONTACT_IMPORT_COLUMN_VALUE_CEILING);
    expect(column!.total).toBe(size);
  });

  it("counts a repeated value once however many rows carry it", () => {
    // The count is of ANSWERS, not rows. A column of four hundred `Subscribed`s
    // has one answer, and reporting "and 399 more" would be a new way of saying
    // nothing.
    const rows = Array.from({ length: 400 }, () => ["Subscribed"]);
    rows.push(["DO NOT CALL"]);
    const [column] = contactImportAllColumnValues(rows, 1);
    expect(column!.values).toEqual(["Subscribed", "DO NOT CALL"]);
    expect(column!.total).toBe(2);
  });

  it("answers for a column no row reaches", () => {
    const held = contactImportAllColumnValues([["only"]], 3);
    expect(held).toHaveLength(3);
    expect(held[2]).toEqual({ values: [], total: 0 });
  });

  it("prints as many values as both phone apps do", () => {
    // The web wizard showed three and the phones showed five, so a value at the
    // fourth was on screen for a crew's phone and behind a control on their
    // laptop. Same file, same decision, different evidence.
    expect(CONTACT_IMPORT_COLUMN_SAMPLE_LIMIT).toBe(5);
  });
});

describe("#248 reading a do-not-text cell", () => {
  it("reads both directions, and an empty cell as false", () => {
    for (const yes of ["true", "TRUE", "yes", "Y", "1", "x", " t "]) {
      expect(readContactFlag(yes)).toBe(true);
    }
    for (const no of ["false", "no", "N", "0", "f", "", "   ", null, undefined]) {
      expect(readContactFlag(no)).toBe(false);
    }
  });

  it("says NULL for a value it does not understand", () => {
    // The third answer is the whole point. Anything-not-true-is-false is how a
    // column of Subscribed/Unsubscribed becomes a column of nobody opted out.
    expect(readContactFlag("Unsubscribed")).toBeNull();
    expect(readContactFlag("2026-01-02")).toBeNull();
  });

  it("lists the unreadable values of a mapped flag column, once each", () => {
    const rows = [
      ["+14165550101", "Subscribed"],
      ["+14165550102", "Unsubscribed"],
      ["+14165550103", "unsubscribed"],
      ["+14165550104", "yes"],
      ["+14165550105", ""],
    ];
    expect(unreadableFlagValues(rows, 1)).toEqual(["Subscribed", "Unsubscribed"]);
  });

  it("says nothing when every cell reads", () => {
    expect(
      unreadableFlagValues(
        [
          ["+14165550101", "TRUE"],
          ["+14165550102", ""],
        ],
        1,
      ),
    ).toEqual([]);
  });
});

describe("joinContactName", () => {
  it("joins first and last", () => {
    expect(joinContactName({ first: "Jo", last: "Smith" })).toBe("Jo Smith");
  });

  it("collapses a blank half rather than storing a stray space", () => {
    expect(joinContactName({ first: "  ", last: "Chen" })).toBe("Chen");
    expect(joinContactName({ first: "Dana", last: null })).toBe("Dana");
  });

  it("prefers the person over a `full` column that may be the company", () => {
    // A file carrying both usually got `full` from a business field; first/last
    // is the person we are about to text.
    expect(
      joinContactName({ first: "Jo", last: "Smith", full: "Smith Roofing" }),
    ).toBe("Jo Smith");
  });

  it("falls back to the full name when there is no split pair", () => {
    expect(joinContactName({ full: "Alice Adams" })).toBe("Alice Adams");
  });

  it("says nothing rather than an empty string when the row is nameless", () => {
    // null is "this file says nothing about the name", which is what stops the
    // importer erasing a name the business already had.
    expect(joinContactName({})).toBeNull();
    expect(joinContactName({ first: " ", last: "", full: "  " })).toBeNull();
  });
});

describe("#248 the exports a switching customer already has", () => {
  // THE REAL HEADER ROW of a Google Contacts CSV export, which is what a
  // contractor leaving a personal phone actually has on their laptop — Google
  // Takeout hands it to them, and it is the most common contacts export there is.
  //
  // The shape that matters is the PAIR: Google writes every repeatable field as
  // `<Field> N - Type` followed by `<Field> N - Value`, where Type holds "Mobile"
  // or "Home" and Value holds the number. Both contain the word "phone", Type
  // comes first, and the detector scans left to right.
  const GOOGLE_CONTACTS = [
    "Name",
    "Given Name",
    "Additional Name",
    "Family Name",
    "Group Membership",
    "E-mail 1 - Type",
    "E-mail 1 - Value",
    "Phone 1 - Type",
    "Phone 1 - Value",
    "Organization 1 - Name",
    "Notes",
  ];

  it("guesses the phone NUMBER column, not the label beside it", () => {
    // The whole point of #248: the customer uploads the file they already have.
    // Guessing `Phone 1 - Type` means every row's number reads "Mobile", every
    // row is skipped as unusable, and the person is left to work out why — at the
    // exact moment they have the least patience for us.
    const found = detectContactColumns(GOOGLE_CONTACTS);
    expect(GOOGLE_CONTACTS[found.phone!]).toBe("Phone 1 - Value");
  });

  it("guesses the split name columns Google actually writes", () => {
    const found = detectContactColumns(GOOGLE_CONTACTS);
    expect(GOOGLE_CONTACTS[found.first_name!]).toBe("Given Name");
    expect(GOOGLE_CONTACTS[found.last_name!]).toBe("Family Name");
  });
});
