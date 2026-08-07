import { describe, expect, it } from "vitest";

import {
  CONTACT_IMPORT_CONSENT_REFUSED_NOTE,
  contactImportConsentRefusedReason,
} from "@loonext/shared";

import type { ImportResult } from "@/lib/api/types";

import { csvEscape } from "./csv-import";
import {
  consentRefusalsCsv,
  summarizeConsentRefusals,
  summarizeImport,
} from "./import-summary";

function result(over: Partial<ImportResult>): ImportResult {
  return { imported: 0, updated: 0, skipped: 0, errors: [], ...over };
}

describe("summarizeImport (D20 §3.2/§3.3 import summary)", () => {
  it("renders the imported/updated/skipped headline", () => {
    const summary = summarizeImport(
      result({ imported: 3, updated: 1, skipped: 2 }),
    );
    expect(summary.headline).toBe("3 new, 1 updated, 2 skipped.");
  });

  it("reports no errors for a clean import", () => {
    const summary = summarizeImport(result({ imported: 5 }));
    expect(summary.hasErrors).toBe(false);
    expect(summary.visibleErrors).toEqual([]);
    expect(summary.hiddenErrorCount).toBe(0);
  });

  it("surfaces each skipped row with its reason", () => {
    const errors = [
      { row: 1, reason: "invalid phone: (empty)" },
      { row: 4, reason: "duplicate phone in file: +14165550100" },
    ];
    const summary = summarizeImport(
      result({ imported: 2, skipped: 2, errors }),
    );
    expect(summary.hasErrors).toBe(true);
    expect(summary.visibleErrors).toEqual(errors);
    expect(summary.hiddenErrorCount).toBe(0);
  });

  it("caps the visible error list and counts the overflow", () => {
    const errors = Array.from({ length: 7 }, (_, i) => ({
      row: i + 1,
      reason: `invalid phone: bad-${i}`,
    }));
    const summary = summarizeImport(result({ skipped: 7, errors }), 5);
    expect(summary.visibleErrors).toHaveLength(5);
    expect(summary.hiddenErrorCount).toBe(2);
    expect(summary.visibleErrors[0]).toEqual({
      row: 1,
      reason: "invalid phone: bad-0",
    });
  });
});

/**
 * #248 — the half of the response that says what the attestation did NOT cover.
 *
 * Every assertion reads the shipped constant. A test carrying its own copy of
 * the refusal sentence passes while the server and the client disagree about
 * what the workspace was told, and being told is the entire feature.
 */
const STOPPED = "+14163014444";

function refusal(row: number, phone = STOPPED) {
  return { row, reason: contactImportConsentRefusedReason(phone) };
}

describe("summarizeConsentRefusals (#248)", () => {
  it("CR-1: reports the server's count and the server's sentence", () => {
    const summary = summarizeConsentRefusals(
      result({
        imported: 4,
        consent_refused: 1,
        consent_refusals: [refusal(3)],
        consent_refused_note: CONTACT_IMPORT_CONSENT_REFUSED_NOTE,
      }),
    );

    expect(summary.count).toBe(1);
    expect(summary.note).toBe(CONTACT_IMPORT_CONSENT_REFUSED_NOTE);
    expect(summary.visible).toEqual([refusal(3)]);
    expect(summary.hiddenCount).toBe(0);
  });

  it("CR-2: survives an API that predates the fields", () => {
    // web and api are separate Workers on separate rollout clocks, so for the
    // length of a deploy this client can get a response with none of the three.
    // Reading `.length` off the missing list would throw on an import that
    // otherwise succeeded — a broken summary over a finished write, which is
    // the worst moment in this flow to lose the dialog.
    const summary = summarizeConsentRefusals(result({ imported: 4 }));

    expect(summary.count).toBe(0);
    expect(summary.note).toBeNull();
    expect(summary.visible).toEqual([]);
    expect(summary.hiddenCount).toBe(0);
  });

  it("CR-3b: says so when the count and the list disagree", () => {
    // The two halves of the same answer come from one array on the server
    // today. If they ever stop agreeing — a truncated list, a partial page —
    // this screen printed the big number over the short list and NO overflow
    // line, which reads as "those 40 are the 5 you can see". Overflow measured
    // against whichever half is larger is the only honest answer available
    // without inventing rows.
    const summary = summarizeConsentRefusals(
      result({ consent_refused: 40, consent_refusals: [refusal(2)] }),
    );

    expect(summary.count).toBe(40);
    expect(summary.visible).toHaveLength(1);
    expect(summary.hiddenCount).toBe(39);
  });

  it("CR-3: caps the visible list and counts the overflow", () => {
    const refusals = Array.from({ length: 7 }, (_, i) => refusal(i + 2));
    const summary = summarizeConsentRefusals(
      result({ consent_refused: 7, consent_refusals: refusals }),
      5,
    );

    expect(summary.visible).toHaveLength(5);
    expect(summary.hiddenCount).toBe(2);
    // The count stays the server's, not the length of what fits on screen.
    expect(summary.count).toBe(7);
  });

  it("CR-4: the downloadable list is every refusal, with its row", () => {
    const csv = consentRefusalsCsv([refusal(2), refusal(9, "+12125550100")]);

    // Escaped through the importer's own `csvEscape` rather than a quoting rule
    // retyped here: the shipped reason carries a comma, so a cell that went out
    // raw would split into two columns and hand back a file whose "reason"
    // column reads "already opted out" for everybody.
    expect(csv).toBe(
      [
        "row,reason",
        `2,${csvEscape(contactImportConsentRefusedReason(STOPPED))}`,
        `9,${csvEscape(contactImportConsentRefusedReason("+12125550100"))}`,
      ].join("\r\n"),
    );
    // And the escaping is doing work rather than passing the cell through: if
    // the shipped reason ever stopped containing a comma this guard would still
    // hold, but today it does, and that is why the raw form cannot be written.
    const raw = contactImportConsentRefusedReason(STOPPED);
    expect(csvEscape(raw)).not.toBe(raw);
  });
});
