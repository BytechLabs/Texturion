import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { productionSources, sourceText } from "./source-tree";

const SOURCE = fileURLToPath(new URL("../", import.meta.url));
const ERROR_NAMES = new Set(["e", "err", "error", "cause", "failure"]);
const LOG_LEVELS = new Set(["error", "warn", "info", "log", "debug"]);

function unwrapArgument(argument: ts.Expression): ts.Expression {
  let value = argument;
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isTypeAssertionExpression(value) ||
    ts.isNonNullExpression(value) ||
    ts.isSatisfiesExpression(value)
  ) {
    value = value.expression;
  }
  return value;
}

function isConsoleLog(expression: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(expression) && !ts.isElementAccessExpression(expression)) return false;
  if (!ts.isIdentifier(expression.expression) || expression.expression.text !== "console") return false;
  if (ts.isPropertyAccessExpression(expression)) return LOG_LEVELS.has(expression.name.text);
  const level = expression.argumentExpression;
  return ts.isStringLiteralLike(level) && LOG_LEVELS.has(level.text);
}

function rawErrorLines(file: string, text: string): number[] {
  if (!text.includes("console")) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const lines: number[] = [];

  function visit(node: ts.Node, caught: readonly string[] = []) {
    const name = ts.isCatchClause(node) ? node.variableDeclaration?.name : undefined;
    const bindings = name && ts.isIdentifier(name) ? [...caught, name.text] : caught;
    if (ts.isCallExpression(node) && isConsoleLog(node.expression)) {
      for (const argument of node.arguments) {
        const arg = unwrapArgument(argument);
        const raw =
          (ts.isIdentifier(arg) && (bindings.includes(arg.text) || ERROR_NAMES.has(arg.text.replace(/_$/, "")))) ||
          (ts.isPropertyAccessExpression(arg) && ERROR_NAMES.has(arg.name.text.replace(/_$/, ""))) ||
          (ts.isNewExpression(arg) && arg.expression.getText(source).endsWith("Error"));
        if (raw) lines.push(source.getLineAndCharacterOfPosition(argument.getStart(source)).line + 1);
      }
    }
    ts.forEachChild(node, (child) => visit(child, bindings));
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
      'console.warn("lookup failed", error_);',
      'try { retry(); } catch (thrown) { console.info("retry failed", thrown); }',
      'console["error"]("sweep failed", (error as Error));',
      'try { retry(); } catch (outer) { try { log(); } catch (inner) { console.info("retry failed", outer!); } }',
      'other["error"]("lookup failed", error);',
      'console["warn"]("lookup failed", String(error));',
    ].join("\n"))).toEqual([1, 3, 4, 7, 8, 9, 10]);
  });

  it("passes text to Workers Logs so it retains the exception message", () => {
    const files = productionSources(SOURCE).filter((file) => !relative(SOURCE, file).startsWith(`test${sep}`));
    const failures = files.flatMap((file) => rawErrorLines(file, sourceText(file)).map((line) => `${file}:${line}`));
    expect(failures, "Use errorLogText or reportHandledFailure for raw errors").toEqual([]);
  }, 20_000);
});
