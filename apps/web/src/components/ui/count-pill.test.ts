/**
 * #733 — one count pill.
 *
 * A small round token holding a number was drawn by hand in six places, each
 * with its own size and tint. `CountPill` is the one of them. This scan fails
 * when a class string outside it builds the shape again: a rounded-full token
 * with a quiet or primary fill, semibold tabular numerals and a minimum width
 * or horizontal padding of its own.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

const LITERAL = /"[^"\n]*"|`[^`]*`/g;

/** Is this class string a hand-built count pill? */
export function isHandBuiltCountPill(classes: string): boolean {
  return (
    /\brounded-full\b/.test(classes) &&
    /\btabular-nums\b/.test(classes) &&
    /\bfont-semibold\b/.test(classes) &&
    /\bbg-(?:app-line-soft|primary)\b/.test(classes) &&
    /\bmin-w-|\bpx-1(?:\.5)?\b/.test(classes)
  );
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

describe("#733 one CountPill", () => {
  it("recognises the hand-built pill", () => {
    expect(
      isHandBuiltCountPill(
        "grid h-4 min-w-4 place-items-center rounded-full bg-app-line-soft px-1 text-[10.5px] font-semibold tabular-nums text-app-muted",
      ),
    ).toBe(true);
    expect(
      isHandBuiltCountPill(
        "absolute flex min-w-4 rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground tabular-nums",
      ),
    ).toBe(true);
    expect(
      isHandBuiltCountPill("grid size-5 place-items-center rounded-full bg-app-tint"),
    ).toBe(false);
  });

  it("no file draws one by hand", () => {
    const offenders = files
      .filter(({ path }) => path !== "components/ui/count-pill.tsx")
      .filter(({ text }) =>
        (text.match(LITERAL) ?? []).some(isHandBuiltCountPill),
      )
      .map(({ path }) => path);
    expect(
      offenders,
      "use <CountPill> from components/ui/count-pill instead",
    ).toEqual([]);
  });

  it("is actually used, and the scan actually looked", () => {
    expect(files.length).toBeGreaterThan(200);
    const users = files.filter(({ text }) => text.includes("<CountPill"));
    expect(users.length).toBeGreaterThanOrEqual(6);
  });
});
