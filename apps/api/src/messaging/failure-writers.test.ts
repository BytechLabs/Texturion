import { createRequire } from "node:module";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import type * as TypeScript from "typescript";
import { expect, it } from "vitest";

import { productionSources, sourceText } from "../test/source-tree";

const ts = createRequire(import.meta.url)("typescript") as typeof TypeScript;
const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const interruptedWriter = fileURLToPath(new URL("send.ts", import.meta.url));

function uncoveredFailureWrites(path: string): number[] {
  const text = sourceText(path);
  if (!text.includes("persistMessagePatch") && !/\.from\(\s*["']messages["']/.test(text)) return [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const declarations: [name: string, value: TypeScript.Expression][] = [];
  const uncovered: number[] = [];

  function values(expression: TypeScript.Expression): TypeScript.Expression[] {
    if (ts.isConditionalExpression(expression)) {
      return [...values(expression.whenTrue), ...values(expression.whenFalse)];
    }
    if (ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression)) {
      return values(expression.expression);
    }
    if (ts.isIdentifier(expression)) {
      const declaration = declarations.findLast(([name]) => name === expression.text);
      if (declaration) return values(declaration[1]);
    }
    return [expression];
  }

  function visit(node: TypeScript.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.push([node.name.text, node.initializer]);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const patch = ts.isIdentifier(callee) && callee.text === "persistMessagePatch"
        ? node.arguments[2]
        : (ts.isPropertyAccessExpression(callee) && callee.name.text === "update" &&
            /\.from\(\s*["']messages["']\s*\)$/.test(callee.expression.getText(source))
          ? node.arguments[0]
          : undefined);
      for (const candidate of patch ? values(patch) : []) {
        if (!ts.isObjectLiteralExpression(candidate)) continue;
        const fields = new Map(candidate.properties.flatMap((property) =>
          ts.isPropertyAssignment(property)
            ? [[property.name.getText(source).replaceAll(/["']/g, ""), property.initializer] as const]
            : [],
        ));
        const status = fields.get("status");
        if (!status || !values(status).some((value) =>
          ts.isStringLiteralLike(value) && value.text === "failed"
        )) continue;
        const interrupted = fields.get("error_code");
        if (path === interruptedWriter &&
            interrupted?.getText(source) === "SEND_INTERRUPTED_ERROR_CODE") continue;
        if (!fields.has("error_reason")) {
          uncovered.push(source.getLineAndCharacterOfPosition(candidate.getStart(source)).line + 1);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return uncovered;
}

it("records a reason when an API writer marks a message failed", () => {
  const uncovered = productionSources(sourceRoot).flatMap((path) =>
    uncoveredFailureWrites(path).map((line) => `${relative(sourceRoot, path)}:${line}`),
  );
  expect(uncovered).toEqual([]);
});
