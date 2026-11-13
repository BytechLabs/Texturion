/**
 * `unwrap` is only handed a query that returns rows.
 *
 * `unwrap` throws when `data` is null. PostgREST returns no body for an insert,
 * update, delete or upsert without `.select()`, and null from `.maybeSingle()`
 * when no row matched, so `unwrap` around either reports a successful call as
 * a failure. Ten writes and five reads did: saving the appointment reminder
 * rules deleted them and answered 500, and every finished job logged
 * "job rating ask failed" after queueing the ask. The route tests' fakes
 * answered those writes with `[]`, which the database never does.
 *
 * A write with no `.select()` takes `expectOk`; a `.maybeSingle()` read takes
 * `unwrapOptional`. Failing output names file:line.
 */
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { productionSources, sourceText } from "./source-tree";

const API_SRC = join(import.meta.dirname, "..");

const WRITES = new Set(["insert", "update", "delete", "upsert"]);
const RETURNS_ROWS = new Set(["select", "single", "maybeSingle"]);

/** How many variables, `.then` callbacks, helpers and `Promise.all` slots a result is followed through. */
const MAX_HOPS = 4;

type Misuse = "write returns no row" | "maybeSingle may be null";

interface Finding {
  line: number;
  misuse: Misuse;
}

interface Scan {
  /** `unwrap` calls whose query the scan could read. */
  chains: number;
  /** Lines of the `unwrap` calls whose argument it could not trace to a query. */
  untraced: number[];
  findings: Finding[];
}

/** A call chain's method names, and the expression it starts from: `a.b().c()` gives [c, b] and `a`. */
function chainOf(node: ts.Expression): { methods: string[]; root: ts.Expression } {
  const methods: string[] = [];
  let current = node;
  for (;;) {
    if (
      ts.isAwaitExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      current = current.expression;
    } else if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
      methods.push(current.expression.name.text);
      current = current.expression.expression;
    } else {
      return { methods, root: current };
    }
  }
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** The elements of `Promise.all([...])`, awaited or not. */
function promiseAllElements(node: ts.Expression): readonly ts.Expression[] | undefined {
  let current = node;
  while (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current)) current = current.expression;
  if (
    ts.isCallExpression(current) &&
    current.expression.getText() === "Promise.all" &&
    current.arguments.length === 1 &&
    ts.isArrayLiteralExpression(current.arguments[0])
  ) {
    return current.arguments[0].elements;
  }
  return undefined;
}

/** What a function hands back: an arrow's expression body, or every `return`. */
function returnedExpressions(fn: ts.FunctionLikeDeclaration): ts.Expression[] {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const returned: ts.Expression[] = [];
  const search = (inner: ts.Node): void => {
    if (ts.isReturnStatement(inner) && inner.expression) returned.push(inner.expression);
    ts.forEachChild(inner, search);
  };
  search(fn.body);
  return returned;
}

/** The function a name is bound to in the file, declared or assigned to a `const`. */
function localFunction(name: ts.Identifier): ts.FunctionLikeDeclaration | undefined {
  let found: ts.FunctionLikeDeclaration | undefined;
  const search = (inner: ts.Node): void => {
    if (found) return;
    if (ts.isFunctionDeclaration(inner) && inner.name?.text === name.text) found = inner;
    else if (
      ts.isVariableDeclaration(inner) &&
      ts.isIdentifier(inner.name) &&
      inner.name.text === name.text &&
      inner.initializer &&
      isFunctionLike(inner.initializer)
    ) {
      found = inner.initializer;
    }
    ts.forEachChild(inner, search);
  };
  search(name.getSourceFile());
  return found;
}

/**
 * The query methods behind an expression: its own chain, then whatever its
 * root leads to. That is a variable, a `.then` receiver, a `Promise.all` slot,
 * either branch of a conditional, or a helper called with the query or
 * returning one. Without `from` or `rpc` in the result, it was not traced.
 */
function queryMethods(node: ts.Expression, hops = 0): string[] {
  const { methods, root } = chainOf(node);
  if (hops >= MAX_HOPS) return methods;

  if (ts.isConditionalExpression(root)) {
    return [...methods, ...queryMethods(root.whenTrue, hops + 1), ...queryMethods(root.whenFalse, hops + 1)];
  }
  if (ts.isCallExpression(root) && ts.isIdentifier(root.expression)) {
    const helper = localFunction(root.expression);
    return [
      ...methods,
      ...root.arguments.flatMap((argument) => queryMethods(argument, hops + 1)),
      ...(helper ? returnedExpressions(helper).flatMap((returned) => queryMethods(returned, hops + 1)) : []),
    ];
  }
  if (!ts.isIdentifier(root)) return methods;
  const name = root.text;

  for (let scope: ts.Node | undefined = root.parent; scope; scope = scope.parent) {
    if (!isFunctionLike(scope) && !ts.isSourceFile(scope)) continue;

    // `query.then((res) => unwrap(res))`: the parameter is the receiver's result.
    if (
      isFunctionLike(scope) &&
      scope.parameters.some((parameter) => parameter.name.getText() === name) &&
      ts.isCallExpression(scope.parent) &&
      ts.isPropertyAccessExpression(scope.parent.expression) &&
      scope.parent.expression.name.text === "then"
    ) {
      return [...methods, ...queryMethods(scope.parent.expression.expression, hops + 1)];
    }

    const found: string[] = [];
    const search = (inner: ts.Node): void => {
      if (ts.isVariableDeclaration(inner) && inner.initializer) {
        if (ts.isIdentifier(inner.name) && inner.name.text === name) {
          found.push(...queryMethods(inner.initializer, hops + 1));
        } else if (ts.isArrayBindingPattern(inner.name)) {
          const index = inner.name.elements.findIndex(
            (element) => ts.isBindingElement(element) && element.name.getText() === name,
          );
          const element = index === -1 ? undefined : promiseAllElements(inner.initializer)?.[index];
          if (element) found.push(...queryMethods(element, hops + 1));
        }
      } else if (
        ts.isBinaryExpression(inner) &&
        inner.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(inner.left) &&
        inner.left.text === name
      ) {
        // `query = query.eq(...)`: its own methods only, since its root is the variable again.
        found.push(...chainOf(inner.right).methods);
      }
      ts.forEachChild(inner, search);
    };
    search(scope);
    if (found.length > 0) return [...methods, ...found];
  }
  return methods;
}

