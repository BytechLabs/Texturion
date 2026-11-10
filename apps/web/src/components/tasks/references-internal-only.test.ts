import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * #690: a `#` typed into a text to a customer is a `#`. The reference picker
 * and the chip renderer belong to the internal fields only (a note, a task
 * description, a task comment, a task link), and the composer for a text to a
 * customer shares a file with the note composer, so the guard is on where the
 * picker is wired in that file and on who may import it at all.
 */
const SRC = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

const rel = (path: string) => relative(SRC, path).split("\\").join("/");

describe("references stay out of texts to customers", () => {
  it("only the internal fields import the picker, the trigger or the chips", () => {
    const users = sourceFiles(SRC)
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return /from "(\.\/|@\/components\/tasks\/)(reference-picker|use-reference-trigger|reference-text)"/.test(
          text,
        );
      })
      .map(rel)
      .sort();
    expect(users).toEqual([
      "components/tasks/task-detail-panel.tsx",
      "components/tasks/task-feed.tsx",
      "components/tasks/task-links-section.tsx",
      "components/thread/composer.tsx",
      "components/thread/message-bubble.tsx",
    ]);
  });

  it("in the shared composer the trigger runs for a note and the picker renders for a note", () => {
    const text = readFileSync(join(SRC, "components/thread/composer.tsx"), "utf8");
    const typed = text.indexOf("noteRefs.onTyped(");
    expect(typed).toBeGreaterThan(0);
    expect(text.slice(typed - 40, typed)).toMatch(/if \(isNote\) \{\s*$/);
    const picker = text.indexOf("<ReferencePicker");
    expect(picker).toBeGreaterThan(0);
    expect(text.slice(picker - 40, picker)).toMatch(/\{isNote && \(\s*$/);
    // And nowhere else in the file.
    expect(text.split("noteRefs.onTyped(").length).toBe(2);
    expect(text.split("<ReferencePicker").length).toBe(2);
  });

  it("the message bubble reads references out of a note and nothing else", () => {
    const text = readFileSync(join(SRC, "components/thread/message-bubble.tsx"), "utf8");
    expect(text).toContain("{note ? <ReferenceText text={message.body} /> : message.body}");
  });
});
