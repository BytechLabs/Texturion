import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const sourceRoots = [".", "../../../apps/api/src", "../../../apps/web/src"];

it("passes the reader's locale to every TypeScript money formatter call", () => {
  const missingLocale: string[] = [];
  for (const root of sourceRoots) {
    const directory = resolve(import.meta.dirname, root);
    for (const name of readdirSync(directory, { recursive: true, encoding: "utf8" })) {
      if (!/\.tsx?$/u.test(name) || /\.(?:test|spec)\.tsx?$/u.test(name)) continue;
      const content = readFileSync(resolve(directory, name), "utf8");
      if (!content.includes("formatMoney")) continue;
      const source = ts.createSourceFile(name, content, ts.ScriptTarget.Latest);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
            node.expression.text === "formatMoney" && !node.arguments[3]) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          missingLocale.push(`${root}/${name}:${line + 1}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  expect(missingLocale).toEqual([]);
});
