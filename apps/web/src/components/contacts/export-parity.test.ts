/**
 * #304/#595 — taking data out, and the rule that decides which client gets it.
 *
 * ── WHAT THIS FILE USED TO SAY ────────────────────────────────────────────
 *
 * That exports are web-only on purpose, because the three readers #304 names —
 * a bookkeeper reconciling to an invoice, a lawyer who needs a document, an
 * owner in a spreadsheet — are all at a desk. It asserted that neither phone
 * called an export endpoint at all, and it wrote down the reason so the
 * omission was a decision rather than an accident.
 *
 * It also wrote down what would change it, and that is exactly what happened:
 *
 *   "Starting an export is asynchronous, so a phone COULD start one and a
 *   laptop collect it. The reason not to is the other half: there is no
 *   collection surface on the phones either. Shipping 'start' without
 *   'collect' is the half that generates the support question rather than
 *   answering it. So the rule is both halves or neither. If the phones ever
 *   get the list, this test is what should fail, and the fix is to build the
 *   button beside it — not to delete this file."
 *
 * #595 built both halves on both phones, this test failed, and this is the
 * replacement it asked for.
 *
 * ── WHAT IT SAYS NOW ──────────────────────────────────────────────────────
 *
 * The rule never was "web only". The rule is BOTH HALVES OR NEITHER, and it
 * now binds three clients instead of one. A client that can start an export it
 * cannot collect is the thing being prevented, on any platform.
 *
 * What the phones deliberately do NOT have is the other export kinds — the
 * workspace dump, one contact's history, and the task list. Those carry
 * customer data, are gated on `contacts.bulk`, and are still desk work. The
 * usage summary is the one that names no customer and answers to a person who
 * may hold no other capability at all, which is why it is the one that
 * travelled. That asymmetry is asserted below rather than left to be noticed.
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

/** Every export path a client's source mentions. */
function exportPaths(files: string[]): string[] {
  const found: string[] = [];
  for (const path of files) {
    for (const match of parityCode(path).matchAll(
      /["'`](\/v1\/exports[^"'`]*)/g,
    )) {
      found.push(match[1]);
    }
  }
  return found;
}

const PHONES = [
  ["android", () => sources(ANDROID_SRC, ".kt")],
  ["ios", () => sources(IOS_SRC, ".swift")],
] as const;

describe("#304/#595 an export is both halves, on every client that has one", () => {
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

  it.each(PHONES)(
    "EP-2: %s can collect everything it can start",
    (_name, list) => {
      const paths = exportPaths(list());
      // A client with no export surface at all is still a valid answer — that
      // is what both phones were until #595, and what a new client will be on
      // the day it is created. EP-4 is what stops this early return covering
      // for a walk that found nothing.
      if (paths.length === 0) return;

      expect(
        paths.some((path) => path === "/v1/exports"),
        "This client starts an export and never lists them. A phone that can " +
          "START an export it cannot COLLECT is the half that generates the " +
          "support question instead of answering it — build the list beside " +
          "the button. GET /v1/exports returns only the kinds the caller may " +
          "collect, so it needs no role logic of its own.\n  " +
          paths.join("\n  "),
      ).toBe(true);

      expect(
        paths.some((path) => path.startsWith("/v1/exports/")),
        "This client lists exports and can start none of them, so the screen " +
          "can only ever be empty.\n  " + paths.join("\n  "),
      ).toBe(true);
    },
  );

  it.each(PHONES)(
    "EP-3: %s carries only the export that names no customer",
    (_name, list) => {
      // The kinds that stayed at a desk. Each is gated on `contacts.bulk` and
      // each carries customer data; the usage summary is neither, which is the
      // whole reason it is the one a phone got. A phone growing one of these
      // is not a bug on its own — it is a decision that needs the argument in
      // this file's header rewritten, and this is what makes somebody rewrite
      // it rather than notice later.
      const desk = exportPaths(list()).filter(
        (path) => path === "/v1/exports/history" || path === "/v1/exports/tasks",
      );
      expect(
        desk,
        "A phone now starts an export carrying customer data. That is gated " +
          "on `contacts.bulk` rather than `billing.manage`, and the reasoning " +
          "above is about the usage summary specifically — rewrite it before " +
          "allowing this.",
      ).toEqual([]);
    },
  );

  it("EP-4: reads both clients, so a passing run means something", () => {
    // The failure this whole family of guards exists to catch: a scan that
    // walks nothing reports success forever. It matters more now than when
    // this file only asserted absence — EP-2 returns early on an empty list,
    // so a broken walk would read as "no export surface" rather than as an
    // error.
    expect(sources(ANDROID_SRC, ".kt").length).toBeGreaterThan(50);
    expect(sources(IOS_SRC, ".swift").length).toBeGreaterThan(50);
    // And that both phones really did get the usage half.
    for (const [, list] of PHONES) {
      expect(exportPaths(list())).toContain("/v1/exports/usage");
    }
  });
});

/**
 * #595 — the usage export card is mounted UNCONDITIONALLY on both phones, and
 * that is load-bearing rather than incidental.
 *
 * The card asks `billing.manage` for itself. A call site that ALSO asks —
 * `if (isOwner) UsageExportCard(scope)` — reads like belt and braces and is
 * neither: `isOwner` is `role == owner`, so it hides the card from the admin
 * and from the bookkeeper, who is the person the whole feature exists for. Both
 * phones have an `isOwner` in the very block this card is mounted in, one line
 * above it, so the mistake is one autocomplete away.
 *
 * A capability answered in two places is a capability that will be answered
 * differently in one of them. This is a text check, and it is the right shape
 * for this: it catches a branch being ADDED, which is exactly what a source
 * lint can see and a behavioural test on a client we cannot compile cannot.
 */
describe("#595 the usage export gate is asked once, at the card", () => {
  const MOUNTS = [
    [
      "android",
      "apps/android/app/src/main/kotlin/com/loonext/android/features/settings/UsageSection.kt",
      "UsageExportCard(scope)",
    ],
    [
      "ios",
      "apps/ios/Loonext/Features/Settings/UsageSection.swift",
      "UsageExportCard(scope: scope)",
    ],
  ] as const;

  it.each(MOUNTS)("EP-5: %s mounts it without a second opinion", (_name, file, mount) => {
    const lines = parityCode(join(REPO_ROOT, file)).split("\n");
    const at = lines.findIndex((line) => line.includes(mount));
    expect(
      at,
      `${file} no longer mounts the card as \`${mount}\`. If it moved, fix ` +
        "this guard — do not delete it; the whole point is that the mount " +
        "site stays unconditional.",
    ).toBeGreaterThanOrEqual(0);

    // The mount and the line it sits on. A conditional wrapping it is either
    // on the same line (`if (isOwner) UsageExportCard(...)`) or opens the line
    // before, so both are read.
    const suspect = `${lines[at - 1] ?? ""}\n${lines[at]}`;
    expect(
      /\bisOwner\b|\brole\b\s*[=!]=|canManage|isAdmin/.test(suspect),
      `The mount is wrapped in a role check:\n${suspect}\n\n` +
        "The card already asks `billing.manage` for itself. A role check here " +
        "hides it from the bookkeeper — the reader this export is for — and " +
        "every client test would stay green, because they render the card " +
        "directly rather than through the section.",
    ).toBe(false);
  });
});
