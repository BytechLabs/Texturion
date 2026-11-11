/**
 * #733: the toast rules. A change that can be undone says so through
 * `undoableToast` (five seconds, one Undo); nothing builds its own Undo
 * action. A delete with no restore reports with a plain toast, and only after a
 * `ConfirmDialog` has asked first, since nothing can bring it back.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const HOME = "components/ui/optimistic-undo.tsx";

/** Deletes that ask first through a dialog of their own rather than ConfirmDialog. */
const ASKS_ITS_OWN_WAY: Record<string, string> = {
  "components/settings/text-enable-card.tsx":
    "removing texting asks the owner to type the number, a form dialog",
};

const HAND_BUILT_UNDO = /label:\s*t\(\s*"(?:thread|common)\.undo"\s*\)/;
const PLAIN_DELETE_TOAST = /toast\.success\(\s*t\(\s*"[a-zA-Z]+\.[a-zA-Z]*(?:Deleted|Removed)"/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** Does this source give a toast an Undo of its own? */
export function buildsOwnUndo(text: string): boolean {
  return HAND_BUILT_UNDO.test(text);
}

/** Does this source report a delete with a plain toast and never confirm it? */
export function deletesWithoutAsking(text: string): boolean {
  return PLAIN_DELETE_TOAST.test(text) && !/<ConfirmDialog\b/.test(text);
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path).split("\\").join("/"),
  text: readFileSync(path, "utf8"),
}));

describe("#733 toasts", () => {
  it("catches both shapes", () => {
    expect(buildsOwnUndo(`toast("Cleared", { action: { label: t("thread.undo"), onClick } })`)).toBe(true);
    expect(buildsOwnUndo(`undoableToast({ message, undoLabel: t("thread.undo"), onUndo })`)).toBe(false);
    expect(deletesWithoutAsking(`toast.success(t("misc.fileDeleted"));`)).toBe(true);
    expect(deletesWithoutAsking(`<ConfirmDialog />; toast.success(t("misc.fileDeleted"));`)).toBe(false);
  });

  it("reads the app", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.some(({ text }) => PLAIN_DELETE_TOAST.test(text))).toBe(true);
  });

  it("only undoableToast offers Undo", () => {
    const offenders = files
      .filter(({ path, text }) => path !== HOME && buildsOwnUndo(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("a delete with no Undo asked first", () => {
    const offenders = files
      .filter(({ path, text }) => !(path in ASKS_ITS_OWN_WAY) && deletesWithoutAsking(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("every named exception still reports a delete", () => {
    const stale = Object.keys(ASKS_ITS_OWN_WAY).filter(
      (path) => !files.some((file) => file.path === path && PLAIN_DELETE_TOAST.test(file.text)),
    );
    expect(stale).toEqual([]);
  });
});