function scan(fileName: string, text: string): Scan {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const result: Scan = { chains: 0, untraced: [], findings: [] };
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "unwrap" &&
      node.arguments.length > 0
    ) {
      const methods = queryMethods(node.arguments[0]);
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      if (!methods.includes("from") && !methods.includes("rpc")) {
        result.untraced.push(line);
      } else {
        result.chains += 1;
        if (methods.includes("maybeSingle")) {
          result.findings.push({ line, misuse: "maybeSingle may be null" });
        } else if (
          methods.some((name) => WRITES.has(name)) &&
          !methods.some((name) => RETURNS_ROWS.has(name))
        ) {
          result.findings.push({ line, misuse: "write returns no row" });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

describe("the scan itself", () => {
  const misuses = (code: string): Misuse[] => scan("sample.ts", code).findings.map((f) => f.misuse);

  it("flags a write with no .select()", () => {
    expect(misuses('unwrap(await db.from("t").insert({ a: 1 }), "x");')).toEqual(["write returns no row"]);
    expect(misuses('unwrap(await db.from("t").delete().eq("id", id), "x");')).toEqual(["write returns no row"]);
    expect(misuses('unwrap(await db.from("t").update({ a: 1 }).eq("id", id), "x");')).toEqual([
      "write returns no row",
    ]);
    expect(misuses('unwrap(await db.from("t").upsert(rows, { onConflict: "a" }), "x");')).toEqual([
      "write returns no row",
    ]);
  });

  it("flags a .maybeSingle() read", () => {
    expect(misuses('unwrap<Row | null>(await db.from("t").select("a").eq("id", id).maybeSingle(), "x");')).toEqual([
      "maybeSingle may be null",
    ]);
  });

  it("passes a read, a write that selects, and an rpc", () => {
    expect(misuses('unwrap<Row[]>(await db.from("t").select("a").eq("id", id), "x");')).toEqual([]);
    expect(misuses('unwrap<Row[]>(await db.from("t").delete().eq("id", id).select("id"), "x");')).toEqual([]);
    expect(misuses('unwrap<Row>(await db.from("t").insert(row).select("id").single(), "x");')).toEqual([]);
    expect(misuses('unwrap<number>(await db.rpc("api_do", { p_id: id }), "x");')).toEqual([]);
  });

  it("follows a variable, a .then callback and a Promise.all slot to the query", () => {
    expect(misuses('async function f() { const r = await db.from("t").delete().eq("id", id); unwrap(r, "x"); }')).toEqual([
      "write returns no row",
    ]);
    expect(
      misuses(
        'async function f() { let q = db.from("t").select("a"); q = q.eq("id", id); return unwrap<Row[]>(await q, "x"); }',
      ),
    ).toEqual([]);
    expect(misuses('db.from("t").update({ a: 1 }).eq("id", id).then((res) => unwrap(res, "x"));')).toEqual([
      "write returns no row",
    ]);
    expect(
      misuses(
        'async function f() { const [rows, gone] = await Promise.all([db.from("t").select("a"), db.from("t").delete()]);' +
          ' unwrap<Row[]>(rows, "x"); unwrap(gone, "y"); }',
      ),
    ).toEqual(["write returns no row"]);
  });

  it("counts a call it cannot trace instead of passing it quietly", () => {
    const result = scan("sample.ts", 'unwrap(await load(db), "x");');
    expect(result).toEqual({ chains: 0, untraced: [1], findings: [] });
  });
});

describe("unwrap fits the query it is handed", () => {
  let chains = 0;
  const failures: string[] = [];
  const untraced: string[] = [];
  for (const path of productionSources(API_SRC)) {
    const result = scan(path, sourceText(path));
    chains += result.chains;
    const file = relative(API_SRC, path).split("\\").join("/");
    for (const line of result.untraced) untraced.push(`${file}:${line}`);
    for (const finding of result.findings) failures.push(`${file}:${finding.line} ${finding.misuse}`);
  }

  it("no write without .select() and no .maybeSingle() goes through unwrap", () => {
    expect(failures).toEqual([]);
  });

  it("reports its coverage, and traces every call to its query", () => {
    console.info(`unwrap calls scanned: ${chains}`);
    expect(chains).toBeGreaterThan(300);
    expect(untraced).toEqual([]);
  });
});
