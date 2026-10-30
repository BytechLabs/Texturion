#!/usr/bin/env node
/**
 * A Worker's upload size, measured by wrangler's own dry run, against a budget.
 *
 *   node scripts/check-worker-size.mjs apps/web --budget-kib 7168
 *
 * Run by the build job in `.github/workflows/checks.yml`, after the OpenNext
 * build, because nothing else looks at the web Worker before it ships, and an
 * oversized one passes the build, every test and a local server (D141).
 * ship.yml uploads the web Worker after the database migration and the api
 * deploy, so a rejected upload there leaves production half released.
 *
 * The size is read from wrangler's "Total Upload" line, the same figure a real
 * deploy reports. When that line is missing the check fails, so a change in
 * wrangler's output cannot turn into a silent pass.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const ANSI = /\u001b\[[0-9;]*m/g;
const UPLOAD_LINE = /Total Upload:\s*([\d.]+)\s*KiB\s*\/\s*gzip:\s*([\d.]+)\s*KiB/;

/** Raw and gzip KiB from wrangler's output, or null when it reports neither. */
export function uploadSize(output) {
  const match = UPLOAD_LINE.exec(String(output ?? "").replace(ANSI, ""));
  if (!match) return null;
  const rawKiB = Number(match[1]);
  const gzipKiB = Number(match[2]);
  return Number.isFinite(rawKiB) && Number.isFinite(gzipKiB) ? { rawKiB, gzipKiB } : null;
}

/** Whether the gzip size fits, and the one line that says so either way. */
export function judge(size, budgetKiB) {
  const headroom = budgetKiB - size.gzipKiB;
  const figures =
    `${size.gzipKiB.toFixed(2)} KiB gzip (${size.rawKiB.toFixed(2)} KiB raw) ` +
    `against a budget of ${budgetKiB} KiB gzip`;
  return headroom >= 0
    ? { ok: true, message: `Worker upload is ${figures}, ${headroom.toFixed(2)} KiB to spare.` }
    : { ok: false, message: `Worker upload is ${figures}, ${(-headroom).toFixed(2)} KiB over.` };
}

function main() {
  const [packageDir, flag, value] = process.argv.slice(2);
  const budgetKiB = Number(value);
  if (!packageDir || flag !== "--budget-kib" || !(budgetKiB > 0)) {
    console.error("Usage: node scripts/check-worker-size.mjs <package-dir> --budget-kib <n>");
    process.exit(2);
  }

  const outdir = mkdtempSync(join(tmpdir(), "worker-size-"));
  let result;
  try {
    result = spawnSync(
      "pnpm",
      ["exec", "wrangler", "deploy", "--dry-run", `--outdir=${outdir}`],
      {
        cwd: join(REPO_ROOT, packageDir),
        encoding: "utf8",
        shell: process.platform === "win32",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);
  if (result.error || result.status !== 0) {
    console.error(
      `::error::wrangler's dry run for ${packageDir} failed (${result.error?.message ?? `exit ${result.status}`}).`,
    );
    process.exit(1);
  }

  const size = uploadSize(output);
  if (!size) {
    console.error(
      `::error::wrangler's dry run for ${packageDir} printed no "Total Upload" line, so its size is unknown.`,
    );
    process.exit(1);
  }

  const { ok, message } = judge(size, budgetKiB);
  if (!ok) {
    console.error(`::error::${packageDir}: ${message}`);
    process.exit(1);
  }
  console.log(`${packageDir}: ${message}`);
}

// Only when run, never when imported by its test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
