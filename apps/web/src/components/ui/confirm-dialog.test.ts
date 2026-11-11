/**
 * #733 — one confirm dialog.
 *
 * "Are you sure?" used to be drawn by hand in every file: a Dialog, a Cancel, a
 * destructive button, each with its own width and its own idea of what pending
 * looks like. `ConfirmDialog` is the one of them. This scan fails when a file
 * builds the pattern again: a `<DialogFooter>` holding a cancel-style button
 * (outline or ghost) next to a `variant="destructive"` one.
 *
 * A dialog with fields to fill is not a confirm, so it may keep its own footer.
 * Each exception names why; an exception that stops matching anything fails
 * too, so the list cannot go stale.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

/** Posix path under src/ -> why this dialog is not a simple confirm. */
const EXCEPTIONS: Record<string, string> = {
  "components/settings/delete-account-card.tsx":
    "typed confirmation: the owner types a word before the button unlocks",
  "components/settings/close-workspace-card.tsx":
    "typed confirmation: the owner types the workspace name",
  "components/settings/text-enable-card.tsx":
    "code entry: the footer belongs to a verification-code form",
  "components/settings/two-factor-card.tsx":
    "code entry and recovery-code steps of the 2FA enrolment wizard",
};

const FOOTER = /<DialogFooter\b[\s\S]*?<\/DialogFooter>/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith("(marketing")) continue;
      sourceFiles(full, out);
    } else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Does this footer hold a cancel-style button AND a destructive one? */
export function handBuiltConfirm(footer: string): boolean {
  return (
    /variant="destructive"/.test(footer) &&
    /variant="(outline|ghost)"/.test(footer)
  );
}

const files = sourceFiles(SRC).map((file) => ({
  path: relative(SRC, file).split(sep).join("/"),
  text: readFileSync(file, "utf8"),
}));

describe("#733 one ConfirmDialog", () => {
  it("recognises the hand-built pattern", () => {
    const built = `<DialogFooter>
      <Button variant="outline">Cancel</Button>
      <Button variant="destructive">Delete</Button>
    </DialogFooter>`;
    expect(handBuiltConfirm(built)).toBe(true);
    expect(
      handBuiltConfirm(
        `<DialogFooter><Button variant="ghost">Close</Button></DialogFooter>`,
      ),
    ).toBe(false);
  });

  it("no file hand-builds a cancel + destructive footer", () => {
    const offenders = files
      .filter(({ path }) => path !== "components/ui/confirm-dialog.tsx")
      .filter(({ path }) => !(path in EXCEPTIONS))
      .filter(({ text }) => (text.match(FOOTER) ?? []).some(handBuiltConfirm))
      .map(({ path }) => path);
    expect(
      offenders,
      "use <ConfirmDialog> from components/ui/confirm-dialog instead",
    ).toEqual([]);
  });

  it("every named exception still hand-builds one", () => {
    const stale = Object.keys(EXCEPTIONS).filter((path) => {
      const file = files.find((f) => f.path === path);
      return !file || !(file.text.match(FOOTER) ?? []).some(handBuiltConfirm);
    });
    expect(stale).toEqual([]);
  });

  it("is actually used, and the scan actually looked", () => {
    expect(files.length).toBeGreaterThan(200);
    const users = files.filter(({ text }) => text.includes("<ConfirmDialog"));
    expect(users.length).toBeGreaterThanOrEqual(20);
  });
});
