import { formatContactImportColumn } from "@loonext/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  contactsPickerSupported,
  getContactsManager,
  mapPickedContacts,
  pickedContactsToCsv,
  type PickedContact,
} from "./contacts-picker";

/**
 * Install a fake Web Contacts Picker environment: a `navigator.contacts`
 * manager and the `ContactsManager` global (both required by the spec's
 * feature-detect). `vi.stubGlobal` handles getter-only globals like
 * `navigator` (a plain assignment throws in the node test env);
 * `vi.unstubAllGlobals` in afterEach restores them.
 */
function stubPicker(
  manager: Partial<{
    select: unknown;
    getProperties: unknown;
  }> | null,
): void {
  const win: Record<string, unknown> = {};
  if (manager) win.ContactsManager = function ContactsManager() {};
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", manager ? { contacts: manager } : {});
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("contactsPickerSupported (feature-detect, D20 §3.3)", () => {
  it("is true only when navigator.contacts + ContactsManager + both methods exist", () => {
    stubPicker({
      select: () => Promise.resolve([]),
      getProperties: () => Promise.resolve(["name", "tel"]),
    });
    expect(contactsPickerSupported()).toBe(true);
  });

  it("is false when the ContactsManager global is absent (partial polyfill)", () => {
    // navigator.contacts present, but no ContactsManager on window.
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {
      contacts: {
        select: () => Promise.resolve([]),
        getProperties: () => Promise.resolve([]),
      },
    });
    expect(contactsPickerSupported()).toBe(false);
  });

  it("is false when getProperties is missing (spec requires it)", () => {
    stubPicker({ select: () => Promise.resolve([]) });
    expect(contactsPickerSupported()).toBe(false);
  });

  it("is false — and getContactsManager null — when the picker is absent (desktop/iOS)", () => {
    stubPicker(null);
    expect(contactsPickerSupported()).toBe(false);
    expect(getContactsManager()).toBeNull();
  });

  it("returns the live manager when supported", () => {
    const manager = {
      select: () => Promise.resolve([]),
      getProperties: () => Promise.resolve(["name", "tel"]),
    };
    stubPicker(manager);
    expect(getContactsManager()).toBe(manager);
  });
});

describe("mapPickedContacts (picker result → importer rows)", () => {
  it("maps name + tel, first name wins, one row per distinct number", () => {
    const picked: PickedContact[] = [
      { name: ["Ada Lovelace", "Ada"], tel: ["(416) 555-0100"] },
      { name: ["Grace"], tel: ["416-555-0111", "416-555-0111", "647 555 0122"] },
    ];
    expect(mapPickedContacts(picked)).toEqual([
      { name: "Ada Lovelace", phone: "(416) 555-0100" },
      { name: "Grace", phone: "416-555-0111" },
      { name: "Grace", phone: "647 555 0122" },
    ]);
  });

  it("drops cards with no phone (they cannot key a contact)", () => {
    const picked: PickedContact[] = [
      { name: ["No Number"], tel: [] },
      { name: ["Blank"], tel: ["   "] },
      { name: ["Kept"], tel: ["4165550100"] },
    ];
    expect(mapPickedContacts(picked)).toEqual([
      { name: "Kept", phone: "4165550100" },
    ]);
  });

  it("tolerates a missing name array (empty name, still imports the number)", () => {
    expect(mapPickedContacts([{ tel: ["4165550100"] }])).toEqual([
      { name: "", phone: "4165550100" },
    ]);
  });
});

describe("pickedContactsToCsv (shared importer CSV)", () => {
  it("builds a phone,name CSV that reuses the canonical importer format", () => {
    const { csv } = pickedContactsToCsv([
      { name: "Ada Lovelace", phone: "+14165550100" },
      { name: "Grace, Hopper", phone: "+14165550111" },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("phone,name");
    expect(lines[1]).toBe("+14165550100,Ada Lovelace");
    // RFC-4180 escaping, so a comma in a name never shifts the phone column.
    expect(lines[2]).toBe('+14165550111,"Grace, Hopper"');
  });

  it("omits the name column entirely when no picked contact has a name", () => {
    const { csv } = pickedContactsToCsv([
      { name: "", phone: "+14165550100" },
      { name: "", phone: "+14165550111" },
    ]);
    expect(csv.split("\r\n")[0]).toBe("phone");
  });

  /**
   * #248 round 3 — this door writes its own file, so it declares its own file.
   *
   * The API refuses any import whose columns are not all accounted for. There
   * is no header row a person chose here and no file to show anybody: the
   * picker asks the browser for `name` and `tel` and we write the CSV one line
   * later. So the function that decides the header states what it means, and a
   * caller cannot be left to work the declaration out for a file it did not
   * write — which would be guessing at exactly the thing the declaration exists
   * to stop being guessed at.
   */
  it("PK-1: declares every column it writes, by index and header", () => {
    const { csv, columns } = pickedContactsToCsv([
      { name: "Ada Lovelace", phone: "+14165550100" },
    ]);

    expect(columns.map(formatContactImportColumn)).toEqual([
      "0:phone:phone",
      "1:name:name",
    ]);
    // The declaration describes THIS file: same count, same headers, same
    // order. A declaration that drifts from the header is a 422 at best and a
    // column read as the wrong thing at worst.
    expect(csv.split("\r\n")[0].split(",")).toEqual(
      columns.map((column) => column.header),
    );
  });

  it("PK-2: declares one column when the file has one", () => {
    const { csv, columns } = pickedContactsToCsv([
      { name: "", phone: "+14165550100" },
    ]);

    expect(columns.map(formatContactImportColumn)).toEqual(["0:phone:phone"]);
    expect(csv.split("\r\n")[0].split(",")).toHaveLength(columns.length);
  });
});
