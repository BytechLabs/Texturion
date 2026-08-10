/**
 * @vitest-environment happy-dom
 *
 * #248 — the three doors that hand strangers' phone numbers to this product:
 * the one question each of them now has to ask, and the one answer each of them
 * has to bring back.
 *
 * This file exists because its absence is the defect. #226 made
 * `consent_attested` mandatory on CSV import and asserted it from the server
 * side only; no test anywhere drove the client that had to satisfy it, so every
 * CSV import on web, Android and iOS returned 422 for over a week against a
 * field the UI had no control for. A guard on the gate is not a guard on the
 * client's ability to pass it.
 *
 * The second half is the same lesson pointed the other way. The server now
 * REFUSES that attestation on any contact with a standing opt-out, and reports
 * how many and which. A refusal nobody is shown is a silent one, and the whole
 * reason an attestation exists is that somebody can point at it months later —
 * so a client that drops the report puts the hole back.
 *
 * The assertions read the shipped constants — IMPORT_CONSENT_LABEL, the shared
 * field/value the server compares against, and the server's own refusal
 * sentences — rather than phrases typed in here. A test carrying its own copy
 * of the wording is a test that passes while the two halves disagree, which is
 * the whole shape of this issue.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  CONTACT_IMPORT_CONSENT_REFUSED_NOTE,
  CONTACT_IMPORT_MAX_BYTES,
  CONTACT_IMPORT_MAX_ROWS,
  contactImportConsentRefusedReason,
  VCARD_IMPORT_MAX_BYTES,
} from "@loonext/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { csvMutate, vcardMutate, select, download } = vi.hoisted(() => ({
  csvMutate: vi.fn(),
  vcardMutate: vi.fn(),
  select: vi.fn(),
  download: vi.fn(),
}));

vi.mock("@/lib/api/contacts", () => ({
  useImportContacts: () => ({
    mutate: csvMutate,
    isPending: false,
    reset: vi.fn(),
  }),
}));
vi.mock("@/lib/api/contacts-vcard", () => ({
  useImportVCard: () => ({
    mutate: vcardMutate,
    isPending: false,
    reset: vi.fn(),
  }),
}));
// happy-dom has no object-URL plumbing, and the assertion worth making is about
// the BYTES handed to the browser rather than the anchor click that follows.
// #587: only `triggerBlobDownload` is replaced. `csvDownloadBlob` is the REAL
// one, so the byte-order-mark assertion below is about the shipped code — a
// stub would have quietly removed the thing this issue added. The module's
// only import is `./error`, so pulling the original is free.
vi.mock("@/lib/api/contacts-export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/contacts-export")>()),
  triggerBlobDownload: download,
}));
// The wizard lazy-loads papaparse inside handleFile; parsing a real File in a
// test environment is not what is under test here, so the parse resolves
// synchronously with a fixed two-row sheet.
vi.mock("papaparse", () => ({
  default: {
    parse: (
      _file: unknown,
      options: { complete: (result: { data: string[][] }) => void },
    ) => {
      options.complete({
        data: [
          ["First Name", "Last Name", "Phone Number"],
          ["Sam", "Okafor", "416-555-0199"],
          ["Dana", "Rivera", "212-555-0100"],
        ],
      });
    },
  },
}));

import type { ImportResult } from "@/lib/api/types";
import { CONSENT_REFUSALS_FILENAME } from "@/lib/contacts/import-summary";

import { ImportWizard } from "./import-wizard";
import { PhonePickerDialog } from "./phone-picker-dialog";
import { VCardImportDialog } from "./vcard-import-dialog";
// #228: the attestation sentence moved into the catalogue, keyed by door.
import { contactsEn } from "@/i18n/sections/contacts";

const IMPORT_CONSENT_LABEL = {
  file: contactsEn.consentLabelFile,
  picked: contactsEn.consentLabelPicked,
} as const;

afterEach(cleanup);
beforeEach(() => {
  csvMutate.mockReset();
  vcardMutate.mockReset();
  select.mockReset();
  download.mockReset();
});

/** The attestation control, found by the sentence it actually renders. */
function consentBox(source: keyof typeof IMPORT_CONSENT_LABEL) {
  return screen.getByLabelText(IMPORT_CONSENT_LABEL[source]);
}

/**
 * jest-dom is not installed in this app, so `disabled` is read off the element.
 * Written as a helper rather than repeated inline because the whole file turns
 * on this one property being true before an attestation and false after.
 */
function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled;
}

function chooseFile(label: string, contents: string, name: string) {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, {
    target: { files: [new File([contents], name, { type: "text/csv" })] },
  });
}

/** The number the live database proved carries a standing `stop_keyword` row. */
const STOPPED = "+14163014444";

