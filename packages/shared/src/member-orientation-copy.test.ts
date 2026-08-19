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

/**
 * #228 moved each client's English out of its screen and into a catalogue, so
 * the "source" for this guard is both files. Reading only the screen would make
 * every assertion below fail on a change that lost nothing; reading only the
 * catalogue would stop noticing if the screen quietly rendered something else.
 *
 * Web moved first, then Android. iOS still holds its words inline and is read
 * unchanged — the entry is simply absent for it, so the day iOS moves, the
 * failure is loud rather than a silently vacuous pass.
 */
const CATALOGS: Partial<Record<keyof typeof CLIENTS, string>> = {
  web: "apps/web/src/i18n/sections/onboarding.ts",
  android:
    "apps/android/app/src/main/kotlin/com/loonext/android/core/i18n/ShellStrings.kt",
  ios: "apps/ios/Loonext/Core/I18n/ShellStrings.swift",
};

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

function read(path: string): string {
  return readFileSync(join(REPO, path), "utf8");
}

const sources = Object.fromEntries(
  Object.entries(CLIENTS).map(([client, path]) => {
    const catalog = CATALOGS[client as keyof typeof CLIENTS];
    return [client, rejoin(read(path) + (catalog ? read(catalog) : ""))];
  }),
) as Record<keyof typeof CLIENTS, string>;

