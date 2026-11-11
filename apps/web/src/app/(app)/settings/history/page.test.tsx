import { describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));

import HistorySettingsRedirect from "./page";
import TrashSettingsRedirect from "./trash/page";

describe("#755 the old History addresses still land somewhere", () => {
  it("sends /settings/history to the audit log", () => {
    HistorySettingsRedirect();
    expect(redirect).toHaveBeenLastCalledWith("/settings/audit-log");
  });

  it("keeps /settings/history/trash going to the Trash", () => {
    TrashSettingsRedirect();
    expect(redirect).toHaveBeenLastCalledWith("/trash");
  });
});
