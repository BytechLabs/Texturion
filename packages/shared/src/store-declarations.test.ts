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
 * #243 — the customer-facing half of the same statement.
 *
 * The declarations and the inventory are internal documents; this is the one a
 * customer reads, and the three are one statement made three times. A path that
 * appears in two of them and not the third is the finding.
 */
const PRIVACY_POLICY = read(
  "apps",
  "web",
  "src",
  "app",
  "(marketing)",
  "legal",
  "privacy",
  "page.tsx",
)
  /*
   * COMMENTS STRIPPED, and this is not tidiness. The comments in that file
   * explain the disclosures by quoting them — "#243: connections and API keys
   * are outbound paths a workspace opens" sits directly above the paragraph
   * that says so. Matching raw source, deleting the whole customer-facing
   * paragraph left this test passing on the comment that survived it.
   */
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");

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

  /**
   * A file that exists is not a surface a customer can reach.
   *
   * Apple 5.1.1(v) is about REACHABILITY: the requirement is that somebody can
   * delete their account from inside the app, and both declarations tell a
   * reviewer the exact route (Settings, Account, Delete your account). The
   * check above passes on a `DeleteAccountCard` nobody renders, which is the
   * state a refactor leaves behind when it drops one call site: the file is
   * still in the tree, the declaration still promises the route, and the button
   * is gone from the app.
   */
  const mounts: [string, string[], RegExp][] = [
    [
      "iOS",
      ["apps", "ios", "Loonext", "Features", "Settings", "ProfileSection.swift"],
      /DeleteAccountCard\s*\(/,
    ],
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
        "ProfileSection.kt",
      ],
      /DeleteAccountCard\s*\(/,
    ],
    [
      "web",
      ["apps", "web", "src", "app", "(app)", "settings", "account", "page.tsx"],
      /<DeleteAccountCard\s*\/?>/,
    ],
  ];

  it.each(mounts)("%s actually renders it", (label, parts, mounted) => {
    expect(
      read(...parts),
      `${label}: ${parts.join("/")} no longer renders DeleteAccountCard, so the ` +
        "in-app deletion route both store declarations promise does not exist",
    ).toMatch(mounted);
  });

  /**
   * The deletion URL is FILED WITH GOOGLE, so the string in the declaration is
   * the promise, and the route is what honours it. Checking each separately
   * leaves the gap between them: a typo in the declaration, or a route renamed
   * to something the declaration does not name, passes both halves. Play does
   * not re-check the URL until it 404s in a review sweep.
   */
  it("the filed deletion URL is the route that exists", () => {
    const FILED = /https:\/\/loonext\.com(\/[a-z0-9/-]*)/g;
    for (const [label, source] of [
      ["apps/ios/store/privacy-nutrition.md", IOS_DECLARATION],
      ["apps/android/store/data-safety.md", ANDROID_DECLARATION],
    ] as const) {
      const deletion = [...source.matchAll(FILED)]
        .map((match) => match[1])
        .filter((path) => path.includes("delete"));
      expect(deletion.length, `${label} files no deletion URL at all`).toBeGreaterThan(0);
      for (const path of deletion) {
        // A route in this app is a directory with a page under it. Route groups
        // like `(marketing)` do not appear in the URL, so the lookup names the
        // group rather than deriving it: getting that wrong would make this
        // pass by never finding anything.
        expect(
          () => read("apps", "web", "src", "app", "(marketing)", ...path.slice(1).split("/"), "page.tsx"),
          `${label} files ${path}, and no page serves it`,
        ).not.toThrow();
      }
    }
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

/*
 * #243 — the paths a WORKSPACE opens, which nothing was watching.
 *
 * The AI features have a guard already: the disclosure is generated from the
 * cost registry, so a new model cannot ship undisclosed. Outbound connections
 * and API keys had no equivalent, and both shipped with the inventory and the
 * privacy policy still saying data goes only to our sub-processors.
 *
 * This is the same failure #430 found for push services — a route by which
 * message content leaves, named nowhere — so it is guarded the same way: if the
 * code exists, the words must exist.
 *
 * Keyed on the FILE rather than on a feature flag, because the file is what
 * makes the path real. A flag that is off still ships the capability, and the
 * declaration is about what the app can do.
 */
describe("#243 an outbound path the workspace opens is disclosed", () => {
  const PATHS = [
    {
      what: "outbound webhooks",
      file: ["apps", "api", "src", "webhooks", "outbound.ts"],
      // What the policy has to actually SAY, not merely mention. "connection"
      // is the word the product uses for these on every screen.
      policy: /connection/i,
      inventory: /outbound webhooks/i,
    },
    {
      what: "API keys",
      file: ["apps", "api", "src", "auth", "api-key.ts"],
      policy: /API key/i,
      inventory: /API keys/i,
    },
  ];

  it("names each one in the privacy policy and the inventory", () => {
    let checked = 0;
    for (const path of PATHS) {
      let exists = true;
      try {
        read(...path.file);
      } catch {
        exists = false;
      }
      // Not skipped silently: a path that has been REMOVED should make somebody
      // delete the disclosure deliberately, so the absence is reported.
      expect(
        exists,
        `${path.file.join("/")} is gone. If ${path.what} was removed, remove its ` +
          `disclosure from the privacy policy and the inventory in the same change.`,
      ).toBe(true);
      if (!exists) continue;
      checked += 1;

      expect(
        PRIVACY_POLICY,
        `${path.what} send customer data somewhere we did not choose, and the ` +
          `privacy policy does not say so. The sentence about sub-processors is ` +
          `not the whole answer once this exists.`,
      ).toMatch(path.policy);

      expect(
        INVENTORY,
        `${path.what} are missing from docs/DATA-INVENTORY.md, which is the ` +
          `document both store declarations are written from.`,
      ).toMatch(path.inventory);
    }
    // A loop over an empty list would agree with itself.
    expect(checked).toBe(PATHS.length);
  });
});
