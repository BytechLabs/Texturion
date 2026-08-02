import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * #441 — a commit's SCOPE is checked against its DIFF.
 *
 * `feat(android)` on a change that also edits `apps/ios/**` puts the word
 * "android" at the front of an iOS customer's "What's new", because
 * release-please routes by files and the store notes are generated from the
 * subjects. That shipped once (af2f2b5) with a perfectly well-formed subject —
 * the wrong part was a fact about the diff, which the prose rules cannot see.
 *
 * The way a guard like this dies is by becoming inert: someone renames a
 * directory, every path stops matching, and it reports "all good" forever. So
 * these assert a real mismatch is CAUGHT as well as that honest commits pass.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const { scopeErrors, checkOne } = (await import(
  join(REPO, "scripts", "check-commit-message.mjs")
)) as {
  scopeErrors: (scope: string | undefined, files: string[] | null) => string[];
  checkOne: (
    message: string,
    files?: string[] | null,
  ) => { header: string; errors: string[] };
};

describe("#441 a client scope is checked against the paths", () => {
  it("catches the commit that started this — one phone named, two changed", () => {
    // af2f2b5's actual shape: scoped android, two of three files iOS.
    const errors = scopeErrors("android", [
      "apps/android/app/src/main/kotlin/com/loonext/android/features/notifications/NotificationsScreen.kt",
      "apps/ios/Loonext/Features/Notifications/NotificationsFeedModel.swift",
      "apps/ios/Loonext/Features/Notifications/NotificationsView.swift",
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("ios");
    // The fix has to be in the message, or the author has to guess it.
    expect(errors[0]).toContain("(mobile)");
    // Naming the paths is the whole point — a verdict with no evidence is one
    // people learn to override.
    expect(errors[0]).toContain("NotificationsView.swift");
  });

  it("accepts a single-client commit that stays in its own client", () => {
    expect(
      scopeErrors("ios", ["apps/ios/Loonext/Features/Contacts/ContactsTab.swift"]),
    ).toEqual([]);
  });

  it("accepts the cross-platform scopes for the diffs they describe", () => {
    expect(
      scopeErrors("mobile", ["apps/android/a/B.kt", "apps/ios/C/D.swift"]),
    ).toEqual([]);
    expect(
      scopeErrors("clients", [
        "apps/web/src/a.tsx",
        "apps/android/a/B.kt",
        "apps/ios/C/D.swift",
      ]),
    ).toEqual([]);
  });

  it("still rejects mobile when the diff reaches the web app", () => {
    const errors = scopeErrors("mobile", ["apps/android/a/B.kt", "apps/web/src/a.tsx"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("web");
  });

  it("has no opinion on non-client scopes", () => {
    // An API change shipping its own migration and updating all three clients
    // is normal work. Flagging it would make the guard noise, and noise is how
    // a guard gets switched off.
    for (const scope of ["api", "db", "shared", "contacts", "compose"]) {
      expect(
        scopeErrors(scope, [
          "apps/api/src/routes/contacts.ts",
          "supabase/migrations/20260802020000_contact_merge.sql",
          "apps/web/src/a.tsx",
          "apps/ios/C/D.swift",
        ]),
      ).toEqual([]);
    }
  });

  it("fails open when the diff is unknown, rather than inventing a verdict", () => {
    expect(scopeErrors("android", null)).toEqual([]);
    expect(scopeErrors("android", [])).toEqual([]);
    expect(scopeErrors(undefined, ["apps/ios/C/D.swift"])).toEqual([]);
  });

  it("matches a directory boundary, not a prefix", () => {
    // `apps/web-marketing/` must not read as `apps/web`.
    expect(scopeErrors("ios", ["apps/web-marketing/src/a.tsx"])).toEqual([]);
  });
});

describe("#441 the path rule is wired into the message check", () => {
  const files = ["apps/android/a/B.kt", "apps/ios/C/D.swift"];

  it("rejects a published commit whose scope contradicts the diff", () => {
    const { errors } = checkOne(
      "feat(android): tell the crew when notifications are paused, on the phones too",
      files,
    );
    expect(errors.join("\n")).toContain("contradicts the diff");
  });

  it("leaves internal commits alone — their scope reaches no customer", () => {
    const { errors } = checkOne("chore(android): bump the gradle plugin", files);
    expect(errors.join("\n")).not.toContain("contradicts the diff");
  });

  it("keeps checking the prose rules when the paths are fine", () => {
    const { errors } = checkOne("feat(ios): fixed some things", [
      "apps/ios/C/D.swift",
    ]);
    expect(errors.join("\n")).toContain("present tense");
  });
});
