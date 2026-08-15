import { describe, expect, it } from "vitest";

import {
  PORT_PRE_CUTOVER_CHECKLIST,
  PORT_PRE_CUTOVER_STATUSES,
  isBeforePortCutover,
} from "./porting";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/*
 * #228 — the checklist names keys, so the assertions resolve them through the
 * catalogue the card reads.
 */
function lookUp(table: unknown, key: string, lang: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[name];
  if (typeof value !== "string") throw new Error(`no ${lang} for ${key}`);
  return value;
}

const say = (key: string): string => lookUp(WEB_EN, key, "English");
const sayFr = (key: string): string => lookUp(WEB_FR, key, "French");

describe("#319/#248 what a customer is told while their number is transferring", () => {
  it("warns while the transfer is in flight and not before or after", () => {
    for (const status of PORT_PRE_CUTOVER_STATUSES) {
      expect(isBeforePortCutover(status)).toBe(true);
    }
    // `draft` — nothing in flight. `exception` — the rejection notice owns that
    // screen. `ported` onwards — too late to export, moot once switched.
    for (const status of [
      "draft",
      "exception",
      "ported",
      "cancel-pending",
      "cancelled",
    ]) {
      expect(isBeforePortCutover(status)).toBe(false);
    }
  });

  it("treats an unknown status as nothing to warn about", () => {
    // An allowlist, so a status added to the carrier vocabulary later starts
    // silent and gets considered, rather than inheriting a warning about a
    // deadline it may not have.
    expect(isBeforePortCutover("some-new-carrier-state")).toBe(false);
    expect(isBeforePortCutover("")).toBe(false);
  });

  it("leads with the item that can lose the number", () => {
    // ORDER IS THE CONTRACT, not decoration. A reader skims the bold leads and
    // stops; the one that costs them the number on their trucks has to be the
    // one they cannot miss. Every other item here is an inconvenience.
    const first = PORT_PRE_CUTOVER_CHECKLIST.items[0]!;
    expect(say(first.lead)).toBe("Keep your old service active.");
    expect(say(first.detail)).toContain("release the number back to the carrier");
    // And in French, because the order is the contract in both languages and a
    // reader who skims the bold leads is skimming whichever ones they can read.
    expect(sayFr(first.detail)).toMatch(/perdre|libérer/i);
  });

  it("says something under every lead, on every row", () => {
    // A lead with no reason under it is an instruction a business owner has to
    // take on trust while looking at a bill they want to cancel.
    expect(PORT_PRE_CUTOVER_CHECKLIST.items.length).toBeGreaterThanOrEqual(4);
    for (const item of PORT_PRE_CUTOVER_CHECKLIST.items) {
      expect(item.lead.trim()).not.toBe("");
      expect(item.detail.trim()).not.toBe("");
    }
  });
});

/*
 * #228 — every key the checklist names, resolved in both languages.
 *
 * This list is read by somebody whose business number is mid-transfer, and one
 * of its four items is the difference between keeping that number and losing
 * it. A half-translated checklist there is worse than an English one: it reads
 * as though the untranslated line is the unimportant one.
 */
describe("#228 the pre-cutover checklist reads in both languages", () => {
  it("resolves the heading and every lead and detail", () => {
    const keys = [
      PORT_PRE_CUTOVER_CHECKLIST.heading,
      ...PORT_PRE_CUTOVER_CHECKLIST.items.flatMap((item) => [item.lead, item.detail]),
    ];
    for (const key of keys) {
      expect(say(key).length, key).toBeGreaterThan(0);
      expect(sayFr(key).length, key).toBeGreaterThan(0);
      expect(sayFr(key), `${key} is not translated`).not.toBe(say(key));
    }
    expect(keys.length).toBe(9);
  });

  it("gives every item its own lead", () => {
    // Four items sharing a lead would satisfy every assertion above while
    // making the list say one thing four times.
    const leads = PORT_PRE_CUTOVER_CHECKLIST.items.map((item) => say(item.lead));
    expect(new Set(leads).size).toBe(PORT_PRE_CUTOVER_CHECKLIST.items.length);
  });
});