/** An import that landed, and one person in it the attestation could not cover. */
function refusedResult(over: Partial<ImportResult> = {}): ImportResult {
  return {
    imported: 2,
    updated: 0,
    skipped: 0,
    errors: [],
    consent_refused: 1,
    consent_refusals: [
      { row: 2, reason: contactImportConsentRefusedReason(STOPPED) },
    ],
    consent_refused_note: CONTACT_IMPORT_CONSENT_REFUSED_NOTE,
    ...over,
  };
}

/** Answer the next mutation with this summary, the way the API would. */
function answerWith(mutate: typeof csvMutate, result: ImportResult) {
  mutate.mockImplementation(
    (
      _request: unknown,
      options: { onSuccess: (result: ImportResult) => void },
    ) => options.onSuccess(result),
  );
}

/** What the workspace has to end up reading — the server's own two sentences. */
function expectRefusalReported() {
  expect(screen.getByText(CONTACT_IMPORT_CONSENT_REFUSED_NOTE)).toBeTruthy();
  expect(
    screen.getByText(contactImportConsentRefusedReason(STOPPED)),
  ).toBeTruthy();
}

describe("#248 the CSV wizard can satisfy the #226 gate", () => {
  async function reachPreview() {
    render(<ImportWizard open onOpenChange={() => {}} />);
    chooseFile("CSV file", "First Name,Last Name,Phone Number\r\n", "book.csv");
    // The parse is behind a dynamic import, so the map step arrives a tick later.
    await screen.findByText(/in your columns/);
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByText("Check before importing");
  }

  it("IC-1: will not import until somebody says why these people may be texted", async () => {
    await reachPreview();

    // Disabled, not hidden: the person can see the import is one tick away and
    // what that tick claims. Hiding the button would leave a screen whose only
    // finished-looking path is a 422.
    expect(
      isDisabled(screen.getByRole("button", { name: /^Import 2 contacts$/ })),
    ).toBe(true);
    expect(csvMutate).not.toHaveBeenCalled();
  });

  it("IC-2: sends the attestation the person actually gave", async () => {
    await reachPreview();

    fireEvent.click(consentBox("file"));
    const importButton = screen.getByRole("button", {
      name: /^Import 2 contacts$/,
    });
    await waitFor(() => expect(isDisabled(importButton)).toBe(false));
    fireEvent.click(importButton);

    expect(csvMutate).toHaveBeenCalledTimes(1);
    expect(csvMutate.mock.calls[0][0]).toMatchObject({ consentAttested: true });
  });

  it("IC-3: the box starts empty, every time", async () => {
    // A pre-ticked attestation is not an attestation. This is the one control
    // in the product where the smart default is the wrong answer, so it is
    // asserted rather than left to whoever edits the component next.
    await reachPreview();

    expect(consentBox("file").getAttribute("aria-checked")).toBe("false");
  });

  it("IC-0: quotes the server's bounds rather than its own copy of them", () => {
    // These two numbers lived here as literals under a comment calling them a
    // mirror of the API's. That is how a client comes to accept a file the
    // server then refuses — and the person only finds out after the upload.
    render(<ImportWizard open onOpenChange={() => {}} />);

    expect(
      screen.getByText(
        `Up to ${CONTACT_IMPORT_MAX_ROWS.toLocaleString()} rows / ` +
          `${CONTACT_IMPORT_MAX_BYTES / (1024 * 1024)} MB`,
      ),
    ).toBeTruthy();
  });

  it("IC-4: previews the name that will land, not half of it", async () => {
    // The file is First/Last, the shape the wizard could not express. If the
    // split columns were dropped again this cell would read "Sam" or "–".
    await reachPreview();

    expect(screen.getByText("Sam Okafor")).toBeTruthy();
    expect(screen.getByText("Dana Rivera")).toBeTruthy();
  });
});

describe("#248 a .vcf is asked the same question", () => {
  it("IC-5: cannot open the file picker unattested", () => {
    // This route had NO consent gate at all — the only working bulk door into
    // the product was the one that never asked, the exact inverse of #226.
    render(<VCardImportDialog open onOpenChange={() => {}} />);

    expect(
      isDisabled(screen.getByRole("button", { name: /Choose a \.vcf file/ })),
    ).toBe(true);
  });

  it("IC-9: quotes the server's .vcf ceiling", () => {
    render(<VCardImportDialog open onOpenChange={() => {}} />);

    expect(
      screen.getByText(
        `Up to ${VCARD_IMPORT_MAX_BYTES / (1024 * 1024)} MB`,
      ),
    ).toBeTruthy();
  });

  it("IC-6: sends the attestation with the card file", async () => {
    render(<VCardImportDialog open onOpenChange={() => {}} />);

    fireEvent.click(consentBox("file"));
    await waitFor(() =>
      expect(
        isDisabled(screen.getByRole("button", { name: /Choose a \.vcf file/ })),
      ).toBe(false),
    );
    chooseFile("vCard file", "BEGIN:VCARD\r\nEND:VCARD", "phone.vcf");

    // The dialog reads the card file before posting, to enumerate what these
    // cards carry that the importer does not read (#248 round 3) — so the
    // mutation lands a tick after the choice rather than inside it.
    await waitFor(() => expect(vcardMutate).toHaveBeenCalledTimes(1));
    expect(vcardMutate.mock.calls[0][0]).toMatchObject({
      consentAttested: true,
    });
  });
});

