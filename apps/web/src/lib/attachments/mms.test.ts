/**
 * Client-side MMS validation matrix (#189): the type/size/count gate the text
 * composers run BEFORE any bytes leave the browser, mirroring the API's
 * outbound rules. Pure functions — no React, no network.
 */
import { describe, expect, it } from "vitest";

import {
  MMS_ACCEPT,
  MMS_MAX_MEDIA_BYTES,
  MMS_MAX_MEDIA_ITEMS,
  partitionMmsFiles,
  validateMmsFile,
} from "./mms";

import { EN as WEB_EN, FR_CA as WEB_FR } from "@/i18n/catalog";

/** #228 — the module names keys now, so the tests resolve them. */
function resolver(table: unknown) {
  return (key: string, vars: Record<string, string> = {}): string => {
    const [section, name] = key.split(".");
    const text = (table as Record<string, Record<string, string>>)[section]?.[name];
    if (typeof text !== "string") throw new Error(`no entry for ${key}`);
    return Object.entries(vars).reduce(
      (out, [token, value]) => out.split(`{${token}}`).join(value),
      text,
    );
  };
}

const sayEn = resolver(WEB_EN);
const sayFr = resolver(WEB_FR);

const jpeg = { name: "site.jpg", type: "image/jpeg", size: 500_000 };

describe("validateMmsFile", () => {
  it("admits a deliverable file and resolves its send type", () => {
    const check = validateMmsFile(jpeg, 0, sayEn);
    expect(check).toEqual({ ok: true, contentType: "image/jpeg" });
  });

  it("resolves the send type from the extension when the OS reports none", () => {
    const check = validateMmsFile({ name: "Sam Rivera.vcf", type: "", size: 900 }, 0, sayEn);
    expect(check).toEqual({ ok: true, contentType: "text/vcard" });
  });

  it("canonicalizes vendor MIME spellings (audio/x-m4a → audio/mp4)", () => {
    const check = validateMmsFile({
      name: "voicenote.m4a",
      type: "audio/x-m4a",
      size: 40_000,
    }, 0, sayEn);
    expect(check).toEqual({ ok: true, contentType: "audio/mp4" });
  });

  it("rejects an undeliverable type with the file's name in the copy", () => {
    const check = validateMmsFile({
      name: "backup.zip",
      type: "application/zip",
      size: 1000,
    }, 0, sayEn);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toContain('"backup.zip"');
      expect(check.reason).toContain("can carry");
    }
  });

  it("rejects SVG (matches the API: active document, never deliverable)", () => {
    const check = validateMmsFile({
      name: "logo.svg",
      type: "image/svg+xml",
      size: 1000,
    }, 0, sayEn);
    expect(check.ok).toBe(false);
  });

  it("rejects an empty file", () => {
    const check = validateMmsFile({ name: "note.txt", type: "text/plain", size: 0 }, 0, sayEn);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("empty");
  });

  it("rejects a file over the 1 MB carrier ceiling", () => {
    const check = validateMmsFile({
      name: "clip.mp4",
      type: "video/mp4",
      size: MMS_MAX_MEDIA_BYTES + 1,
    }, 0, sayEn);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("1 MB");
  });

  it("admits a file exactly at the ceiling", () => {
    const check = validateMmsFile({
      name: "clip.mp4",
      type: "video/mp4",
      size: MMS_MAX_MEDIA_BYTES,
    }, 0, sayEn);
    expect(check.ok).toBe(true);
  });

  it("rejects past the item cap", () => {
    const check = validateMmsFile(jpeg, MMS_MAX_MEDIA_ITEMS, sayEn);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain(`${MMS_MAX_MEDIA_ITEMS}`);
  });
});

