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

import { parityCode } from "./parity-source";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

/** Where the shared vocabulary is hand-ported. */
const PORTS: Record<string, string> = {
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/core/contacts/ContactFields.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Core/ContactFields.swift"),
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
      expect(CONTACT_FIELDS_COPY.privacy, phrase).toContain(phrase);
      for (const [platform, path] of Object.entries(PORTS)) {
        expect(code(path), `${platform}: ${phrase}`).toContain(phrase);
      }
    }
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
      expect(code(path), `${platform}: Not asked`).toContain("Not asked");
      expect(code(path), `${platform}: Not set`).toContain("Not set");
    }
  });
});
