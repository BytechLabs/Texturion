#!/usr/bin/env node
/**
 * Every Telnyx endpoint the API calls is registered, and every registered
 * endpoint is still called.
 *
 *   node scripts/check-telnyx-endpoints.mjs
 *
 * WHY. The rig reaches Telnyx only through `loonext-telnyx-guard`, whose policy
 * is generated from `apps/api/src/telnyx/endpoints.ts`, one class per endpoint.
 * A call to an endpoint the registry does not list is refused on the rig, and a
 * scenario fails for a reason nobody can see in the diff. So a new endpoint
 * fails here, in the pull request that adds it, until somebody decides which
 * class it belongs to. An entry nothing calls any more is a permission the
 * guard keeps granting to nobody, so that fails too.
 *
 * HOW IT FINDS THE CALLS. From the TypeScript AST, because the calls do not look
 * alike: a path is written beside its method, held in a local first, or handed
 * to a small wrapper in the same file that adds the method, which may also take
 * the action name as an argument. Every `/v2/...` literal in the API source is
 * followed to the request that sends it, and every request to Telnyx must be
 * fed by such a literal. A path this cannot follow is a failure, not a skip: a
 * guard that silently stopped seeing a call site is worse than one that refuses
 * to guess.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API_SRC = "apps/api/src";
export const REGISTRY_FILE = "apps/api/src/telnyx/endpoints.ts";
const CLIENT_FILE = "apps/api/src/telnyx/client.ts";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const SEGMENT = /^(?:[A-Za-z0-9_]+|:id)$/;

/** The compiler the api package builds with; there is none at the repo root. */
export function loadTypeScript() {
  return createRequire(join(REPO_ROOT, "apps/api/package.json"))("typescript");
}

