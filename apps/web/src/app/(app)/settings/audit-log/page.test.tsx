/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import HistorySettingsPage from "./page";

const readHistory = vi.hoisted(() => vi.fn(() => ({ isPending: true })));
const ACTOR_ID = "aaaaaaaa-0000-4000-8000-000000000001";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/lib/api/audit-log", () => ({ useAuditLog: readHistory }));
vi.mock("@/lib/api/client", () => ({ getApiBaseUrl: () => "https://example.test" }));
vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({ data: { data: [{ user_id: ACTOR_ID, display_name: "Sam" }] } }),
}));
vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "workspace" }));
vi.mock("@/lib/hooks/use-records-delete", () => ({ useCanDeleteRecords: () => true }));
vi.mock("@/lib/supabase/browser", () => ({ getAccessToken: async () => null }));

afterEach(() => {
  cleanup();
  readHistory.mockClear();
  window.history.replaceState(null, "", "/");
});

describe("Audit log filters in the URL", () => {
  it("loads the whole filter window and restores it after a navigation", () => {
    const initial = `/settings/audit-log?actor=${ACTOR_ID}&action=member.deactivated`
      + "&since=2026-11-01&until=2026-11-17&view=compact";
    window.history.replaceState(null, "", initial);
    const page = render(<HistorySettingsPage />);

    expect(readHistory).toHaveBeenLastCalledWith({
      actor: ACTOR_ID,
      action: "member.deactivated",
      since: new Date("2026-11-01T00:00:00").toISOString(),
      until: new Date("2026-11-18T00:00:00").toISOString(),
    });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "" } });
    const next = new URLSearchParams(window.location.search);
    expect(next.get("since")).toBe("");
    expect(next.get("view")).toBe("compact");
    expect(next.get("actor")).toBe(ACTOR_ID);
    page.rerender(<HistorySettingsPage />);
    expect(readHistory).toHaveBeenLastCalledWith(expect.objectContaining({ since: undefined }));

    window.history.replaceState(null, "", initial);
    page.rerender(<HistorySettingsPage />);
    expect(readHistory).toHaveBeenLastCalledWith(expect.objectContaining({
      since: new Date("2026-11-01T00:00:00").toISOString(),
    }));
  });

  it("ignores malformed filters from a copied URL", () => {
    window.history.replaceState(
      null, "", "/settings/audit-log?actor=unknown&action=unknown&since=2026-02-30&until=bad",
    );
    render(<HistorySettingsPage />);
    expect(readHistory).toHaveBeenLastCalledWith({
      actor: undefined,
      action: undefined,
      since: expect.any(String),
      until: undefined,
    });
  });
});
