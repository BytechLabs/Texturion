import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * #476 — the first-run checklist says the same thing on all three clients.
 *
 * Web owns the wording. Android and iOS hand-port it, and a hand-port is
 * exactly where this drifts: three wordings of the same idea is the failure
 * #376 and #392 describe, and the acceptance criterion for #476 is literally
 * "the copy matches web word for word".
 *
 * That criterion is unenforceable by review — nobody diffs three files in two
 * other languages — so it is enforced here instead, by reading all three
 * sources. The same technique as `font-licenses.test.ts`: derive from what is
 * actually in the tree rather than from a list somebody must remember.
 *
 * Adding a checklist row means adding its strings below.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const CLIENTS = {
  // #228: web owns the wording and web's wording now lives in the catalogue —
  // `components/inbox/getting-started-card.tsx` reads every line below through
  // `t("inbox.started…")`. Pointing at the component would compare the two
  // hand-ports against a file with no sentences left in it, which is a guard
  // that passes because it is looking at nothing.
  web: "apps/web/src/i18n/sections/inbox.ts",
  android:
    "apps/android/app/src/main/kotlin/com/loonext/android/features/inbox/GettingStartedLogic.kt",
  ios: "apps/ios/Loonext/Features/Inbox/GettingStartedCard.swift",
} as const;

/** Where each client keeps its two card TITLES (native holds them at the mount). */
const TITLE_SOURCES = {
  web: CLIENTS.web,
  android:
    "apps/android/app/src/main/kotlin/com/loonext/android/features/inbox/InboxTab.kt",
  ios: CLIENTS.ios,
} as const;

const sources = Object.fromEntries(
  Object.entries(CLIENTS).map(([client, path]) => [
    client,
    readFileSync(join(REPO, path), "utf8"),
  ]),
) as Record<keyof typeof CLIENTS, string>;

const titleSources = Object.fromEntries(
  Object.entries(TITLE_SOURCES).map(([client, path]) => [
    client,
    readFileSync(join(REPO, path), "utf8"),
  ]),
) as Record<keyof typeof TITLE_SOURCES, string>;

/** The owner list. */
const OWNER_COPY = [
  "Set your workspace up",
  "Get your business number",
  "It's on its way, usually under a minute.",
  "Taking a little longer than usual. You don't need to do anything.",
  "Receive your first text",
  "Text your number from your phone, and it lands right here.",
  "Send your first reply",
  "Open a conversation and answer like you would from your cell.",
  "Invite a teammate",
];

/** The member list. */
const MEMBER_COPY = [
  "Answer a customer",
  "Open a thread and reply. It goes out from the business number, and the whole crew can see it.",
  "Leave a note for the crew",
  // The em dash is deliberate and load-bearing to this test: it is the exact
  // character that drifted to a comma during the first port.
  "Switch the composer to Note. Notes stay inside the app — the customer never sees them.",
  "Mark something done",
  "Tick a message off when it is handled, so the rest of the crew knows nobody needs to chase it.",
];

const TITLES = ["Getting started", "Getting the hang of it"];

describe("#476 the first-run checklist reads the same on every client", () => {
  it("reads three real sources, so the guard cannot pass on empty files", () => {
    // Without this, a renamed file would make every assertion below vacuous.
    for (const [client, text] of Object.entries(sources)) {
      expect(text.length, `${client} source is empty`).toBeGreaterThan(1000);
    }
  });

  for (const line of [...OWNER_COPY, ...MEMBER_COPY]) {
    it(`all three say: "${line.slice(0, 48)}${line.length > 48 ? "…" : ""}"`, () => {
      const missing = Object.entries(sources)
        .filter(([, text]) => !text.includes(line))
        .map(([client]) => client);
      expect(missing).toEqual([]);
    });
  }

  for (const title of TITLES) {
    it(`all three title a card "${title}"`, () => {
      const missing = Object.entries(titleSources)
        .filter(([, text]) => !text.includes(title))
        .map(([client]) => client);
      expect(missing).toEqual([]);
    });
  }

  it("gates the member list on the axis its items actually need", () => {
    // #405's argument is that these are two audiences arriving differently,
    // not one list filtered. The sharp edge is `read_only`: web falls through
    // to the member card, whose three items — reply, note, mark done — are all
    // things that role cannot do. Both native clients ask for
    // `conversations.send` instead, so an observer sees no card rather than
    // instructions they cannot follow.
    //
    // Asserted on the native sources only. Web's gate lives in JSX in a
    // different file and is covered by its own role branch; this pins the two
    // ports that were written from scratch.
    for (const client of ["android", "ios"] as const) {
      expect(
        sources[client],
        `${client} must gate the member list on conversations.send`,
      ).toMatch(/conversations\.send|CONVERSATIONS_SEND|conversationsSend/);
    }
  });
});