describe("#248 the device address book is asked it too", () => {
  beforeEach(() => {
    // The picker is a Chrome-for-Android capability; the dialog feature-detects
    // `navigator.contacts` + the global constructor, so both are stood up here.
    Object.defineProperty(navigator, "contacts", {
      configurable: true,
      value: { select, getProperties: async () => ["name", "tel"] },
    });
    vi.stubGlobal("ContactsManager", function ContactsManager() {});
    select.mockResolvedValue([{ name: ["Sam Okafor"], tel: ["416-555-0199"] }]);
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, "contacts");
  });

  it("IC-7: will not open the address book unattested", () => {
    // Being in somebody's phone is not consent to be texted by their business,
    // and this door reaches the same upsert as the other two.
    render(<PhonePickerDialog open onOpenChange={() => {}} />);

    expect(
      isDisabled(screen.getByRole("button", { name: "Choose contacts" })),
    ).toBe(true);
    expect(select).not.toHaveBeenCalled();
  });

  it("IC-8: sends the attestation with the picked contacts", async () => {
    render(<PhonePickerDialog open onOpenChange={() => {}} />);

    fireEvent.click(consentBox("picked"));
    const pickButton = screen.getByRole("button", { name: "Choose contacts" });
    await waitFor(() => expect(isDisabled(pickButton)).toBe(false));
    fireEvent.click(pickButton);

    await waitFor(() => expect(csvMutate).toHaveBeenCalledTimes(1));
    expect(csvMutate.mock.calls[0][0]).toMatchObject({ consentAttested: true });
  });

  it("CR-7: reports the refusal back to the person who picked them", async () => {
    // Picked from a phone book, so the picker knows nothing about opt-outs and
    // every name in it looks equally fresh. Asserted at this door too rather
    // than trusting that it still shares a summary component with the .vcf one.
    answerWith(csvMutate, refusedResult());
    render(<PhonePickerDialog open onOpenChange={() => {}} />);

    fireEvent.click(consentBox("picked"));
    const pickButton = screen.getByRole("button", { name: "Choose contacts" });
    await waitFor(() => expect(isDisabled(pickButton)).toBe(false));
    fireEvent.click(pickButton);

    await screen.findByText("Import finished");
    expectRefusalReported();
  });
});

