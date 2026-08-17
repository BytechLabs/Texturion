/**
 * #291 — the other-numbers list reads the same on web, Android and iOS.
 *
 * The sentence that matters is the match note. Adding a number here is not
 * bookkeeping: it changes which customer an inbound text or call is attributed
 * to. A client that dropped that line would let a crew add a number believing
 * it was a memo, and find out when a message arrived under a name they did not
 * expect.
 *
 * Every assertion runs against the source with COMMENTS STRIPPED. The prose
 * explaining why the note exists contains the note's own words, so a client
 * that deleted the line and kept the comment would otherwise pass — that is
 * exactly how the contact-fields twin of this file was decorative until it was
 * broken on purpose.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { contactsEn } from "@/i18n/sections/contacts";

import { parityCode } from "./parity-source";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

/**
 * #228 — web's words moved into the catalogue, so they are read from there
 * rather than from `phone-list.tsx`. Scanning the component for English would
 * now match nothing and this file would pass by checking an empty set. The
 * phones still spell theirs inline. What is asserted is unchanged: every
 * client says the same sentences, and web's copy still has to exist somewhere.
 *
 * The KEYS are listed rather than `Object.values(contactsEn)`. A join of the
 * whole section makes every assertion a substring search over ~200 unrelated
 * sentences, which is how the sibling contact-filter guard passed with its
 * chip renamed to "All people".
 */
const WEB_WORDS = [
  contactsEn.phoneAddLabel,
  contactsEn.phoneLabelPlaceholder,
  contactsEn.phonePlaceholder,
  contactsEn.phoneMatchNote,
].join("\n");

const SOURCES: Record<string, string> = {
  web: join(REPO_ROOT, "apps/web/src/components/contacts/phone-list.tsx"),
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/features/contacts/PhoneList.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Features/Contacts/PhoneList.swift"),
};

/** The source with its comments removed. See the header. */
const code = parityCode;

/**
 * #228: every client reads these labels from a catalogue now. Web moved first
 * (that is what `WEB_WORDS` is), then iOS, and Android last — so no screen
 * alone contains the sentences this guard pins.
 *
 * Screen AND catalogue rather than catalogue alone: what is being asked is
 * whether a person reads the same words on three clients, and dropping the
 * screen would stop noticing a view that renders something else entirely.
 */
const IOS_CATALOGUE = join(
  REPO_ROOT,
  "apps/ios/Loonext/Core/I18n/ContactsTasksStrings.swift",
);

const ANDROID_CATALOGUE = join(
  REPO_ROOT,
  "apps/android/app/src/main/kotlin/com/loonext/android/core/i18n/ContactsTasksStrings.kt",
);

/** A client's words: its screen, plus the catalogue it reaches into. */
function words(platform: string, path: string): string {
  if (platform === "ios") return code(path) + " " + code(IOS_CATALOGUE);
  if (platform === "android") return code(path) + " " + code(ANDROID_CATALOGUE);
  return code(path);
}

/** Said on every client, verbatim. */
const SENTENCES: readonly string[] = [
  "Add another number",
  "Landline, the wife, the shop…",
  "Another number they answer",
  "Texts and calls from this number will show up under this customer, in ",
  "their own thread.",
];