const primers = Object.fromEntries(
  Object.entries(PRIMERS).map(([client, path]) => {
    // The primer's words moved to the same Android catalogue the orientation's
    // did — one section file per surface, and the shell is one surface.
    const catalog = CATALOGS[client as keyof typeof CLIENTS];
    return [client, rejoin(read(path) + (catalog ? read(catalog) : ""))];
  }),
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

/**
 * #521 — the joining note, which is the same feature on three clients and
 * therefore the same words on three clients.
 *
 * Added because the first port of it drifted on EVERY string: the attribution
 * read "{from} says" above the quote on two clients and "From {from}" below it
 * on the third, and the invite field had three different labels, placeholders
 * and descriptions. The guard above existed for exactly that failure and did
 * not cover these strings, so eighteen green tests proved nothing about them.
 *
 * ATTRIBUTION MATCHES THE INVITE EMAIL. `sendExistingAccountInvite` in
 * `apps/api/src/routes/team.ts` signs the note "{name} says" and falls back to
 * "They said" when there is no name. A member who gets both should read the
 * same construction over the same quote rather than two attempts at it.
 */
const JOINING_NOTE_COPY = [
  // The attribution, unnamed. The named form is interpolated per client and
  // cannot be pinned as a literal, so the fallback is what anchors the wording.
  "They said",
];

/**
 * The invite field, which lives on the team settings screen rather than in the
 * orientation, so it is checked against those three sources instead.
 */
const INVITE_NOTE_COPY = [
  "What to tell them (optional)",
  // NOT "goes in their invite email". For an address with no Loonext account
  // the invite is sent by Supabase Auth from a template this repo does not
  // control and which carries no note, so promising the email is false for the
  // ordinary case. What is always true is that they read it when they join.
  "They see this once, when they join. You cannot change it after the invite goes out.",
];

/**
 * Where each client puts the invite form.
 *
 * A LIST PER CLIENT, because #228 moved web's words out of the screen and into
 * the catalogue: the label and the description are now `appShell.teamNoteLabel`
 * and `appShell.teamNoteDescription`, and the screen holds the keys. Reading
 * both files keeps this guard asking the same question it always asked — do all
 * three clients say the same sentence — rather than quietly passing because the
 * English left the file it used to be measured in.
 *
 * The phones are unchanged: they hand-port, so their literal still lives in the
 * screen.
 */
const TEAM_SOURCES = {
  web: [
    "apps/web/src/app/(app)/settings/team/page.tsx",
    "apps/web/src/i18n/sections/appShell.ts",
  ],
  android: [
    "apps/android/app/src/main/kotlin/com/loonext/android/features/settings/TeamSection.kt",
    // #228 moved the Android screen's words out too, so the guard follows them
    // here for the same reason it follows web's into `i18n/sections/appShell.ts`.
    "apps/android/app/src/main/kotlin/com/loonext/android/core/i18n/SettingsMoreStrings.kt",
  ],
  ios: [
    "apps/ios/Loonext/Features/Settings/TeamSection.swift",
    // And now iOS's too, for the same reason and one sweep later. Both phones
    // reached the same shape as web: the screen names a key and the sentence
    // lives in the catalogue beside its French.
    "apps/ios/Loonext/Core/I18n/SettingsMoreStrings.swift",
  ],
} as const;

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

  for (const line of JOINING_NOTE_COPY) {
    it(`#521 all three orientations say: "${line}"`, () => {
      const missing = Object.entries(sources)
        .filter(([, text]) => !text.includes(line))
        .map(([client]) => client);
      expect(missing).toEqual([]);
    });
  }

  it("ends on the notification ask, on every client", () => {
    /*
     * THE SCREEN FILE'S KEY ORDER, not the catalogue's byte order.
     *
     * This compared `indexOf("You choose when we buzz you")` against
     * `indexOf("One inbox, the whole crew")` inside `sources`, which is the
     * screen concatenated with its catalogue. Since #228 neither sentence
     * appears in any screen — all three hold keys — so both indexes landed in
     * the catalogue half, and the assertion measured where two entries sit in a
     * shell catalogue holding hundreds of unrelated strings.
     *
     * That is not the order anybody is shown. Reordering Android's SCREENS list
     * to put the ask first — the exact cold-ask regression the comment names —
     * passed on all three clients. And it would have FAILED for somebody merely
     * re-sorting two catalogue lines, which changes nothing a person sees:
     * wrong in both directions at once.
     *
     * Every client lists its screens as keys, in order, in the screen file. So
     * that is what is read — `screens`, not `sources`.
     */
    for (const [client, path] of Object.entries(CLIENTS)) {
      const screen = read(path);
      const inbox = screen.indexOf("orientationInboxTitle");
      const ask = screen.indexOf("orientationNotificationsTitle");

      // Neither key found means the screen was renamed and this stopped
      // checking anything — the failure mode of every indexOf assertion.
      expect(inbox, `${client} no longer names orientationInboxTitle`).toBeGreaterThan(-1);
      expect(ask, `${client} no longer names orientationNotificationsTitle`).toBeGreaterThan(-1);

      expect(
        ask,
        `${client} asks for notifications before it has given a reason. ` +
          `"Requested with context, not cold" is three screens of reason and ` +
          `then one ask; this client puts the ask first.`,
      ).toBeGreaterThan(inbox);
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

describe("#521 the invite note asks for the same thing on all three clients", () => {
  // `rejoin` here too, and it is not decoration: #228 moved the phones' words
  // into catalogues, where a sentence that fitted one line inside a component
  // is wrapped across two with a `+`. Without this the guard would report a
  // drift that does not exist — the words are identical, only the column limit
  // moved.
  const teamSources = Object.fromEntries(
    Object.entries(TEAM_SOURCES).map(([client, paths]) => [
      client,
      rejoin(paths.map((path) => read(path)).join("\n")),
    ]),
  );

  it("reads three real sources, so the guard cannot pass on empty files", () => {
    for (const [client, text] of Object.entries(teamSources)) {
      expect(text.length, client).toBeGreaterThan(2000);
    }
  });

  for (const line of INVITE_NOTE_COPY) {
    it(`all three say: "${line.slice(0, 44)}${line.length > 44 ? "…" : ""}"`, () => {
      const missing = Object.entries(teamSources)
        .filter(([, text]) => !text.includes(line))
        .map(([client]) => client);
      expect(missing).toEqual([]);
    });
  }

  it("no client promises the note reaches the invite email", () => {
    // The claim is false for the ordinary invite. A brand-new address is
    // emailed by Supabase Auth from a template this repo does not control,
    // which carries no note; only the already-has-an-account fallback in
    // `sendExistingAccountInvite` renders it. All three clients wrote this
    // promise on the first pass, which is why it is asserted rather than
    // remembered.
    const forbidden = /in (their|the) invite email|goes? (in|out) with the invite|invite email/i;
    const offenders = Object.entries(teamSources)
      .filter(([, text]) => {
        const stripped = text
          .replace(/\/\*[\s\S]*?\*\//g, " ")
          .split("\n")
          .filter((l) => !/^\s*(\/\/|\*)/.test(l))
          .join("\n");
        return forbidden.test(stripped);
      })
      .map(([client]) => client);
    expect(offenders).toEqual([]);
  });
});
