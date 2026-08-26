/** @vitest-environment happy-dom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CalendarAttentionItem,
  CalendarConnection,
  CalendarConnectionsView,
} from "@/lib/api/calendar";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  disconnect: vi.fn(),
  resolveAttention: vi.fn(),
  refetch: vi.fn(),
  attentionRefetch: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  view: {
    data: undefined as CalendarConnectionsView | undefined,
    isLoading: false,
    isError: false,
  },
  attentionView: {
    data: { attention: [] as CalendarAttentionItem[] },
    isLoading: false,
    isError: false,
  },
}));

vi.mock("@/lib/api/calendar", () => ({
  useCalendarConnections: () => ({
    ...mocks.view,
    refetch: mocks.refetch,
  }),
  useAuthorizeCalendarConnection: () => ({
    isPending: false,
    variables: undefined,
    mutate: mocks.authorize,
  }),
  useDisconnectCalendarConnection: () => ({
    isPending: false,
    variables: undefined,
    mutate: mocks.disconnect,
  }),
  useCalendarAttention: () => ({
    ...mocks.attentionView,
    refetch: mocks.attentionRefetch,
  }),
  useResolveCalendarAttention: () => ({
    isPending: false,
    variables: undefined,
    mutate: mocks.resolveAttention,
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import { LocaleProvider } from "@/i18n/provider";

import { CalendarConnectionsCard } from "./calendar-connections-card";

function connection(
  patch: Partial<CalendarConnection> = {},
): CalendarConnection {
  return {
    id: "calendar-1",
    provider: "google",
    status: "active",
    account_label: "maria@example.com",
    calendar_label: "Field crew",
    last_verified_at: "2026-08-25T15:00:00.000Z",
    last_sync_at: "2026-08-25T14:58:00.000Z",
    last_error_key: null,
    conflict_count: 0,
    ...patch,
  };
}

function setView(
  connections: CalendarConnection[] = [],
  configured: CalendarConnectionsView["configured"] = {
    google: true,
    microsoft: true,
  },
) {
  mocks.view.data = { connections, disclosures: [], configured };
}

function attentionItem(
  patch: Partial<CalendarAttentionItem> = {},
): CalendarAttentionItem {
  return {
    id: "link-1",
    state: "conflict",
    provider_condition: "conflict",
    task: {
      id: "task-1",
      title: "Furnace tune-up",
      due_at: "2026-11-01T14:00:00.000Z",
    },
    connection: {
      id: "calendar-1",
      provider: "google",
      calendar_label: "Field crew",
      time_zone: "America/Edmonton",
    },
    ours: {
      start: "2026-11-01T14:00:00.000Z",
      end: "2026-11-01T15:00:00.000Z",
      time_zone: "America/Toronto",
      title: "Furnace tune-up",
    },
    theirs: {
      start: "2026-11-01T16:00:00.000Z",
      end: "2026-11-01T17:00:00.000Z",
      time_zone: "America/Toronto",
      title: "Furnace tune-up",
    },
    differences: {
      start: true,
      end: true,
      time_zone: false,
      title: false,
      description: false,
    },
    display_timestamps: {
      ours_changed_at: "2026-08-25T14:00:00.000Z",
      provider_observed_at: "2026-08-25T14:01:00.000Z",
      attention_at: "2026-08-25T14:01:00.000Z",
    },
    ours_changed_by: null,
    refusal: null,
    ...patch,
  };
}

function renderCard(locale: "en" | "fr-CA" = "en") {
  return render(
    <LocaleProvider userLocale={locale} deviceLocale="en" companyLocale="en">
      <CalendarConnectionsCard />
    </LocaleProvider>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  window.history.replaceState({}, "", "/settings/profile");
  mocks.authorize.mockReset();
  mocks.disconnect.mockReset();
  mocks.resolveAttention.mockReset();
  mocks.refetch.mockReset();
  mocks.attentionRefetch.mockReset();
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.view.data = undefined;
  mocks.view.isLoading = false;
  mocks.view.isError = false;
  mocks.attentionView.data = { attention: [] };
  mocks.attentionView.isLoading = false;
  mocks.attentionView.isError = false;
});

describe("#245 two-way calendar settings", () => {
  it("states the write, invitation, and feed-revocation consequences before connect", () => {
    setView();
    renderCard();

    const disclosure = screen.getByText(/creates calendar events/i);
    expect(disclosure.textContent).toMatch(/schedule changes/i);
    expect(disclosure.textContent).toMatch(/linked events/i);
    expect(disclosure.textContent).toMatch(/never imports unrelated events/i);
    expect(disclosure.textContent).toMatch(/never.*invites customers/i);
    expect(disclosure.textContent).toMatch(/revokes.*read-only calendar feed/i);

    for (const name of ["Connect Google Calendar", "Connect Microsoft 365"]) {
      const button = screen.getByRole("button", { name });
      expect(button.getAttribute("aria-describedby")).toBe(
        "calendar-connection-disclosure",
      );
    }
  });

  it("starts authorization only for a configured provider", () => {
    setView([], { google: true, microsoft: false });
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Connect Google Calendar" }));
    expect(mocks.authorize).toHaveBeenCalledWith(
      { provider: "google" },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
    expect(
      (screen.getByRole("button", {
        name: "Connect Microsoft 365",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    const unavailable = screen.getByText(/Microsoft 365 is not available/i);
    expect(unavailable).toBeTruthy();
    expect(unavailable.className).not.toContain("sr-only");
  });

  it("announces a successful OAuth return and removes only its one-time result", async () => {
    window.history.replaceState(
      {},
      "",
      "/settings/profile?calendar=connected&tab=personal#calendar",
    );
    setView();
    renderCard("fr-CA");

    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Calendrier connecté."),
    );
    expect(window.location.search).toBe("?tab=personal");
    expect(window.location.hash).toBe("#calendar");
  });

  it("announces a failed OAuth return and removes the one-time result", async () => {
    window.history.replaceState({}, "", "/settings/profile?calendar=failed");
    setView();
    renderCard();

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Calendar sign-in could not be completed. Try again.",
      ),
    );
    expect(window.location.search).toBe("");
  });

  it("explains that a different calendar must be disconnected first", async () => {
    window.history.replaceState(
      {},
      "",
      "/settings/profile?calendar=replacement_requires_disconnect&tab=personal",
    );
    setView();
    renderCard();

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "A different calendar is already connected. Disconnect it before connecting this one.",
      ),
    );
    expect(window.location.search).toBe("?tab=personal");
  });

  it("explains that disconnect cleanup must finish before reconnecting", async () => {
    window.history.replaceState(
      {},
      "",
      "/settings/profile?calendar=disconnect_in_progress&tab=personal",
    );
    setView();
    renderCard();

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Calendar cleanup is still in progress. Wait for it to finish before reconnecting.",
      ),
    );
    expect(window.location.search).toBe("?tab=personal");
  });

  it("shows connection health, verification, sync, conflicts, and a guarded disconnect", () => {
    setView([connection({ conflict_count: 2 })]);
    renderCard();

    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("maria@example.com")).toBeTruthy();
    expect(screen.getByText("Calendar: Field crew")).toBeTruthy();
    expect(screen.getByText(/Last verified/)).toBeTruthy();
    expect(screen.getByText(/Last synced/)).toBeTruthy();
    expect(screen.getByText(/2 scheduling conflicts/i)).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: /read-only calendar feed instead/i }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(mocks.disconnect).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Disconnect and stop syncing" }),
    );
    expect(mocks.disconnect).toHaveBeenCalledWith(
      "calendar-1",
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it("offers reauthorization and the read-only fallback when disconnected", () => {
    setView([
      connection({
        status: "reauth_required",
        last_verified_at: null,
        last_sync_at: null,
        last_error_key: "calendar.authorization_expired",
      }),
    ]);
    renderCard();

    expect(screen.getByText("Reconnect required")).toBeTruthy();
    expect(screen.getByText("Not verified yet")).toBeTruthy();
    expect(screen.getByText("Not synced yet")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/could not verify/i);

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(mocks.authorize).toHaveBeenCalledWith(
      { provider: "google" },
      expect.anything(),
    );
    expect(
      screen
        .getByRole("link", { name: /read-only calendar feed instead/i })
        .getAttribute("href"),
    ).toBe("#calendar-read-only-feed");
  });

  it("describes an active transient failure as an automatic retry", () => {
    setView([
      connection({
        status: "active",
        last_error_key: "calendar.provider_unavailable",
      }),
    ]);
    renderCard();

    expect(screen.getByRole("status").textContent).toMatch(
      /retry automatically/i,
    );
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
    expect(screen.queryByText(/Reconnect it to resume/i)).toBeNull();
  });

  it("keeps a content-free cleanup warning visible even without a live connection", () => {
    setView();
    mocks.view.data!.disclosures = [
      {
        connection_id: "old-connection",
        provider: "google",
        reason: "cleanup_failed",
        occurred_at: "2026-08-25T12:00:00.000Z",
        push_delivered_at: null,
      },
    ];
    renderCard();

    const warning = screen.getByRole("status").textContent ?? "";
    expect(warning).toMatch(
      /disconnected.*could not confirm removal/i,
    );
    expect(screen.getByRole("button", { name: "Connect Google Calendar" }))
      .toBeTruthy();
    expect(warning).not.toMatch(/customer|task|address/i);
  });

  it("does not offer reconnect or disconnect while durable cleanup is running", () => {
    setView([connection({ status: "disconnected" })]);
    renderCard();

    expect(screen.getByRole("status").textContent).toMatch(/finishing.*cleanup/i);
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect Google Calendar" }))
      .toBeNull();
    expect(
      screen.queryByRole("button", { name: "Connect Microsoft 365" }),
    ).toBeNull();
  });

  it("keeps every promise and action in French Canadian", () => {
    setView([], { google: true, microsoft: false });
    renderCard("fr-CA");

    const disclosure = screen.getByText(/crée des événements de calendrier/i);
    expect(disclosure.textContent).toMatch(/événements liés/i);
    expect(disclosure.textContent).toMatch(/n'importe jamais les événements sans lien/i);
    expect(disclosure.textContent).toMatch(/n'invite jamais de clients/i);
    expect(disclosure.textContent).toMatch(/révoque.*lecture seule/i);
    expect(
      screen.getByRole("button", { name: "Connecter Google Agenda" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", {
        name: /Utiliser plutôt le flux de calendrier en lecture seule/i,
      }),
    ).toBeTruthy();
  });

  it("announces a load failure and lets the reader retry", () => {
    mocks.view.isError = true;
    renderCard();

    expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/i);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("gives the loading skeleton an accessible status", () => {
    mocks.view.isLoading = true;
    renderCard();

    expect(screen.getByRole("status").textContent).toMatch(
      /Loading calendar connections/i,
    );
  });

  it("does not leak an unknown server state into visible copy", () => {
    setView([connection({ status: "future_state" as never })]);
    renderCard();

    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.queryByText("future_state")).toBeNull();
  });

  it("shows both sides of a conflict and submits an explicit winner", () => {
    setView([connection({ conflict_count: 1 })]);
    mocks.attentionView.data = {
      attention: [
        attentionItem({
          theirs: {
            start: "2026-11-01T16:00:00.000Z",
            end: "2026-11-01T18:00:00.000Z",
            time_zone: "Europe/Paris",
            title: "Boiler tune-up",
          },
          differences: {
            start: true,
            end: true,
            time_zone: true,
            title: true,
            description: true,
          },
          ours_changed_by: { id: "member-1", name: "Maria Chen" },
        }),
      ],
    };
    renderCard();

    expect(screen.getByText("This job moved in two places")).toBeTruthy();
    expect(screen.getByText("What differs")).toBeTruthy();
    expect(screen.getByText("Different start time")).toBeTruthy();
    expect(screen.getByText("Different end time")).toBeTruthy();
    expect(screen.getByText("Different time zone")).toBeTruthy();
    expect(screen.getByText("Different job title")).toBeTruthy();
    expect(screen.getByText(/job notes differ too/i).textContent).toMatch(
      /choice also keeps that copy's notes/i,
    );
    expect(screen.getAllByText("Starts")).toHaveLength(2);
    expect(screen.getAllByText("Ends")).toHaveLength(2);
    expect(screen.getAllByText("Time zone")).toHaveLength(2);
    expect(screen.getByText("America/Toronto")).toBeTruthy();
    expect(screen.getByText("Europe/Paris")).toBeTruthy();
    expect(screen.getByText("Loonext schedule")).toBeTruthy();
    expect(screen.getByText("Google Calendar schedule")).toBeTruthy();
    expect(screen.getByText(/Maria Chen changed the Loonext schedule/i)).toBeTruthy();
    expect(screen.getByText(/observed the Google Calendar schedule/i)).toBeTruthy();
    expect(screen.getByText(/Conflict detected on/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open job" }).getAttribute("href"))
      .toBe("/tasks?task=task-1");

    fireEvent.click(
      screen.getByRole("button", { name: "Keep calendar schedule" }),
    );
    expect(mocks.resolveAttention).toHaveBeenCalledWith(
      {
        id: "link-1",
        resolution: { action: "use_calendar" },
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it.each([
    ["event_removed", /calendar event has since been removed/i],
    ["refused", /no longer has a usable schedule/i],
  ] as const)(
    "keeps conflict evidence but removes stale provider choice after %s",
    (providerCondition, explanation) => {
      setView([connection({ conflict_count: 1 })]);
      mocks.attentionView.data = {
        attention: [
          attentionItem({
            provider_condition: providerCondition,
            refusal:
              providerCondition === "refused"
                ? { code: "all_day", detail: null }
                : null,
          }),
        ],
      };
      renderCard();

      expect(screen.getByText(explanation)).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Keep Loonext schedule" }),
      ).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "Keep calendar schedule" }),
      ).toBeNull();
      expect(screen.getByRole("button", { name: "Not sure yet" })).toBeTruthy();

      fireEvent.click(
        screen.getByRole("button", { name: "Keep Loonext schedule" }),
      );
      expect(mocks.resolveAttention).toHaveBeenCalledWith(
        {
          id: "link-1",
          resolution: { action: "use_app" },
        },
        expect.anything(),
      );
    },
  );

  it("requires and submits a new instant when a removed event was moved", () => {
    setView([connection()]);
    mocks.attentionView.data = {
      attention: [
        attentionItem({
          state: "event_removed",
          ours: {
            start: "2026-11-01T16:00:00.000Z",
            end: "2026-11-01T17:00:00.000Z",
            time_zone: "America/Edmonton",
            title: "Furnace tune-up",
          },
          theirs: null,
        }),
      ],
    };
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "The job was moved" }));
    fireEvent.change(screen.getByLabelText("New date and time"), {
      target: { value: "2026-11-03T09:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save new time" }));

    expect(mocks.resolveAttention).toHaveBeenCalledWith(
      {
        id: "link-1",
        resolution: {
          action: "moved",
          new_due_at: "2026-11-03T16:30:00.000Z",
        },
      },
      expect.anything(),
    );
    expect(screen.getByText("This time is in America/Edmonton.")).toBeTruthy();
  });

  it.each([
    [
      "2026-03-08T02:30",
      /does not exist because daylight saving time starts/i,
    ],
    [
      "2026-11-01T01:30",
      /happens twice because daylight saving time ends/i,
    ],
  ])("refuses a DST-invalid moved wall clock (%s)", (value, message) => {
    setView([connection()]);
    mocks.attentionView.data = {
      attention: [
        attentionItem({
          state: "event_removed",
          ours: {
            start: "2026-11-01T16:00:00.000Z",
            end: "2026-11-01T17:00:00.000Z",
            time_zone: "America/Edmonton",
            title: "Furnace tune-up",
          },
          theirs: null,
        }),
      ],
    };
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "The job was moved" }));
    fireEvent.change(screen.getByLabelText("New date and time"), {
      target: { value },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save new time" }));

    expect(mocks.resolveAttention).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringMatching(message));
  });

  it("explains a refused all-day event without offering a destructive guess", () => {
    setView([connection()]);
    mocks.attentionView.data = {
      attention: [
        attentionItem({
          state: "refused",
          ours: null,
          theirs: null,
          refusal: { code: "all_day", detail: null },
        }),
      ],
    };
    renderCard();

    expect(screen.getByText("This job became an all-day event")).toBeTruthy();
    expect(screen.getByText(/needs a real start time/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /keep/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancelled/i })).toBeNull();
  });

  it("explains an invalid provider title without stalling the other events", () => {
    setView([connection()]);
    mocks.attentionView.data = {
      attention: [
        attentionItem({
          state: "refused",
          ours: null,
          theirs: null,
          refusal: { code: "invalid_title", detail: "empty" },
        }),
      ],
    };
    renderCard();

    expect(
      screen.getByText("This calendar event needs a valid job title"),
    ).toBeTruthy();
    expect(screen.getByText(/500 characters or fewer/i)).toBeTruthy();
  });

  it.each([
    ["description_too_long", /5,000 characters or fewer/i],
    ["outside_sync_window", /90 days ago through 365 days ahead/i],
    ["unsafe_meeting", /cannot notify guests or damage meeting details/i],
    ["recurrence", /will not guess which occurrence/i],
    ["future_provider_code", /could not handle the provider change safely/i],
  ])("gives an honest refusal instruction for %s", (code, instruction) => {
    setView([connection()]);
    mocks.attentionView.data = {
      attention: [
        attentionItem({
          state: "refused",
          provider_condition: "refused",
          ours: null,
          theirs: null,
          refusal: { code, detail: null },
        }),
      ],
    };

    renderCard();

    expect(screen.getByText(instruction)).toBeTruthy();
    expect(screen.queryByText(/time zone is not supported/i)).toBeNull();
  });
});
