import {
  CONTACT_IMPORT_IGNORE,
  defaultContactImportColumns,
  formatContactImportColumn,
  readContactFlag,
} from "@loonext/shared";
import { describe, expect, it } from "vitest";

import {
  answerColumn,
  answerRemaining,
  buildPreview,
  csvEscape,
  csvRows,
  decideColumns,
  importColumns,
  IMPORT_FIELDS,
  normalizeNanpPhone,
  SAMPLE_VALUE_LIMIT,
  skippedRowsCsv,
  summarizePreview,
  type CsvRow,
} from "./csv-import";

/** Data rows as they leave the parser: the header is line 1, so these start at 2. */
function rows(...cells: string[][]): CsvRow[] {
  return cells.map((row, index) => ({ line: index + 2, cells: row }));
}

/**
 * #248 round 3 — there is no classifier, so there is nothing here to be
 * incomplete.
 *
 * Two rounds tried to work out what a dropped column MEANT: first from the
 * header word, then from the shape of its values. Both are vocabularies, both
 * were beaten by an ordinary export, and each time the end of the story was a
 * text delivered to somebody who had said stop. The model below asks nothing.
 * Every column of the file is on screen with its own values, and every one of
 * them needs an answer.
 *
 * These fixtures are MIXED on purpose. Every #248 consent test in round one
 * shipped against a one-row file, so any defect that only appears when a
 * flagged row sits beside a clean one was invisible to all of them.
 */
