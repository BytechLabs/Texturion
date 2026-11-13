/**
 * A file that can render on the server takes the plain lookups from
 * `i18n/translate`, never from the "use client" provider.
 *
 * Every export of a "use client" module is a client reference on the server,
 * and calling one there throws "Attempted to call makeTranslate() from the
 * server". `/pay/<token>` and `/photos/<token>` did exactly that, so every
 * payment and photo link a customer opened answered 500 in production. The
 * build cannot see it on a dynamic page; only this scan can.
 */
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceFiles, sourceText, stripComments } from "@/test/source-tree";

const SRC = join(process.cwd(), "src");

/** The provider exports that are plain functions, callable outside React. */
const PLAIN = ["makeTranslate", "forwardTranslate", "sayWith", "sayEnglish"];

const PROVIDER = /import\s+(?!type\b)\{([^}]*)\}\s+from\s+["'](?:@\/i18n\/provider|(?:\.{1,2}\/)+(?:[\w-]+\/)*provider)["']/g;

function isClientModule(text: string): boolean {
  return /^\s*(["'])use client\1/.test(stripComments(text));
}

/** The plain functions a file imports, as values, from the provider. */
function plainFromProvider(text: string): string[] {
  const names: string[] = [];
  for (const match of stripComments(text).matchAll(PROVIDER)) {
    for (const part of match[1].split(",")) {
      const name = part.trim();
      if (name.startsWith("type ")) continue;
      const imported = name.split(/\s+as\s+/)[0].trim();
      if (PLAIN.includes(imported)) names.push(imported);
    }
  }
  return names;
}

describe("the scan itself", () => {
  it("finds a value import of a plain function, and not a type import", () => {
    expect(plainFromProvider('import { makeTranslate, type Translate } from "@/i18n/provider";')).toEqual([
      "makeTranslate",
    ]);
    expect(plainFromProvider('import { sayWith as say } from "../../i18n/provider";')).toEqual(["sayWith"]);
    expect(plainFromProvider('import type { Translate } from "@/i18n/provider";')).toEqual([]);
    expect(plainFromProvider('import { useT } from "@/i18n/provider";')).toEqual([]);
    expect(plainFromProvider('import { makeTranslate } from "@/i18n/translate";')).toEqual([]);
  });

  it("reads the directive past a leading comment", () => {
    expect(isClientModule('// note\n"use client";\nexport const a = 1;')).toBe(true);
    expect(isClientModule('export const a = 1;\n"use client";')).toBe(false);
  });
});

describe("translate is server-safe", () => {
  const files = sourceFiles(SRC, [".ts", ".tsx"]).filter((file) => !/\.test\.tsx?$/.test(file));

  it("the lookups live in a module with no directive that does not reach back into the provider", () => {
    const text = sourceText(join(SRC, "i18n", "translate.ts"));
    expect(isClientModule(text)).toBe(false);
    expect(text).not.toMatch(/from\s+["']\.\/provider["']/);
  });

  it("no file that can render on the server imports a plain lookup from the provider", () => {
    const offenders = files
      .filter((file) => !isClientModule(sourceText(file)))
      .flatMap((file) =>
        plainFromProvider(sourceText(file)).map(
          (name) => `${relative(SRC, file).split("\\").join("/")} imports ${name}`,
        ),
      );
    expect(offenders).toEqual([]);
  });

  it("covers the public token pages", () => {
    for (const page of ["components/public/payment-page.tsx", "components/public/job-photo-page.tsx"]) {
      const text = sourceText(join(SRC, page));
      expect(isClientModule(text), page).toBe(false);
      expect(text, page).toMatch(/from\s+["']@\/i18n\/translate["']/);
    }
  });
});
