import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

import type * as TS from "typescript";
import { describe, expect, it } from "vitest";

/**
 * What a marketing page makes a phone download before it can hydrate.
 *
 * The app catalogue (every section of `i18n/catalog.ts`, both languages,
 * about 590 KB) reached the mobile home page through three imports: the root
 * error boundaries calling `useT()`, the nav's mobile sheet reading its close
 * label through `useT()`, and the SERVER thread demos importing
 * `formatCallDuration` from `lib/format/call.ts`, which imports
 * `@/i18n/provider`. The third needs no rendering: a server module importing
 * a `"use client"` module makes it a client reference, and Next ships every
 * client reference in the page's server graph. So the rules are on the import
 * graph, not on usage.
 *
 * Walking the static imports (a dynamic `import()` is a separate, later
 * chunk) from every marketing page, in both languages, and the layouts and
 * boundaries that wrap them:
 *
 * 1. No reachable module imports `@/i18n/provider`.
 * 2. No module below a `"use client"` boundary imports the app catalogue or
 *    the home catalogue (the whole home page, both languages).
 * 3. Every import of this app's own files resolves, so none is skipped.
 *
 * And the hero's p5 is the lean build, with every method the sketch calls.
 *
 * Imports are read with the TypeScript parser: a pattern misses an import
 * list spread over lines with a comment inside the braces.
 */

/**
 * Through `createRequire`: `import ts from "typescript"` sends 8MB of
 * CommonJS through vite's transform (see settings/billing/exit-path.test.ts).
 */
const ts = createRequire(import.meta.url)("typescript") as typeof TS;

const SRC = resolve(import.meta.dirname, "..");
const REPO = resolve(SRC, "..", "..", "..");
const APP = join(SRC, "app");

interface ModuleImports {
  isClient: boolean;
  /** Static value imports and re-exports. `import type` is erased and skipped. */
  values: string[];
  /** `import("…")` specifiers. */
  dynamic: string[];
}