describe("importColumns: the file's columns, not our field list", () => {
  it("IC-1: leaves a column it does not recognise UNANSWERED, not ignored", () => {
    // The whole design in one assertion, and it is now the SAME assertion on
    // both sides of the boundary. `defaultContactImportColumns` used to answer
    // `ignore` for a column it did not recognise and this function undid it;
    // round 3 took `ignore` out of that function's return type, because a
    // dismissal a detector filled in on somebody's behalf IS the silent drop
    // wearing a control. Asserted against the shared function's own answer
    // rather than against `null` twice, so a shared default that started
    // manufacturing dismissals again fails HERE, at the client that would post
    // them, and not only in the package that invented them.
    const headers = ["Phone", "Marketing Status"];
    const data = rows(
      ["416-555-0199", "Unsubscribed"],
      ["416-555-0198", "Subscribed"],
      ["212-555-0100", "Unsubscribed"],
    );
    const shared = defaultContactImportColumns(
      headers,
      data.map((row) => row.cells),
    );
    expect(shared[1].action).toBeNull();
    // Not merely "not ignore": nothing in the union may be manufactured here,
    // and `ignore` is the one that would sail past the wizard's gate.
    expect(shared.map((column) => column.action)).not.toContain(
      CONTACT_IMPORT_IGNORE,
    );

    expect(importColumns(headers, data)[1].answer).toBeNull();
  });

  it("IC-2: keeps the guess for a column it did recognise", () => {
    // The other half. A clean export should not make somebody retype `Phone` →
    // phone seven times; a gate that fires on every file is a gate people learn
    // to click through, which is worse than no gate.
    const columns = importColumns(
      ["Phone Number", "Do Not Call"],
      rows(["416-555-0199", "y"], ["416-555-0198", ""]),
    );

    expect(columns.map((column) => column.answer)).toEqual([
      "phone",
      "opted_out",
    ]);
  });

  it("IC-3: asks about a cell PAST the end of the header row", () => {
    // `Phone,Name` over a row reading `+1206…,Ann,DO NOT CALL`. Every loop in
    // round two was bounded by `headers.length`, so this cell was not misread —
    // it was never looked at by any rule at all, and hand-edited files do this
    // constantly: somebody appends a note to one row and never touches the
    // header.
    const columns = importColumns(
      ["Phone", "Name"],
      rows(
        ["206-555-0100", "Ann", "DO NOT CALL"],
        ["206-555-0101", "Bo"],
        ["206-555-0102", "Cy"],
      ),
    );

    expect(columns).toHaveLength(3);
    expect(columns[2].header).toBe("");
    expect(columns[2].answer).toBeNull();
    // And it is not merely counted: the value that decides who gets texted is
    // the thing a person has to be able to read.
    expect(columns[2].samples).toEqual(["DO NOT CALL"]);
  });

  it("IC-4: shows a whole sentence, because a decision is not a token", () => {
    // Round two capped a "flag" value at 16 characters, so `Contact
    // Preference` = "Do not text this customer" (25) walked straight through.
    // Real CRM exports write sentences. Nothing here has a length rule to fail.
    const columns = importColumns(
      ["Phone", "Contact Preference"],
      rows(
        ["416-555-0199", "Do not text this customer"],
        ["416-555-0198", "Happy to hear from us"],
      ),
    );

    expect(columns[1].samples).toContain("Do not text this customer");
  });

  it("IC-5: asks about a column that answers every row the same way", () => {
    // Sixty rows of `Unsubscribed` was skipped by round two as a "constant
    // column" — an agency's unsubscribe list handed to a crew, which is an
    // ordinary Monday, and sixty people imported textable.
    const columns = importColumns(
      ["Phone", "Marketing Status"],
      rows(
        ...Array.from({ length: 60 }, (_, index) => [
          `41655501${String(index).padStart(2, "0")}`,
          "Unsubscribed",
        ]),
      ),
    );

    expect(columns[1].answer).toBeNull();
    expect(columns[1].samples).toEqual(["Unsubscribed"]);
    expect(columns[1].more).toBe(false);
  });

  it("IC-6: asks about a column with four different answers", () => {
    // `distinct.size <= min(FLAG_MAX_DISTINCT = 3, …)` meant a column answering
    // DNC / OK / HOLD / PENDING was never reported at any file size.
    const columns = importColumns(
      ["Phone", "Status"],
      rows(
        ["416-555-0199", "DNC"],
        ["416-555-0198", "OK"],
        ["212-555-0100", "HOLD"],
        ["212-555-0101", "PENDING"],
      ),
    );

    expect(columns[1].answer).toBeNull();
    expect(columns[1].samples).toHaveLength(SAMPLE_VALUE_LIMIT);
    expect(columns[1].more).toBe(true);
  });

  it("IC-7: asks about an empty column rather than exempting it", () => {
    // A stray trailing comma adds a column nobody meant, with nothing in it,
    // and making somebody answer for it feels like noise. It is asked about
    // anyway: "a column with nothing in it decides nothing" is a rule about
    // which columns may be skipped, and a rule about which columns may be
    // skipped is the thing both earlier rounds lost to.
    const columns = importColumns(
      ["Phone", "Name", ""],
      rows(["416-555-0199", "Sam", ""], ["416-555-0198", "Pat", ""]),
    );

    expect(columns).toHaveLength(3);
    expect(columns[2].answer).toBeNull();
    expect(columns[2].samples).toEqual([]);
  });
});

