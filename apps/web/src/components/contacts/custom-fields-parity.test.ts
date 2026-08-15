/**
 * #291 — the workspace's own contact fields read the same on all three clients.
 *
 * The sentence that matters is the privacy line. It is the only thing standing
 * between a text column and a card number, and it works only where the field is
 * being DEFINED — a client that dropped it, softened it, or moved it to a help
 * page would be a client where an owner never sees it.
 *
 * The second is the delete warning. Removing a field hides it; it does not
 * erase what the crew typed. A client that said nothing would leave an owner
 * believing they had deleted something.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CONTACT_FIELDS_CAP,
  CONTACT_FIELDS_COPY,
  CONTACT_FIELD_KINDS,
  CONTACT_FIELD_OPTIONS_CAP,
  CONTACT_FIELD_VALUE_MAX,
} from "@loonext/shared";

import { describe, expect, it } from "vitest";

import { contactsEn } from "@/i18n/sections/contacts";

import { parityCode } from "./parity-source";

/**
 * #228 — web's answer states live in the catalogue now. The KEYS are listed
 * rather than the whole section: a join of every sentence turns each assertion
 * into a substring search over unrelated copy, which is how the sibling
 * contact-filter guard passed with its chip renamed.
 */
const WEB_WORDS = [contactsEn.notAsked, contactsEn.notSet, contactsEn.yes, contactsEn.no].join(
  "\n",
);

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

/** Where the shared vocabulary is hand-ported. */
const PORTS: Record<string, string> = {
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/core/contacts/ContactFields.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Core/ContactFields.swift"),
};

/**
 * #228 — where the SENTENCES live now.
 *
 * The ports above still hold the rule (kinds, caps, key derivation); what they
 * no longer hold is the copy, which moved to each client's catalogue. So the
 * phrase assertions read these three, and the "does this screen reach the
 * privacy line at all" assertions keep reading the screens — those are two
 * different questions and pointing both at one file is how a guard goes quiet.
 */
const CATALOGUES: Record<string, string> = {
  web: join(REPO_ROOT, "apps/web/src/i18n/sections/settings.ts"),
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/core/i18n/SettingsStrings.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Core/I18n/SettingsStrings.swift"),
};

/** Where the values are filled in on a contact. */
const VALUE_SURFACES: Record<string, string> = {
  web: join(REPO_ROOT, "apps/web/src/components/contacts/custom-fields.tsx"),
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/features/contacts/CustomFields.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Features/Contacts/CustomFields.swift"),
};

/** Where the fields are defined. */
const SETTINGS_SURFACES: Record<string, string> = {
  web: join(
    REPO_ROOT,
    "apps/web/src/components/settings/contact-fields-card.tsx",
  ),
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/features/settings/ContactFieldsCard.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Features/Settings/ContactFieldsCard.swift"),
};

const read = (path: string) => readFileSync(path, "utf8");

/**
 * The source with its comments removed.
 *
 * EVERY assertion below runs against this rather than the raw file. Half of
 * them were decorative before it existed: the prose explaining why "Not asked"
 * is a third state contains the words "Not asked", so a client that collapsed
 * the state and left the comment in place still passed. Found by making that
 * exact change and watching the test stay green.
 */
const code = parityCode;

describe("#291 the contact fields read the same everywhere", () => {
  it("reads every source, so a passing run means something", () => {
    // Without this, a renamed file makes every assertion below vacuous — the
    // readFileSync would throw, but a glob-based version would silently check
    // nothing. Named explicitly and asserted non-trivial.
    for (const [platform, path] of Object.entries({
      ...PORTS,
      ...VALUE_SURFACES,
      ...SETTINGS_SURFACES,
    })) {
      expect(read(path).length, platform).toBeGreaterThan(1000);
    }
  });

  it("says the privacy line where fields are DEFINED, on every client", () => {
    // Not on the contact screen, and not in a help page: the moment somebody
    // is deciding what a field is for is the only moment it lands.
    const missing: string[] = [];
    for (const [platform, path] of Object.entries(SETTINGS_SURFACES)) {
      const text = code(path);
      // The card may reach it through the shared constant OR carry the words;
      // what must not happen is neither.
      const reachesIt =
        text.includes("CONTACT_FIELDS_COPY.privacy") ||
        text.includes("Copy.PRIVACY") ||
        text.includes("Copy.privacy") ||
        text.includes("card numbers");
      if (!reachesIt) missing.push(platform);
    }
    expect(
      missing,
      "The #291 privacy line never reaches these settings screens:",
    ).toEqual([]);
  });

  it("names the three data classes, rather than gesturing at them", () => {
    // "Be careful what you store" is advice nobody acts on. These three are
    // the classes our store declarations (#254) and retention policy (#284)
    // do not cover, which is why they are the ones named.
    for (const phrase of [
      "card numbers",
      "government IDs",
      "health information",
    ]) {
      // #228: the shared constant names a key, so the words are checked where
      // they now live — in all three catalogues, so no client can soften it.
      for (const [platform, path] of Object.entries(CATALOGUES)) {
        expect(code(path), `${platform}: ${phrase}`).toContain(phrase);
      }
    }
    // And the key itself still points at the privacy line rather than at some
    // other sentence — the check above would pass on a catalogue that held
    // these words anywhere.
    expect(CONTACT_FIELDS_COPY.privacy).toBe("settings.contactFieldsPrivacy");
  });

  it("warns that removing a field keeps the values, on every client", () => {
    for (const [platform, path] of Object.entries(SETTINGS_SURFACES)) {
      const text = code(path);
      const reachesIt =
        text.includes("CONTACT_FIELDS_COPY.delete_warning") ||
        text.includes("Copy.DELETE_WARNING") ||
        text.includes("Copy.deleteWarning") ||
        text.includes("stays");
      expect(reachesIt, platform).toBe(true);
    }
  });

  it("agrees on every limit, so a phone and the server refuse the same thing", () => {
    // A client with a larger cap lets somebody fill in an eleventh field and
    // learn at save time; a smaller one hides a field the server would accept.
    const android = code(PORTS.android);
    const ios = code(PORTS.ios);

    expect(android).toContain(`const val CAP = ${CONTACT_FIELDS_CAP}`);
    expect(ios).toContain(`static let cap = ${CONTACT_FIELDS_CAP}`);
    expect(android).toContain(`const val OPTIONS_CAP = ${CONTACT_FIELD_OPTIONS_CAP}`);
    expect(ios).toContain(`static let optionsCap = ${CONTACT_FIELD_OPTIONS_CAP}`);
    expect(android).toContain(`const val VALUE_MAX = ${CONTACT_FIELD_VALUE_MAX}`);
    expect(ios).toContain(`static let valueMax = ${CONTACT_FIELD_VALUE_MAX}`);

    // And the same kinds, in the same order — the order is what a picker shows.
    const list = CONTACT_FIELD_KINDS.map((kind) => `"${kind}"`).join(", ");
    expect(android).toContain(`val KINDS = listOf(${list})`);
    expect(ios).toContain(`static let kinds = [${list}]`);
  });

  it("keeps 'Not asked' distinct from 'No' on every client", () => {
    // A yes/no field that has never been answered is not a no. Collapsing the
    // two makes somebody ask a customer a question they already answered.
    for (const [platform, path] of Object.entries(VALUE_SURFACES)) {
      const text = platform === "web" ? WEB_WORDS : code(path);
      expect(text, `${platform}: Not asked`).toContain("Not asked");
      expect(text, `${platform}: Not set`).toContain("Not set");
    }
  });
});
