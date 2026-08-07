/**
 * @vitest-environment happy-dom
 *
 * #248 round 3 — the vCard door, which had no gate of any kind.
 *
 * `CATEGORIES:DNC` and a `NOTE` reading "DO NOT CONTACT - asked us to stop" are
 * the only two places the format lets a card say do-not-text, they are what
 * Apple and Google actually export, and the importer dropped both without a
 * word while the file's consent attestation was written over the top. There was
 * no column list to classify here and no refusal to read: the file simply
 * imported clean.
 *
 * So the dialog reads the cards itself, shows what they carry, and posts a
 * complete declaration. Reading the file on this side is the point — the server
 * names the properties it is missing, so a client that answered the 422 by
 * echoing them back would be round two's defect with a different noun.
 *
 * The fixture is a MIX: three cards, one with a category, one with a note, one
 * with neither.
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
  formatVCardProperty,
  vcardParameterProperty,
  type VCardPropertyDeclaration,
} from "@loonext/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { vcardMutate } = vi.hoisted(() => ({ vcardMutate: vi.fn() }));

vi.mock("@/lib/api/contacts-vcard", () => ({
  useImportVCard: () => ({
    mutate: vcardMutate,
    isPending: false,
    reset: vi.fn(),
  }),
}));

import { VCardImportDialog } from "./vcard-import-dialog";
import { IMPORT_CONSENT_LABEL } from "./import-consent-check";

afterEach(cleanup);
beforeEach(() => {
  vcardMutate.mockReset();
});

const BOOK = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Ann Rivera",
  "TEL;TYPE=CELL:+12065550100",
  "CATEGORIES:DNC",
  "ORG:Rivera Roofing",
  "END:VCARD",
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Bo Tran",
  "TEL;TYPE=CELL:+12065550101",
  "NOTE:DO NOT CONTACT - asked us to stop",
  "END:VCARD",
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Cy Okafor",
  "TEL;TYPE=CELL:+12065550102",
  "ORG:Okafor Electric",
  "END:VCARD",
].join("\r\n");

/** Attest, choose the file, and wait for whatever the dialog does next. */
async function choose(contents: string) {
  render(<VCardImportDialog open onOpenChange={() => {}} />);
  fireEvent.click(screen.getByLabelText(IMPORT_CONSENT_LABEL.file));
  const picker = screen.getByRole("button", { name: /Choose a \.vcf file/ });
  await waitFor(() => expect((picker as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText("vCard file"), {
    target: { files: [new File([contents], "phone.vcf", { type: "text/vcard" })] },
  });
}

function propertySelect(property: string): HTMLSelectElement {
  return screen.getByLabelText(`What is ${property}?`) as HTMLSelectElement;
}

function importButton() {
  return screen.getByRole("button", {
    name: /^Import \d+ cards$/,
  }) as HTMLButtonElement;
}

describe("#248: a .vcf cannot import past a property nobody has answered", () => {
  it("VD-1: stops on the two properties a card can say do-not-text in", async () => {
    await choose(BOOK);

    await screen.findByText(/on these cards/);
    expect(screen.getByText("CATEGORIES")).toBeTruthy();
    expect(screen.getByText("NOTE")).toBeTruthy();
    expect(vcardMutate).not.toHaveBeenCalled();
    expect(importButton().disabled).toBe(true);
  });

  it("VD-2: shows what each property SAYS on these cards", async () => {
    await choose(BOOK);
    await screen.findByText(/on these cards/);

    // The values are the whole design. A person who cannot see "DNC" cannot
    // skip it knowingly, and then the click is theatre. And the note is a
    // sentence: nothing here truncates a decision to a token.
    expect(screen.getByText(/“DNC”/)).toBeTruthy();
    expect(
      screen.getByText(/“DO NOT CONTACT - asked us to stop”/),
    ).toBeTruthy();
  });

  it("VD-3: pre-answers nothing", async () => {
    // Unlike the CSV wizard, where a header spelled `Phone` is a guess worth
    // making on somebody's behalf, `NOTE` is house-keeping on most cards and a
    // revocation on the one that matters. This product may not pick.
    await choose(BOOK);
    await screen.findByText(/on these cards/);

    expect(propertySelect("NOTE").value).toBe("");
    expect(propertySelect("CATEGORIES").value).toBe("");
    expect(propertySelect("ORG").value).toBe("");
  });

  it("VD-4: never asks about a property it reads", async () => {
    await choose(BOOK);
    await screen.findByText(/on these cards/);

    expect(screen.queryByLabelText("What is TEL?")).toBeNull();
    expect(screen.queryByLabelText("What is FN?")).toBeNull();
    expect(screen.queryByLabelText("What is VERSION?")).toBeNull();
  });

  it("VD-5: posts the file and a declaration for every unread property", async () => {
    await choose(BOOK);
    await screen.findByText(/on these cards/);

    fireEvent.change(propertySelect("CATEGORIES"), {
      target: { value: "opted_out" },
    });
    fireEvent.change(propertySelect("NOTE"), { target: { value: "opted_out" } });
    fireEvent.change(propertySelect("ORG"), {
      target: { value: CONTACT_IMPORT_IGNORE },
    });
    // The parameter on the TEL lines is a question too, and it is the one this
    // client used to skip: TEL is mapped, so the line was read for its number
    // and `TYPE=CELL` — the same slot Apple writes `X-ABLabel=DO NOT CALL` in —
    // was never enumerated. The server counts it, so a declaration without it
    // is refused, and the refusal would arrive after the upload.
    fireEvent.change(propertySelect(vcardParameterProperty("TEL", "TYPE")), {
      target: { value: CONTACT_IMPORT_IGNORE },
    });
    await waitFor(() => expect(importButton().disabled).toBe(false));
    fireEvent.click(importButton());

    expect(vcardMutate).toHaveBeenCalledTimes(1);
    const request = vcardMutate.mock.calls[0][0] as {
      file: File;
      consentAttested: boolean;
      properties: VCardPropertyDeclaration[];
    };
    expect(request.consentAttested).toBe(true);
    expect(await request.file.text()).toBe(BOOK);
    expect(request.properties.map(formatVCardProperty).sort()).toEqual([
      "CATEGORIES:opted_out",
      "NOTE:opted_out",
      `ORG:${CONTACT_IMPORT_IGNORE}`,
      `${vcardParameterProperty("TEL", "TYPE")}:${CONTACT_IMPORT_IGNORE}`,
    ]);
  });

  it("VD-10: asks about the label on a TEL line, and can block those cards", async () => {
    // Apple's inline shape. The grouped `item1.X-ABLabel:` form was always
    // caught, which is exactly what made this one look covered — and it is not
    // an exotic file, it is what an iPhone exports when somebody has labelled a
    // number. Nothing about the mapped property TEL may exempt the free text
    // written beside it.
    await choose(
      [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "FN:Ann Rivera",
        "TEL;TYPE=CELL;X-ABLabel=DO NOT CALL:+16135550100",
        "END:VCARD",
        "BEGIN:VCARD",
        "VERSION:3.0",
        "FN:Bo Tran",
        "TEL;TYPE=HOME:+16135550101",
        "END:VCARD",
      ].join("\r\n"),
    );
    await screen.findByText(/on these cards/);

    const label = vcardParameterProperty("TEL", "X-ABLABEL");
    // On screen with its own text, not the phone number beside it.
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText(/“DO NOT CALL”/)).toBeTruthy();

    fireEvent.change(propertySelect(label), {
      target: { value: "opted_out" },
    });
    fireEvent.change(propertySelect(vcardParameterProperty("TEL", "TYPE")), {
      target: { value: CONTACT_IMPORT_IGNORE },
    });
    await waitFor(() => expect(importButton().disabled).toBe(false));
    fireEvent.click(importButton());

    const request = vcardMutate.mock.calls[0][0] as {
      properties: VCardPropertyDeclaration[];
    };
    expect(request.properties.map(formatVCardProperty).sort()).toEqual([
      `${vcardParameterProperty("TEL", "TYPE")}:${CONTACT_IMPORT_IGNORE}`,
      `${label}:opted_out`,
    ]);
  });

  it("VD-6: one click answers the rest, with every value still on screen", async () => {
    // The bulk dismissal is allowed ONLY because the properties and their
    // values are rendered above it, which is what makes it an informed click.
    await choose(BOOK);
    await screen.findByText(/on these cards/);
    const bulk = screen.getByRole("button", {
      name: /None of these say who can be texted/,
    });
    expect(screen.getByText(/“DNC”/)).toBeTruthy();

    fireEvent.click(bulk);

    await waitFor(() => expect(importButton().disabled).toBe(false));
    expect(propertySelect("CATEGORIES").value).toBe(CONTACT_IMPORT_IGNORE);
  });

  it("VD-7: the bulk answer never overwrites one somebody gave", async () => {
    await choose(BOOK);
    await screen.findByText(/on these cards/);
    fireEvent.change(propertySelect("CATEGORIES"), {
      target: { value: "opted_out" },
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /None of these say who can be texted/,
      }),
    );

    await waitFor(() =>
      expect(propertySelect("ORG").value).toBe(CONTACT_IMPORT_IGNORE),
    );
    expect(propertySelect("CATEGORIES").value).toBe("opted_out");
  });

  it("VD-8: imports straight away when the cards carry nothing we don't read", async () => {
    // A question with no content is the kind of gate people learn to click
    // through, and the one it has to survive is the fourth import.
    await choose(
      [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "FN:Ann Rivera",
        "TEL:+12065550100",
        "END:VCARD",
      ].join("\r\n"),
    );

    await waitFor(() => expect(vcardMutate).toHaveBeenCalledTimes(1));
    const request = vcardMutate.mock.calls[0][0] as {
      properties: unknown[];
    };
    expect(request.properties).toEqual([]);
  });

  it("VD-9: asks again about the next file's properties", async () => {
    // An answer about `X-STATUS` in one export says nothing about `X-STATUS` in
    // the next. Carrying it over would mean somebody clears a property once and
    // every later file walks past the gate.
    await choose(BOOK);
    await screen.findByText(/on these cards/);
    fireEvent.click(
      screen.getByRole("button", {
        name: /None of these say who can be texted/,
      }),
    );
    await waitFor(() => expect(importButton().disabled).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByText("Import from a vCard");
    fireEvent.click(screen.getByLabelText(IMPORT_CONSENT_LABEL.file));
    fireEvent.change(screen.getByLabelText("vCard file"), {
      target: {
        files: [
          new File(
            [
              "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ann\r\nTEL:+12065550100\r\n" +
                "X-STATUS:DO NOT CALL\r\nEND:VCARD",
            ],
            "second.vcf",
            { type: "text/vcard" },
          ),
        ],
      },
    });

    await screen.findByText("X-STATUS");
    expect(propertySelect("X-STATUS").value).toBe("");
    expect(importButton().disabled).toBe(true);
    expect(vcardMutate).not.toHaveBeenCalled();
  });
});