describe("#248 every door reports what the attestation could not cover", () => {
  it("CR-5: the CSV wizard's summary says who was refused", async () => {
    answerWith(csvMutate, refusedResult());
    render(<ImportWizard open onOpenChange={() => {}} />);
    chooseFile("CSV file", "First Name,Last Name,Phone Number\r\n", "book.csv");
    await screen.findByText(/in your columns/);
    fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
    await screen.findByText("Check before importing");
    fireEvent.click(consentBox("file"));
    fireEvent.click(screen.getByRole("button", { name: /^Import 2 contacts$/ }));

    await screen.findByText("Import finished");
    expectRefusalReported();
  });

  it("CR-6: the .vcf summary says it too", async () => {
    // The door that most needs it: a .vcf has no property for "this person told
    // us to stop", so every standing STOP in a phone book arrives looking like
    // a fresh contact who agreed. Carries a skipped row too, so that this and
    // CR-10 fail to different breaks — the refusal block sitting inside the
    // skipped-rows block would still satisfy this one.
    answerWith(
      vcardMutate,
      refusedResult({
        skipped: 1,
        errors: [{ row: 5, reason: "invalid phone: (empty)" }],
      }),
    );
    render(<VCardImportDialog open onOpenChange={() => {}} />);
    fireEvent.click(consentBox("file"));
    await waitFor(() =>
      expect(
        isDisabled(screen.getByRole("button", { name: /Choose a \.vcf file/ })),
      ).toBe(false),
    );
    chooseFile("vCard file", "BEGIN:VCARD\r\nEND:VCARD", "phone.vcf");

    await screen.findByText("Import finished");
    expectRefusalReported();
  });

  it("CR-10: an import with nothing skipped still reports the refusal", async () => {
    // The block is not a kind of error and must not be nested inside the
    // skipped-rows one: these rows imported, and a clean file full of people
    // who have opted out is the case where the report matters most.
    answerWith(vcardMutate, refusedResult({ errors: [], skipped: 0 }));
    render(<VCardImportDialog open onOpenChange={() => {}} />);
    fireEvent.click(consentBox("file"));
    await waitFor(() =>
      expect(
        isDisabled(screen.getByRole("button", { name: /Choose a \.vcf file/ })),
      ).toBe(false),
    );
    chooseFile("vCard file", "BEGIN:VCARD\r\nEND:VCARD", "phone.vcf");

    await screen.findByText("Import finished");
    expect(screen.queryByText(/couldn't be imported/)).toBeNull();
    expectRefusalReported();
  });

  it("CR-8: an import that refused nothing says nothing", async () => {
    // A compliance notice printed after every import is one nobody reads by the
    // third import, and the one it has to survive is the fourth.
    answerWith(
      vcardMutate,
      refusedResult({
        consent_refused: 0,
        consent_refusals: [],
        consent_refused_note: null,
      }),
    );
    render(<VCardImportDialog open onOpenChange={() => {}} />);
    fireEvent.click(consentBox("file"));
    await waitFor(() =>
      expect(
        isDisabled(screen.getByRole("button", { name: /Choose a \.vcf file/ })),
      ).toBe(false),
    );
    chooseFile("vCard file", "BEGIN:VCARD\r\nEND:VCARD", "phone.vcf");

    await screen.findByText("Import finished");
    expect(screen.queryByText(CONTACT_IMPORT_CONSENT_REFUSED_NOTE)).toBeNull();
    // The button, not just the sentence. With nothing refused there is no note
    // to print, so a block that rendered anyway would still show no note — and
    // this assertion is the one that notices it standing there empty, offering
    // a download of nobody.
    expect(
      screen.queryByRole("button", { name: "Download the refused rows" }),
    ).toBeNull();
  });

  it("CR-11: a count with no rows behind it says so, and offers no file", async () => {
    // The two halves of the answer come from one array on the server today. If
    // they ever stop agreeing, this block printed "40" over silence — no rows,
    // no overflow line, because the overflow line lived inside a list that only
    // rendered when there were rows — and offered a download that would hand
    // back a header and nothing else.
    answerWith(
      vcardMutate,
      refusedResult({ consent_refused: 40, consent_refusals: [] }),
    );
    render(<VCardImportDialog open onOpenChange={() => {}} />);
    fireEvent.click(consentBox("file"));
    await waitFor(() =>
      expect(
        isDisabled(screen.getByRole("button", { name: /Choose a \.vcf file/ })),
      ).toBe(false),
    );
    chooseFile("vCard file", "BEGIN:VCARD\r\nEND:VCARD", "phone.vcf");
    await screen.findByText("Import finished");

    expect(screen.getByText("…and 40 more.")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Download the refused rows" }),
    ).toBeNull();
  });

  it("CR-9: the download carries every refusal, not the fifty on screen", async () => {
    // The list is capped and the audit row keeps only a count, so this file is
    // the only surviving answer to "which of them?". A download that inherited
    // the cap would lose the rest of them silently.
    const many = Array.from({ length: 60 }, (_, i) => ({
      row: i + 2,
      reason: contactImportConsentRefusedReason(
        `+1416555${String(i).padStart(4, "0")}`,
      ),
    }));
    answerWith(
      vcardMutate,
      refusedResult({ consent_refused: 60, consent_refusals: many }),
    );
    render(<VCardImportDialog open onOpenChange={() => {}} />);
    fireEvent.click(consentBox("file"));
    await waitFor(() =>
      expect(
        isDisabled(screen.getByRole("button", { name: /Choose a \.vcf file/ })),
      ).toBe(false),
    );
    chooseFile("vCard file", "BEGIN:VCARD\r\nEND:VCARD", "phone.vcf");
    await screen.findByText("Import finished");

    fireEvent.click(
      screen.getByRole("button", { name: "Download the refused rows" }),
    );

    expect(download).toHaveBeenCalledTimes(1);
    const [blob, filename] = download.mock.calls[0] as [Blob, string];
    expect(filename).toBe(CONSENT_REFUSALS_FILENAME);
    // #587: the byte-order mark, asserted on the BYTES. `blob.text()` decodes as
    // UTF-8 and consumes the mark, so no text assertion below can see whether it
    // is there — and its absence is exactly what makes an accented reason arrive
    // as mojibake in the spreadsheet somebody opens this in.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    const csv = await blob.text();
    expect(csv.split("\r\n")).toHaveLength(61); // header + every refusal
    expect(csv).toContain(many[59].reason);
  });
});