describe("answering a column touches nothing else", () => {
  const columns = importColumns(
    ["Phone", "Do Not Call", "Description"],
    rows(
      ["416-555-0199", "y", "Left a key under the mat"],
      ["416-555-0198", "", "Back gate code 4821"],
    ),
  );

  it("AN-1: never unsets the opt-out column to satisfy another answer", () => {
    // The round-two model was keyed by FIELD, so pointing a second field at a
    // column another field already held DELETED that field. Choosing Notes for
    // the "Do Not Call" column removed the opt-out mapping with nothing on
    // screen moving except the row being edited, and the file imported as
    // though nobody had opted out. A column has ONE answer here, so there is
    // nothing left to delete.
    const next = answerColumn(columns, 2, "notes");

    expect(next[1].answer).toBe("opted_out");
    expect(next[0].answer).toBe("phone");
    expect(next[2].answer).toBe("notes");
  });

  it("AN-2: un-answering one column leaves the others answered", () => {
    const next = answerColumn(columns, 1, null);

    expect(next[1].answer).toBeNull();
    expect(next[0].answer).toBe("phone");
    expect(decideColumns(next).declarations).toBeNull();
  });

  it("AN-3: leaves the array it was given alone", () => {
    // The caller is a `useState` setter, and React compares by identity.
    const next = answerColumn(columns, 1, CONTACT_IMPORT_IGNORE);

    expect(columns[1].answer).toBe("opted_out");
    expect(next).not.toBe(columns);
  });

  it("AN-4: the bulk answer touches only the unanswered columns", () => {
    // The one-click dismissal is allowed ONLY because the columns and their
    // values are on screen when it is pressed. It must not also overwrite an
    // answer somebody gave: a bulk ignore that cleared a mapped opt-out column
    // would be the defect with a friendlier button.
    const partial = answerColumn(columns, 2, null);
    const next = answerRemaining(partial, CONTACT_IMPORT_IGNORE);

    expect(next[1].answer).toBe("opted_out");
    expect(next[2].answer).toBe(CONTACT_IMPORT_IGNORE);
    expect(decideColumns(next).unanswered).toEqual([]);
  });
});

describe("decideColumns: what may be posted, and what may not", () => {
  const headers = ["Phone", "Name", "Marketing Status"];
  const data = rows(
    ["416-555-0199", "Sam", "Unsubscribed"],
    ["416-555-0198", "Pat", "Subscribed"],
    ["212-555-0100", "Wen", "Unsubscribed"],
  );

  it("DE-1: refuses a partial declaration while any column is unanswered", () => {
    const decision = decideColumns(importColumns(headers, data));

    expect(decision.declarations).toBeNull();
    expect(decision.unanswered.map((column) => column.index)).toEqual([2]);
  });

  it("DE-2: declares every column once the last one is answered", () => {
    const answered = answerColumn(
      importColumns(headers, data),
      2,
      CONTACT_IMPORT_IGNORE,
    );
    const decision = decideColumns(answered);

    expect(decision.declarations?.map(formatContactImportColumn)).toEqual([
      "0:phone:Phone",
      "1:name:Name",
      `2:${CONTACT_IMPORT_IGNORE}:Marketing Status`,
    ]);
  });

  it("DE-3: tells two nameless columns apart", () => {
    // Round two matched its field on `normalizeContactHeader`, which strips
    // everything but `[a-z0-9]` — so "", "—", "#" and "★" all normalised to the
    // SAME EMPTY STRING and two columns could not be told apart. The index is
    // the identity here, so they cannot collide.
    const declared = decideColumns(
      answerRemaining(
        importColumns(
          ["Phone", "—", "★"],
          rows(["416-555-0199", "DNC", "keep"], ["416-555-0198", "", "keep"]),
        ),
        CONTACT_IMPORT_IGNORE,
      ),
    ).declarations;

    expect(declared?.map(formatContactImportColumn)).toEqual([
      "0:phone:Phone",
      `1:${CONTACT_IMPORT_IGNORE}:—`,
      `2:${CONTACT_IMPORT_IGNORE}:★`,
    ]);
  });

  it("DE-4: shows a field claimed twice instead of resolving it", () => {
    // The API refuses the pair by name, so a screen that quietly dropped one
    // would send a request it knows will fail. And the losing half of any
    // automatic answer is a field silently emptied, which is the entire defect
    // class this model exists to make impossible.
    const conflicted = answerColumn(
      answerColumn(importColumns(headers, data), 2, "phone"),
      1,
      CONTACT_IMPORT_IGNORE,
    );
    const decision = decideColumns(conflicted);

    expect(decision.declarations).toBeNull();
    expect(decision.conflicts).toHaveLength(1);
    expect(decision.conflicts[0].field).toBe("phone");
    expect(decision.conflicts[0].columns.map((column) => column.index)).toEqual([
      0, 2,
    ]);
  });

  it("DE-5: the person's answer is the mapping, not the detector's guess", () => {
    // Round two's gate only examined UNMAPPED columns, so a `Description`
    // column reading "DO NOT CONTACT" was claimed by `notes`, filed as a note,
    // and the message went out — invisible to a gate that never looked at
    // mapped columns. Answering it `opted_out` has to actually block the row.
    const columns = importColumns(
      ["Phone", "Description"],
      rows(
        ["416-555-0199", "DO NOT CONTACT"],
        ["416-555-0198", ""],
        ["212-555-0100", "DO NOT CONTACT"],
      ),
    );
    expect(columns[1].answer).toBe("notes");

    const decision = decideColumns(answerColumn(columns, 1, "opted_out"));

    expect(decision.mapping).toEqual({ phone: 0, opted_out: 1 });
    expect(decision.declarations?.map(formatContactImportColumn)).toEqual([
      "0:phone:Phone",
      "1:opted_out:Description",
    ]);
  });

  it("DE-6: an ignored column is declared, never omitted", () => {
    // "Declared ignore" and "left out of the request" are the same thing to a
    // reader and opposite things to the server: the second is what it refuses.
    const decision = decideColumns(
      answerRemaining(importColumns(headers, data), CONTACT_IMPORT_IGNORE),
    );

    expect(decision.declarations).toHaveLength(3);
    expect(decision.mapping.notes).toBeUndefined();
  });
});

