import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * #294 — the task drawer's files, grouped into the visits they arrived on.
 *
 * Before this the section was one flat list: a job with four site visits looked
 * exactly like a job with one, and nothing said which pictures were the finished
 * work or who took them. These pin the three things a person reads off the grouped
 * view, because all three are inherited from the note rather than stored per file
 * and a refactor could quietly drop any of them without failing a type check.
 */

vi.mock("@/lib/api/attachments", () => ({
  useDeleteAttachment: () => ({ isPending: false, mutate: vi.fn(), variables: undefined }),
  useAttachmentUrl: () => ({ data: null, isPending: false }),
  useReportAttachment: () => ({ isPending: false, mutate: vi.fn() }),
}));

vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => "c-1",
  useActiveCompany: () => ({ companyId: "c-1", role: "owner" }),
}));

import type { TaskAttachmentItem } from "@/lib/api/types";

import { TaskAttachments } from "./task-attachments";

function photo(over: Partial<TaskAttachmentItem> & { id: string }): TaskAttachmentItem {
  return {
    source: "note",
    kind: "image",
    file_name: "site.jpg",
    content_type: "image/jpeg",
    size_bytes: 1024,
    created_at: "2026-07-04T10:00:00Z",
    note_id: null,
    work_phase: null,
    added_by_user_id: null,
    ...over,
  };
}

const NAMES = new Map([["u1", "Priya"]]);

describe("what a person reads off a job's photos (#294)", () => {
  it("labels a set as the after, and names who took it", () => {
    const html = renderToStaticMarkup(
      <TaskAttachments
        names={NAMES}
        items={[
          photo({
            id: "a",
            note_id: "n1",
            work_phase: "after",
            added_by_user_id: "u1",
          }),
        ]}
      />,
    );
    expect(html).toContain("After");
    expect(html).toContain("Priya");
  });

  it("says a customer's own photo came from them, rather than leaving it blank", () => {
    // The first question anybody asks of a photo they did not take. An
    // unattributed group reads as a crew photo nobody signed.
    const html = renderToStaticMarkup(
      <TaskAttachments names={NAMES} items={[photo({ id: "a", source: "mms" })]} />,
    );
    expect(html).toContain("From the customer");
    // And it carries no label: it is not a before, whatever it shows.
    expect(html).not.toContain("Before");
  });

  it("shows one heading per visit, not one per file", () => {
    // The whole point of grouping. Four photos from one visit is one heading.
    const html = renderToStaticMarkup(
      <TaskAttachments
        names={NAMES}
        items={[
          photo({ id: "a", note_id: "n1", work_phase: "before", added_by_user_id: "u1" }),
          photo({ id: "b", note_id: "n1", work_phase: "before", added_by_user_id: "u1" }),
          photo({ id: "c", note_id: "n1", work_phase: "before", added_by_user_id: "u1" }),
        ]}
      />,
    );
    expect(html.match(/Before/g) ?? []).toHaveLength(1);
  });

  it("puts the before ahead of the after, because that is when they happened", () => {
    const html = renderToStaticMarkup(
      <TaskAttachments
        names={NAMES}
        items={[
          photo({
            id: "after",
            note_id: "n2",
            work_phase: "after",
            created_at: "2026-07-04T16:00:00Z",
            added_by_user_id: "u1",
          }),
          photo({
            id: "before",
            note_id: "n1",
            work_phase: "before",
            created_at: "2026-07-04T09:00:00Z",
            added_by_user_id: "u1",
          }),
        ]}
      />,
    );
    expect(html.indexOf("Before")).toBeLessThan(html.indexOf("After"));
  });

  it("still says who added an unlabelled set", () => {
    // Most notes are neither, and those photos are not second-class: the time and
    // the person are what make them a record at all.
    const html = renderToStaticMarkup(
      <TaskAttachments
        names={NAMES}
        items={[photo({ id: "a", note_id: "n1", added_by_user_id: "u1" })]}
      />,
    );
    expect(html).toContain("Priya");
  });

  it("falls back to the crew when the name is not in the roster", () => {
    // A member who left is still the person who took the photo, and their id is
    // not a thing to put on screen.
    const html = renderToStaticMarkup(
      <TaskAttachments
        names={NAMES}
        items={[photo({ id: "a", note_id: "n1", added_by_user_id: "gone" })]}
      />,
    );
    expect(html).toContain("Added by the crew");
    expect(html).not.toContain("gone");
  });

  it("keeps the empty state, which teaches where files come from", () => {
    const html = renderToStaticMarkup(<TaskAttachments names={NAMES} items={[]} />);
    expect(html).toContain("Files live on the messages and notes");
  });
});
