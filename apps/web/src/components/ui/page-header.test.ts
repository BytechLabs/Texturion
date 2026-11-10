/**
 * #732: every list page draws its title and main action through PageHeader, so
 * "New" sits in the same place and looks the same everywhere.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const PAGES = [
  "components/inbox/inbox-pane.tsx",
  "components/calls/calls-view.tsx",
  "components/tasks/tasks-page.tsx",
  "app/(app)/contacts/page.tsx",
];

describe("#732 page headers", () => {
  it.each(PAGES)("%s uses the shared header and draws no title of its own", (file) => {
    const source = readFileSync(join(SRC, file), "utf8");
    expect(source).toContain("<PageHeader");
    expect(source).not.toMatch(/<h1[\s>]/);
  });

  it("a main action is a filled button, never an outline or ghost one", () => {
    for (const file of PAGES) {
      const source = readFileSync(join(SRC, file), "utf8");
      const primary = source.match(/primary=\{([\s\S]*?)\n\s{8}\}/)?.[1] ?? "";
      expect(primary, file).not.toMatch(/variant="(outline|ghost)"/);
    }
  });
});
