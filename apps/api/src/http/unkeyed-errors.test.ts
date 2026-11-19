import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const apiSource = join(import.meta.dirname, "..");
const unkeyedBudget = { errorResponse: 513, ApiError: 298 };

it("does not add unkeyed API errors", () => {
  const counts = { errorResponse: 0, ApiError: 0 };
  for (const name of readdirSync(apiSource, { recursive: true, encoding: "utf8" })) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const content = readFileSync(join(apiSource, name), "utf8");
    if (!content.includes("errorResponse") && !content.includes("ApiError")) continue;
    const source = ts.createSourceFile(name, content, ts.ScriptTarget.Latest);
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        node.expression.text === "errorResponse" && !node.arguments[3]) {
        counts.errorResponse++;
      }
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) &&
        node.expression.text === "ApiError" && !node.arguments?.[2]) {
        counts.ApiError++;
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  for (const name of ["errorResponse", "ApiError"] as const) {
    expect(counts[name], `New ${name} refusals need a catalogue key`)
      .toBeLessThanOrEqual(unkeyedBudget[name]);
  }
});
