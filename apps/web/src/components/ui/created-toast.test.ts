/**
 * #724: a toast announcing something created or added either goes through
 * `createdToast`, with Open, or is listed here because its result is already
 * on screen. A new creation flow cannot ship a dead-end toast without being
 * added to this list on purpose.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "../..");

/** Creations whose result is already in view, so Open would point at the screen you are on. */
const STAYS_IN_PLACE: Record<string, string> = {
  "contacts.contactAdded": "the dialog navigates to the new contact",
  "appShell.templateCreated": "the template appears in the list behind the dialog",
  "settings.leadSourceAdded": "the source appears in the list it was typed into",
  "settings.closedDatesAdded": "the date appears in the list it was added to",
  "settingsMore.moduleAdded": "the module shows as on in the card it was switched on in",
};

const CREATION_KEY = /t\(\s*"([a-zA-Z]+\.[a-zA-Z]*(?:Created|Added))"/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** Keys announced by a plain `toast(` or `toast.success(` call in this source. */
function plainCreationToasts(source: string): string[] {
  const keys: string[] = [];
  for (const call of source.matchAll(/toast(?:\.success)?\(/g)) {
    // The message argument, up to the end of the call's first lines.
    const message = source.slice(call.index, call.index + 200);
    for (const match of message.matchAll(CREATION_KEY)) keys.push(match[1]);
  }
  return keys;
}

describe("creation toasts (#724)", () => {
  it("offer Open, or are listed as already showing their result", () => {
    const found = new Map<string, string>();
    for (const file of sourceFiles(SRC)) {
      for (const key of plainCreationToasts(readFileSync(file, "utf8"))) {
        found.set(key, file.slice(SRC.length + 1));
      }
    }
    // A scan that matched nothing proves nothing.
    expect(found.size).toBeGreaterThan(0);
    const deadEnds = [...found].filter(([key]) => !(key in STAYS_IN_PLACE));
    expect(deadEnds, "use createdToast, or list the key in STAYS_IN_PLACE with why").toEqual([]);
  });
});
