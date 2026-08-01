import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * #502 — a permission the app asks for must appear in the declaration filed for
 * it.
 *
 * # The failure this is built from
 *
 * `docs/RELEASING.md` opens its store checklist with the reason: a wrong
 * declaration does not fail at submission, it gets the app pulled weeks later in
 * a review sweep, which for a business phone line is an outage for every mobile
 * customer at once with no engineering fix available.
 *
 * #459 added `NSContactsUsageDescription` to `apps/ios/project.yml` and shipped.
 * Both store files still carried "Last reconciled with the code: 2026-07-26",
 * `privacy-nutrition.md` still listed two purpose strings under the heading
 * "These are the exact strings", and `DATA-INVENTORY.md` — the document both
 * forms are filled from — still said flatly "No contacts permission on iOS."
 * Nobody was careless. The checklist that would have caught it runs at release
 * time, by hand, and the commit that broke it touched none of those files.
 *
 * `inventory-agreement.test.ts` is the same idea for sub-processors, written
 * after that rule was broken twice. This is the permissions half.
 *
 * # What it can and cannot do
 *
 * It checks that every permission and purpose string actually shipped is NAMED
 * in the declaration filed for it. It cannot read the prose and judge whether
 * the justification is honest — that is a human reading. What it catches is the
 * mechanical failure that has actually happened: a permission added in one place
 * and declared in none.
 *
 * The roster below is the point rather than an implementation detail. Adding a
 * permission means adding a line here, which is the moment somebody has to ask
 * what the store form now says.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const read = (...parts: string[]) => readFileSync(join(REPO, ...parts), "utf8");

const IOS_PROJECT = read("apps", "ios", "project.yml");
const ANDROID_MANIFEST = read(
  "apps",
  "android",
  "app",
  "src",
  "main",
  "AndroidManifest.xml",
);
const IOS_DECLARATION = read("apps", "ios", "store", "privacy-nutrition.md");
const ANDROID_DECLARATION = read("apps", "android", "store", "data-safety.md");
const INVENTORY = read("docs", "DATA-INVENTORY.md");

/**
 * Permissions that are plumbing rather than a declaration: they gate no personal
 * data, and neither store asks about them. Everything else must be named.
 */
const ANDROID_UNDECLARED = new Set([
  "INTERNET",
  "ACCESS_NETWORK_STATE",
  "WAKE_LOCK",
  "VIBRATE",
  "FOREGROUND_SERVICE",
  "READ_SYNC_SETTINGS",
  "WRITE_SYNC_SETTINGS",
]);

function iosPurposeStrings(): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  // `INFOPLIST_KEY_NSFooUsageDescription: "…"` — the only shape project.yml uses.
  const pattern = /INFOPLIST_KEY_(NS\w*UsageDescription):\s*"([^"]*)"/g;
  for (const match of IOS_PROJECT.matchAll(pattern)) {
    out.push({ key: match[1], value: match[2] });
  }
  return out;
}

function androidPermissions(): string[] {
  const pattern = /android:name="android\.permission\.([A-Z_]+)"/g;
  const all = [...ANDROID_MANIFEST.matchAll(pattern)].map((m) => m[1]);
  return [...new Set(all)].filter((name) => !ANDROID_UNDECLARED.has(name));
}

describe("#502 iOS purpose strings are declared", () => {
  it("finds the strings at all, so a rename cannot make this vacuous", () => {
    // A guard that silently matches nothing is worse than no guard: it reports
    // success forever. If project.yml stops using INFOPLIST_KEY_, this fails
    // here rather than passing everything below.
    expect(iosPurposeStrings().length).toBeGreaterThanOrEqual(3);
  });

  it("names every shipped purpose string in the App Privacy file", () => {
    const missing = iosPurposeStrings()
      .filter(({ key }) => !IOS_DECLARATION.includes(key))
      .map(({ key }) => key);
    expect(
      missing,
      `\n\napps/ios/project.yml ships a purpose string that\n` +
        `apps/ios/store/privacy-nutrition.md does not mention:\n  ${missing.join("\n  ")}\n\n` +
        `That file is what App Store Connect's App Privacy section is filled\n` +
        `from, and App Review checks purpose strings specifically.\n`,
    ).toEqual([]);
  });

  it("quotes each string verbatim, because a paraphrase is a different promise", () => {
    // The file says "These are the exact strings; change them there, not here."
    // A drifted quote means the founder files words the app never shows.
    const drifted = iosPurposeStrings()
      .filter(({ value }) => !IOS_DECLARATION.includes(value))
      .map(({ key }) => key);
    expect(
      drifted,
      `\n\nThe string filed for these keys is not the string the app shows:\n  ` +
        `${drifted.join("\n  ")}\n`,
    ).toEqual([]);
  });
});

