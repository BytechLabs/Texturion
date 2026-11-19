import { readFileSync } from "node:fs";
import { relative } from "node:path";

import ts from "typescript";
import { expect, it } from "vitest";

import { productionSources } from "./test/source-tree";

const src = import.meta.dirname;
const maxRows = 1000;

function oversizedLimits(path: string) {
  const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const constants = new Map<string, number>();
  const failures: string[] = [];

  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer && ts.isNumericLiteral(declaration.initializer)) {
        constants.set(declaration.name.text, Number(declaration.initializer.text));
      }
    }
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "limit") {
      const [argument] = node.arguments;
      const limit = argument && ts.isNumericLiteral(argument) ? Number(argument.text)
        : argument && ts.isIdentifier(argument) ? constants.get(argument.text) : undefined;
      if (limit !== undefined && limit > maxRows) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        failures.push(`${relative(src, path)}:${line + 1} requests ${limit} rows`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return failures;
}

it("keeps PostgREST read limits within the hosted response ceiling", () => {
  const config = readFileSync(new URL("../../../supabase/config.toml", import.meta.url), "utf8");
  expect(config).toMatch(/^max_rows = 1000$/m);
  expect(productionSources(src).flatMap(oversizedLimits)).toEqual([]);
});
