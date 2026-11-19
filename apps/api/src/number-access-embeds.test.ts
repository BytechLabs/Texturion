import { relative } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

import { productionSources, sourceText } from "./test/source-tree";

const sourceRoot = import.meta.dirname;

function filtersParent(scope: ts.Node, table: string): boolean {
  const innerEmbed = new RegExp(`\\b${table}(?:!\\w+)?!inner\\s*\\(`);
  function visit(node: ts.Node): true | undefined {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const filter = node.arguments[0]?.getText() ?? "";
      if (node.expression.name.text === "select" && innerEmbed.test(filter)) return true;
      if (node.expression.name.text === "or" && node.arguments.length === 1 &&
          filter.includes(`${table}.not.is.null`)) return true;
    }
    return ts.forEachChild(node, visit);
  }
  return visit(scope) === true;
}

function unfilteredNumberEmbeds(path: string): string[] {
  const content = sourceText(path);
  if (!content.includes("referencedTable") || !content.includes("phone_number_id")) return [];

  const file = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  const failures: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "or") {
      const [filter, options] = node.arguments;
      if (filter?.getText(file).includes("phone_number_id") && options) {
        const table = ts.isObjectLiteralExpression(options)
          ? options.properties.find((property): property is ts.PropertyAssignment =>
              ts.isPropertyAssignment(property) && property.name.getText(file) === "referencedTable")
              ?.initializer
          : undefined;
        const scope = ts.findAncestor(node, ts.isFunctionLike) ?? file;
        const name = table && ts.isStringLiteral(table) ? table.text : "";
        if (!/^\w+$/.test(name) || !filtersParent(scope, name)) {
          const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
          failures.push(`${relative(sourceRoot, path)}:${line + 1}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return failures;
}

it("applies embedded number access to the parent rows", () => {
  expect(productionSources(sourceRoot).flatMap(unfilteredNumberEmbeds)).toEqual([]);
});
