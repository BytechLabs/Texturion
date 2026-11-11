/**
 * #745: only the data-export screens may start or list a queued export.
 *
 * `/v1/exports` is the regulatory pipeline: a scheduled build, a row in the
 * exports list in Settings, a signed link. "Export outstanding work" on Tasks
 * used it, so a routine convenience queued a compliance job. A list export is a
 * direct download (`GET /v1/tasks/export.csv`, `GET /v1/contacts/export`); this
 * fails when any other web code reaches for the queue.
 *
 * Two questions, because the endpoint is reached two ways: a literal `/v1/exports`
 * anywhere but its one client module, and an import of that module (whose hooks
 * hide the literal) from any screen not named below.
 *
 * THE ALLOW-LIST IS THE ARGUMENT. Each entry says why it is a queued export and
 * not a list download. Adding a screen here is a decision to put another thing on
 * the regulatory pipeline, and should be made as one. Entries are re-derived on
 * every run: one that no longer imports the client is reported as stale rather
 * than quietly excusing the next file at that path.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../..");
const CLIENT = "lib/api/exports.ts";

const ALLOWED_CALLERS = new Map<string, string>([
  [
    "components/settings/export-data-card.tsx",
    "the workspace data export: the one this pipeline exists for",
  ],
  [
    "components/settings/export-usage.tsx",
    "the bookkeeper's usage summary: a built period document, not a list of rows",
  ],
  [
    "components/contacts/export-history.tsx",
    "one customer's whole conversation history as a document, built in the background",
  ],
]);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      out.push(...sources(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** A comment that names the endpoint is documentation, not a call. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

const files = sources(SRC).map((full) => ({
  path: relative(SRC, full).replaceAll("\\", "/"),
  text: withoutComments(readFileSync(full, "utf8")),
}));

const IMPORTS_CLIENT = /from\s+["'](?:@\/lib\/api\/exports|\.{1,2}\/(?:\.\.\/)*(?:lib\/api\/)?exports)["']/;
const LITERAL = /\/v1\/exports/;

describe("#745 the queued export pipeline is for data exports only", () => {
  it("reads a real tree", () => {
    // A guard whose scan found nothing reports success in the same words as a
    // clean tree.
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((file) => file.path === CLIENT)).toBe(true);
  });

  it("only the exports client names /v1/exports", () => {
    const offenders = files
      .filter((file) => LITERAL.test(file.text) && file.path !== CLIENT)
      .map((file) => file.path);
    expect(
      offenders,
      "These call the queued export endpoints directly. A list export is a direct download, not a data export.",
    ).toEqual([]);
  });

  it("only the allow-listed screens use the exports client", () => {
    const importers = files.filter((file) => IMPORTS_CLIENT.test(file.text)).map((file) => file.path);
    const offenders = importers.filter((path) => !ALLOWED_CALLERS.has(path));
    expect(
      offenders,
      "These start or list a queued data export. Download the list directly (see tasks-export.ts) or, if this really is a data export, add it to ALLOWED_CALLERS with the reason.",
    ).toEqual([]);
  });

  it("every allow-list entry still uses the client", () => {
    const importers = new Set(
      files.filter((file) => IMPORTS_CLIENT.test(file.text)).map((file) => file.path),
    );
    const stale = [...ALLOWED_CALLERS.keys()].filter((path) => !importers.has(path));
    expect(stale, "Remove these from ALLOWED_CALLERS.").toEqual([]);
  });
});
