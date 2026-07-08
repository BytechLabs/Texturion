import { describe, expect, it } from "vitest";

import type { BillingModule } from "@/lib/api/billing";

import {
  droppedPhotoNotice,
  mmsAttachGated,
  photosDropped,
} from "./mms-gate";

function module(
  id: BillingModule["id"],
  enabled: boolean,
): BillingModule {
  return {
    id,
    label: `label-${id}`,
    blurb: `blurb-${id}`,
    detail: null,
    monthly_cents: 500,
    enabled,
    available: true,
  };
}

// ---------------------------------------------------------------------------
// mmsAttachGated (#62)
// ---------------------------------------------------------------------------

describe("mmsAttachGated", () => {
  it("keeps the affordance while modules are unknown (loading/error) — the API is the backstop", () => {
    expect(mmsAttachGated(undefined)).toBe(false);
  });

  it("is open when the mms module is enabled", () => {
    expect(
      mmsAttachGated([module("voice", false), module("mms", true)]),
    ).toBe(false);
  });

  it("gates when the mms module is present but off", () => {
    expect(
      mmsAttachGated([module("mms", false), module("voice", true)]),
    ).toBe(true);
  });

  it("gates when the loaded catalog has no mms row at all", () => {
    expect(mmsAttachGated([module("voice", true)])).toBe(true);
    expect(mmsAttachGated([])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// photosDropped (#23) — media out, none back = cap-and-drop
// ---------------------------------------------------------------------------

describe("photosDropped", () => {
  const att = { id: "att-1", content_type: "image/jpeg", size_bytes: 1 };

  it("detects a send that carried media but came back without attachments", () => {
    expect(photosDropped(1, { attachments: [] })).toBe(true);
    expect(photosDropped(3, { attachments: [] })).toBe(true);
  });

  it("treats a missing attachments array (bare compose row) as dropped too", () => {
    expect(photosDropped(2, {})).toBe(true);
  });

  it("is quiet when the photos actually went out", () => {
    expect(photosDropped(1, { attachments: [att] })).toBe(false);
  });

  it("is quiet for text-only sends", () => {
    expect(photosDropped(0, { attachments: [] })).toBe(false);
    expect(photosDropped(0, {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// droppedPhotoNotice — copy pluralization
// ---------------------------------------------------------------------------

describe("droppedPhotoNotice", () => {
  it("singular for one photo", () => {
    expect(droppedPhotoNotice(1)).toBe(
      "Your text was sent, but the photo wasn't. You've used all included picture messages this month.",
    );
  });

  it("plural for several", () => {
    expect(droppedPhotoNotice(3)).toBe(
      "Your text was sent, but the photos weren't. You've used all included picture messages this month.",
    );
  });
});
