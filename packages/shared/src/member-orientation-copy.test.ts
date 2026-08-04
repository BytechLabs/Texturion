import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * #286 — the joining orientation says the same thing on all three clients.
 *
 * Web owns the wording. Android and iOS hand-port it, and a hand-port is
 * exactly where this drifts: three wordings of the same four screens is the
 * failure #376 and #392 describe, and #476 already had to fix it once for the
 * first-run checklist.
 *
 * Unenforceable by review — nobody diffs three files in two other languages —
 * so it is enforced here, by reading all three sources. Same technique as
 * `first-run-copy.test.ts`.
 *
 * Adding or rewording a screen means editing the list below, which is the
 * point: the copy moves in one commit or it does not move.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const CLIENTS = {
  web: "apps/web/src/components/onboarding/member-orientation.tsx",
  android:
    "apps/android/app/src/main/kotlin/com/loonext/android/features/onboarding/MemberOrientation.kt",
  ios: "apps/ios/Loonext/Features/Onboarding/MemberOrientation.swift",
} as const;

/** Where each client keeps the standalone notification primer. */
const PRIMERS = {
  android:
    "apps/android/app/src/main/kotlin/com/loonext/android/features/onboarding/NotificationPrimer.kt",
  ios: "apps/ios/Loonext/Features/Onboarding/NotificationPrimer.swift",
} as const;

/**
 * Kotlin and Swift wrap long literals across lines with `+` — Kotlin trailing,
 * Swift leading. Rejoining them is what lets one wording be matched against
 * three languages; without it this test would only ever pass on lines short
 * enough to fit a Kotlin column limit, which is not a property of the copy.
 */
function rejoin(text: string): string {
  return text.replace(/"\s*\+\s*"/g, "");
}

const sources = Object.fromEntries(
  Object.entries(CLIENTS).map(([client, path]) => [
    client,
    rejoin(readFileSync(join(REPO, path), "utf8")),
  ]),
) as Record<keyof typeof CLIENTS, string>;

const primers = Object.fromEntries(
  Object.entries(PRIMERS).map(([client, path]) => [
    client,
    rejoin(readFileSync(join(REPO, path), "utf8")),
  ]),
) as Record<keyof typeof PRIMERS, string>;

/** The four screens, titles and bodies, in order. */
const ORIENTATION_COPY = [
  "One inbox, the whole crew",
  "Every text your customers send lands here, and everyone on the crew can see it. Nothing sits unanswered in one person's phone.",
  "You answer as the business",
  "Your replies go out from the workspace's number, so customers never get your personal one. If a number isn't shared with you, Settings tells you which and why.",
  "Notes stay inside",
  // The em dash is load-bearing to this test for the same reason it was in
  // #476: it is the exact character that drifted to a comma during that port.
  "Switch the composer to Note and only the crew sees it — the customer never does. Mention a teammate in one and it lands on their For you.",
  "You choose when we buzz you",
  "You're joining a workspace that already has traffic. Turn on notifications for the work meant for you, and change them any time in Settings.",
];

/** The buttons. A skip labelled three different ways is three flows. */
const ACTIONS = ["Skip", "Next", "Turn on notifications", "Not now"];

/** The standalone primer, which only the two phones have an OS prompt for. */
const PRIMER_COPY = [
  "Want a nudge when work comes in?",
  "We'll buzz you for new customer texts, missed calls and the work assigned to you — nothing else. You can change what reaches you, and when, in Settings.",
];

describe("#286 the joining orientation reads the same on every client", () => {
  it("reads three real sources, so the guard cannot pass on empty files", () => {
    // Without this, a renamed or emptied file would make every assertion below
    // vacuously true — the failure mode a guard is supposed to catch.
    for (const [client, text] of Object.entries(sources)) {
      expect(text.length, `${client} source is empty`).toBeGreaterThan(1000);
    }
  });

  for (const line of ORIENTATION_COPY) {
    it(`all three say: "${line.slice(0, 44)}${line.length > 44 ? "…" : ""}"`, () => {
      const missing = Object.entries(sources)
        .filter(([, text]) => !text.includes(line))
        .map(([client]) => client);
      expect(missing).toEqual([]);
    });
  }

  for (const action of ACTIONS) {
    it(`all three label a button "${action}"`, () => {
      const missing = Object.entries(sources)
        .filter(([, text]) => {
          // JSX puts the label between tags, and the formatter puts it on its
          // own line; Kotlin and Swift quote it. Both forms are anchored — a
          // bare includes(action) would pass on the word appearing in a
          // comment, which is the kind of guard that only ever looks like one.
          const tight = text.replace(/>\s+/g, ">").replace(/\s+</g, "<");
          return (
            !text.includes(`"${action}"`) && !tight.includes(`>${action}<`)
          );
        })
        .map(([client]) => client);
      expect(missing).toEqual([]);
    });
  }

  it("ends on the notification ask, on every client", () => {
    // The order matters more than any single screen: "requested with context,
    // not cold" is three screens of reason followed by one ask, and a client
    // that put the ask first would still pass every line check above.
    for (const [client, text] of Object.entries(sources)) {
      expect(
        text.indexOf("You choose when we buzz you"),
        `${client} orders the screens`,
      ).toBeGreaterThan(text.indexOf("One inbox, the whole crew"));
    }
  });
});

describe("#286 the standalone primer reads the same on both phones", () => {
  it("reads two real sources", () => {
    for (const [client, text] of Object.entries(primers)) {
      expect(text.length, `${client} primer is empty`).toBeGreaterThan(1000);
    }
  });

  for (const line of PRIMER_COPY) {
    it(`both say: "${line.slice(0, 44)}${line.length > 44 ? "…" : ""}"`, () => {
      const missing = Object.entries(primers)
        .filter(([, text]) => !text.includes(line))
        .map(([client]) => client);
      expect(missing).toEqual([]);
    });
  }

  it("no client asks for the permission on mount any more", () => {
    // The bug #286 names: "the first thing the product does is ring their
    // personal phone about a customer they have never heard of". Both phones
    // fired the OS prompt from a startup path — Android from the calls overlay,
    // iOS from push registration — and both had exactly one prompt to spend.
    const android = readFileSync(
      join(REPO, "apps/android/app/src/main/kotlin/com/loonext/android/features/calls/CallsOverlay.kt"),
      "utf8",
    );
    expect(android).not.toContain("EnsureNotificationPermission()");
    const ios = readFileSync(
      join(REPO, "apps/ios/Loonext/Features/Push/PushRegistrar.swift"),
      "utf8",
    );
    expect(ios).not.toContain("requestAuthorization");
  });
});