describe("#502 Android permissions are declared", () => {
  it("finds the permissions at all", () => {
    expect(androidPermissions().length).toBeGreaterThanOrEqual(8);
  });

  it("names every declarable permission in the Data safety file", () => {
    const missing = androidPermissions().filter(
      (name) => !ANDROID_DECLARATION.includes(name),
    );
    expect(
      missing,
      `\n\nAndroidManifest.xml requests a permission that\n` +
        `apps/android/store/data-safety.md does not mention:\n  ${missing.join("\n  ")}\n\n` +
        `Play requires a justification covering every use of a sensitive\n` +
        `permission. If this one genuinely needs no declaration, add it to\n` +
        `ANDROID_UNDECLARED above and say why.\n`,
    ).toEqual([]);
  });

  it("names every declarable permission in the inventory both forms come from", () => {
    const missing = androidPermissions().filter(
      (name) => !INVENTORY.includes(name),
    );
    expect(missing, `docs/DATA-INVENTORY.md is missing: ${missing.join(", ")}`).toEqual(
      [],
    );
  });
});

describe("#502 the deletion promises still have something behind them", () => {
  /**
   * Checklist items 5 and 6 of `docs/RELEASING.md`, which are mechanical and
   * were therefore being done by hand. Apple 5.1.1(v) requires in-app account
   * deletion; Play files the deletion URL, so a rename breaks the declaration
   * silently on a page nobody visits.
   */
  const surfaces: [string, string[]][] = [
    ["iOS", ["apps", "ios", "Loonext", "Features", "Settings", "DeleteAccountCard.swift"]],
    [
      "Android",
      [
        "apps",
        "android",
        "app",
        "src",
        "main",
        "kotlin",
        "com",
        "loonext",
        "android",
        "features",
        "settings",
        "DeleteAccountCard.kt",
      ],
    ],
    ["web", ["apps", "web", "src", "components", "settings", "delete-account-card.tsx"]],
    [
      "the filed deletion URL",
      ["apps", "web", "src", "app", "(marketing)", "legal", "delete-my-data", "page.tsx"],
    ],
  ];

  it.each(surfaces)("%s still has one", (label, parts) => {
    expect(() => read(...parts), `${label}: ${parts.join("/")} is gone`).not.toThrow();
  });
});

describe("#502 the inventory does not deny what the code does", () => {
  it("no longer claims iOS asks for no contacts permission", () => {
    // The literal sentence #502 found. It was true until #459 shipped, which is
    // exactly what made it easy to leave in place.
    expect(
      INVENTORY,
      "docs/DATA-INVENTORY.md still says iOS has no contacts permission, but " +
        "apps/ios/project.yml declares NSContactsUsageDescription.",
    ).not.toMatch(/No contacts permission on iOS/i);
  });

  it("both declarations record when they were last checked against the code", () => {
    for (const [label, source] of [
      ["apps/ios/store/privacy-nutrition.md", IOS_DECLARATION],
      ["apps/android/store/data-safety.md", ANDROID_DECLARATION],
    ] as const) {
      expect(
        source,
        `${label} has no "Last reconciled with the code" date. That date is how ` +
          `a reviewer knows whether to trust the file.`,
      ).toMatch(/Last reconciled with the code:\*{0,2}\s*\d{4}-\d{2}-\d{2}/);
    }
  });
});
