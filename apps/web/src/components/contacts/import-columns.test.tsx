/**
 * @vitest-environment happy-dom
 *
 * #248 round 3 — the wizard is the only door with a person to ask, and this is
 * the asking.
 *
 * Round one dropped a "Do Not Call" column because no header pattern matched
 * it, wrote the file's consent attestation over the top, and a real text
 * reached somebody that file said not to contact. Round two replaced the
 * vocabulary of WORDS with a vocabulary of NUMBERS — few distinct values, short
 * values, repeated across rows — and three independent verifiers walked files
 * straight through it: four distinct answers, a 25-character value, the same
 * answer on all sixty rows, a four-row file, a cell past the end of the header
 * row, a column the detector had already claimed for `notes`.
 *
 * There is no classifier now. Every column of the file is on screen with its
 * own values, and the wizard will not move until each one has an answer. What
 * that CANNOT stop is somebody answering "skip this column" for all of them
 * without reading a word, and nothing can — the answer is a claim, like the
 * attestation beside it. What it closes is the SILENT case: no column is
 * dropped that nobody was shown, and this screen never fills in an answer for a
 * column it did not recognise. Every real accident is in the silent case.
 *
 * Fixtures are multi-row and MIXED on purpose: every #248 consent test in round
 * one shipped against a one-row file, so any defect that only appears when a
 * flagged row sits beside a clean one was invisible to all of them.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  CONTACT_IMPORT_IGNORE,
  formatContactImportColumn,
  readContactFlag,
  type ContactImportColumnDeclaration,
} from "@loonext/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { csvMutate, sheet } = vi.hoisted(() => ({
  csvMutate: vi.fn(),
  sheet: { rows: [] as string[][] },
}));

vi.mock("@/lib/api/contacts", () => ({
  useImportContacts: () => ({
    mutate: csvMutate,
    isPending: false,
    reset: vi.fn(),
  }),
}));
// #587: the real `csvDownloadBlob`; only the DOM side is replaced.
vi.mock("@/lib/api/contacts-export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/contacts-export")>()),
  triggerBlobDownload: vi.fn(),
}));
// The wizard lazy-loads papaparse inside handleFile. Parsing a real File is not
// what is under test, so the parse resolves synchronously with whatever sheet
// the current test set up.
//
// It DOES honour `skipEmptyLines`, though, and that is not politeness. The
// wizard passes it deliberately — blank lines have to reach `csvRows`, which
// drops them the way the API does while keeping each survivor's real line
// number — and a mock that ignored the option would make the setting
// unassertable. It was: flipping it to "greedy" survived every test in this
// file until this mock learned to care.
vi.mock("papaparse", () => ({
  default: {
    parse: (
      _file: unknown,
      options: {
        skipEmptyLines?: boolean | string;
        complete: (result: { data: string[][] }) => void;
      },
    ) =>
      options.complete({
        data: options.skipEmptyLines
          ? sheet.rows.filter((row) => row.some((cell) => cell.trim() !== ""))
          : sheet.rows,
      }),
  },
}));

import { ImportWizard } from "./import-wizard";

afterEach(cleanup);
beforeEach(() => {
  csvMutate.mockReset();
  sheet.rows = [];
});

/** The bytes a sheet would have on disk, so "we post what they chose" is real. */
function sheetText(rows: string[][]): string {
  return rows.map((row) => row.join(",")).join("\r\n");
}

/** Load a sheet and land on the column step. */
async function openWith(rows: string[][]) {
  sheet.rows = rows;
  const file = new File([sheetText(rows)], "book.csv", { type: "text/csv" });
  render(<ImportWizard open onOpenChange={() => {}} />);
  fireEvent.change(screen.getByLabelText("CSV file"), {
    target: { files: [file] },
  });
  await screen.findByText(/in your columns/);
  return file;
}

function previewButton() {
  return screen.getByRole("button", {
    name: "Preview import",
  }) as HTMLButtonElement;
}

