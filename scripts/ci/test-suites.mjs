/**
 * The vitest packages in the workspace and a way to open each one's vitest.
 *
 * A package is a vitest package when its `test` script is `vitest run`. Any
 * other `test` script fails here, so a package that switches runner cannot drop
 * out of CI without somebody deciding where its tests run instead.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function toRepoPath(absolute) {
  return path.relative(REPO_ROOT, absolute).split(path.sep).join("/");
}

export function workspacePackages() {
  const yaml = readFileSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
  const patterns = [...yaml.matchAll(/^\s*-\s*["']?([^"'\s#]+)["']?\s*$/gm)].map((m) => m[1]);
  if (patterns.length === 0) throw new Error("pnpm-workspace.yaml lists no packages");
  const dirs = new Set();
  for (const pattern of patterns) {
    if (!pattern.endsWith("/*") || pattern.slice(0, -2).includes("*")) {
      throw new Error(`pnpm-workspace.yaml pattern ${pattern} is not of the form dir/*`);
    }
    const parent = path.join(REPO_ROOT, pattern.slice(0, -2));
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(path.join(parent, entry.name, "package.json"))) {
        dirs.add(toRepoPath(path.join(parent, entry.name)));
      }
    }
  }
  return [...dirs].sort().map((dir) => {
    const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, dir, "package.json"), "utf8"));
    return { dir, name: manifest.name, manifest };
  });
}

export function vitestPackages() {
  const packages = workspacePackages().filter((pkg) => pkg.manifest.scripts?.test !== undefined);
  for (const pkg of packages) {
    if (pkg.manifest.scripts.test !== "vitest run") {
      throw new Error(
        `${pkg.dir}: test script is "${pkg.manifest.scripts.test}", not "vitest run"; ` +
          "scripts/ci/test-plan.mjs only knows how to shard vitest",
      );
    }
  }
  if (packages.length === 0) throw new Error("no workspace package has a vitest test script");
  return packages;
}

/** Workspace packages `pkg` depends on, directly or through another one. */
export function workspaceDependencies(pkg, all = workspacePackages()) {
  const byName = new Map(all.map((p) => [p.name, p]));
  const found = new Map();
  const visit = (current) => {
    const deps = { ...current.manifest.dependencies, ...current.manifest.devDependencies };
    for (const [name, range] of Object.entries(deps)) {
      if (!String(range).startsWith("workspace:") || found.has(name)) continue;
      const dep = byName.get(name);
      if (!dep) continue;
      found.set(name, dep);
      visit(dep);
    }
  };
  visit(pkg);
  return [...found.values()];
}

export async function loadVitestNode(pkgDir) {
  const require = createRequire(path.join(REPO_ROOT, pkgDir, "package.json"));
  const manifestPath = require.resolve("vitest/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry = manifest.exports["./node"];
  const relative = typeof entry === "string" ? entry : (entry.import?.default ?? entry.import ?? entry.default);
  return import(pathToFileURL(path.join(path.dirname(manifestPath), relative)).href);
}

/** Opens vitest for one package without running anything. Close it when done. */
export async function openVitest(pkgDir, options = {}) {
  const { createVitest } = await loadVitestNode(pkgDir);
  const root = path.join(REPO_ROOT, pkgDir);
  process.chdir(root);
  return createVitest("test", { watch: false, root, ...options });
}

/** The vitest-internal graph walk `vitest --changed` uses, checked for presence. */
export async function testDependencies(vitest, spec) {
  const specifications = vitest.specifications;
  if (typeof specifications?.getTestDependencies !== "function") {
    throw new Error("this vitest no longer has specifications.getTestDependencies; update scripts/ci");
  }
  const deps = await specifications.getTestDependencies(spec);
  return [spec.moduleId, ...deps].map(toRepoPath);
}
