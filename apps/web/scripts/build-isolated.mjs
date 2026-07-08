/**
 * Reliable production build into an ISOLATED output dir.
 *
 * Why this exists: a plain `next build` writes into the default `.next`. If a
 * `next dev` server is running (it holds and continuously rewrites `.next`), the
 * two collide and the build fails INTERMITTENTLY with a corrupted module graph:
 *   - "Cannot find module for page: /legal/subprocessors"  (page-data collect)
 *   - "Cannot read properties of undefined (reading 'call')" in webpack-runtime
 *     while prerendering "/"  (a half-written chunk from the dev server)
 * Those were the flaky red bars: the build itself is correct (typecheck passes),
 * the failure is a shared-cache race, not a source error.
 *
 * next.config.ts honors LOONEXT_DIST_DIR (sets `distDir`). This script points it
 * at a FRESH, unique dir per build (`.next-build-<pid>-<ts>`), removes any stale
 * one first, runs `next build`, and cleans up on success. The build can then run
 * green regardless of a concurrent dev server, because it never touches `.next`.
 *
 * Usage:  pnpm --filter @loonext/web build:isolated
 *         # keep the output for `next start`:  KEEP_DIST=1 pnpm ... build:isolated
 *         # pin the dir name:  LOONEXT_DIST_DIR=.next-prod pnpm ... build:isolated
 */

import { spawnSync } from "node:child_process";
import { rmSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const webDir = process.cwd();
const distDir =
  process.env.LOONEXT_DIST_DIR ||
  `.next-build-${process.pid}-${Date.now()}`;
const keep = process.env.KEEP_DIST === "1";
const distPath = join(webDir, distDir);

function clean() {
  if (existsSync(distPath)) {
    try {
      rmSync(distPath, { recursive: true, force: true });
    } catch {
      // Best-effort: a leftover dir from a killed build shouldn't block us.
    }
  }
}

// Start from a clean slate so no half-written prior output can poison the graph.
clean();

// Run Next's own CLI entry with the current Node (no shell, no PATH lookup, no
// Windows .cmd-shim EINVAL): resolve `next/dist/bin/next` and exec it directly.
const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const env = { ...process.env, LOONEXT_DIST_DIR: distDir };

function nextBuild() {
  return spawnSync(process.execPath, [nextBin, "build"], {
    cwd: webDir,
    stdio: "inherit",
    env,
  }).status ?? 1;
}

// Single pass: the marketing fonts are next/font/google instances now
// (lib/marketing/fonts.ts), and next/font emits its own <link rel=preload>
// at build time, so the old two-pass gen-font-preloads manifest dance is gone.
const code = nextBuild();

// Clean up the isolated output unless the caller wants to `next start` from it.
if (!keep) clean();

if (code === 0) {
  console.log(
    `\n✓ Isolated production build succeeded (dist: ${distDir}${keep ? ", kept" : ", cleaned"}).`,
  );
} else {
  console.error(`\n✗ Isolated production build failed (exit ${code}).`);
}

process.exit(code);
