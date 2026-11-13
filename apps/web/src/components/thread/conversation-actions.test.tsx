/**
 * @vitest-environment happy-dom
 */
/**
 * Every inbox row builds the conversation's action list on every render. The
 * snooze and follow-up presets, and the time each one resolves to, are worked
 * out only when their submenu opens, which is one row at a time.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as shared from "@loonext/shared";

import { RecordContextMenu } from "@/components/ui/record-menu";
import { makeTranslate } from "@/i18n/translate";
import { submenuItems } from "@/lib/record-actions/types";

import { buildConversationActions } from "./conversation-actions";
import { formatPresetHint } from "./snooze-menu";

// Only the action definitions are under test, so no workspace is loaded.
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ userId: "u-1", role: "owner" }),
}));
vi.mock("@loonext/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@loonext/shared")>();
  return {
    ...actual,
    snoozePresets: vi.fn(actual.snoozePresets),
    followUpPresets: vi.fn(actual.followUpPresets),
  };
});

const t = makeTranslate("en");
const snoozePresets = vi.mocked(shared.snoozePresets);
const followUpPresets = vi.mocked(shared.followUpPresets);

function build() {
  return buildConversationActions({
    t,
    state: {
      status: "open",
      isSpam: false,
      pinned: false,
      unread: false,
      muted: false,
      followed: false,
      snoozedUntil: null,
      snoozeKind: null,
      assignedUserId: null,
    },
    members: [],
    viewer: { canWrite: true, canDelete: false },
    blocked: false,
    unblocking: false,
    surface: { openHref: "/inbox/c-1", hasGallery: false, hasCatchUp: false },
    run: new Proxy({}, { get: () => () => {} }) as Parameters<
      typeof buildConversationActions
    >[0]["run"],
  });
}

beforeEach(() => {
  snoozePresets.mockClear();
  followUpPresets.mockClear();
});
afterEach(cleanup);

describe("conversation snooze and follow-up submenus", () => {
  it("are not worked out when a row builds its list or opens its menu", () => {
    const actions = build();
    render(
      <RecordContextMenu actions={actions}>
        <div data-testid="row">row</div>
      </RecordContextMenu>,
    );
    fireEvent.contextMenu(screen.getByTestId("row"));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(snoozePresets).not.toHaveBeenCalled();
    expect(followUpPresets).not.toHaveBeenCalled();
  });

  it("list the presets, their times and Pick a date when opened", () => {
    const actions = build();
    const snooze = submenuItems(actions.find((action) => action.id === "snooze")!);
    const followUp = submenuItems(actions.find((action) => action.id === "follow-up")!);
    expect(snoozePresets).toHaveBeenCalledTimes(1);
    expect(followUpPresets).toHaveBeenCalledTimes(1);

    const presets = snoozePresets.mock.results[0]!.value as { id: string; at: number }[];
    expect(snooze.map((item) => item.id)).toEqual([
      ...presets.map((preset) => preset.id),
      "custom",
    ]);
    expect(snooze.map((item) => item.trailing)).toEqual([
      ...presets.map((preset) => formatPresetHint(preset.at, t)),
      undefined,
    ]);
    expect(followUp.at(-1)?.id).toBe("custom");
  });
});
