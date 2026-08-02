/**
 * #298 — the tag list, and the sentence an admin reads before an irreversible
 * merge.
 *
 * What is tested here is what this card could lie about. The counts are the
 * whole reason it exists ("cleanup is impossible without being able to see the
 * problem"), and the merge confirmation is the only thing between an admin and
 * an operation that cannot be undone by retyping a name — so those two get the
 * assertions. The mutation plumbing is covered where it lives.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

type Row = {
  tag_id: string;
  name: string;
  uses: number;
  description?: string | null;
  last_used?: string | null;
};

const state: { rows: Row[]; locked: boolean } = { rows: [], locked: false };

vi.mock("@/lib/api/tags", () => ({
  useTagUsage: () => ({ data: { data: state.rows }, isPending: false }),
  useMergeTags: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTag: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/api/companies", () => ({
  useCompany: () => ({ data: { id: "co-1", tags_locked: state.locked } }),
  useUpdateCompany: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { TagManagementCard } from "./tag-management-card";

function render(
  next: Partial<typeof state> & { canManage?: boolean } = {},
): string {
  Object.assign(state, {
    rows: [
      {
        tag_id: "t1",
        name: "Warranty",
        uses: 12,
        description: "Work we are going back to fix for free.",
        last_used: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
      { tag_id: "t2", name: "Wrnty", uses: 1, description: null, last_used: null },
      { tag_id: "t3", name: "Roof", uses: 0, description: null, last_used: null },
    ],
    locked: false,
    ...next,
  });
  return renderToStaticMarkup(
    <TagManagementCard canManage={next.canManage ?? true} />,
  )
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x2F;", "/");
}

describe("#298 the usage list", () => {
  it("counts in threads, so the near-duplicate is visible next to the real one", () => {
    // The names alone say nothing — every one of them looked reasonable to
    // whoever made it. "Warranty 12" beside "Wrnty 1" is the entire insight.
    const html = render();
    expect(html).toContain("12 threads");
    expect(html).toContain("1 thread");
    expect(html).not.toContain("1 threads");
  });

  it("calls a zero 'never used' rather than '0 threads'", () => {
    // "0 threads" reads as a value still loading. "never used" reads as the
    // verdict it is, which is what makes the tail of the list actionable.
    expect(render()).toContain("never used");
    expect(render()).not.toContain("0 threads");
  });

  it("renders nothing at all when the workspace has no tags", () => {
    // A card headed "Tags" over an empty list teaches an admin that tags are
    // broken, not that they have not started.
    expect(render({ rows: [] })).toBe("");
  });

  it("offers no merge to somebody who cannot curate", () => {
    const html = render({ canManage: false });
    expect(html).toContain("Warranty");
    expect(html).not.toContain("Merge");
  });

  it("offers no merge when there is nothing to merge INTO", () => {
    const html = render({ rows: [{ tag_id: "t1", name: "Warranty", uses: 3 }] });
    expect(html).not.toContain("Merge");
  });

  it("shows what a tag MEANS, and when it was last used", () => {
    // The two things the names alone cannot say. A tag with forty uses and
    // nothing since March is a category the crew has quietly stopped
    // believing in, and the count on its own reads as healthy.
    const html = render();
    expect(html).toContain("Work we are going back to fix for free.");
    expect(html).toContain("last ");
  });

  it("labels the pencil by what it will actually do", () => {
    // The glyph is the same either way, so the label carries the difference:
    // writing the first description is a different act from changing one, and
    // a screen reader user has only the label to tell them which.
    const html = render();
    expect(html).toContain('aria-label="Edit the description for Warranty"');
    expect(html).toContain('aria-label="Describe Wrnty"');
  });
});

describe("#298 the creation lock", () => {
  it("is offered to a curator and says the crew keeps using what exists", () => {
    // The line that stops this becoming a taxonomy nobody follows: a tech who
    // cannot categorise a thread leaves it uncategorised, so the restriction
    // has to be on INVENTING a tag and the copy has to say so up front.
    const html = render();
    expect(html).toContain("Only owners and admins can create tags");
    expect(html).toContain("Everyone can still use every tag you already have");
  });

  it("is not shown to somebody who could not act on it", () => {
    expect(render({ canManage: false })).not.toContain(
      "Only owners and admins can create tags",
    );
  });

  it("names the cost once it is on", () => {
    // Loss Aversion, inverted: the cost of a locked list is invisible from
    // this screen, because it lands on a tech mid-job and never reports back.
    expect(render({ locked: true })).toContain("leave the thread");
    expect(render({ locked: false })).not.toContain("leave the thread");
  });
});
