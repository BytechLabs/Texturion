/**
 * Every PostgREST query the Worker's source builds names only columns the
 * database has (#750).
 *
 * `profiles.email` and `task_map_rows.number` reached production as 500s because
 * the route tests' fakes accepted any column. This reads the source with the
 * TypeScript parser, finds each `.from("<table>")` chain, resolves the strings it
 * passes (literals, templates, constants in the same file or an imported one,
 * `[...].join(",")`), and checks them against src/test/schema-snapshot.json, which
 * `scripts/api-schema-snapshot.mjs --check` keeps equal to the database built
 * from supabase/migrations.
 *
 * Checked per chain: the select list (embedded relations resolve to their
 * target table, aliases and casts are stripped), filter and order columns with
 * a literal name, and the keys of an object literal passed to insert, update or
 * upsert. A string it cannot resolve is counted and listed, never skipped
 * quietly; the dynamic ceiling below can only go down.
 *
 * Failing output names file:line, table and column.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  checkFilterName,
  checkLogicalExpression,
  checkSelect,
  type Problem,
  SCHEMA_SNAPSHOT,
} from "./schema-columns";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Calls whose first argument is a column name. */
const COLUMN_FILTERS = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is",
  "in",
  "contains",
  "containedBy",
  "overlaps",
  "order",
  "not",
  "textSearch",
]);
const WRITES = new Set(["insert", "update", "upsert"]);
/** `.or("a.is.null,b.lt.5")`: a filter whose column names sit inside one string. */
const LOGICAL = new Set(["or", "and"]);

/**
 * Selects and filters the scan cannot resolve to a string. Today these are the
 * only ones; a new dynamic query raises the count and fails the ceiling, which
 * is the prompt to make it resolvable (a constant) or to cover it with a test
 * that runs it through a fake.
 */
const MAX_DYNAMIC = 70;

interface Finding {
  file: string;
  line: number;
  table: string;
  problem: Problem;
}

interface Dynamic {
  file: string;
  line: number;
  what: string;
}

interface Totals {
  chains: number;
  selects: number;
  filters: number;
  writes: number;
  notChains: number;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (
      name.endsWith(".ts") &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".d.ts") &&
      !full.includes(`${join("src", "test")}`) &&
      !name.startsWith("test-support")
    ) {
      out.push(full);
    }
  }
  return out;
}

const trees = new Map<string, ts.SourceFile>();
function parse(file: string): ts.SourceFile {
  let tree = trees.get(file);
  if (!tree) {
    tree = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.ES2022,
      true,
    );
    trees.set(file, tree);
  }
  return tree;
}

function importTarget(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(from), specifier);
  for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** A top-level `const NAME = <expr>` in `file`, local or imported by name. */
function constInitializer(
  file: string,
  name: string,
  depth = 0,
): { file: string; node: ts.Expression } | undefined {
  if (depth > 4) return undefined;
  const tree = parse(file);
  // Scope-insensitive on purpose: a name declared exactly once in the file is
  // that declaration; a name declared twice is ambiguous and stays dynamic.
  const declared: ts.Expression[] = [];
  const collect = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      declared.push(node.initializer);
    }
    ts.forEachChild(node, collect);
  };
  collect(tree);
  if (declared.length === 1) return { file, node: declared[0] };
  if (declared.length > 1) return undefined;
  for (const statement of tree.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      for (const element of statement.importClause.namedBindings.elements) {
        if (element.name.text !== name) continue;
        const target = importTarget(file, statement.moduleSpecifier.text);
        if (target) {
          return constInitializer(
            target,
            (element.propertyName ?? element.name).text,
            depth + 1,
          );
        }
      }
    }
  }
  return undefined;
}

let blame = "";

/** Every string `node` can be, or null when it is not statically known. */
function blameNull(node: ts.Node): null {
  blame = node.getText().replace(/\s+/g, " ").slice(0, 50);
  return null;
}