/** Test code fakes Telnyx; it does not call it. */
export function isApiSource(rel) {
  return (
    rel.endsWith(".ts") &&
    !rel.endsWith(".d.ts") &&
    !/\.(test|e2e|load)\.ts$/.test(rel) &&
    !/(^|\/)test\//.test(rel) &&
    !/(^|\/)test-support\.ts$/.test(rel)
  );
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules") return [];
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function sourceFiles() {
  return walk(join(REPO_ROOT, API_SRC))
    .map((full) => relative(REPO_ROOT, full).split("\\").join("/"))
    .filter((file) => isApiSource(file) && file !== REGISTRY_FILE)
    .sort()
    .map((file) => ({ file, text: readFileSync(join(REPO_ROOT, file), "utf8") }));
}

class Unfollowable extends Error {}

/** The client's request functions; a call to either is a Telnyx request. */
const REQUESTERS = new Set(["telnyxRequest", "telnyxUpload"]);
/** Called by name only: one reached through another name is a call this check cannot count. */
const CALLED_BY_NAME = new Set([...REQUESTERS, "telnyxUrl"]);
const UNKNOWN = "unknown";

/**
 * One file, bound, so a name resolves to its own declaration: two functions
 * each with a `const url` are two values, and an import keeps the name it was
 * exported under. Nothing is type-checked and no import is followed.
 */
function bind(ts, file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const host = {
    getSourceFile: (name) => (name.endsWith(file) ? sf : undefined),
    fileExists: (name) => name.endsWith(file),
    readFile: () => text,
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = ts.createProgram({
    rootNames: [file],
    options: { noLib: true, noResolve: true, types: [] },
    host,
  });
  return { sf, checker: program.getTypeChecker() };
}

/**
 * The Telnyx requests one file makes, as `{ method, path, where }`, plus the
 * places it could not follow.
 */
export function scanFile(ts, file, text) {
  const { sf, checker } = bind(ts, file, text);
  const where = (node) =>
    `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
  const isSatisfies = (node) => ts.isSatisfiesExpression?.(node) ?? false;

  const literals = [];
  const calls = [];
  const identifiers = [];
  (function visit(node) {
    if (isPathLiteral(node)) literals.push(node);
    if (ts.isCallExpression(node)) calls.push(node);
    if (ts.isIdentifier(node)) identifiers.push(node);
    ts.forEachChild(node, visit);
  })(sf);

  function isPathLiteral(node) {
    if (ts.isLiteralTypeNode(node.parent ?? node)) return false;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text.startsWith("/v2/");
    }
    if (ts.isTemplateExpression(node)) {
      if (node.head.text.startsWith("/v2/")) return true;
      return node.head.text === "" && node.templateSpans[0].literal.text.startsWith("/v2/");
    }
    return false;
  }

  const symbolOf = (id) => {
    const p = id.parent;
    if (ts.isShorthandPropertyAssignment(p) && p.name === id) {
      return checker.getShorthandAssignmentValueSymbol(p);
    }
    if (ts.isExportSpecifier(p)) return checker.getExportSpecifierLocalTargetSymbol(p);
    return checker.getSymbolAtLocation(id);
  };
  const declarationOf = (id) => {
    const symbol = symbolOf(id);
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  };
  const importedName = (decl) =>
    decl && ts.isImportSpecifier(decl) ? (decl.propertyName ?? decl.name).text : null;

  /**
   * What a callee is, by the name its module exports it under. A client
   * function reached as a property is read whatever object holds it: a
   * namespace import, or the module handed around.
   */
  const nameOf = (expr) => {
    if (ts.isIdentifier(expr)) return importedName(declarationOf(expr)) ?? expr.text;
    if (ts.isPropertyAccessExpression(expr)) {
      const name = expr.name.text;
      if (CALLED_BY_NAME.has(name)) return name;
      if (name === "fetch" && /^(?:globalThis|self)$/.test(expr.expression.getText(sf))) return name;
    }
    return null;
  };
  const calleeName = (call) => nameOf(call.expression);

  const isDeclarationName = (id) => {
    const p = id.parent;
    return (
      (ts.isParameter(p) || ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p)) &&
      p.name === id
    );
  };

  const references = (root, symbol) =>
    symbol
      ? identifiers.filter(
          (id) =>
            id.pos >= root.pos &&
            id.end <= root.end &&
            !isDeclarationName(id) &&
            symbolOf(id) === symbol,
        )
      : [];

  /** The function a callee names, when it is declared in this file. */
  const localFunction = (callee) => {
    if (!ts.isIdentifier(callee)) return null;
    const decls = symbolOf(callee)?.declarations ?? [];
    const body = decls.find((d) => ts.isFunctionDeclaration(d) && d.body);
    if (body) return body;
    const init = decls.find(ts.isVariableDeclaration)?.initializer;
    return init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : null;
  };

  const declarationNode = (fn) => (ts.isFunctionDeclaration(fn) ? fn : fn.parent);

  const functionName = (fn) => {
    const decl = declarationNode(fn);
    return (ts.isFunctionDeclaration(decl) || ts.isVariableDeclaration(decl)) &&
      decl.name &&
      ts.isIdentifier(decl.name)
      ? decl.name.text
      : null;
  };

  const inType = (node) => {
    for (let cur = node.parent; cur; cur = cur.parent) if (ts.isTypeNode(cur)) return true;
    return false;
  };

  const callersOf = (fn) => calls.filter((call) => localFunction(call.expression) === fn);

  /**
   * True when callers outside this file could reach `fn`: it is exported, or
   * it is read anywhere except as the callee of a call. Its callers here are
   * then not all of its callers.
   */
  const escapesFile = (fn) => {
    const decl = declarationNode(fn);
    if (ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Export) return true;
    return references(sf, symbolOf(decl.name)).some(
      (ref) => !(ts.isCallExpression(ref.parent) && ref.parent.expression === ref),
    );
  };

  const parameterOf = (decl) => {
    const fn = decl.parent;
    if (!ts.isFunctionLike(fn) || !fn.body || !functionName(fn)) return null;
    return { fn, index: fn.parameters.indexOf(decl), name: functionName(fn) };
  };

  /** Every string a placeholder can hold, when that is knowable in this file. */
  const literalValues = (expr, seen = new Set()) => {
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return [expr.text];
    if (
      ts.isParenthesizedExpression(expr) ||
      ts.isAsExpression(expr) ||
      ts.isNonNullExpression(expr) ||
      isSatisfies(expr)
    ) {
      return literalValues(expr.expression, seen);
    }
    if (ts.isConditionalExpression(expr)) {
      return [...literalValues(expr.whenTrue, seen), ...literalValues(expr.whenFalse, seen)];
    }
    if (ts.isIdentifier(expr)) {
      const decl = declarationOf(expr);
      if (decl && seen.has(decl)) {
        throw new Unfollowable(`${where(expr)}: cannot list the values of "${expr.text}"`);
      }
      if (decl && ts.isParameter(decl)) {
        const param = parameterOf(decl);
        if (!param) {
          throw new Unfollowable(`${where(expr)}: cannot list the values of "${expr.text}"`);
        }
        if (escapesFile(param.fn)) {
          throw new Unfollowable(
            `${where(expr)}: "${param.name}" is exported or passed around, so callers this ` +
              `check cannot see may hand it any "${expr.text}". Keep it private to this file`,
          );
        }
        const callers = callersOf(param.fn);
        if (callers.length === 0) {
          throw new Unfollowable(
            `${where(expr)}: "${param.name}" is never called in this file, so "${expr.text}" has no known value`,
          );
        }
        const next = new Set([...seen, decl]);
        return callers.flatMap((call) => {
          const arg = call.arguments[param.index];
          if (!arg) throw new Unfollowable(`${where(call)}: "${param.name}" is called without "${expr.text}"`);
          return literalValues(arg, next);
        });
      }
      if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
        if (!(ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const)) {
          throw new Unfollowable(
            `${where(expr)}: "${expr.text}" is not a const, so a later assignment can change ` +
              `it unseen. Make it a const`,
          );
        }
        return literalValues(decl.initializer, new Set([...seen, decl]));
      }
    }
    throw new Unfollowable(`${where(expr)}: "${expr.getText(sf)}" is not a literal this check can read`);
  };

  const any = (results) =>
    results.includes(true) ? true : results.includes(UNKNOWN) ? UNKNOWN : false;

  /**
   * Whether a URL is built on the Telnyx base: true, false, or UNKNOWN when
   * the base arrives from callers this file cannot see. Only the leftmost part
   * is the base, so an id in the path that happens to be called telnyxId says
   * nothing about where the request goes.
   */
  const telnyxBase = (expr, seen = new Set()) => {
    if (
      ts.isParenthesizedExpression(expr) ||
      ts.isAsExpression(expr) ||
      ts.isNonNullExpression(expr) ||
      isSatisfies(expr)
    ) {
      return telnyxBase(expr.expression, seen);
    }
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      return /telnyx/i.test(expr.text);
    }
    if (ts.isTemplateExpression(expr)) {
      return expr.head.text === ""
        ? telnyxBase(expr.templateSpans[0].expression, seen)
        : /telnyx/i.test(expr.head.text);
    }
    if (ts.isBinaryExpression(expr)) {
      return expr.operatorToken.kind === ts.SyntaxKind.PlusToken
        ? telnyxBase(expr.left, seen)
        : any([telnyxBase(expr.left, seen), telnyxBase(expr.right, seen)]);
    }
    if (ts.isConditionalExpression(expr)) {
      return any([telnyxBase(expr.whenTrue, seen), telnyxBase(expr.whenFalse, seen)]);
    }
    if (ts.isNewExpression(expr) && expr.expression.getText(sf) === "URL" && expr.arguments?.length) {
      return telnyxBase(expr.arguments[1] ?? expr.arguments[0], seen);
    }
    if (/telnyx/i.test(expr.getText(sf))) return true;
    if (ts.isPropertyAccessExpression(expr)) return telnyxBase(expr.expression, seen);
    if (ts.isCallExpression(expr) || ts.isNewExpression(expr)) {
      const callee = ts.isCallExpression(expr) ? [telnyxBase(expr.expression, seen)] : [];
      return any([...callee, ...(expr.arguments ?? []).map((arg) => telnyxBase(arg, seen))]);
    }
    if (!ts.isIdentifier(expr)) return false;
    const decl = declarationOf(expr);
    if (!decl || seen.has(decl)) return false;
    const next = new Set([...seen, decl]);
    if (importedName(decl)) return /telnyx/i.test(importedName(decl));
    if (ts.isVariableDeclaration(decl)) {
      return decl.initializer ? telnyxBase(decl.initializer, next) : false;
    }
    if (ts.isParameter(decl)) {
      const param = parameterOf(decl);
      if (!param || escapesFile(param.fn)) return UNKNOWN;
      return any(
        callersOf(param.fn).map((call) => {
          const arg = call.arguments[param.index];
          return arg ? telnyxBase(arg, next) : false;
        }),
      );
    }
    return false;
  };

  /** The path templates one literal can produce, with `:id` for each id. */
  const templatesOf = (node) => {
    const parts = [];
    if (ts.isTemplateExpression(node)) {
      parts.push({ text: node.head.text });
      for (const span of node.templateSpans) {
        parts.push({ expr: span.expression }, { text: span.literal.text });
      }
      // `${base}/v2/...`: the base is not part of the path.
      if (node.head.text === "") parts.splice(0, 2);
    } else {
      parts.push({ text: node.text });
    }

    const kept = [];
    for (const part of parts) {
      if (part.text !== undefined && part.text.includes("?")) {
        kept.push({ text: part.text.slice(0, part.text.indexOf("?")) });
        break;
      }
      kept.push(part);
    }

    const exprs = [];
    const joined = kept
      .map((part) => {
        if (part.text !== undefined) return part.text;
        exprs.push(part.expr);
        return `\u0000${exprs.length - 1}\u0000`;
      })
      .join("");
    const segments = joined.split("/").slice(1);
    const MARKER = /^\u0000(\d+)\u0000$/;

    let templates = [[]];
    segments.forEach((segment, i) => {
      const marker = MARKER.exec(segment);
      if (!marker) {
        if (segment.includes("\u0000")) {
          throw new Unfollowable(`${where(node)}: an interpolation shares a path segment with text; give it a segment of its own`);
        }
        templates = templates.map((t) => [...t, segment]);
        return;
      }
      if (i <= 1) {
        throw new Unfollowable(`${where(node)}: the collection after /v2/ is interpolated, so the endpoint is unknowable`);
      }
      // An id follows a collection name. After an action, or after another
      // interpolation, the segment names what is done, and that must be known.
      const expr = exprs[Number(marker[1])];
      const previous = segments[i - 1];
      if (previous === "actions" || MARKER.test(previous)) {
        const values = [...new Set(literalValues(expr))];
        templates = templates.flatMap((t) => values.map((value) => [...t, value]));
      } else {
        templates = templates.map((t) => [...t, ":id"]);
      }
    });
    return templates.map((t) => `/${t.join("/")}`);
  };

  const fed = new Set();

  const methodsOf = (object, fallback) => {
    for (const prop of object.properties) {
      if (ts.isSpreadAssignment(prop)) {
        throw new Unfollowable(`${where(prop)}: a spread in the request options can set the method unseen`);
      }
    }
    for (const prop of object.properties) {
      if (ts.isPropertyAssignment(prop) && prop.name.getText(sf) === "method") {
        return [...new Set(literalValues(prop.initializer))];
      }
      if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === "method") {
        return [...new Set(literalValues(prop.name))];
      }
    }
    return fallback ? [fallback] : [];
  };

  const requestSink = (object, origin) => {
    const call = object.parent;
    if (!ts.isCallExpression(call) || !call.arguments.includes(object)) {
      throw new Unfollowable(`${where(origin)}: this path is set on an object that is not a request`);
    }
    const name = calleeName(call) ?? "";
    const methods = methodsOf(object, name === "telnyxUpload" ? "POST" : null);
    if (methods.length === 0) throw new Unfollowable(`${where(origin)}: the request names no method`);
    fed.add(call);
    const telnyx = REQUESTERS.has(name) || /telnyx/i.test(name);
    return methods.map((method) => ({ method, telnyx }));
  };

  const fetchSink = (call) => {
    const init = call.arguments[1];
    let methods = ["GET"];
    if (init) {
      if (!ts.isObjectLiteralExpression(init)) {
        throw new Unfollowable(`${where(call)}: the fetch options are not written inline`);
      }
      methods = methodsOf(init, "GET");
    }
    fed.add(call);
    const telnyx = telnyxBase(call.arguments[0]);
    return methods.map((method) => ({ method, telnyx }));
  };

  /** Follows a value up the tree until it is sent, or proves it cannot. */
  const follow = (start, seen) => {
    let cur = start;
    for (;;) {
      const p = cur.parent;
      if (!p) break;
      if (ts.isNewExpression(p) && p.expression.getText(sf) === "Request") {
        throw new Unfollowable(
          `${where(start)}: a Request object carries its method where this check cannot ` +
            `see it. Pass the URL and an inline options object to fetch`,
        );
      }
      if (
        ts.isParenthesizedExpression(p) ||
        ts.isAsExpression(p) ||
        ts.isNonNullExpression(p) ||
        isSatisfies(p) ||
        (ts.isConditionalExpression(p) && p.condition !== cur) ||
        ts.isNewExpression(p) ||
        (ts.isPropertyAccessExpression(p) && p.expression === cur) ||
        (ts.isCallExpression(p) && p.expression === cur)
      ) {
        cur = p;
        continue;
      }
      if (ts.isPropertyAssignment(p) && p.initializer === cur) {
        if (p.name.getText(sf) === "path" && ts.isObjectLiteralExpression(p.parent)) {
          return requestSink(p.parent, start);
        }
        break;
      }
      if (ts.isShorthandPropertyAssignment(p) && p.name === cur) {
        if (cur.getText(sf) === "path") return requestSink(p.parent, start);
        break;
      }
      if (ts.isCallExpression(p)) {
        const index = p.arguments.indexOf(cur);
        if (calleeName(p) === "fetch") {
          if (index === 0) return fetchSink(p);
          break;
        }
        const fn = localFunction(p.expression);
        if (fn) return throughParameter(fn, index, start, seen);
        // A helper that builds a URL from the path; its result may still be sent.
        cur = p;
        continue;
      }
      if (ts.isVariableDeclaration(p) && p.initializer === cur && ts.isIdentifier(p.name)) {
        return throughReferences(references(sf, symbolOf(p.name)), start, seen);
      }
      break;
    }
    throw new Unfollowable(
      `${where(start)}: cannot see which request sends this path. Write it beside ` +
        `its method in a telnyxRequest call, in a local the call reads, or as an ` +
        `argument to a wrapper declared in the same file`,
    );
  };

  const throughParameter = (fn, index, start, seen) => {
    const param = fn.parameters[index];
    if (!param || !ts.isIdentifier(param.name) || seen.has(param) || !fn.body) {
      throw new Unfollowable(`${where(start)}: cannot follow this path into "${functionName(fn)}"`);
    }
    return throughReferences(
      references(fn.body, symbolOf(param.name)),
      start,
      new Set([...seen, param]),
    );
  };

  // A value read several times only has to reach a request once; the other
  // reads are labels and error messages.
  const throughReferences = (refs, start, seen) => {
    const sinks = [];
    let first;
    for (const ref of refs) {
      try {
        sinks.push(...follow(ref, seen));
      } catch (error) {
        if (!(error instanceof Unfollowable)) throw error;
        first ??= error;
      }
    }
    if (sinks.length === 0) {
      throw first ?? new Unfollowable(`${where(start)}: this path is never sent`);
    }
    return sinks;
  };

  const unsure = (node) =>
    `${where(node)}: cannot tell whether this request goes to Telnyx, because its base ` +
    `arrives from callers in other files. Build a Telnyx URL with telnyxUrl here, or give ` +
    `another vendor's base a const in this file`;

  const requests = [];
  const problems = [];
  for (const literal of literals) {
    if (ts.isTemplateExpression(literal) && literal.head.text === "") {
      const base = telnyxBase(literal.templateSpans[0].expression);
      if (base === UNKNOWN) problems.push(unsure(literal));
      if (base !== true) continue;
    }
    try {
      const sinks = follow(literal, new Set());
      if (sinks.some((sink) => sink.telnyx === UNKNOWN)) {
        problems.push(unsure(literal));
        continue;
      }
      const ours = sinks.filter((sink) => sink.telnyx === true);
      if (ours.length === 0) continue;
      for (const path of templatesOf(literal)) {
        for (const { method } of ours) requests.push({ method, path, where: where(literal) });
      }
    } catch (error) {
      if (!(error instanceof Unfollowable)) throw error;
      problems.push(error.message);
    }
  }

  // The census: every Telnyx request must have been reached from a literal.
  const isClient = file === CLIENT_FILE;
  for (const call of calls) {
    const name = calleeName(call);
    const isRawFetch =
      !isClient && name === "fetch" && call.arguments[0] && telnyxBase(call.arguments[0]) === true;
    if ((REQUESTERS.has(name) || isRawFetch) && !fed.has(call)) {
      problems.push(
        `${where(call)}: a Telnyx request whose path this check cannot read. ` +
          `Its path must be a /v2/ literal the check can follow here`,
      );
    }
  }

  // The census counts calls by name, so a client function held under any other
  // name, or handed on as a value, hides every call made through it.
  for (const id of identifiers) {
    const p = id.parent;
    let name = null;
    if (ts.isExportSpecifier(p)) name = (p.propertyName ?? p.name).text;
    else if (ts.isPropertyAccessExpression(p) && p.name === id) name = id.text;
    else if (!ts.isImportSpecifier(p) && !isDeclarationName(id) && !inType(id)) {
      name = importedName(declarationOf(id)) ?? (isClient ? id.text : null);
    }
    if (!name || !CALLED_BY_NAME.has(name)) continue;
    const callee = ts.isPropertyAccessExpression(p) && p.name === id ? p : id;
    const called = ts.isCallExpression(callee.parent) && callee.parent.expression === callee;
    if (!called) {
      problems.push(
        `${where(id)}: ${name} is used here as a value, and calls made through another ` +
          `name are calls this check cannot count. Call ${name} by name`,
      );
    }
  }

  return { requests, problems };
}

/** A reader that has gone blind passes everything, so reading nothing fails. */
export function coverage(requests, entries) {
  if (requests.length > 0 && entries.length > 0) return [];
  return [
    `Read ${requests.length} Telnyx requests and ${entries.length} registry entries. ` +
      `One of them being zero means this check is reading nothing; fix the reader ` +
      `before trusting a pass`,
  ];
}

/** The registry's entries, read from its source without running it. */
export function readRegistry(ts, text, file = REGISTRY_FILE) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const line = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const problems = [];
  let array;
  (function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "TELNYX_ENDPOINTS"
    ) {
      let init = node.initializer;
      while (
        init &&
        (ts.isAsExpression(init) ||
          ts.isParenthesizedExpression(init) ||
          (ts.isSatisfiesExpression && ts.isSatisfiesExpression(init)))
      ) {
        init = init.expression;
      }
      if (init && ts.isArrayLiteralExpression(init)) array = init;
    }
    ts.forEachChild(node, visit);
  })(sf);
  if (!array) {
    return { entries: [], problems: [`${file}: no TELNYX_ENDPOINTS array literal`] };
  }

  const entries = [];
  for (const element of array.elements) {
    if (!ts.isObjectLiteralExpression(element)) {
      problems.push(`${file}:${line(element)}: every entry must be an object literal`);
      continue;
    }
    const entry = { line: line(element) };
    for (const prop of element.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer))
      ) {
        entry[prop.name.getText(sf)] = prop.initializer.text;
      }
    }
    if (!entry.method || !entry.path || !entry.policy) {
      problems.push(`${file}:${entry.line}: method, path and policy must all be string literals`);
      continue;
    }
    entries.push(entry);
  }
  return { entries, problems };
}