describe("csvRows: the rows the server will see, numbered as it numbers them", () => {
  it("CR-1: drops blank lines and keeps the line each survivor came from", () => {
    // A port of the tail of the API's `parseCsvRows`. The wizard used to number
    // rows `position + 2`, which was only ever right because it rewrote the
    // file before uploading and the rewrite had no blank lines. Now that the
    // person's own file goes up, a blank line anywhere in it would shift every
    // skip reason after it onto the wrong original row — and the skipped-rows
    // download is built by joining those numbers back.
    const parsed = [
      ["Phone", "Name"],
      ["416-555-0199", "Sam"],
      ["", ""],
      ["nope", "Pat"],
      [""],
    ];

    expect(csvRows(parsed)).toEqual([
      { line: 1, cells: ["Phone", "Name"] },
      { line: 2, cells: ["416-555-0199", "Sam"] },
      { line: 4, cells: ["nope", "Pat"] },
    ]);
  });

  it("CR-2: the preview's row numbers are the file's own line numbers", () => {
    const parsed = [
      ["Phone"],
      ["416-555-0199"],
      ["  "],
      ["nope"],
    ];
    const all = csvRows(parsed);
    const preview = buildPreview(all.slice(1), { phone: 0 });

    expect(preview.map((row) => row.rowNumber)).toEqual([2, 4]);
    // Which is what makes the skipped-rows download hand back the right row.
    const csv = skippedRowsCsv(
      [{ row: 4, reason: "invalid phone: nope" }],
      preview,
    );
    expect(csv.split("\r\n")[1]).toBe("nope,,,,,,,invalid phone: nope");
  });
});

describe("normalizeNanpPhone (API mirror)", () => {
  it("normalizes human formats to E.164", () => {
    expect(normalizeNanpPhone("(416) 555-0199")).toBe("+14165550199");
    expect(normalizeNanpPhone("1-212-555-0100")).toBe("+12125550100");
    expect(normalizeNanpPhone("+12125550100")).toBe("+12125550100");
  });

  it("rejects non-NANP and unassigned area codes", () => {
    expect(normalizeNanpPhone("+442071234567")).toBeNull(); // UK
    expect(normalizeNanpPhone("(999) 555-0100")).toBeNull(); // unassigned NPA
    expect(normalizeNanpPhone("555-0100")).toBeNull(); // too short
    expect(normalizeNanpPhone("")).toBeNull();
  });
});