function strings(file: string, node: ts.Node, depth = 0): string[] | null {
  if (depth > 8) return blameNull(node);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [node.text];
  }
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return strings(file, node.expression, depth + 1);
  }
  if (ts.isTemplateExpression(node)) {
    let acc: string[] = [node.head.text];
    for (const span of node.templateSpans) {
      const part = strings(file, span.expression, depth + 1);
      if (!part) return blameNull(node);
      acc = acc.flatMap((a) => part.map((p) => a + p + span.literal.text));
    }
    return acc;
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = strings(file, node.left, depth);
    const right = strings(file, node.right, depth);
    return left && right ? left.flatMap((l) => right.map((r) => l + r)) : null;
  }
  if (ts.isConditionalExpression(node)) {
    const a = strings(file, node.whenTrue, depth + 1);
    const b = strings(file, node.whenFalse, depth + 1);
    return a && b ? [...a, ...b] : null;
  }
  if (ts.isIdentifier(node)) {
    const found = constInitializer(file, node.text);
    return found ? strings(found.file, found.node, depth + 1) : blameNull(node);
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "join"
  ) {
    const items = stringList(file, node.expression.expression, depth + 1);
    const sep = node.arguments[0]
      ? strings(file, node.arguments[0], depth + 1)
      : [","];
    return items && sep && sep.length === 1 ? [items.join(sep[0])] : null;
  }
  return blameNull(node);
}

function stringList(file: string, node: ts.Node, depth: number): string[] | null {
  if (depth > 8) return blameNull(node);
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return stringList(file, node.expression, depth + 1);
  }
  if (ts.isIdentifier(node)) {
    const found = constInitializer(file, node.text);
    return found ? stringList(found.file, found.node, depth + 1) : blameNull(node);
  }
  if (!ts.isArrayLiteralExpression(node)) return blameNull(node);
  const out: string[] = [];
  for (const element of node.elements) {
    if (ts.isSpreadElement(element)) {
      const inner = stringList(file, element.expression, depth + 1);
      if (!inner) return blameNull(node);
      out.push(...inner);
    } else {
      const one = strings(file, element, depth + 1);
      if (!one || one.length !== 1) return blameNull(node);
      out.push(one[0]);
    }
  }
  return out;
}

/** The `.from(<table>)` call a query chain starts at, if it is a database one. */
function chainRoot(call: ts.CallExpression): ts.CallExpression | "storage" | undefined {
  let expr: ts.Expression = call.expression;
  for (;;) {
    if (ts.isPropertyAccessExpression(expr)) {
      if (expr.name.text === "storage") return "storage";
      expr = expr.expression;
    } else if (ts.isCallExpression(expr)) {
      if (
        ts.isPropertyAccessExpression(expr.expression) &&
        expr.expression.name.text === "from"
      ) {
        let owner: ts.Expression = expr.expression.expression;
        while (ts.isPropertyAccessExpression(owner)) {
          if (owner.name.text === "storage") return "storage";
          owner = owner.expression;
        }
        return expr;
      }
      expr = expr.expression;
    } else if (
      ts.isParenthesizedExpression(expr) ||
      ts.isNonNullExpression(expr) ||
      ts.isAwaitExpression(expr) ||
      ts.isAsExpression(expr)
    ) {
      expr = expr.expression;
    } else return undefined;
  }
}

