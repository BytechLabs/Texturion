import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { contactsEn, contactsFr } from "@/i18n/sections/contacts";

/**
 * #228 — "Same as workspace" is ONE control, so it gets one name.
 *
 * It had three, and nothing noticed for as long as it took to look:
 *
 * - web's catalogue said "Same as workspace";
 * - Android's said "Same as **your** workspace";
 * - iOS held "Same as your workspace" in its catalogue and then **bypassed it**
 *   with a hardcoded English literal in `ContactDetailView`, so it rendered a
 *   third thing and had no French at all.
 *
 * The drift was invisible because each client's own tests pinned its own
 * wording, which is exactly the failure mode a per-client assertion has. This
 * one reads all three catalogues.
 *
 * ## Why the named variant matters more than the plain one
 *
 * An inherit option that does not say what it inherits is a setting somebody
 * has to leave the screen to understand — a French workspace reading "same as
 * workspace" cannot tell whether that means French. So the named form carries a
 * slot, and a client that dropped the slot would render `{language}` at a
 * person, which reads as a bug rather than as a setting.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const ANDROID = readFileSync(
  join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/core/i18n/ContactsTasksStrings.kt",
  ),
  "utf8",
);
const IOS = readFileSync(
  join(REPO_ROOT, "apps/ios/Loonext/Core/I18n/ContactsTasksStrings.swift"),
  "utf8",
);

describe("#228 the inherit option reads the same on all three clients", () => {
  it("reads both phone catalogues, so a passing run means something", () => {
    // A guard that read nothing would pass forever. This one has two file
    // reads between it and its subject.
    expect(ANDROID.length, "android catalogue").toBeGreaterThan(1000);
    expect(IOS.length, "ios catalogue").toBeGreaterThan(1000);
  });

  it("says the same English on every client", () => {
    for (const [platform, source] of [
      ["android", ANDROID],
      ["ios", IOS],
    ] as const) {
      expect(source, `${platform}: the plain form`).toContain(
        contactsEn.sameAsWorkspace,
      );
      expect(source, `${platform}: the named form`).toContain(
        contactsEn.sameAsWorkspaceNamed,
      );
    }
  });

  it("says the same French on every client", () => {
    for (const [platform, source] of [
      ["android", ANDROID],
      ["ios", IOS],
    ] as const) {
      expect(source, `${platform}: the plain form, in French`).toContain(
        contactsFr.sameAsWorkspace,
      );
      expect(source, `${platform}: the named form, in French`).toContain(
        contactsFr.sameAsWorkspaceNamed,
      );
    }
  });

  it("keeps the slot in the named form, in both languages", () => {
    // The half that turns a label into a bug report if it is lost.
    for (const sentence of [
      contactsEn.sameAsWorkspaceNamed,
      contactsFr.sameAsWorkspaceNamed,
    ]) {
      expect(sentence).toContain("{language}");
    }
  });

  it("does not say 'your' on any client, which is where the drift was", () => {
    // Named rather than implied. This is the exact word that differed, and a
    // regression to it would otherwise pass every assertion above except by
    // accident of the substring check.
    expect(contactsEn.sameAsWorkspace).not.toContain("your");
    for (const [platform, source] of [
      ["android", ANDROID],
      ["ios", IOS],
    ] as const) {
      expect(source, `${platform} reintroduced "your"`).not.toContain(
        "Same as your workspace",
      );
    }
  });
});