describe("buildPreview (dry-run row statuses)", () => {
  const mapping = { phone: 0, name: 1, opted_out: 2 } as const;

  it("marks valid rows ready with the normalized phone", () => {
    const [row] = buildPreview(rows(["(416) 555-0199", "Sam", ""]), mapping);
    expect(row.status).toBe("ready");
    expect(row.phoneE164).toBe("+14165550199");
    expect(row.optedOut).toBe(false);
    expect(row.reason).toBeNull();
    expect(row.rowNumber).toBe(2); // header is line 1, like the API
  });

  it("marks invalid phones with the API's reason wording", () => {
    const preview = buildPreview(
      rows(["nope", "A", ""], ["", "B", ""]),
      mapping,
    );
    expect(preview[0].status).toBe("invalid_phone");
    expect(preview[0].reason).toBe("invalid phone: nope");
    expect(preview[1].reason).toBe("invalid phone: (empty)");
  });

  it("marks later duplicates of the same normalized phone", () => {
    const preview = buildPreview(
      rows(["4165550199", "First", ""], ["(416) 555-0199", "Second", ""]),
      mapping,
    );
    expect(preview[0].status).toBe("ready");
    expect(preview[1].status).toBe("duplicate");
    expect(preview[1].reason).toBe("duplicate phone in file: +14165550199");
    expect(preview[1].rowNumber).toBe(3);
  });

  it("applies the API's truthy set to opted_out", () => {
    const preview = buildPreview(
      rows(
        ["4165550101", "", "true"],
        ["4165550102", "", "YES"],
        ["4165550103", "", "1"],
        ["4165550104", "", "y"],
        ["4165550105", "", "no"],
        ["4165550106", "", ""],
      ),
      mapping,
    );
    expect(preview.map((r) => r.optedOut)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  /**
   * #248 B8 — the preview reads the flag with the SERVER's reader.
   *
   * This file kept its own truthy set under a comment calling it a mirror, and
   * it had stopped being one: the shared reader learned `x`, the mark a
   * hand-kept sheet puts against the rows to block, and this preview still
   * called it nothing. Every row promised "Imports" and imported blocked.
   *
   * Asserted through `readContactFlag` rather than against a list retyped here,
   * so a spelling the server adds tomorrow is covered by this test today.
   */
  it("PV-1: reads the flag with the shared reader, not a local copy of it", () => {
    const spellings = ["true", "YES", "1", "y", "x", "no", ""];
    const preview = buildPreview(
      rows(...spellings.map((cell, i) => [`41655501${10 + i}`, "", cell])),
      mapping,
    );

    expect(preview.map((row) => row.optedOut)).toEqual(
      spellings.map((cell) => readContactFlag(cell) === true),
    );
    // And the pairing that made it worth writing: `x` is a block, not a blank.
    expect(preview[4].optedOut).toBe(true);
  });

  /**
   * #248 D2 — an opt-out carried by the row we throw away.
   *
   * A merge of two exports lists the same person twice, once plain and once
   * flagged. The API keeps the first row and folds the restriction in; the
   * preview kept the first row and dropped the restriction with the duplicate,
   * so the screen showed a clean "Imports" over somebody the server was about
   * to block. A preview that disagrees with the write about who gets texted is
   * the defect this whole issue is about, one screen earlier.
   */
  it("PV-2: a duplicate carrying the flag opts out the row that is kept", () => {
    const preview = buildPreview(
      rows(["4165550199", "Sam", ""], ["(416) 555-0199", "Sam O", "yes"]),
      mapping,
    );

    expect(preview[0].status).toBe("ready");
    expect(preview[0].optedOut).toBe(true);
    expect(preview[1].status).toBe("duplicate");
    // And the count the preview headline prints follows it.
    expect(summarizePreview(preview)).toEqual({
      ready: 1,
      skipped: 1,
      optedOut: 1,
    });
  });

  it("PV-3: a later plain row cannot clear a flag an earlier one set", () => {
    // The asymmetry is the rule: an import may lower a contact's standing,
    // never raise it. Merging in both directions would let the last spelling of
    // a duplicate decide, and one of the two orders ends with a text.
    const preview = buildPreview(
      rows(["4165550199", "Sam", "yes"], ["4165550199", "Sam", "no"]),
      mapping,
    );

    expect(preview[0].optedOut).toBe(true);
  });

  it("ignores opted_out cells when the column is unmapped", () => {
    const [row] = buildPreview(rows(["4165550101", "Sam", "true"]), {
      phone: 0,
      name: 1,
    });
    expect(row.optedOut).toBe(false);
  });

  /**
   * #248 — the preview promises the name that will actually land.
   *
   * These three pin `resolvedName` against the API's own joiner rather than a
   * re-implementation: the wizard shows this value in the Name column, and a
   * preview promising something other than what the server writes is the same
   * defect as no preview at all.
   */
  it("joins split first/last columns into the one stored name", () => {
    const [row] = buildPreview(rows(["4165550199", "Sam", "Okafor"]), {
      phone: 0,
      first_name: 1,
      last_name: 2,
    });
    expect(row.resolvedName).toBe("Sam Okafor");
  });

  it("prefers the person over a full-name column carrying the business", () => {
    // The server prefers first+last when a file has both, which is not the
    // answer anyone would guess — so the preview has to show the same one.
    const [row] = buildPreview(
      rows(["4165550199", "Bob's Plumbing", "Bob", "Vance"]),
      { phone: 0, name: 1, first_name: 2, last_name: 3 },
    );
    expect(row.resolvedName).toBe("Bob Vance");
  });

  it("collapses a blank half rather than storing a leading space", () => {
    const [row] = buildPreview(rows(["4165550199", "", "Chen"]), {
      phone: 0,
      first_name: 1,
      last_name: 2,
    });
    expect(row.resolvedName).toBe("Chen");
  });
});

describe("summarizePreview", () => {
  it("counts ready, skipped, and opted-out rows", () => {
    const preview = buildPreview(
      rows(
        ["4165550101", "", "true"],
        ["4165550101", "", ""],
        ["bad", "", ""],
        ["4165550102", "", ""],
      ),
      { phone: 0, name: 1, opted_out: 2 },
    );
    expect(summarizePreview(preview)).toEqual({
      ready: 2,
      skipped: 2,
      optedOut: 1,
    });
  });
});

describe("csvEscape", () => {
  it("escapes commas, quotes, and newlines per RFC 4180", () => {
    expect(csvEscape('he said "hi", twice')).toBe('"he said ""hi"", twice"');
    expect(csvEscape("plain")).toBe("plain");
  });
});

describe("skippedRowsCsv", () => {
  it("joins API error rows back to the original values by row number", () => {
    const preview = buildPreview(
      rows(["4165550199", "Sam", ""], ["nope", "Pat", ""]),
      { phone: 0, name: 1, opted_out: 2 },
    );
    const csv = skippedRowsCsv(
      [{ row: 3, reason: "invalid phone: nope" }],
      preview,
    );
    const lines = csv.split("\r\n");
    // Every mappable field plus the reason — the download is the person's own
    // rows handed back, so it carries the raw cells rather than our joined name.
    expect(lines[0]).toBe([...IMPORT_FIELDS, "reason"].join(","));
    expect(lines[1]).toBe("nope,Pat,,,,,,invalid phone: nope");
  });

  it("escapes a reason that carries the delimiter", () => {
    // The reasons come from the server and are prose. One containing a comma
    // used to be written raw, which shifted every later column of that line.
    const preview = buildPreview(rows(["nope", "Pat", ""]), {
      phone: 0,
      name: 1,
    });
    const csv = skippedRowsCsv(
      [{ row: 2, reason: 'invalid phone: "nope, really"' }],
      preview,
    );

    expect(csv.split("\r\n")[1]).toBe(
      'nope,Pat,,,,,,"invalid phone: ""nope, really"""',
    );
  });
});
