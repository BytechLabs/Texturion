import { describe, expect, it } from "vitest";

import {
  CONTACT_FIELDS_COPY,
  CONTACT_FIELD_VALUE_MAX,
  contactFieldKey,
  contactFieldValueError,
} from "./contact-fields";

describe("contactFieldKey", () => {
  it("CF-1: turns a label into something a CSV header can survive", () => {
    // The same string becomes a JSON key AND a column head for import mapping
    // (#248) and export (#227). A key with a comma in it makes a file that
    // reads back wrong, two features from now.
    expect(contactFieldKey("Boiler model")).toBe("boiler_model");
    expect(contactFieldKey("Serial #")).toBe("serial");
    expect(contactFieldKey("Warranty expiry, if any")).toBe(
      "warranty_expiry_if_any",
    );
    // A label that STARTS with punctuation. The leading trim is the only thing
    // standing between "#Serial" and a null — without it the key is "_serial",
    // which fails the must-start-with-a-letter check and the field cannot be
    // created at all.
    expect(contactFieldKey("#Serial")).toBe("serial");
  });

  it("CF-2: refuses rather than inventing a name", () => {
    // "???" is not a field name. Generating one would produce a column nobody
    // can map back to anything, discovered at import time by somebody who did
    // not create it.
    expect(contactFieldKey("???")).toBeNull();
    expect(contactFieldKey("   ")).toBeNull();
    // Leading digits are legal JSON and an awkward column head, and the
    // database refuses them anyway.
    expect(contactFieldKey("2nd meter")).toBeNull();
  });

  it("CF-3: never ends in the separator it introduced", () => {
    // "Serial #" collapses to "serial_" before trimming. A trailing underscore
    // is not wrong exactly, but it shows up in every export header.
    expect(contactFieldKey("Serial #")).not.toMatch(/_$/);
    expect(contactFieldKey("Model (v2)")).not.toMatch(/_$/);

    // The case the FINAL strip exists for, and the only one it catches: a
    // label long enough that the 40-character cut lands on a separator the
    // sanitiser itself introduced. Found by breaking the strip and watching
    // the short cases above carry on passing.
    const long = `${"x".repeat(39)} tail`;
    expect(contactFieldKey(long)).toBe("x".repeat(39));
  });
});

describe("contactFieldValueError", () => {
  const text = { kind: "text" as const, options: null, label: "Notes" };
  const number = { kind: "number" as const, options: null, label: "Capacity" };
  const date = { kind: "date" as const, options: null, label: "Warranty" };
  const select = {
    kind: "select" as const,
    options: ["Combi", "System"],
    label: "System type",
  };
  const checkbox = { kind: "checkbox" as const, options: null, label: "Dog" };

  it("CF-4: empty is always allowed, because it is an ANSWER", () => {
    // "We asked and there is no gate code" is a fact worth recording, and it
    // is not the same as never having asked.
    for (const def of [text, number, date, select, checkbox]) {
      expect(contactFieldValueError(def, ""), def.kind).toBeNull();
    }
  });

  it("CF-5: a date field takes a date, not a phrase", () => {
    // "next Tuesday" is a value nothing downstream can sort, filter or remind
    // on — and it would look fine on the screen where it was typed.
    expect(contactFieldValueError(date, "2027-03-01")).toBeNull();
    expect(contactFieldValueError(date, "next Tuesday")).toContain("Warranty");
  });

  it("CF-6: a select takes one of its own choices", () => {
    expect(contactFieldValueError(select, "Combi")).toBeNull();
    expect(contactFieldValueError(select, "Combie")).toContain("choices");
  });

  it("CF-7: the reason names the FIELD, so somebody can find it", () => {
    // A form with ten custom fields and one error saying "invalid" is a form
    // somebody edits at random until it saves.
    expect(contactFieldValueError(number, "abc")).toBe(
      "Capacity should be a number",
    );
    expect(contactFieldValueError(checkbox, "maybe")).toBe(
      "Dog should be yes or no",
    );
  });

  it("CF-8: a value has a ceiling", () => {
    const long = "x".repeat(CONTACT_FIELD_VALUE_MAX + 1);
    expect(contactFieldValueError(text, long)).toContain("too long");
  });
});

describe("the privacy line", () => {
  it("CF-9: names the categories rather than gesturing at them", () => {
    // "Be careful what you store" is advice nobody acts on. The three classes
    // named here are the ones our store declarations (#254) and retention
    // policy (#284) do not cover, so they are the ones worth naming.
    expect(CONTACT_FIELDS_COPY.privacy).toContain("card numbers");
    expect(CONTACT_FIELDS_COPY.privacy).toContain("government IDs");
    expect(CONTACT_FIELDS_COPY.privacy).toContain("health information");
  });

  it("CF-10: says what happens to what people already typed", () => {
    // Removing a definition hides the field; it does not erase the values.
    // A workspace that assumed otherwise would think it had deleted something.
    expect(CONTACT_FIELDS_COPY.delete_warning).toContain("stays");
  });
});
