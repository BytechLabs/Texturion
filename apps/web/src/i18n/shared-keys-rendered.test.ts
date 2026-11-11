import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import * as shared from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { makeTranslate } from "./provider";

/**
 * A shared constant whose value is a catalogue key ("domain.referralCopy") has
 * to go through `t` or `say` before it reaches the page. Rendered bare, the
 * reader sees the key itself, which is how Billing's referral button came to
 * say "domain.referralCopy". This scan fails on a line that puts such a
 * constant in a JSX slot (`{KEY}`, `? KEY :`, `: KEY}`) with no translator
 * call before it on the line.
 */
const SRC = join(__dirname, "..");
const en = makeTranslate("en");

function isCatalogueKey(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^[a-z][A-Za-z]*\.[A-Za-z0-9_]+$/.test(value) &&
    en(value as Parameters<typeof en>[0]) !== value
  );
}

function sharedKeyConstants(): string[] {
  return Object.entries(shared)
    .filter(([name, value]) => /^[A-Z][A-Z0-9_]+$/.test(name) && isCatalogueKey(value))
    .map(([name]) => name);
}

/**
 * Shared lists and maps of records that hold keys in their properties, such as
 * `ON_CALL_PRESETS[].label`, with the names of those properties. On-call's
 * buttons rendered `{preset.label}` and showed "domain.onCallPresetTonight".
 */
function sharedKeyProperties(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const [name, value] of Object.entries(shared)) {
    if (!/^[A-Z][A-Z0-9_]+$/.test(name) || !value || typeof value !== "object") continue;
    const records = Array.isArray(value) ? value : Object.values(value);
    for (const record of records) {
      if (!record || typeof record !== "object" || Array.isArray(record)) continue;
      for (const [property, held] of Object.entries(record)) {
        if (!isCatalogueKey(held)) continue;
        const properties = found.get(name) ?? new Set<string>();
        properties.add(property);
        found.set(name, properties);
      }
    }
  }
  return found;
}

/** The lines that render a key-holding property of `names` without translating it. */
export function bareKeyPropertyLines(
  text: string,
  keyProperties: Map<string, Set<string>>,
): string[] {
  const properties = new Set<string>();
  for (const [name, held] of keyProperties) {
    if (new RegExp(`\\b${name}\\b`).test(text)) for (const property of held) properties.add(property);
  }
  if (properties.size === 0) return [];
  const slot = new RegExp(`\\{\\s*\\w+\\.(${[...properties].join("|")})\\s*\\}`, "g");
  return text.split("\n").filter((line) => {
    if (/^\s*import\b/.test(line)) return false;
    for (const match of line.matchAll(slot)) {
      const before = line.slice(0, match.index);
      // A React key and a template-string part are never shown to anyone.
      if (/key=$/.test(before) || before.endsWith("$")) continue;
      if (!/\b(?:t|say|sayWith|translate)\(/.test(before)) return true;
    }
    return false;
  });
}

/** Files whose matching property is their own already-translated text. */
const OWN_COPY: Record<string, string> = {
  "components/marketing/whats-new-page.tsx": "`copy` is the page's own translated copy, not a shared record",
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** The lines that render one of `names` without translating it first. */
export function bareKeyLines(text: string, names: readonly string[]): string[] {
  if (names.length === 0) return [];
  const slot = new RegExp(`[{?:]\\s*(${names.join("|")})\\s*[}:]`);
  return text.split("\n").filter((line) => {
    if (/^\s*import\b/.test(line)) return false;
    const match = slot.exec(line);
    if (!match) return false;
    const before = line.slice(0, match.index);
    return !/\b(?:t|say|sayWith|translate)\(/.test(before);
  });
}

describe("shared catalogue keys are translated before they render", () => {
  const names = sharedKeyConstants();

  it("finds the shared key constants it checks", () => {
    expect(names).toContain("REFERRAL_SHARE_COPY");
    expect(names.length).toBeGreaterThan(20);
  });

  it("flags a key rendered bare, and passes one wrapped in say()", () => {
    expect(bareKeyLines("  {copied ? REFERRAL_SHARE_COPIED : REFERRAL_SHARE_COPY}", names)).toHaveLength(1);
    expect(bareKeyLines("  {say(copied ? REFERRAL_SHARE_COPIED : REFERRAL_SHARE_COPY)}", names)).toEqual([]);
  });

  it("no web file renders one bare", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      bareKeyLines(readFileSync(file, "utf8"), names).map(
        (line) => `${relative(SRC, file)}: ${line.trim()}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  const keyProperties = sharedKeyProperties();

  it("finds the shared records that hold keys in their properties", () => {
    expect([...(keyProperties.get("ON_CALL_PRESETS") ?? [])]).toEqual(["label", "detail"]);
  });

  it("flags a key property rendered bare, and passes one wrapped in say()", () => {
    const file = "ON_CALL_PRESETS.map((preset) => (\n  <Button title={preset.detail}>\n    {preset.label}\n";
    expect(bareKeyPropertyLines(file, keyProperties)).toHaveLength(2);
    const fixed = "ON_CALL_PRESETS.map((preset) => (\n  <Button title={say(preset.detail)}>\n    {say(preset.label)}\n";
    expect(bareKeyPropertyLines(fixed, keyProperties)).toEqual([]);
  });

  it("no web file renders a key property bare", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !(relative(SRC, file).split("\\").join("/") in OWN_COPY))
      .flatMap((file) =>
        bareKeyPropertyLines(readFileSync(file, "utf8"), keyProperties).map(
          (line) => `${relative(SRC, file)}: ${line.trim()}`,
        ),
      );
    expect(offenders).toEqual([]);
  });

  it("every named exception still matches something", () => {
    const stale = Object.keys(OWN_COPY).filter(
      (path) => bareKeyPropertyLines(readFileSync(join(SRC, path), "utf8"), keyProperties).length === 0,
    );
    expect(stale).toEqual([]);
  });
});