function readImports(source: string, fileName: string): ModuleImports {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let isClient = false;
  for (const s of sf.statements) {
    if (!ts.isExpressionStatement(s) || !ts.isStringLiteral(s.expression)) break;
    if (s.expression.text === "use client") isClient = true;
  }
  const values: string[] = [];
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s)) {
      if (s.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
      if (ts.isStringLiteral(s.moduleSpecifier)) values.push(s.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(s) && s.moduleSpecifier && !s.isTypeOnly) {
      if (ts.isStringLiteral(s.moduleSpecifier)) values.push(s.moduleSpecifier.text);
    }
  }
  const dynamic: string[] = [];
  const visit = (n: TS.Node) => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = n.arguments;
      if (arg && ts.isStringLiteralLike(arg)) dynamic.push(arg.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { isClient, values, dynamic };
}

const CODE = /\.(?:tsx?|jsx?|mjs)$/;

/**
 * The file an app-local specifier names, `undefined` for a package, `null`
 * for a local specifier that names nothing. `.js` resolves to `.ts` the way
 * Next's bundler does.
 */
function resolveSpecifier(from: string, spec: string): string | null | undefined {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith("@root/")) base = join(REPO, spec.slice(6));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return undefined;
  const stem = base.replace(/\.(?:jsx?|mjs)$/, "");
  for (const candidate of [
    base,
    `${stem}.ts`,
    `${stem}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** The root layout and boundaries, and every route file under the two marketing groups. */
function marketingEntries(): string[] {
  const out = ["layout.tsx", "error.tsx", "global-error.tsx", "not-found.tsx"].map((f) =>
    join(APP, f),
  );
  const ROUTE_FILE = /^(?:page|layout|error|not-found|loading|template)\.tsx$/;
  const collect = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) collect(full);
      else if (ROUTE_FILE.test(entry)) out.push(full);
    }
  };
  collect(join(APP, "(marketing)"));
  collect(join(APP, "(marketing-fr)"));
  return out;
}

const PROVIDER = join(SRC, "i18n", "provider.tsx");
const CLIENT_FORBIDDEN = new Map([
  [join(SRC, "i18n", "catalog.ts"), "the app catalogue (every section, both languages)"],
  [join(SRC, "i18n", "marketing", "home.ts"), "the home catalogue (the whole page, both languages)"],
]);

interface Finding {
  importer: string;
  target: string;
  why: string;
}

function walk(entries: string[]): {
  visited: Map<string, boolean>;
  findings: Finding[];
  unresolved: string[];
} {
  // Value: whether the module is reached in client context.
  const visited = new Map<string, boolean>();
  const findings: Finding[] = [];
  const unresolved: string[] = [];
  const queue: [string, boolean][] = entries.map((e) => [e, false]);
  while (queue.length > 0) {
    const [file, inherited] = queue.shift()!;
    if (!CODE.test(file)) continue; // a stylesheet, a document, an image
    const imports = readImports(readFileSync(file, "utf8"), file);
    const isClient = inherited || imports.isClient;
    const seen = visited.get(file);
    // Revisit only when a module is first reached as client code.
    if (seen === true || (seen === false && !isClient)) continue;
    visited.set(file, isClient);
    for (const spec of imports.values) {
      const target = resolveSpecifier(file, spec);
      if (target === undefined) continue; // a package; not this app's graph
      if (target === null) {
        unresolved.push(`${rel(file)} -> ${spec}`);
        continue;
      }
      if (target === PROVIDER) {
        findings.push({
          importer: file,
          target,
          why: isClient
            ? "a client module importing the provider ships the whole app catalogue"
            : "a server module importing the provider makes it a client reference, " +
              "and Next ships every client reference with the page",
        });
        continue;
      }
      const forbidden = CLIENT_FORBIDDEN.get(target);
      if (isClient && forbidden) {
        findings.push({ importer: file, target, why: `client code imports ${forbidden}` });
        continue;
      }
      queue.push([target, isClient]);
    }
  }
  return { visited, findings, unresolved };
}

function rel(f: string): string {
  return relative(SRC, f).replace(/\\/g, "/");
}

describe("the import reader the walk depends on", () => {
  it("reads an import list spread over lines with comments inside the braces", () => {
    const { values } = readImports(
      'import {\n  formatCallDuration, // talk time\n  other, /* and this */\n} from "@/lib/format/call";\n',
      "x.tsx",
    );
    expect(values).toEqual(["@/lib/format/call"]);
  });

  it("skips type-only imports and re-exports, and imports quoted in comments", () => {
    const { values } = readImports(
      [
        'import type { A } from "@/a";',
        'export type { B } from "@/b";',
        '// import { c } from "@/c";',
        '/** import { d } from "@/d"; */',
        'export { e } from "@/e";',
        'import "@/f";',
      ].join("\n"),
      "x.ts",
    );
    expect(values).toEqual(["@/e", "@/f"]);
  });

  it("keeps a dynamic import out of the static list", () => {
    const parsed = readImports('const m = () => import("./later");\n', "x.tsx");
    expect(parsed.values).toEqual([]);
    expect(parsed.dynamic).toEqual(["./later"]);
  });

  it("finds a client directive below a comment", () => {
    expect(readImports('/* why */\n"use client";\nexport {};\n', "x.tsx").isClient).toBe(true);
    expect(readImports('export const a = "use client";\n', "x.ts").isClient).toBe(false);
  });
});

describe("the marketing pages' first load", () => {
  const entries = marketingEntries();
  const { visited, findings, unresolved } = walk(entries);
  const reached = [...visited.keys()].map(rel);
  const clientModules = [...visited].filter(([, c]) => c).map(([f]) => rel(f));

  it("walked every marketing page through the client boundary, so a pass means something", () => {
    console.info(
      `marketing-first-load: walked ${visited.size} modules from ${entries.length} entries, ` +
        `${clientModules.length} of them client code`,
    );
    expect(entries.length).toBeGreaterThan(60);
    for (const page of [
      "app/(marketing)/page.tsx",
      "app/(marketing)/pricing/page.tsx",
      "app/(marketing)/for/plumbers/page.tsx",
      "app/(marketing-fr)/fr/page.tsx",
      "app/(marketing-fr)/fr/tarifs/page.tsx",
      "app/(marketing-fr)/fr/plombiers/page.tsx",
    ]) {
      expect(entries.map(rel), `${page} is not among the walk's entries`).toContain(page);
    }
    expect(visited.size).toBeGreaterThan(100);
    for (const must of [
      "components/marketing/hero/hero.tsx",
      "components/marketing/hero/hero-inbox.tsx",
      "components/marketing/nav.tsx",
      "components/marketing/thread-demo/thread-primitives.tsx",
      "components/marketing/trades/trade-thread.tsx",
    ]) {
      expect(reached, `the walk never reached ${must}, so it is not testing the page`).toContain(
        must,
      );
    }
    expect(clientModules).toContain("components/marketing/hero/hero-inbox.tsx");
  });

  it("resolves every import of this app's own files", () => {
    expect(
      unresolved,
      "The walk could not find these files, so it could not check what they " +
        "import. Teach resolveSpecifier the form, or fix the import.",
    ).toEqual([]);
  });

  it("ships neither the i18n provider nor a two-language catalogue", () => {
    expect(
      findings.map((f) => `${rel(f.importer)} -> ${rel(f.target)}: ${f.why}`),
      "These put the app catalogue (about 590 KB, both languages) or a whole " +
        "page's copy in both languages on a marketing page's first load. Import " +
        "the one module you need instead (e.g. lib/format/call-duration.ts, " +
        "components/ui/sheet-base.tsx, app/boundary-copy.ts, the thread demo's " +
        "DemoStatusPill), or pass the words down from a server component.",
    ).toEqual([]);
  });
});