function scan() {
  const findings: Finding[] = [];
  const dynamic: Dynamic[] = [];
  const totals: Totals = { chains: 0, selects: 0, filters: 0, writes: 0, notChains: 0 };

  for (const file of sourceFiles(SRC)) {
    const tree = parse(file);
    const rel = relative(resolve(SRC, ".."), file).replaceAll("\\", "/");
    const lineOf = (node: ts.Node) =>
      tree.getLineAndCharacterOfPosition(node.getStart()).line + 1;

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const method = node.expression.name.text;
        const isSelect = method === "select";
        const isFilter = COLUMN_FILTERS.has(method);
        const isLogical = LOGICAL.has(method);
        const isWrite = WRITES.has(method);
        if (isSelect || isFilter || isWrite || isLogical) {
          const root = chainRoot(node);
          if (root === "storage") {
            // not a table
          } else if (!root) {
            if (isSelect) totals.notChains++;
          } else {
            const tableArg = root.arguments[0];
            const tables = tableArg ? strings(file, tableArg) : null;
            if (!tables) {
              dynamic.push({ file: rel, line: lineOf(node), what: `${method} on a table the scan cannot resolve` });
            } else {
              for (const table of tables) {
                const report = (problems: Problem[]) => {
                  for (const problem of problems) {
                    findings.push({ file: rel, line: lineOf(node), table, problem });
                  }
                };
                if (!SCHEMA_SNAPSHOT.tables[table]) {
                  report([{ table, column: "*", reason: `no table or view named ${table}` }]);
                  continue;
                }
                const miss = (column: string, where: string) => {
                  if (!SCHEMA_SNAPSHOT.tables[table].columns.includes(column)) {
                    report([{ table, column, reason: `${table} has no column ${column} (${where})` }]);
                  }
                };
                if (isSelect) {
                  totals.selects++;
                  const arg = node.arguments[0];
                  const texts = arg ? strings(file, arg) : ["*"];
                  if (!texts) {
                    dynamic.push({ file: rel, line: lineOf(node), what: `select(${arg.getText().replace(/\s+/g, " ").slice(0, 40)}) on ${table} [cannot resolve: ${blame}]` });
                  } else {
                    for (const text of texts) report(checkSelect(text, table));
                  }
                } else if (isLogical) {
                  const arg = node.arguments[0];
                  const text = arg ? strings(file, arg) : null;
                  const foreign = node.arguments[1] !== undefined;
                  if (!text) {
                    dynamic.push({ file: rel, line: lineOf(node), what: `${method}(${arg?.getText().replace(/\s+/g, " ").slice(0, 40)}) on ${table}` });
                  } else if (!foreign) {
                    totals.filters++;
                    for (const t of text) {
                      report(checkLogicalExpression(t, table));
                    }
                  }
                } else if (isFilter) {
                  const arg = node.arguments[0];
                  const names = arg ? strings(file, arg) : null;
                  if (!names) {
                    dynamic.push({ file: rel, line: lineOf(node), what: `${method}(${arg?.getText().slice(0, 40)}) on ${table}` });
                  } else {
                    totals.filters++;
                    for (const name of names) {
                      const problem = checkFilterName(name, table);
                      if (problem) report([{ ...problem, reason: `${problem.reason} (${method})` }]);
                    }
                  }
                } else {
                  const arg = node.arguments[0];
                  const rows = !arg
                    ? []
                    : ts.isArrayLiteralExpression(arg)
                      ? arg.elements
                      : [arg];
                  for (const row of rows) {
                    if (!ts.isObjectLiteralExpression(row)) {
                      dynamic.push({ file: rel, line: lineOf(node), what: `${method}(${row.getText().slice(0, 40)}) on ${table}` });
                      continue;
                    }
                    totals.writes++;
                    for (const prop of row.properties) {
                      if (
                        (ts.isPropertyAssignment(prop) ||
                          ts.isShorthandPropertyAssignment(prop)) &&
                        (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
                      ) {
                        miss(prop.name.text, method);
                      }
                    }
                  }
                }
              }
              if (isSelect || isFilter || isWrite || isLogical) totals.chains++;
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return { findings, dynamic, totals };
}

describe("every query the API builds names columns the database has", () => {
  const { findings, dynamic, totals } = scan();

  it("finds no unknown table, column, or relation", () => {
    const lines = findings.map(
      (f) => `${f.file}:${f.line}  ${f.table}.${f.problem.column}  ${f.problem.reason}`,
    );
    expect(lines, lines.join("\n")).toEqual([]);
  });

  it("reports its coverage, and the dynamic count only goes down", () => {
    const sites = new Set(dynamic.map((d) => `${d.file}:${d.line}`)).size;
    console.info(
      `[#750] ${totals.selects} selects, ${totals.filters} filter/order columns, ` +
        `${totals.writes} written objects checked; ${dynamic.length} operations at ${sites} query sites are dynamic and not checked; ` +
        `${totals.notChains} selects with no .from() in the chain (rpc or helper-built)`,
    );
    for (const d of dynamic) console.info(`[#750 dynamic] ${d.file}:${d.line}  ${d.what}`);
    expect(totals.selects).toBeGreaterThan(300);
    expect(sites).toBeLessThanOrEqual(MAX_DYNAMIC);
  });
});
