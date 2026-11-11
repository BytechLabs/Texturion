/**
 * #733 — one load error.
 *
 * "Couldn't load this" used to end in a sentence and a bare underline link
 * (`<button className="underline">Retry</button>`) inside every card. `LoadError`
 * is the one of them, with `variant="inline"` for a spot inside a card. This
 * scan fails when a file draws a raw `<button>` whose label is the shared
 * Retry text. The shared `<Button>` is a different component and is not
 * matched.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

/** Paths that draw a raw Retry button, and why. */
const EXCEPTIONS: Record<string, string> = {
  "components/settings/change-plan-dialog.tsx":
    "a clause inside a requirement checklist line (a span), not a block of its own",
};

const RAW_RETRY =
  /<button\b[^<]*>\s*\{t\("(?:common|misc)\.retry"\)\}\s*<\/button>/;

/** Does this source draw a raw `<button>` labelled with the shared Retry? */
export function drawsRawRetry(text: string): boolean {
  return RAW_RETRY.test(text);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith("(marketing") || entry.name === "marketing") {
        continue;
      }
      sourceFiles(full, out);
    } else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = sourceFiles(SRC).map((file) => ({
  path: relative(SRC, file).split(sep).join("/"),
  text: readFileSync(file, "utf8"),
}));

describe("#733 one LoadError", () => {
  it("recognises a raw Retry link", () => {
    expect(
      drawsRawRetry(
        `<p>{t("misc.x")} <button type="button" onClick={() => list.refetch()} className="underline">{t("misc.retry")}</button></p>`,
      ),
    ).toBe(true);
    expect(
      drawsRawRetry(`<Button onClick={go}>{t("common.retry")}</Button>`),
    ).toBe(false);
    expect(
      drawsRawRetry(`<button type="button">{t("common.save")}</button>`),
    ).toBe(false);
  });

  it("no file draws a raw Retry button", () => {
    const offenders = files
      .filter(({ path }) => path !== "components/ui/load-error.tsx")
      .filter(({ path }) => !(path in EXCEPTIONS))
      .filter(({ text }) => drawsRawRetry(text))
      .map(({ path }) => path);
    expect(
      offenders,
      "use <LoadError> from components/ui/load-error instead",
    ).toEqual([]);
  });

  it("every named exception still draws one", () => {
    const stale = Object.keys(EXCEPTIONS).filter((path) => {
      const file = files.find((f) => f.path === path);
      return !file || !drawsRawRetry(file.text);
    });
    expect(stale).toEqual([]);
  });

  it("is actually used, and the scan actually looked", () => {
    expect(files.length).toBeGreaterThan(200);
    const users = files.filter(({ text }) => text.includes("<LoadError"));
    expect(users.length).toBeGreaterThanOrEqual(10);
  });
});
