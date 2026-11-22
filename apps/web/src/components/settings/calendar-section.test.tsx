/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberRole } from "@loonext/shared";
import { LocaleProvider } from "@/i18n/provider";
import { useCalendarConnections, useCalendarFeed } from "@/lib/api/calendar";
import { CalendarSection } from "./calendar-section";

const mocks = vi.hoisted(() => ({
  role: "owner" as MemberRole,
  connections: [] as { id: string; provider: string; status: string }[],
  feedActive: false,
  createUrl: "https://api.example.com/calendar/tok/schedule.ics",
  check: vi.fn(),
}));

vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: mocks.role }),
}));

vi.mock("@/lib/api/calendar", () => ({
  useCalendarConnections: vi.fn(() => ({
    data: {
      connections: mocks.connections.map((c) => ({
        account_label: "maria@example.com",
        calendar_label: "Field crew",
        last_verified_at: null,
        last_sync_at: null,
        last_error_key: null,
        conflict_count: 0,
        ...c,
      })),
      disclosures: [],
      configured: { google: true, microsoft: true },
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  useAuthorizeCalendarConnection: () => ({ isPending: false, mutate: vi.fn() }),
  useDisconnectCalendarConnection: () => ({ isPending: false, mutate: vi.fn() }),
  useCalendarAttention: () => ({
    data: { attention: [] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useResolveCalendarAttention: () => ({ isPending: false, mutate: vi.fn() }),
  useCalendarFeed: vi.fn(() => ({
    data: { active: mocks.feedActive, last_read_at: null },
    isLoading: false,
  })),
  useCreateCalendarFeed: () => ({
    isPending: false,
    mutate: (_: unknown, o: { onSuccess: (d: { url: string }) => void }) =>
      o.onSuccess({ url: mocks.createUrl }),
  }),
  useRevokeCalendarFeed: () => ({ isPending: false, mutate: vi.fn() }),
}));

vi.mock("@/lib/calendar/check-feed-link", () => ({
  checkFeedLink: (url: string) => mocks.check(url),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));



function renderSection(locale: "en" | "fr-CA" = "en") {
  return render(
    <LocaleProvider userLocale={locale} deviceLocale="en" companyLocale="en">
      <CalendarSection />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mocks.role = "owner";
  vi.mocked(useCalendarConnections).mockClear();
  vi.mocked(useCalendarFeed).mockClear();
  mocks.connections = [];
  mocks.feedActive = false;
  mocks.check.mockReset();
  mocks.check.mockResolvedValue({ state: "working" });
});
afterEach(cleanup);

describe("#744 the one Calendar section", () => {
  it("hides both setup options and starts no calendar reads for a bookkeeper", () => {
    mocks.role = "bookkeeper";
    const { container } = renderSection();
    expect(container.querySelector("#calendar")).toBeNull();
    expect(useCalendarConnections).not.toHaveBeenCalled();
    expect(useCalendarFeed).not.toHaveBeenCalled();
  });

  it("offers both ways up front, each with what it does", () => {
    renderSection();
    expect(screen.getAllByRole("heading", { name: "Calendar" })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "Connect Google or Microsoft (two-way)" }),
    ).toBeInstanceOf(Element);
    expect(
      screen.getByRole("heading", {
        name: "Subscribe from any calendar app (read-only)",
      }),
    ).toBeInstanceOf(Element);
    expect(screen.getByRole("button", { name: "Connect Google Calendar" })).toBeInstanceOf(Element);
    expect(screen.getByRole("button", { name: "Set up my calendar" })).toBeInstanceOf(Element);
    expect(document.querySelector("details")).toBeNull();
    expect(document.querySelectorAll("section#calendar")).toHaveLength(1);
  });

  it("folds the subscription link under an alternative while a calendar is connected", () => {
    mocks.connections = [{ id: "c1", provider: "google", status: "active" }];
    renderSection();
    const details = document.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
    expect(screen.getByText("Or subscribe read-only")).toBeInstanceOf(Element);
    expect(
      screen.queryByRole("heading", {
        name: "Subscribe from any calendar app (read-only)",
      }),
    ).toBeNull();
  });

  it("speaks French", () => {
    renderSection("fr-CA");
    expect(screen.getByRole("heading", { name: "Calendrier" })).toBeInstanceOf(Element);
    expect(
      screen.getByRole("heading", { name: "Connecter Google ou Microsoft (bidirectionnel)" }),
    ).toBeInstanceOf(Element);
  });
});

describe("#744 the link check", () => {
  it("fetches the new link and says Working", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Set up my calendar" }));
    await waitFor(() => expect(screen.getByText("Working")).toBeInstanceOf(Element));
    expect(mocks.check).toHaveBeenCalledWith(mocks.createUrl);
  });

  it("shows a clear error, and lets the person check again", async () => {
    mocks.check.mockResolvedValueOnce({ state: "error", status: 404 });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Set up my calendar" }));
    await waitFor(() => expect(screen.getByText(/did not work \(error 404\)/)).toBeInstanceOf(Element));
    expect(screen.queryByText("Working")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.getByText("Working")).toBeInstanceOf(Element));
    expect(mocks.check).toHaveBeenCalledTimes(2);
  });

  it("says so when the link cannot be reached at all", async () => {
    mocks.check.mockResolvedValueOnce({ state: "unreachable" });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Set up my calendar" }));
    await waitFor(() => expect(screen.getByText(/Could not reach this link/)).toBeInstanceOf(Element));
  });
});
