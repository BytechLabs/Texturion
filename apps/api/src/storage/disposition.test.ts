/**
 * #317 — the disposition rule, and the roster of everyone who mints a signed URL.
 *
 * The unit tests below pin the rule. The enumeration after them is the part that
 * keeps working after this issue is closed: it walks the source tree, finds every
 * `createSignedUrl` call, and fails if one of them does not go through
 * `dispositionOptions` and is not a declared exception with a reason.
 *
 * That check exists because the bug was not "the rule is wrong" — there was no
 * rule. Five call sites each had an implicit answer, and four of them were
 * "whatever the browser feels like", including the one that hands out inbound MMS
 * files from strangers. A sixth is one `git commit` away at any time.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { dispositionOptions, INLINE_AUDIO_TYPES, rendersInlineSafely } from "./disposition";

describe("#317 dispositionOptions", () => {
  it("leaves the allow-listed image types inline", () => {
    // The thread renders these with <img src>; a download would replace looking
    // at a photo of a broken furnace with a file-save dialog.
    for (const type of [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/heic",
      "image/heif",
    ]) {
      expect(dispositionOptions(type), type).toEqual({ download: false });
    }
  });

  it("leaves our own voicemail audio inline, so the play button stays a play button", () => {
    for (const type of INLINE_AUDIO_TYPES) {
      expect(dispositionOptions(type), type).toEqual({ download: false });
    }
  });

  it("forces a download for every document type — including the ZIP containers", () => {
    // The formats the issue is really about. A .docx and an .odt are ZIP
    // archives, and the allow-list has to admit them because customers send
    // them.
    for (const type of [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.oasis.opendocument.text",
      "application/vnd.oasis.opendocument.spreadsheet",
      "text/csv",
      "text/plain",
    ]) {
      expect(dispositionOptions(type), type).toEqual({ download: true });
    }
  });

  it("forces a download for SVG, the image format that actually executes", () => {
    // The reason images can be inline at all is that SVG is NOT in the
    // allow-list. If it ever gets added, this assertion is what makes the
    // consequence visible instead of silent.
    expect(dispositionOptions("image/svg+xml")).toEqual({ download: true });
    expect(dispositionOptions("image/svg+xml; charset=utf-8")).toEqual({
      download: true,
    });
  });

  it("forces a download for an absent, null, or unrecognised type", () => {
    // Fails toward safety. A legacy row with no content_type gets a download
    // rather than whatever the browser decides to do with unknown bytes.
    for (const type of [
      undefined,
      null,
      "",
      "   ",
      "application/octet-stream",
      "text/html",
      "application/x-msdownload",
    ]) {
      expect(dispositionOptions(type), JSON.stringify(type)).toEqual({
        download: true,
      });
    }
  });

  it("does not turn an absent type into a 500", () => {
    // A row that simply lacks the column reads as `undefined`, and an unguarded
    // `.trim()` on that threw — which turned a signed-URL mint into a 500 for
    // exactly the legacy rows this rule is supposed to protect.
    expect(() => rendersInlineSafely(undefined)).not.toThrow();
    expect(() => rendersInlineSafely(null)).not.toThrow();
  });

  it("tolerates the casing and padding a stored header actually arrives with", () => {
    expect(dispositionOptions(" IMAGE/JPEG ")).toEqual({ download: false });
    expect(dispositionOptions("Application/PDF")).toEqual({ download: true });
  });
});

describe("#317 every signed-URL mint decides its disposition", () => {
  /**
   * Mint sites that deliberately do NOT set a disposition, and why.
   *
   * A file here must still exist and must still mint, or the exception is stale
   * and gets removed — an exception nobody can see is how the original bug spread
   * to four call sites.
   */
  const DECLARED_EXCEPTIONS: Record<string, string> = {
    "messaging/media.ts":
      "Outbound MMS media, fetched by TELNYX and the carrier — never by a " +
      "browser. Content-Disposition means nothing to a machine fetcher, and " +
      "sending one to a carrier's media pipeline is a change with no upside.",
    "calls/runtime.ts":
      "#309 recorded voicemail greetings, fetched by TELNYX to play down a " +
      "phone line — never opened in a browser. Same reasoning as the MMS " +
      "media above: a Content-Disposition header means nothing to a machine " +
      "fetcher. The URL is minted at play time and expires in five minutes, " +
      "so it is not a link anybody can hold on to and open later either.",
  };

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        out.push(...sourceFiles(full));
      } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
        out.push(full);
      }
    }
    return out;
  }

  const SRC = join(import.meta.dirname, "..");

  /** Every non-test file that mints a signed URL, keyed by its path under src/. */
  function mintSites(): Map<string, string> {
    const sites = new Map<string, string>();
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      if (!/\.createSignedUrls?\(/.test(text)) continue;
      const rel = file.slice(SRC.length + 1).split("\\").join("/");
      sites.set(rel, text);
    }
    return sites;
  }

  it("finds the mint sites at all, so a passing run means something", () => {
    // A regex that silently matches nothing would make every assertion below
    // vacuous, which is the failure mode of every filesystem-derived check.
    const sites = mintSites();
    expect(sites.size).toBeGreaterThanOrEqual(5);
    expect([...sites.keys()]).toContain("routes/attachments.ts");
  });

  it("routes every browser-facing mint through the one resolver", () => {
    const offenders: string[] = [];
    for (const [rel, text] of mintSites()) {
      if (rel === "storage/disposition.ts") continue;
      if (rel in DECLARED_EXCEPTIONS) continue;
      if (!text.includes("dispositionOptions(")) offenders.push(rel);
    }
    expect(
      offenders,
      `These mint a signed URL without deciding its disposition (#317). Either ` +
        `pass dispositionOptions(contentType), or add the file to ` +
        `DECLARED_EXCEPTIONS in this test with the reason a browser will never ` +
        `open the bytes:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("keeps no stale exceptions", () => {
    const sites = mintSites();
    for (const rel of Object.keys(DECLARED_EXCEPTIONS)) {
      expect(
        sites.has(rel),
        `${rel} is excused from #317 and no longer mints a signed URL. Remove ` +
          `the exception.`,
      ).toBe(true);
    }
  });

  it("gives every exception a reason worth reading", () => {
    for (const [rel, reason] of Object.entries(DECLARED_EXCEPTIONS)) {
      expect(reason.length, rel).toBeGreaterThan(60);
    }
  });
});