describe("partitionMmsFiles", () => {
  it("admits up to the cap and rejects the tail with the cap sentence", () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      name: `photo-${i}.jpg`,
      type: "image/jpeg",
      size: 1000,
    }));
    const { accepted, rejected } = partitionMmsFiles(files, 0, sayEn);
    expect(accepted).toHaveLength(MMS_MAX_MEDIA_ITEMS);
    expect(rejected).toHaveLength(5 - MMS_MAX_MEDIA_ITEMS);
    expect(rejected[0].reason).toContain("up to");
  });

  it("counts already-staged items toward the cap", () => {
    const { accepted, rejected } = partitionMmsFiles([jpeg, jpeg], 2, sayEn);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it("keeps admitting valid files after a rejection", () => {
    const { accepted, rejected } = partitionMmsFiles([
      { name: "logo.svg", type: "image/svg+xml", size: 1000 },
      { name: "quote.pdf", type: "application/pdf", size: 1000 },
    ], 0, sayEn);
    expect(accepted.map((a) => a.contentType)).toEqual(["application/pdf"]);
    expect(rejected).toHaveLength(1);
  });
});

describe("MMS_ACCEPT", () => {
  it("offers the deliverable MIME set plus the empty-type extensions", () => {
    expect(MMS_ACCEPT).toContain("image/jpeg");
    expect(MMS_ACCEPT).toContain("video/mp4");
    expect(MMS_ACCEPT).toContain("text/vcard");
    expect(MMS_ACCEPT).toContain(".vcf");
    expect(MMS_ACCEPT).toContain(".amr");
    expect(MMS_ACCEPT).not.toContain("image/svg");
  });
});

describe("#228 why a file was refused, in French", () => {
  it("names the file inside the sentence rather than in front of it", () => {
    // The name is a variable on all three clients for this reason: the
    // subject is not where every language starts, and a sentence built by
    // gluing the name to the front cannot be reordered by a translator.
    const check = validateMmsFile({ name: "devis.pdf", type: "", size: 0 }, 0, sayFr);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toContain("devis.pdf");
    expect(check.reason).toContain("est vide");
    expect(check.reason).not.toMatch(/\{/);
  });

  it("falls back to a translated 'that file' when the OS reports no name", () => {
    // The unnamed case is the one that would betray a hardcoded English
    // fallback, because nothing else in the sentence is English.
    const check = validateMmsFile({ name: "", type: "", size: 0 }, 0, sayFr);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toContain("Ce fichier");
    expect(check.reason).not.toContain("That file");
  });

  it("still says the limit and the size ceiling", () => {
    const tooMany = validateMmsFile(jpeg, MMS_MAX_MEDIA_ITEMS, sayFr);
    expect(tooMany.ok).toBe(false);
    if (tooMany.ok) return;
    expect(tooMany.reason).toContain(String(MMS_MAX_MEDIA_ITEMS));

    const tooBig = validateMmsFile(
      { name: "clip.mp4", type: "video/mp4", size: MMS_MAX_MEDIA_BYTES + 1 },
      0,
      sayFr,
    );
    expect(tooBig.ok).toBe(false);
    if (tooBig.ok) return;
    expect(tooBig.reason).toContain("1 Mo");
  });

  it("resolves every refusal in both languages", () => {
    // A missing key fails here rather than rendering its own name under
    // somebody's draft.
    const cases = [
      [{ name: "a.jpg", type: "image/jpeg", size: 10 }, MMS_MAX_MEDIA_ITEMS],
      [{ name: "a.exe", type: "application/x-msdownload", size: 10 }, 0],
      [{ name: "a.jpg", type: "image/jpeg", size: 0 }, 0],
      [{ name: "a.jpg", type: "image/jpeg", size: MMS_MAX_MEDIA_BYTES + 1 }, 0],
    ] as const;
    for (const say of [sayEn, sayFr]) {
      for (const [file, count] of cases) {
        const check = validateMmsFile(file, count, say);
        expect(check.ok, JSON.stringify(file)).toBe(false);
        if (check.ok) continue;
        expect(check.reason).not.toContain("thread.");
        expect(check.reason).not.toMatch(/\{/);
      }
    }
  });
});
