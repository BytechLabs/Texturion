/**
 * #732: every list page draws its title and main action through PageHeader, so
 * "New" sits in the same place and looks the same everywhere.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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

/**
 * #733: no page in the signed-in app draws a title of its own. The only
 * `<h1>` allowed outside PageHeader are the record pages, whose title is the
 * record's name in its record header, and the compose bar.
 */
const OWN_TITLE_ALLOWED = new Set([
  "components/ui/page-header.tsx",
  "app/(app)/contacts/[id]/page.tsx",
  "components/calls/call-detail.tsx",
  "components/inbox/new-conversation.tsx",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx$/.test(entry) && !entry.includes(".test.") ? [full] : [];
  });
}

describe("#733 page titles", () => {
  // Marketing, auth, onboarding and the full-screen states (errors, MFA, the
  // update prompt) are their own patterns, outside the app's pages.
  const appFiles = [...walk(join(SRC, "app", "(app)")), ...walk(join(SRC, "components"))]
    .map((file) => relative(SRC, file).replaceAll("\\", "/"))
    .filter((rel) => !/^components\/(marketing|public|auth)\//.test(rel))
    .filter((rel) => !["components/shell/mfa-gate.tsx", "components/shell/update-prompt.tsx"].includes(rel));

  it("draws every page title through PageHeader", () => {
    const own = appFiles.filter(
      (rel) => !OWN_TITLE_ALLOWED.has(rel) && /<h1[\s>]/.test(readFileSync(join(SRC, rel), "utf8")),
    );
    expect(own).toEqual([]);
  });

  it("covers the app, so an empty scan cannot pass", () => {
    const users = appFiles.filter((rel) => readFileSync(join(SRC, rel), "utf8").includes("<PageHeader"));
    expect(users.length).toBeGreaterThanOrEqual(9);
  });
});