/** Both directions, plus the shape of each entry. Returns failure messages. */
export function compare(entries, requests) {
  const failures = [];
  const key = (method, path) => `${method} ${path}`;
  const registered = new Map();
  for (const entry of entries) {
    const k = key(entry.method, entry.path);
    if (registered.has(k)) failures.push(`${REGISTRY_FILE}:${entry.line}: ${k} is registered twice`);
    registered.set(k, entry);
    if (!METHODS.has(entry.method)) {
      failures.push(`${REGISTRY_FILE}:${entry.line}: "${entry.method}" is not an HTTP method`);
    }
    const segments = entry.path.split("/").slice(1);
    if (!entry.path.startsWith("/v2/") || !segments.every((s) => SEGMENT.test(s))) {
      failures.push(
        `${REGISTRY_FILE}:${entry.line}: "${entry.path}" must be a /v2/ path with ` +
          `:id for each id and no query string`,
      );
    } else if (segments[1] === ":id" || /:id\/:id/.test(entry.path)) {
      // An id names one resource of a collection, so it needs the collection
      // before it; two in a row would let one entry grant every sub-resource.
      failures.push(
        `${REGISTRY_FILE}:${entry.line}: "${entry.path}" has an id with no collection ` +
          `before it; name the collection or sub-resource`,
      );
    }
  }

  const called = new Map();
  for (const request of requests) {
    const k = key(request.method, request.path);
    if (!called.has(k)) called.set(k, []);
    called.get(k).push(request.where);
  }

  for (const [k, sites] of [...called].sort()) {
    if (!registered.has(k)) {
      failures.push(
        `${k} is called at ${sites.join(", ")} but is not in ${REGISTRY_FILE}. ` +
          `Register it with the policy class the guard should apply`,
      );
    }
  }
  for (const [k, entry] of [...registered].sort()) {
    if (!called.has(k)) {
      failures.push(
        `${REGISTRY_FILE}:${entry.line}: ${k} is registered but nothing calls it. ` +
          `Remove it, so the guard stops granting it`,
      );
    }
  }
  return failures;
}

function main() {
  const ts = loadTypeScript();
  const files = sourceFiles();
  const requests = [];
  const problems = [];
  for (const { file, text } of files) {
    const result = scanFile(ts, file, text);
    requests.push(...result.requests);
    problems.push(...result.problems);
  }
  const registry = readRegistry(ts, readFileSync(join(REPO_ROOT, REGISTRY_FILE), "utf8"));
  const failures = [
    ...problems,
    ...registry.problems,
    ...compare(registry.entries, requests),
    ...coverage(requests, registry.entries),
  ];


  const endpoints = new Set(requests.map((r) => `${r.method} ${r.path}`)).size;
  if (failures.length > 0) {
    for (const failure of failures) console.error(`  x ${failure}`);
    console.error(`\ncheck-telnyx-endpoints: ${failures.length} problem(s).`);
    process.exit(1);
  }
  console.log(
    `check-telnyx-endpoints: ${requests.length} call sites in ${files.length} files ` +
      `reach ${endpoints} endpoints; all ${registry.entries.length} registry entries are in use.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