describe("#291 the other-numbers list reads the same everywhere", () => {
  it("reads every source, so a passing run means something", () => {
    for (const [platform, path] of Object.entries(SOURCES)) {
      expect(code(path).length, platform).toBeGreaterThan(1000);
    }
  });

  it("carries every sentence on every client, verbatim", () => {
    const missing: string[] = [];
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = platform === "web" ? WEB_WORDS : words(platform, path);
      for (const sentence of SENTENCES) {
        if (!text.includes(sentence)) missing.push(`${platform}: ${sentence}`);
      }
    }
    expect(
      missing,
      "These #291 sentences are missing or reworded on some clients:\n  " +
        missing.join("\n  "),
    ).toEqual([]);
  });

  it("names the number in the remove control on every client", () => {
    // A row of numbers with a bare "Remove" beside each is a control somebody
    // taps by position. On a screen where two of a customer's lines differ by
    // one digit, that is a number deleted by accident.
    //
    // #228: web now builds this label from the catalogue, so it takes BOTH
    // halves — the sentence has a slot for the number, and the component fills
    // that slot with the row's own number. Asserting only the first would pass
    // for a component that never passed the number in.
    expect(contactsEn.phoneRemove, "web: the label has a slot").toContain(
      "{number}",
    );
    expect(code(SOURCES.web), "web: remove names the number").toMatch(
      /contacts\.phoneRemove"[\s,{]*number:\s*entry\.phone_e164/,
    );
    // #228: iOS moved to the same shape web uses, so it takes both halves for
    // the same reason — the catalogue sentence has the slot, and the screen
    // fills it with the row's own number. Asserting only the label would pass
    // for a screen that renders "Remove {number}" literally, which is worse
    // than a bare "Remove" because it looks like a bug rather than reading as
    // one control among many.
    expect(
      code(IOS_CATALOGUE),
      "ios: the label has a slot",
    ).toContain("Remove {number}");
    expect(
      code(SOURCES.ios),
      "ios: remove names the number",
    ).toMatch(/contactsTasks\.phoneRemove"[\s,\][]*\["number":\s*entry\.phone_e164/);

    // #228: and Android, last of the three, for the same two reasons — the
    // catalogue sentence carries the slot, and the row fills it with its own
    // number. Concatenating instead would put the number outside the
    // translated sentence, where a language that orders the words differently
    // cannot reach it.
    expect(code(ANDROID_CATALOGUE), "android: the label has a slot").toContain(
      "Remove {number}",
    );
    expect(
      code(SOURCES.android),
      "android: remove names the number",
    ).toMatch(/contactsTasks\.phoneRemove",\s*"number" to entry\.phone_e164/);
  });

  /**
   * Where each client opens its "adding a number" branch, and what it calls
   * the note. Written out per platform rather than sniffed with a loose regex:
   * the first version searched for the word "adding" anywhere, which on web
   * matched the `useState` declaration near the top of the file and made the
   * whole assertion vacuous.
   */
  const NOTE = {
    // #228: web reaches the note through its catalogue key, so the key IS the
    // identifier. There is no declaration in the file any more, which `body()`
    // already handles — a needle it cannot find leaves the whole source in
    // play, and the key appears exactly once, inside the adding branch. Both
    // assertions below therefore still bite; only the spelling moved.
    web: {
      identifier: "contacts\\.phoneMatchNote",
      branch: "{adding ? (",
      declaration: "export const PHONE_MATCH_NOTE",
    },
    // #228: Android reaches the note through its catalogue key, so the key IS
    // the identifier — the same move web made. There is no declaration in the
    // file any more, which `body()` already handles: a needle it cannot find
    // leaves the whole source in play, and the key appears exactly once,
    // inside the adding branch, so both assertions still bite.
    android: {
      identifier: "contactsTasks\\.phoneMatchNote",
      branch: "if (adding) {",
      declaration: "const val PHONE_MATCH_NOTE",
    },
    ios: {
      identifier: "phoneMatchNote",
      branch: "if adding {",
      declaration: "let phoneMatchNote",
    },
  } as const;

  /**
   * The part of the file that RENDERS, with the constant declarations at the
   * bottom cut off.
   *
   * Both assertions below were decorative without this. The declaration sits
   * after the adding branch on every client, so "the identifier appears after
   * the branch" was satisfied by the declaration itself — a client that moved
   * the note to the top of the record, permanently visible, still passed.
   */
  function body(path: string, declaration: string): string {
    const text = code(path);
    const declAt = text.indexOf(declaration);
    return declAt === -1 ? text : text.slice(0, declAt);
  }

  /** Whole-word, so `phoneMatchNoteUnused` is not a use of `phoneMatchNote`. */
  function uses(text: string, identifier: string): number {
    return text.match(new RegExp(`\\b${identifier}\\b`, "g"))?.length ?? 0;
  }

  it("actually SHOWS the match note, rather than merely declaring it", () => {
    // Found by deleting the iOS render call and watching this file stay green:
    // the sentence was still in the source, just attached to nothing.
    for (const [platform, path] of Object.entries(SOURCES)) {
      const { identifier, declaration } = NOTE[platform as keyof typeof NOTE];
      expect(
        uses(body(path, declaration), identifier),
        `${platform}: ${identifier} declared but never rendered`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps the match note out of sight until somebody is adding one", () => {
    // It belongs to the DECISION, not to the record. Shown permanently it
    // becomes furniture that nobody reads by the second visit — which is the
    // same as not saying it, except it also crowds every contact.
    for (const [platform, path] of Object.entries(SOURCES)) {
      const { identifier, branch, declaration } =
        NOTE[platform as keyof typeof NOTE];
      const text = body(path, declaration);
      const branchAt = text.indexOf(branch);
      expect(branchAt, `${platform}: has an adding branch`).toBeGreaterThan(-1);
      expect(
        uses(text.slice(0, branchAt), identifier),
        `${platform}: the match note is shown before anyone is adding a number`,
      ).toBe(0);
      expect(
        uses(text.slice(branchAt), identifier),
        `${platform}: the match note must sit inside the adding branch`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});
