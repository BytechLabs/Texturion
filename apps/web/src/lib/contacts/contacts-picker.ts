import { buildImportCsv, type ImportMapping } from "./csv-import";

/**
 * Web Contacts Picker — progressive enhancement (D20 §3.3 / APP-FEATURES-V2
 * §3.3). Supported on Chrome for Android ONLY (no iOS Safari, no desktop), so
 * every entry point here is strictly additive: when unsupported the UI hides
 * the action entirely — there is NO fake button, and native address-book sync
 * stays roadmap (§3.4).
 *
 * The picker result is mapped onto the SAME canonical import CSV the CSV/vCard
 * importers build, so picked contacts flow through the one idempotent upsert +
 * dedupe + { imported, updated, skipped, errors } summary path — no new server
 * surface, no second pipeline (§3.3 "shared upsert route").
 */

/** The two properties JobText asks the picker for (name + phone). */
export const PICKER_PROPERTIES = ["name", "tel"] as const;

/**
 * A single result from `navigator.contacts.select(['name','tel'], …)`. The
 * Contacts Picker API returns arrays for every property (a contact can carry
 * several names/numbers); fields the user's device omits are simply absent.
 */
export interface PickedContact {
  name?: string[];
  tel?: string[];
}

/**
 * The subset of `navigator.contacts` (the `ContactsManager`) this feature
 * touches. Declared locally because the DOM lib does not yet ship these types
 * everywhere; the runtime feature-detect (`contactsPickerSupported`) is the
 * real gate.
 */
export interface ContactsManagerLike {
  select: (
    properties: readonly string[],
    options?: { multiple?: boolean },
  ) => Promise<PickedContact[]>;
  getProperties?: () => Promise<string[]>;
}

interface PickerNavigator {
  contacts?: ContactsManagerLike;
}

/**
 * Feature-detect the Web Contacts Picker (§3.3). Both the `contacts` slot on
 * `navigator` AND the global `ContactsManager` constructor must exist — the
 * spec's exact test — and it only resolves in a secure top-level context on
 * Chrome for Android. `getProperties` is additionally required because we ask
 * for specific properties; a partial polyfill missing it is treated as
 * unsupported. SSR-safe: returns false when there is no `window`/`navigator`.
 */
export function contactsPickerSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  const nav = navigator as Navigator & PickerNavigator;
  return (
    "contacts" in navigator &&
    "ContactsManager" in window &&
    typeof nav.contacts?.select === "function" &&
    typeof nav.contacts?.getProperties === "function"
  );
}

/** The `navigator.contacts` manager, or null when the picker is unsupported. */
export function getContactsManager(): ContactsManagerLike | null {
  if (!contactsPickerSupported()) return null;
  return (navigator as Navigator & PickerNavigator).contacts ?? null;
}

/** First non-empty, trimmed entry of an array-valued picker property. */
function firstValue(values: string[] | undefined): string {
  if (!values) return "";
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed !== "") return trimmed;
  }
  return "";
}

/** A contact row destined for the shared importer (raw, pre-normalization). */
export interface PickedRow {
  name: string;
  phone: string;
}

/**
 * Flatten the picker result into importer rows: the FIRST name plus one row
 * per DISTINCT phone on the card (contacts are phone-keyed, so a card with two
 * numbers becomes two contacts — mirrors the vCard rule §3.2). Numbers are
 * left raw here; the shared CSV pipeline normalizes to E.164 and reports any
 * un-normalizable number as a skip with a reason, exactly like CSV/vCard.
 * Cards with no phone at all are dropped (they cannot key a contact).
 */
export function mapPickedContacts(picked: readonly PickedContact[]): PickedRow[] {
  const rows: PickedRow[] = [];
  const seenPerCard = new Set<string>();
  for (const contact of picked) {
    const name = firstValue(contact.name);
    seenPerCard.clear();
    for (const rawTel of contact.tel ?? []) {
      const phone = rawTel.trim();
      if (phone === "") continue;
      // De-dupe identical raw numbers within a single card so one card never
      // emits the same number twice before normalization.
      if (seenPerCard.has(phone)) continue;
      seenPerCard.add(phone);
      rows.push({ name, phone });
    }
  }
  return rows;
}

/**
 * Serialize picked rows into the canonical import CSV (`phone,name` header)
 * the API's POST /v1/contacts/import consumes — reusing `buildImportCsv` so the
 * picker path is byte-identical to a CSV upload of the same data. `name` is
 * included only when at least one row carries one, so empty names never write
 * a header column that would blank existing contact names on re-import.
 */
export function pickedContactsToCsv(rows: readonly PickedRow[]): string {
  const dataRows = rows.map((row) => [row.phone, row.name]);
  const hasName = rows.some((row) => row.name !== "");
  const mapping: ImportMapping = hasName
    ? { phone: 0, name: 1 }
    : { phone: 0 };
  return buildImportCsv(dataRows, mapping);
}
