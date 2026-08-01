/**
 * #459 — searching the phone's own address book.
 *
 * The rules that have to hold on all three clients: names match at word starts,
 * a digits-only query is a NUMBER search and not a name one, and the cap is
 * reported rather than hidden.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_DEVICE_CONTACT_ROWS,
  deviceContactMatches,
  filterDeviceContacts,
  type DeviceContactListRow,
} from "./device-contacts";

const row = (name: string, number = "+14165550123", id = name): DeviceContactListRow => ({
  id,
  name,
  number,
});

describe("deviceContactMatches", () => {
  it("shows everything for an empty query", () => {
    expect(deviceContactMatches(row("Dana Smith"), "")).toBe(true);
    expect(deviceContactMatches(row("Dana Smith"), "   ")).toBe(true);
  });

  it("matches a first name", () => {
    expect(deviceContactMatches(row("Dana Smith"), "dan")).toBe(true);
    expect(deviceContactMatches(row("Dana Smith"), "DAN")).toBe(true);
  });

  it("matches a surname, because that is how people are found", () => {
    expect(deviceContactMatches(row("Dana Smith"), "smi")).toBe(true);
    expect(deviceContactMatches(row("Alaska Roofing"), "roof")).toBe(true);
  });

  it("does NOT match mid-word", () => {
    // "Kasm" contains "sm". A list that returns names nobody typed is one
    // people stop reading.
    expect(deviceContactMatches(row("Kasm Roofing"), "sm")).toBe(false);
  });

  it("treats punctuation as a word break", () => {
    expect(deviceContactMatches(row("Smith-Jones"), "jones")).toBe(true);
    expect(deviceContactMatches(row("O'Brien"), "brien")).toBe(true);
  });

  it("handles a query exactly as long as the name", () => {
    // Trivial here, a runtime trap in the Swift port: `1...0` is not an empty
    // range in Swift. Asserted in all three so the case cannot be dropped from
    // one of them.
    expect(deviceContactMatches(row("Dana"), "dana")).toBe(true);
    expect(deviceContactMatches(row("Dana"), "zzzz")).toBe(false);
  });

  it("reads a digits-only query as a NUMBER search, never a name one", () => {
    // The bug this prevents: "1" matching "A1 Plumbing" on its name, which is
    // noise dressed as a result.
    // A number with no "1" anywhere in it, so the only way "1" could match is
    // through the name.
    expect(deviceContactMatches(row("A1 Plumbing", "+14045550999"), "1")).toBe(false);
    expect(deviceContactMatches(row("A1 Plumbing", "+14045550999"), "5550")).toBe(true);
  });

  it("matches a number however it was written down", () => {
    expect(deviceContactMatches(row("Dana", "+14165550123"), "5550123")).toBe(true);
    expect(deviceContactMatches(row("Dana", "(416) 555-0123"), "4165550123")).toBe(true);
  });
});

describe("filterDeviceContacts", () => {
  it("says when the cap hid rows rather than cutting the list silently", () => {
    // A list that stops at fifty without saying so reads as "these are all of
    // them", and somebody who cannot find their plumber concludes we never
    // read their contacts.
    const many = Array.from({ length: MAX_DEVICE_CONTACT_ROWS + 5 }, (_, i) =>
      row(`Person ${i}`, `+1416555${String(1000 + i)}`, `id-${i}`),
    );
    const page = filterDeviceContacts(many, "");
    expect(page.rows).toHaveLength(MAX_DEVICE_CONTACT_ROWS);
    expect(page.truncated).toBe(true);
  });

  it("is not truncated when everything fits", () => {
    const page = filterDeviceContacts([row("Dana Smith")], "dana");
    expect(page.rows).toHaveLength(1);
    expect(page.truncated).toBe(false);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterDeviceContacts([row("Dana Smith")], "zzz").rows).toEqual([]);
  });
});
