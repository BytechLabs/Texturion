import { relative, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

import { productionSources, sourceText } from "../test/source-tree";

const routes = resolve(import.meta.dirname, "../routes");
const followUpByRpc = new Map([
  ["create_task", "afterTaskCreated"],
  ["create_task_with_date", "afterTaskCreated"],
  ["api_create_public_task", "afterTaskCreated"],
  ["api_bulk_tasks", "afterTasksCompleted"],
  ["set_task_done", "afterTasksCompleted"],
  ["set_message_done", "afterPromotedMessageDoneChange"],
]);

function callsFollowUp(node: ts.Node, name: string): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
    return true;
  }
  return ts.forEachChild(node, (child) => {
    if (!ts.isFunctionLike(child) && callsFollowUp(child, name)) return true;
    return undefined;
  }) === true;
}

function missingFollowUps(file: string): string[] {
  const violations: string[] = [];
  const source = ts.createSourceFile(file, sourceText(file), ts.ScriptTarget.Latest, true);
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "rpc") {
      const [rpcName] = node.arguments;
      if (rpcName && ts.isStringLiteral(rpcName)) {
        const rpc = rpcName.text;
        const followUp = followUpByRpc.get(rpc);
        if (followUp) {
          const handler = ts.findAncestor(node, ts.isFunctionLike);
          if (!handler || !callsFollowUp(handler, followUp)) {
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            violations.push(`${relative(routes, file)}:${line} calls ${rpc} without ${followUp}`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return violations;
}

it("runs the task follow-up in every route that creates or completes a job", () => {
  expect(productionSources(routes).flatMap(missingFollowUps)).toEqual([]);
});
