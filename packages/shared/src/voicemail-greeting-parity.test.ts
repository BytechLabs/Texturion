import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * #228 — the voicemail preview says what the caller will actually hear.
 *
 * ## The drift this exists for already happened, and was predicted in writing
 *
 * Three clients each mirror the server's default greeting so an owner can see
 * what a caller hears when they have not recorded one. All three were English,
 * deliberately and correctly, because `inbound-ring.ts` took no locale — and
 * both phones said so in their own words:
 *
 *   > Worth extracting on the day `inbound-ring.ts` learns the workspace's
 *   > language, and misleading before then.
 *
 * `inbound-ring.ts` learned the workspace's language in `8b4e052a`. The mirrors
 * did not, and the commit that created the condition did not follow the
 * pointer. For that window a French workspace was shown an English preview of a
 * French greeting: not a missing translation, but a screen stating something
 * about the product that was false.
 *
 * A comment predicting a drift is not a check. This is the check.
 *
 * ## What it asserts
 *
 * That the sentence each client shows is the sentence the SERVER speaks, in
 * both languages. The server is the only source of truth here — it is the one
 * that talks to Telnyx — so every comparison is against `inbound-ring.ts`
 * rather than between clients.
 */

const REPO = join(import.meta.dirname, "..", "..", "..");

const SERVER = "apps/api/src/messaging/inbound-ring.ts";

const MIRRORS = {
  web: "apps/web/src/i18n/sections/settings.ts",
  android:
    "apps/android/app/src/main/kotlin/com/loonext/android/core/i18n/SettingsStrings.kt",
  ios: "apps/ios/Loonext/Core/I18n/SettingsStrings.swift",
};

const read = (path: string) => readFileSync(join(REPO, path), "utf8");

/**
 * One file's prose, in a form the four languages can be compared in.
 *
 * Three normalisations, each for a difference that is spelling rather than
 * wording:
 *
 * 1. **Interpolation.** `${companyName}`, `{name}` and `\(name)` are the same
 *    hole in four languages.
 * 2. **Line wrapping.** Every file breaks these sentences somewhere different.
 * 3. **Concatenation.** They also break them at different POINTS, joining with
 *    `" + "`. Removing the join is what lets one whole sentence be asserted
 *    rather than fragments — and fragments were the first version of this file,
 *    which failed on both phones for splitting mid-sentence rather than for any
 *    disagreement about the words.
 */
function saidIn(source: string): string {
  return source
    .replace(/\$\{companyName\}|\{name\}|\\\(companyName\)/g, "«NAME»")
    .replace(/\s+/g, " ")
    .replace(/["`] \+ ["`]/g, "");
}

/** What Telnyx says out loud, per language. */
const SPOKEN: Record<string, string> = {
  en:
    "You've reached «NAME». We can't take your call right now. " +
    "Please leave a message after the beep, or hang up and text us at this number.",
  "fr-CA":
    "Vous avez joint «NAME». Nous ne pouvons pas répondre pour le moment. " +
    "Laissez un message après le signal, ou raccrochez et écrivez-nous à ce numéro.",
};

describe("#228 the voicemail preview matches what is spoken", () => {
  const server = saidIn(read(SERVER));

  it("read the server, so a passing run means something", () => {
    expect(server.length).toBeGreaterThan(1000);
    expect(
      server.includes("export function defaultGreeting"),
      "inbound-ring.ts no longer defines defaultGreeting — this whole file is " +
        "checking against something that moved",
    ).toBe(true);
  });

  for (const [locale, sentence] of Object.entries(SPOKEN)) {
    it(`the server still speaks the ${locale} greeting this file pins`, () => {
      // If this fails, the SERVER changed its wording. That is allowed — but
      // the three mirrors have to move with it, which is the rest of this file,
      // so the sentence here is updated last rather than first.
      expect(
        server.includes(sentence),
        `the server no longer says the ${locale} greeting:\n  ${sentence}`,
      ).toBe(true);
    });
  }

  for (const [client, path] of Object.entries(MIRRORS)) {
    it(`${client} shows the same greeting the server speaks, in both languages`, () => {
      const mirror = saidIn(read(path));
      for (const [locale, sentence] of Object.entries(SPOKEN)) {
        // A boolean, not `toContain`: these files are tens of thousands of
        // characters and a failed `toContain` prints all of them, which buries
        // the one line somebody needs.
        expect(
          mirror.includes(sentence),
          `${client}'s catalogue is missing the ${locale} greeting:\n  ${sentence}\n` +
            `An owner is being shown a preview of words their callers do not hear.`,
        ).toBe(true);
      }
    });
  }

  it("no client still hard-codes the greeting outside its catalogue", () => {
    // The extraction is only finished if the old inline copy is gone. A file
    // that keeps its own literal is a second definition, and a second
    // definition is what put all three a commit behind the server.
    const LOGIC = {
      web: "apps/web/src/app/(app)/settings/missed-calls/page.tsx",
      android:
        "apps/android/app/src/main/kotlin/com/loonext/android/features/settings/SettingsLogic.kt",
      ios: "apps/ios/Loonext/Features/Settings/SettingsLogic.swift",
    };
    for (const [client, path] of Object.entries(LOGIC)) {
      expect(
        saidIn(read(path)).includes("We can't take your call right now."),
        `${client} still builds the greeting from its own literal instead of ` +
          `looking it up, so it can drift from the server again`,
      ).toBe(false);
    }
  });
});