describe("the hero loads the lean p5", () => {
  const LEAN = join(SRC, "components", "marketing", "hero", "p5-lean.ts");
  const P5_PKG = join(SRC, "..", "node_modules", "p5", "package.json");
  const isP5 = (spec: string) => spec === "p5" || spec.startsWith("p5/");

  /** Every source module that names p5 at all, with what it imports. */
  const modules: { file: string; imports: ModuleImports }[] = [];
  let scanned = 0;
  const collect = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        collect(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry) || /\.d\.ts$|\.test\.tsx?$/.test(entry)) continue;
      scanned++;
      const source = readFileSync(full, "utf8");
      if (!source.includes("p5")) continue;
      modules.push({ file: full, imports: readImports(source, full) });
    }
  };
  collect(SRC);

  /**
   * The package's own entry points that are the whole browser build. p5 2.x
   * exports it under more than one name (`p5`, `p5/global`, `p5/node`).
   */
  const exportsMap = JSON.parse(readFileSync(P5_PKG, "utf8")).exports as Record<
    string,
    string | { default?: string }
  >;
  const target = (sub: string) => {
    const t = exportsMap[sub];
    return typeof t === "string" ? t : t?.default;
  };
  const FULL_BUILDS = new Set(
    Object.keys(exportsMap).filter((sub) => /^\.\/dist\/app[^/]*\.js$/.test(target(sub) ?? "")),
  );
  const subpath = (spec: string) => (spec === "p5" ? "." : `./${spec.slice(3)}`);

  it("scanned the source and found the full build in p5's exports", () => {
    console.info(
      `marketing-first-load: scanned ${scanned} source modules for p5, ` +
        `${modules.length} name it; p5 exports the full build as ${[...FULL_BUILDS].join(", ")}`,
    );
    expect(scanned).toBeGreaterThan(500);
    expect(modules.map((m) => rel(m.file))).toContain("components/marketing/hero/arrival-field.tsx");
    expect(FULL_BUILDS.has("."), "the guard no longer recognises p5's full build").toBe(true);
  });

  it("loads p5 only through the lean module", () => {
    const offenders = modules.flatMap(({ file, imports }) =>
      file === LEAN
        ? []
        : [...imports.values, ...imports.dynamic].filter(isP5).map((s) => `${rel(file)} -> ${s}`),
    );
    expect(
      offenders,
      'import("p5") (or p5/global, p5/node) is the whole browser build, about ' +
        "1 MB of script. The sketch draws with components/marketing/hero/p5-lean.ts; " +
        "register the addon you need there instead.",
    ).toEqual([]);
  });

  it("composes the lean module from p5's core and addons, never a full build", () => {
    const lean = modules.find((m) => m.file === LEAN);
    expect(lean, "p5-lean.ts no longer imports p5").toBeDefined();
    const specs = lean!.imports.values.filter(isP5);
    expect(specs).toContain("p5/core");
    expect(lean!.imports.dynamic.filter(isP5)).toEqual([]);
    for (const spec of specs) {
      expect(target(subpath(spec)), `${spec} is not an entry point p5 exports`).toBeDefined();
      expect(FULL_BUILDS.has(subpath(spec)), `${spec} is the whole browser build`).toBe(false);
    }
  });

  /**
   * Calls on a value typed `p5` (the sketch's `p`, the `instance` it keeps),
   * by method name.
   */
  function p5MethodCalls(source: string, fileName: string): string[] {
    const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
    const namesP5 = (type: TS.TypeNode | undefined): boolean => {
      let hit = false;
      const look = (n: TS.Node) => {
        if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName) && n.typeName.text === "p5") {
          hit = true;
        }
        ts.forEachChild(n, look);
      };
      if (type) look(type);
      return hit;
    };
    const bound = new Set<string>();
    const findBound = (n: TS.Node) => {
      if ((ts.isParameter(n) || ts.isVariableDeclaration(n)) && ts.isIdentifier(n.name)) {
        if (namesP5(n.type)) bound.add(n.name.text);
      }
      ts.forEachChild(n, findBound);
    };
    findBound(sf);
    const calls = new Set<string>();
    const findCalls = (n: TS.Node) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        ts.isIdentifier(n.expression.expression) &&
        bound.has(n.expression.expression.text)
      ) {
        calls.add(n.expression.name.text);
      }
      ts.forEachChild(n, findCalls);
    };
    findCalls(sf);
    return [...calls].sort();
  }

  const sketches = modules.filter(({ file, imports }) =>
    [...imports.values, ...imports.dynamic].some((s) => resolveSpecifier(file, s) === LEAN),
  );

  it("registers every p5 method the sketch calls", async () => {
    // `p5-modules.d.ts` gives the lean core the full build's type, so tsc
    // passes a call to an addon the lean module never registered. Only this
    // catches it before the first frame throws.
    const { default: lean } = await import("@/components/marketing/hero/p5-lean");
    const proto = lean.prototype as unknown as Record<string, unknown>;
    const calls = sketches.flatMap(({ file }) =>
      p5MethodCalls(readFileSync(file, "utf8"), file).map((name) => ({ file, name })),
    );
    console.info(
      `marketing-first-load: ${calls.length} p5 method calls in ` +
        `${sketches.map((s) => rel(s.file)).join(", ")}`,
    );
    expect(sketches.map((s) => rel(s.file))).toContain("components/marketing/hero/arrival-field.tsx");
    expect(calls.map((c) => c.name)).toEqual(expect.arrayContaining(["createCanvas", "noise", "remove"]));
    expect(
      calls.filter((c) => typeof proto[c.name] !== "function").map((c) => `${rel(c.file)}: p.${c.name}()`),
      "The lean p5 does not define these. Register the addon that does in " +
        "components/marketing/hero/p5-lean.ts.",
    ).toEqual([]);
  });

  it("would report a call to an addon the lean module leaves out", async () => {
    const { default: lean } = await import("@/components/marketing/hero/p5-lean");
    const proto = lean.prototype as unknown as Record<string, unknown>;
    const calls = p5MethodCalls(
      "const s = (p: p5) => { p.circle(1, 2, 3); p.text('9:04 PM', 0, 0); };\n" +
        "let instance: p5 | null = null;\ninstance?.remove();\n",
      "proof.tsx",
    );
    expect(calls).toEqual(["circle", "remove", "text"]);
    expect(calls.filter((name) => typeof proto[name] !== "function")).toEqual(["text"]);
  });
});
