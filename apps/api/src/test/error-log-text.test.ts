import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { productionSources, sourceText } from "./source-tree";

const SOURCE = fileURLToPath(new URL("../", import.meta.url));
const ERROR_NAMES = new Set(["e", "err", "error", "cause", "failure"]);

function rawErrorLines(file: string, text: string): number[] {
  if (!text.includes("console")) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const lines: number[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "console" &&
      node.expression.name.text === "error"
    ) {
      for (const arg of node.arguments) {
        const raw =
          (ts.isIdentifier(arg) && ERROR_NAMES.has(arg.text)) ||
          (ts.isPropertyAccessExpression(arg) && ERROR_NAMES.has(arg.name.text)) ||
          (ts.isNewExpression(arg) && arg.expression.getText(source).endsWith("Error"));
        if (raw) lines.push(source.getLineAndCharacterOfPosition(arg.getStart(source)).line + 1);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);

  return lines;
}

describe("Worker error logs", () => {
  it("detects raw arguments in both single-line and multiline console calls", () => {
    expect(rawErrorLines("example.ts", [
      'console.error("lookup failed", error);',
      'console.error("retry failed",',
      '  new Error("timeout"));',
      'console.error("write failed", result.error);',
      'console.error("lookup failed", errorLogText(error));',
      'console.error("lookup failed", error.message);',
    ].join("\n"))).toEqual([1, 3, 4]);
  });

  it("passes text to Workers Logs so it retains the exception message", () => {
    const files = productionSources(SOURCE).filter((file) => !relative(SOURCE, file).startsWith(`test${sep}`));
    const failures = files.flatMap((file) => rawErrorLines(file, sourceText(file)).map((line) => `${file}:${line}`));
    expect(failures, "Use errorLogText or reportHandledFailure for raw errors").toEqual([]);
  }, 20_000);
});
