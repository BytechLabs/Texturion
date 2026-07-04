import { describe, expect, it } from "vitest";

import type { TaskAttachmentItem } from "@/lib/api/types";

import {
  attachmentLabel,
  isImageAttachment,
  taskAttachmentView,
} from "./derived-attachments";

/**
 * The D28 derived-attachments rendering state table: for each union source ×
 * kind × file_name presence, the exact label / source tag / deletability /
 * preview decision the task drawer renders. Pure — the component maps items
 * through `taskAttachmentView` and adds no logic of its own.
 */

function item(overrides: Partial<TaskAttachmentItem>): TaskAttachmentItem {
  return {
    id: "att-1",
    source: "note",
    kind: "file",
    file_name: "quote.pdf",
    content_type: "application/pdf",
    size_bytes: 1024,
    created_at: "2026-07-04T10:00:00Z",
    ...overrides,
  };
}

describe("taskAttachmentView (D28 read-view state table)", () => {
  const table: {
    name: string;
    input: TaskAttachmentItem;
    expected: ReturnType<typeof taskAttachmentView>;
  }[] = [
    {
      name: "MMS image — Message tag, never deletable, filename-less fallback",
      input: item({
        source: "mms",
        kind: "image",
        file_name: null, // carrier media has no filename (D29: correct)
        content_type: "image/jpeg",
      }),
      expected: {
        label: "JPEG file",
        sourceTag: "Message",
        deletable: false,
        image: true,
      },
    },
    {
      name: "note file — Note tag, deletable (D30 free-space path)",
      input: item({ source: "note", kind: "file" }),
      expected: {
        label: "quote.pdf",
        sourceTag: "Note",
        deletable: true,
        image: false,
      },
    },
    {
      name: "note image — Note tag, deletable, preview",
      input: item({
        source: "note",
        kind: "image",
        file_name: "part.jpg",
        content_type: "image/jpeg",
      }),
      expected: {
        label: "part.jpg",
        sourceTag: "Note",
        deletable: true,
        image: true,
      },
    },
    {
      name: "legacy task row — Legacy tag (pre-D28 upload), still deletable",
      input: item({ source: "task", kind: "file", file_name: "old-spec.pdf" }),
      expected: {
        label: "old-spec.pdf",
        sourceTag: "Legacy",
        deletable: true,
        image: false,
      },
    },
    {
      name: "blank-name generic row falls back to the content type",
      input: item({ source: "task", file_name: "   ", content_type: "text/csv" }),
      expected: {
        label: "CSV file",
        sourceTag: "Legacy",
        deletable: true,
        image: false,
      },
    },
    {
      name: "no name, no type — the plain 'File' fallback",
      input: item({
        source: "mms",
        kind: "file",
        file_name: null,
        content_type: null,
      }),
      expected: {
        label: "File",
        sourceTag: "Message",
        deletable: false,
        image: false,
      },
    },
  ];

  for (const { name, input, expected } of table) {
    it(name, () => {
      expect(taskAttachmentView(input)).toEqual(expected);
    });
  }
});

describe("attachmentLabel / isImageAttachment (shared row helpers)", () => {
  it("prefers the stored file name", () => {
    expect(
      attachmentLabel({ file_name: "receipt.pdf", content_type: "application/pdf" }),
    ).toBe("receipt.pdf");
  });

  it("derives a type label when the name is missing", () => {
    expect(attachmentLabel({ file_name: null, content_type: "image/png" })).toBe(
      "PNG file",
    );
  });

  it("classifies images by content-type prefix, case-insensitively", () => {
    expect(isImageAttachment({ content_type: "IMAGE/JPEG" })).toBe(true);
    expect(isImageAttachment({ content_type: "application/pdf" })).toBe(false);
    expect(isImageAttachment({ content_type: null })).toBe(false);
  });
});
