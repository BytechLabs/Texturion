import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const renderers = [
  {
    directory: "apps/web/src/app",
    extension: ".tsx",
    text: />\s*\{\s*formatPhone\(([\w.]+)\)\s*\}/g,
  },
  {
    directory: "apps/web/src/components",
    extension: ".tsx",
    text: />\s*\{\s*formatPhone\(([\w.]+)\)\s*\}/g,
  },
  {
    directory: "apps/android/app/src/main/kotlin/com/loonext/android/features",
    extension: ".kt",
    text: /\bText\(\s*formatPhone\(([\w.]+)\)/g,
  },
  {
    directory: "apps/ios/Loonext/Features",
    extension: ".swift",
    text: /\bText\(\s*formatPhone\(([\w.]+)\)/g,
  },
];

function readSources(path: string, extension: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(path, entry.name);
    if (entry.isDirectory()) return readSources(absolute, extension);
    return entry.name.endsWith(extension) && !entry.name.includes(".test.") ? [absolute] : [];
  });
}

function hasCopyAction(source: string, number: string) {
  return [
    `<CopyablePhoneNumber number={${number}}`,
    `copyValue={${number}}`,
    `copyValue: ${number}`,
    `copyValue = ${number}`,
    `phoneNumber={${number}}`,
    `phoneNumber: ${number}`,
    `phoneNumber = ${number}`,
    `phoneNumberCopyMenu(${number})`,
    `UIPasteboard.general.string = ${number}`,
    `clipboard.writeText(${number})`,
    `copyToClipboard(${number})`,
    `copyToClipboard(context, clipLabel, ${number})`,
    `AnnotatedString(${number})`,
    `onCopy(${number})`,
    `ClipData.newPlainText(copyLabel, ${number})`,
  ].some((operation) => source.includes(operation));
}

const selectNumber = /(?:\b(?:label|title):\s*|\bSelectOption(?:<[^>]+>)?\([^\n]{0,120}?)(?:formatPhone)\(([\w.]+)!?\)/g;

it("keeps formatted number choices copyable", () => {
  const missing: string[] = [];
  let checked = 0;
  for (const { directory, extension } of renderers) {
    for (const file of readSources(resolve(root, directory), extension)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(selectNumber)) {
        const index = match.index ?? 0;
        const nearby = source.slice(Math.max(index - 140, 0), index + match[0].length + 140);
        checked += 1;
        if (!hasCopyAction(nearby, match[1])) {
          missing.push(`${relative(root, file)}:${source.slice(0, index).split("\n").length} (${match[1]})`);
        }
      }
    }
  }
  expect(checked).toBeGreaterThan(0);
  expect(missing).toEqual([]);
});

it("requires a copy action for directly rendered phone numbers on all clients", () => {
  const missing: string[] = [];
  let checked = 0;
  for (const { directory, extension, text } of renderers) {
    for (const file of readSources(resolve(root, directory), extension)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(text)) {
        const number = match[1];
        const index = match.index ?? 0;
        checked += 1;
        if (!hasCopyAction(source, number)) {
          missing.push(`${relative(root, file)}:${source.slice(0, index).split("\n").length} (${number})`);
        }
      }
    }
  }
  expect(checked).toBeGreaterThan(0);
  expect(missing).toEqual([]);
});

it("distinguishes a display-only label from a copy of the full number", () => {
  expect(hasCopyAction("{formatPhone(call.number)}", "call.number")).toBe(false);
  expect(hasCopyAction("<CopyablePhoneNumber number={call.number} iconOnly />", "call.number")).toBe(true);
  expect(hasCopyAction("Button().phoneNumberCopyMenu(call.number)", "call.number")).toBe(true);
});