/** The select for one column, found the way a screen reader would. */
function columnSelect(name: string | RegExp): HTMLSelectElement {
  return screen.getByLabelText(
    typeof name === "string"
      ? new RegExp(`What is .${name}`)
      : name,
  ) as HTMLSelectElement;
}

function answer(name: string | RegExp, value: string) {
  fireEvent.change(columnSelect(name), { target: { value } });
}

/**
 * A book with a restriction column this importer has never heard of, spelled
 * the way the tools people actually leave say it. Two of these four rows are
 * "do not text", one is not, one says nothing — the mix a real export has.
 */
const MARKETING_STATUS = [
  ["Phone", "Marketing Status"],
  ["416-555-0199", "Unsubscribed"],
  ["416-555-0198", "Subscribed"],
  ["212-555-0100", "Unsubscribed"],
  ["212-555-0101", ""],
];

describe("#248: a column nobody has answered stops the wizard", () => {
  it("CL-1: will not preview while a column is unanswered", async () => {
    await openWith(MARKETING_STATUS);

    // Named, not merely counted: "some column" is not something a person can
    // act on, and the whole point is that they recognise it from their file.
    expect(screen.getByText(/Marketing Status/)).toBeTruthy();
    expect(previewButton().disabled).toBe(true);
  });

  it("CL-2: shows the column's own values, so the answer is informed", async () => {
    await openWith(MARKETING_STATUS);

    // A person cannot say what "Marketing Status" is without seeing what it
    // says. This is the difference between a question and an obstacle, and an
    // obstacle gets clicked through.
    expect(screen.getByText(/“Unsubscribed”, “Subscribed”/)).toBeTruthy();
  });

  it("CL-3: releases the import once a person answers for the column", async () => {
    await openWith(MARKETING_STATUS);
    // Nothing is pre-selected for a column we did not recognise. A dismissal
    // this product filled in on somebody's behalf is the silent drop wearing a
    // control.
    expect(columnSelect("Marketing Status").value).toBe("");

    answer("Marketing Status", CONTACT_IMPORT_IGNORE);

    await waitFor(() => expect(previewButton().disabled).toBe(false));
  });

  it("CL-4: an answered column stays on screen and can be changed", async () => {
    // A row that vanished on being answered would leave no way to see what was
    // asserted, or to change your mind about it.
    await openWith(MARKETING_STATUS);
    answer("Marketing Status", CONTACT_IMPORT_IGNORE);
    await waitFor(() => expect(previewButton().disabled).toBe(false));

    expect(columnSelect("Marketing Status").value).toBe(CONTACT_IMPORT_IGNORE);
    // And changing it is what actually re-decides the import: this column reads
    // Subscribed/Unsubscribed, which the flag reader cannot read, so pointing
    // "do not text" at it has to shut the door again rather than quietly
    // treating every row as textable.
    answer("Marketing Status", "opted_out");

    await waitFor(() => expect(previewButton().disabled).toBe(true));
    expect(screen.getAllByRole("alert").some((node) =>
      (node.textContent ?? "").includes("Unsubscribed"),
    )).toBe(true);
  });

  it("CL-5: asks nothing about a file whose headers it recognised", async () => {
    // A gate that fires on every file is a gate people learn to click through,
    // which is worse than no gate. "Do Not Call" IS in the default guess now,
    // so this file is answered end to end the moment it lands.
    await openWith([
      ["Phone", "Do Not Call"],
      ["416-555-0199", "y"],
      ["416-555-0198", ""],
      ["212-555-0100", "y"],
    ]);

    expect(screen.queryByText(/columns? we don't recognise/)).toBeNull();
    expect(previewButton().disabled).toBe(false);
    expect(columnSelect("Do Not Call").value).toBe("opted_out");
  });

  it("CL-6: asks about a cell PAST the end of the header row", async () => {
    // `Phone,Name` over a row reading `206…,Ann,DO NOT CALL`. Every loop in
    // round two was bounded by `headers.length`, so this cell was not misread —
    // it was never looked at by any rule at all. Hand-edited files do this
    // constantly: somebody appends a note to one row and never touches the
    // header.
    await openWith([
      ["Phone", "Name"],
      ["206-555-0100", "Ann", "DO NOT CALL"],
      ["206-555-0101", "Bo"],
      ["206-555-0102", "Cy"],
    ]);

    expect(previewButton().disabled).toBe(true);
    // Named by position, because the file gave it no name to quote — and the
    // API names it the same way in its own refusal.
    expect(screen.getByText("Column 3 (no header)")).toBeTruthy();
    expect(screen.getByText(/“DO NOT CALL”/)).toBeTruthy();
  });

  it("CL-7: asks about a column that answers every row the same way", async () => {
    // Sixty rows of `Unsubscribed` was skipped by round two as a "constant
    // column". That is an agency's unsubscribe list handed to a crew, which is
    // an ordinary Monday, and sixty people imported textable.
    await openWith([
      ["Phone", "Marketing Status"],
      ...Array.from({ length: 60 }, (_, index) => [
        `41655501${String(index).padStart(2, "0")}`,
        "Unsubscribed",
      ]),
    ]);

    expect(previewButton().disabled).toBe(true);
    expect(screen.getByText(/“Unsubscribed”/)).toBeTruthy();
  });

  it("CL-8: asks about a four-row file with four different answers", async () => {
    // `distinct.size <= min(FLAG_MAX_DISTINCT, rows/2)` failed twice over here:
    // four answers beat the distinct cap, and four rows beat the arithmetic.
    await openWith([
      ["Phone", "Status"],
      ["416-555-0199", "DNC"],
      ["416-555-0198", "OK"],
      ["212-555-0100", "HOLD"],
      ["212-555-0101", "PENDING"],
    ]);

    expect(previewButton().disabled).toBe(true);
    expect(screen.getByText(/“DNC”/)).toBeTruthy();
  });

  it("CL-9: shows a whole sentence, because a decision is not a token", async () => {
    // Round two capped a value at 16 characters, so "Do not text this customer"
    // (25) walked through. Real CRM exports write sentences.
    await openWith([
      ["Phone", "Contact Preference"],
      ["416-555-0199", "Do not text this customer"],
      ["416-555-0198", "Happy to hear from us"],
    ]);

    expect(screen.getByText(/Do not text this customer/)).toBeTruthy();
  });
});

describe("#248 H1: a guess is not an answer, so a guessed column is on screen too", () => {
  /**
   * THE SHIP BLOCKER, as it was proved live: `Phone,Name,Notes` where the Notes
   * column reads "DO NOT CALL - asked us to stop". Every one of those three
   * headers is in the detector's vocabulary, so the file came back from
   * `defaultContactImportColumns` as a COMPLETE declaration, all three clients
   * posted it with no interaction, the API accepted it because it was complete,
   * and the send returned 201 with a messages row created.
   *
   * The screen was the half that failed. It rendered `decision.unanswered` and
   * nothing else, so an auto-detected column never reached it: this file had no
   * unanswered columns, therefore this file had no question, therefore nobody
   * ever saw the sentence in it. The contract says a column is mapped or
   * dismissed BY SOMEBODY WHO CAN SEE ITS VALUES, and a detector is not
   * somebody.
   *
   * `notes` is a perfectly sensible answer for a column called Notes, which is
   * why no amount of improving the detector was ever going to reach this. The
   * fix is that the values are on the screen the person presses through.
   */
  const DO_NOT_CALL = "DO NOT CALL - asked us to stop";
  const EVERY_HEADER_RECOGNISED = [
    ["Phone", "Name", "Notes"],
    ["416-555-0199", "Ada", DO_NOT_CALL],
    ["416-555-0198", "Bo", "gate code 4432"],
    ["212-555-0100", "Cy", ""],
  ];

  it("CL-24: shows what a column the detector claimed actually SAYS", async () => {
    await openWith(EVERY_HEADER_RECOGNISED);

    // The common case stays cheap: nothing to answer, one click forward. That
    // is deliberate, and it is exactly what made the hole invisible.
    expect(screen.queryByText(/columns? we don't recognise/)).toBeNull();
    expect(previewButton().disabled).toBe(false);
    expect(columnSelect("Notes").value).toBe("notes");

    // And the sentence is ON SCREEN while that click is available. This is the
    // whole justification for the step existing: a person who cannot see "DO
    // NOT CALL" cannot be said to have confirmed anything about it.
    const values = screen.getByText(new RegExp(DO_NOT_CALL));
    expect(values).toBeTruthy();
    // BEFORE the way forward, not merely somewhere in the document.
    // DOCUMENT_POSITION_PRECEDING: the values come first.
    expect(
      previewButton().compareDocumentPosition(values) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it("CL-25: posts the guesses by index and header, once somebody has seen them", async () => {
    // `2:notes:Notes` is the literal declaration the ship blocker posted, and it
    // is still what a person who reads the column and agrees with us would send
    // — the defect was never the string, it was that no human was in the loop
    // that produced it. What this pins is the fidelity of the half that is
    // guessed: index, header as the file spelled it, and the detector's field,
    // all reaching the wire unaltered. The API validates the declaration against
    // the bytes, so a guess that travelled with the wrong index or a tidied-up
    // header would 422 a file the person answered correctly.
    await openWith(EVERY_HEADER_RECOGNISED);
    fireEvent.click(previewButton());
    await screen.findByText("Check before importing");
    fireEvent.click(
      screen.getByLabelText(/agreed to be texted by this business/),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Import \d+ contact/ }));

    const request = csvMutate.mock.calls[0][0] as {
      columns: ContactImportColumnDeclaration[];
    };
    expect(request.columns.map(formatContactImportColumn)).toEqual([
      "0:phone:Phone",
      "1:name:Name",
      "2:notes:Notes",
    ]);
  });

  it("CL-26: a mixed file shows BOTH kinds of column, each with its values", async () => {
    // The mix is the point: one column the detector claimed, one it has never
    // heard of. They are rendered by different branches, and the branch for the
    // claimed one is the branch that did not exist.
    await openWith([
      ["Phone", "Notes", "Job #"],
      ["416-555-0199", DO_NOT_CALL, "J-1"],
      ["416-555-0198", "gate code 4432", "J-2"],
      ["212-555-0100", "", "J-3"],
    ]);

    expect(screen.getByText(new RegExp(DO_NOT_CALL))).toBeTruthy();
    expect(screen.getByText(/“J-1”/)).toBeTruthy();
    expect(previewButton().disabled).toBe(true);

    // Dismissing what nobody recognised must not touch what was guessed, and
    // the guessed column's values are still there to be read afterwards.
    fireEvent.click(
      screen.getByRole("button", {
        name: /None of this says who can be texted/,
      }),
    );

    await waitFor(() => expect(previewButton().disabled).toBe(false));
    expect(columnSelect("Job #").value).toBe(CONTACT_IMPORT_IGNORE);
    expect(columnSelect("Notes").value).toBe("notes");
    expect(screen.getByText(new RegExp(DO_NOT_CALL))).toBeTruthy();

    // Still a question, not a receipt: the guessed column can be re-answered
    // from where it is shown. Answering "do not text" over a column of
    // SENTENCES then shuts the way through rather than reading them as nobody
    // opting out, which is the honest end of this file — the sentence is a
    // person to go and ask, not a flag we can parse.
    answer("Notes", "opted_out");

    await waitFor(() => expect(previewButton().disabled).toBe(true));
    expect(
      screen
        .getAllByRole("alert")
        .some((node) => (node.textContent ?? "").includes(DO_NOT_CALL)),
    ).toBe(true);
  });
});

describe("#248: the answer travels with the file", () => {
  it("CL-10: posts the file they chose and a declaration for every column", async () => {
    const chosen = await openWith(MARKETING_STATUS);
    answer("Marketing Status", CONTACT_IMPORT_IGNORE);
    await waitFor(() => expect(previewButton().disabled).toBe(false));
    fireEvent.click(previewButton());
    await screen.findByText("Check before importing");
    fireEvent.click(
      screen.getByLabelText(/agreed to be texted by this business/),
    );
    const importButton = screen.getByRole("button", {
      name: /^Import 4 contacts$/,
    });
    await waitFor(() =>
      expect((importButton as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(importButton);

    expect(csvMutate).toHaveBeenCalledTimes(1);
    const request = csvMutate.mock.calls[0][0] as {
      file: File;
      columns: ContactImportColumnDeclaration[];
    };
    // The FILE THEY CHOSE, unchanged. The wizard used to rewrite every header
    // into our canonical spelling before uploading, which is what made the
    // server's gate unable to fire for this door at all: it only ever saw
    // column names we had invented. Posting the original is what makes the
    // declaration describe the bytes the server parses.
    expect(request.file).toBe(chosen);
    expect(await request.file.text()).toBe(sheetText(MARKETING_STATUS));
    // Complete, by index, headers exactly as the file spelled them.
    expect(request.columns.map(formatContactImportColumn)).toEqual([
      "0:phone:Phone",
      `1:${CONTACT_IMPORT_IGNORE}:Marketing Status`,
    ]);
  });

  it("CL-11: declares the column past the header row, and it blocks", async () => {
    // A declaration that stopped at the header row would be refused by the
    // server as incomplete, because it counts columns from the data too. And
    // the nameless column is not a second-class one: answered do-not-text, it
    // has to actually block the row that carries it.
    await openWith([
      ["Phone", "Name"],
      ["206-555-0100", "Ann", "y"],
      ["206-555-0101", "Bo"],
    ]);
    answer(/What is Column 3/, "opted_out");
    await waitFor(() => expect(previewButton().disabled).toBe(false));
    fireEvent.click(previewButton());
    await screen.findByText("Check before importing");
    expect(screen.getAllByText("Imports, opted out")).toHaveLength(1);
    fireEvent.click(
      screen.getByLabelText(/agreed to be texted by this business/),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Import \d+ contact/ }));

    const request = csvMutate.mock.calls[0][0] as {
      columns: ContactImportColumnDeclaration[];
    };
    expect(request.columns.map(formatContactImportColumn)).toEqual([
      "0:phone:Phone",
      "1:name:Name",
      "2:opted_out:",
    ]);
  });

  it("CL-12: one click answers the rest, with every value still on screen", async () => {
    // The bulk answer is allowed ONLY because the columns and their values are
    // rendered above it. That is what makes it an informed click, which is the
    // entire justification for the design — so this asserts the values are
    // there at the moment the button is, not merely that the button works.
    await openWith([
      ["Phone", "Invoice #", "Marketing Status"],
      ["416-555-0199", "INV-1", "Unsubscribed"],
      ["416-555-0198", "INV-2", "Subscribed"],
      ["212-555-0100", "INV-3", "Unsubscribed"],
    ]);
    const bulk = screen.getByRole("button", {
      name: /None of these say who can be texted/,
    });
    expect(screen.getByText(/“INV-1”/)).toBeTruthy();
    expect(screen.getByText(/“Unsubscribed”/)).toBeTruthy();

    // BELOW THEM, and that is the whole justification rather than a layout
    // preference: "the columns and their values are on screen when it is
    // pressed" is only true if reaching the button meant passing them. Moving
    // this control above the list survived all 2972 tests, because asserting
    // both are RENDERED says nothing about which one a thumb meets first — and
    // a bulk dismissal read before the values is the silent drop with an extra
    // step.
    const status = screen.getByText(/“Unsubscribed”/);
    expect(
      // DOCUMENT_POSITION_FOLLOWING: the button comes after the values.
      bulk.compareDocumentPosition(status) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();

    fireEvent.click(bulk);

    await waitFor(() => expect(previewButton().disabled).toBe(false));
    expect(columnSelect("Invoice #").value).toBe(CONTACT_IMPORT_IGNORE);
    expect(columnSelect("Marketing Status").value).toBe(CONTACT_IMPORT_IGNORE);
  });

  it("CL-13: the bulk answer never overwrites one somebody gave", async () => {
    await openWith([
      ["Phone", "Invoice #", "Marketing Status"],
      ["416-555-0199", "INV-1", "Unsubscribed"],
      ["416-555-0198", "INV-2", ""],
      ["212-555-0100", "INV-3", "Unsubscribed"],
    ]);
    answer("Marketing Status", "opted_out");
    fireEvent.click(
      screen.getByRole("button", { name: /None of this says who can be texted/ }),
    );

    await waitFor(() =>
      expect(columnSelect("Invoice #").value).toBe(CONTACT_IMPORT_IGNORE),
    );
    expect(columnSelect("Marketing Status").value).toBe("opted_out");
  });
});

describe("#248: the answer is the mapping", () => {
  it("CL-14: a column the detector claimed can be declared do-not-text", async () => {
    // Round two's gate only examined UNMAPPED columns, so a `Description`
    // column reading "DO NOT CONTACT" was claimed by `notes`, filed as a note,
    // and the message went out — invisible to that gate by construction. The
    // person's answer is what the server maps on now, so pointing this column
    // at "do not text" has to actually block those rows.
    await openWith([
      ["Phone", "Description"],
      ["416-555-0199", "yes"],
      ["416-555-0198", ""],
      ["212-555-0100", "yes"],
    ]);
    expect(columnSelect("Description").value).toBe("notes");

    answer("Description", "opted_out");
    fireEvent.click(previewButton());
    await screen.findByText("Check before importing");

    expect(screen.getAllByText("Imports, opted out")).toHaveLength(2);
    expect(screen.getAllByText("Imports")).toHaveLength(1);
  });

  it("CL-15: two columns cannot be the same thing, and it is not resolved for them", async () => {
    // The losing half of any automatic answer is a field silently emptied,
    // which is the whole defect class. The API refuses the pair by name; this
    // screen names them too rather than sending a request it knows will fail.
    await openWith([
      ["Phone", "Second Number"],
      ["416-555-0199", "416-555-0100"],
      ["416-555-0198", "416-555-0101"],
    ]);
    answer("Second Number", "phone");

    await waitFor(() => expect(previewButton().disabled).toBe(true));
    const alert = screen.getAllByRole("alert").map((n) => n.textContent ?? "");
    expect(alert.some((text) => text.includes("“Second Number”"))).toBe(true);
    expect(alert.some((text) => text.includes("“Phone”"))).toBe(true);
    // Neither answer was taken away to make the other work.
    expect(columnSelect("Phone").value).toBe("phone");
    expect(columnSelect("Second Number").value).toBe("phone");
  });

  it("CL-16: breaking the answers behind Back shuts the way through again", async () => {
    // The mapping screen's button is the ONE route to the write, which is why
    // there is no second copy of the check on the import button — a condition
    // no input can make false cannot be proved by breaking it. This is the
    // reachable version of the same worry: go forward, come back, break it, and
    // the door is shut with nothing posted.
    await openWith(MARKETING_STATUS);
    answer("Marketing Status", CONTACT_IMPORT_IGNORE);
    await waitFor(() => expect(previewButton().disabled).toBe(false));
    fireEvent.click(previewButton());
    await screen.findByText("Check before importing");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByText(/in your columns/);
    answer("Marketing Status", "phone");

    await waitFor(() => expect(previewButton().disabled).toBe(true));
    expect(csvMutate).not.toHaveBeenCalled();
  });
});

describe("#248: the do-not-text column's own values have to be readable", () => {
  /**
   * The other half, one level down. "Do Not Call" is identified correctly — and
   * then read as nobody opting out, because anything that is not `yes` was
   * silently false. Every row promises "Imports" and the people who
   * unsubscribed get texted.
   */
  const UNREADABLE_FLAG = [
    ["Phone", "Do Not Call"],
    ["416-555-0199", "Unsubscribed"],
    ["416-555-0198", "Subscribed"],
    ["212-555-0100", "Unsubscribed"],
  ];

  it("CL-17: will not preview when the declared flag column cannot be read", async () => {
    await openWith(UNREADABLE_FLAG);

    const alert = screen.getAllByRole("alert").map((n) => n.textContent ?? "");
    expect(alert.some((text) => text.includes("Do Not Call"))).toBe(true);
    expect(alert.some((text) => text.includes("Unsubscribed"))).toBe(true);
    expect(previewButton().disabled).toBe(true);
  });

  it("CL-18: offers no way to assert it away", async () => {
    // Deliberately not resolvable by dismissing anything: we already know this
    // column decides who may be texted, because that is what it was answered
    // as. The only honest fixes are in the file or in the answer.
    await openWith(UNREADABLE_FLAG);

    expect(
      screen.queryByRole("button", { name: /say.? who can be texted/ }),
    ).toBeNull();
    expect(previewButton().disabled).toBe(true);
  });

  it("CL-19: previews a readable flag column, mixed rows and all", async () => {
    await openWith([
      ["Phone", "Do Not Call"],
      ["416-555-0199", "x"],
      ["416-555-0198", ""],
      ["212-555-0100", "yes"],
    ]);
    fireEvent.click(previewButton());
    await screen.findByText("Check before importing");

    // `x` is how a hand-kept sheet marks the blocked rows. The wizard read the
    // flag with its own truthy set, which had never learned it, so a file of
    // x's promised "Imports" on every row and imported them blocked.
    expect(screen.getAllByText("Imports, opted out")).toHaveLength(2);
    expect(screen.getAllByText("Imports")).toHaveLength(1);
  });

  it("CL-20: promises only spellings the shared reader accepts", async () => {
    // The note under the column step listed "true, yes, y, or 1" for months
    // after the reader learned `x`. Printing a list filtered through
    // `readContactFlag` is what keeps the screen and the server from saying
    // different things about who gets blocked.
    await openWith(MARKETING_STATUS);
    const note = screen.getByText(/About "Do not text"/).textContent ?? "";

    /*
     * THE PRINTED TOKENS, not a substring of the sentence around them.
     *
     * This read `promised.toContain("x")` against the note's own prefix — which
     * opens `About "Do not text": rows marked …`. The `x` in **text** satisfied
     * it, and the `y` in **yes** satisfied the other single character, so
     * neither of the two spellings most likely to be dropped could ever fail.
     *
     * Splitting the list gives exact tokens: "x" no longer matches "text".
     */
    const listed = note
      .slice(note.indexOf("marked ") + "marked ".length, note.indexOf(" in that"))
      .split(/,\s*|\s+or\s+/)
      .map((token) => token.trim())
      .filter(Boolean);
    expect(listed.length, `no spellings parsed out of: ${note}`).toBeGreaterThan(2);

    /*
     * PROBED, not read off a list.
     *
     * The roster here was `["true","yes","y","1","x"]` — the same literal the
     * wizard held. Both were missing `t`, which `readContactFlag` has accepted
     * all along, so the under-promise this test exists for was live in the tree
     * while the test was green.
     *
     * Iterating the exported `FLAG_TRUE_SPELLINGS` does not fix that: the
     * screen prints that same list, so the test would agree with it by
     * construction and a spelling dropped from BOTH would go unnoticed. I tried
     * exactly that first, removed `x` from the export, and watched 26 tests
     * pass over a screen that no longer named it.
     *
     * So the reader is asked directly, over every single character it could
     * plausibly be handed plus the words. Nothing here is derived from the
     * thing under test.
     */
    const alphabet = [
      ..."abcdefghijklmnopqrstuvwxyz0123456789".split(""),
      "true",
      "false",
      "yes",
      "no",
    ];
    const accepted = alphabet.filter((token) => readContactFlag(token) === true);
    expect(accepted.length, "the probe found no truthy spelling at all").toBeGreaterThan(3);

    for (const spelling of accepted) {
      expect(
        listed,
        `readContactFlag accepts "${spelling}" and the screen does not name ` +
          `it — somebody with that column edits a file that already worked`,
      ).toContain(spelling);
    }
  });
});

describe("#248: an answer is about one file", () => {
  it("CL-21: asks again about the next file's columns", async () => {
    // An answer given about "Marketing Status" in one spreadsheet says nothing
    // about the column sitting in the same position in the next one. Carrying
    // it over would mean a person clears a column once and every later file
    // walks past the gate, with the second file's answer never given.
    await openWith(MARKETING_STATUS);
    answer("Marketing Status", CONTACT_IMPORT_IGNORE);
    await waitFor(() => expect(previewButton().disabled).toBe(false));

    // "Back" on the column step returns to the file picker and resets.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    const next = [
      ["Phone", "Contactable"],
      ["416-555-0199", "N"],
      ["416-555-0198", "Y"],
      ["212-555-0100", "N"],
    ];
    sheet.rows = next;
    fireEvent.change(screen.getByLabelText("CSV file"), {
      target: {
        files: [new File([sheetText(next)], "second.csv", { type: "text/csv" })],
      },
    });
    await screen.findByText(/in your columns/);

    expect(columnSelect("Contactable").value).toBe("");
    expect(previewButton().disabled).toBe(true);
  });
});

describe("#248 D2: the preview tells the truth about duplicates", () => {
  it("CL-22: a duplicate carrying the flag opts out the row that is kept", async () => {
    // A merge of two exports lists the same person twice, once plain and once
    // flagged. The API folds the restriction into the row it keeps; the preview
    // dropped it with the duplicate and showed a clean "Imports" over somebody
    // the server was about to block.
    await openWith([
      ["Phone", "Do Not Call"],
      ["416-555-0199", ""],
      ["(416) 555-0199", "yes"],
      ["212-555-0100", ""],
    ]);
    fireEvent.click(previewButton());
    await screen.findByText("Check before importing");

    expect(screen.getAllByText("Imports, opted out")).toHaveLength(1);
    expect(screen.getByText(/1 marked opted out/)).toBeTruthy();
  });

  it("CL-23: a blank line does not shift the skip reasons onto other rows", async () => {
    // The API keys its skip reasons to the file's own line numbers, and the
    // skipped-rows download joins them back by that number. The wizard used to
    // number rows `position + 2`, which was only right because it rewrote the
    // file before uploading and the rewrite had no blank lines. Now that the
    // person's own file goes up, a blank line anywhere in it would hand back
    // the wrong original row for every reason after it.
    //
    // Asserted through the DOWNLOAD, because that is the only place the numbers
    // are visible. The screen shows the reasons and not the lines, so a preview
    // assertion cannot tell a correct join from a broken one — which is how
    // `skipEmptyLines` came to be a setting nothing tested.
    const blobs: Blob[] = [];
    // The two halves of `downloadCsv` that a test environment has no plumbing
    // for: the object URL, and the anchor click that would navigate to it.
    // Restored by the config's `restoreMocks`.
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      (blob: Blob | MediaSource) => {
        blobs.push(blob as Blob);
        return "blob:skipped";
      },
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(window, "open").mockReturnValue(null);
    csvMutate.mockImplementation(
      (
        _request: unknown,
        options: { onSuccess: (result: unknown) => void },
      ) =>
        options.onSuccess({
          imported: 1,
          updated: 0,
          skipped: 1,
          // Line 4 of the file: header, contact, blank, the bad one.
          errors: [{ row: 4, reason: "invalid phone: nope" }],
          consent_refused: 0,
          consent_refusals: [],
          consent_refused_note: null,
        }),
    );
    await openWith([
      ["Phone", "Name"],
      ["416-555-0199", "Sam"],
      ["", ""],
      ["nope", "Pat"],
    ]);
    fireEvent.click(previewButton());
    await screen.findByText("Check before importing");
    fireEvent.click(
      screen.getByLabelText(/agreed to be texted by this business/),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Import 1 contact/ }));
    await screen.findByText("Import finished");
    fireEvent.click(
      screen.getByRole("button", { name: "Download skipped rows" }),
    );

    expect(blobs).toHaveLength(1);
    const csv = await blobs[0].text();
    // The person's own row, handed back with the reason beside it. Renumber the
    // rows and this line is blank except for the reason.
    expect(csv.split("\r\n")[1]).toBe("nope,Pat,,,,,,invalid phone: nope");
  });
});
