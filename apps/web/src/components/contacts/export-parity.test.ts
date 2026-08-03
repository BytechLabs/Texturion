/**
 * #304 — taking data out is a WEB-ONLY surface, on purpose.
 *
 * Every other customer-facing thing in this product exists on all three
 * clients, and this file is here so that this one exception is a decision
 * somebody can read rather than an omission somebody assumes.
 *
 * ── WHY WEB ONLY ──────────────────────────────────────────────────────────
 *
 * #304 is titled "the BACK OFFICE cannot get its data out". The three readers
 * it names — a bookkeeper reconciling to an invoice, a lawyer or adjuster who
 * needs a document, an owner doing their own analysis in a spreadsheet — are
 * all sitting at a desk, and the artifact is a file they open in something
 * else. None of that is work done from a van.
 *
 * The #227 workspace dump made the same call before this and made it silently:
 * `export-data-card.tsx` has no Kotlin or Swift counterpart and nothing said
 * why. This file is that decision, written down late but written down.
 *
 * ── WHAT WOULD CHANGE IT ──────────────────────────────────────────────────
 *
 * Starting an export is asynchronous, so a phone COULD start one and a laptop
 * collect it. The reason not to is the other half: there is no collection
 * surface on the phones either — no list of recent exports, no signed
 * download. Shipping "start" without "collect" is the half that generates the
 * support question rather than answering it.
 *
 * So the rule is both halves or neither. If the phones ever get the list, this
 * test is what should fail, and the fix is to build the button beside it — not
 * to delete this file.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parityCode } from "./parity-source";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const ANDROID_SRC = join(
  REPO_ROOT,
  "apps/android/app/src/main/kotlin/com/loonext/android",
);
const IOS_SRC = join(REPO_ROOT, "apps/ios/Loonext");

/** Every source file under a client, so a new one cannot hide. */
function sources(dir: string, extension: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(extension))
    .map((name) => join(dir, name));
}

describe("#304 the export surface is web-only, deliberately", () => {
  it("EP-1: web has both halves — request one, and collect it", () => {
    // The pair that makes the feature whole. If either of these moves, the
    // paths below are wrong and the assertions about the phones are measuring
    // nothing.
    const request = parityCode(
      join(REPO_ROOT, "apps/web/src/components/contacts/export-history.tsx"),
    );
    const collect = parityCode(
      join(REPO_ROOT, "apps/web/src/components/settings/export-data-card.tsx"),
    );
    expect(request).toContain("export function ExportHistory");
    expect(collect.length).toBeGreaterThan(500);
  });

  it("EP-2: neither phone calls an export endpoint", () => {
    // Both halves or neither. A phone that can START an export it cannot
    // COLLECT is the half that generates the support question.
    const offenders: string[] = [];
    for (const [platform, files] of [
      ["android", sources(ANDROID_SRC, ".kt")],
      ["ios", sources(IOS_SRC, ".swift")],
    ] as const) {
      for (const path of files) {
        if (/["'`]\/v1\/exports/.test(parityCode(path))) {
          offenders.push(`${platform}: ${path.slice(REPO_ROOT.length)}`);
        }
      }
    }
    expect(
      offenders,
      "A phone now calls an export endpoint. If that is intended, it needs " +
        "the collection surface too — a list of recent exports with a signed " +
        "download — and this test should be replaced by one asserting BOTH " +
        "halves exist, not deleted:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("EP-3: reads both clients, so a passing run means something", () => {
    // The failure this whole family of guards exists to catch: a scan that
    // walks nothing reports success forever.
    expect(sources(ANDROID_SRC, ".kt").length).toBeGreaterThan(50);
    expect(sources(IOS_SRC, ".swift").length).toBeGreaterThan(50);
  });
});
