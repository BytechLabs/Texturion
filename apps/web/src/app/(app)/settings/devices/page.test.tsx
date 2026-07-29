import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DeviceSession, WorkspaceSession } from "@/lib/api/sessions";

/**
 * #236 — the signed-in-devices screen.
 *
 * These pin the three things that decide whether the screen is usable rather
 * than merely present: the device you are holding is identified so you do not
 * try to kill it, a device with no known location says so instead of showing
 * a blank, and the crew list is not offered to somebody who cannot act on it.
 */

const mine: DeviceSession[] = [
  {
    id: "s-phone",
    client: "android",
    user_agent: "okhttp/4.12.0",
    location: "Toronto, Ontario, CA",
    signed_in_at: "2026-07-01T09:00:00.000Z",
    last_active_at: "2026-07-28T18:00:00.000Z",
    current: false,
  },
  {
    id: "s-browser",
    client: "web",
    user_agent: "Mozilla/5.0",
    location: null,
    signed_in_at: "2026-07-28T09:00:00.000Z",
    last_active_at: "2026-07-28T18:30:00.000Z",
    current: true,
  },
];

const crew: WorkspaceSession[] = [
  {
    id: "s-tech",
    member_id: "m-2",
    client: "ios",
    location: "Hamilton, Ontario, CA",
    signed_in_at: "2026-07-10T09:00:00.000Z",
    last_active_at: "2026-07-20T12:00:00.000Z",
  },
];

let role = "owner";

vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role, companyId: "c-1" }),
  useCompanyId: () => "c-1",
}));

vi.mock("@/lib/api/sessions", () => ({
  useMySessions: () => ({
    isPending: false,
    isError: false,
    isSuccess: true,
    data: { data: mine, next_cursor: null },
    refetch: vi.fn(),
  }),
  useWorkspaceSessions: () => ({
    isPending: false,
    isError: false,
    isSuccess: true,
    data: { data: crew, next_cursor: null },
    refetch: vi.fn(),
  }),
  useRevokeMySession: () => ({ isPending: false, mutate: vi.fn() }),
  useRevokeMemberSessions: () => ({ isPending: false, mutate: vi.fn() }),
}));

vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({
    isPending: false,
    data: {
      data: [
        { id: "m-1", display_name: "Sam Owner" },
        { id: "m-2", display_name: "Riley Tech" },
      ],
    },
  }),
}));

import DevicesSettingsPage from "./page";

const render = () => renderToStaticMarkup(<DevicesSettingsPage />);

describe("/settings/devices", () => {
  it("marks the device the person is reading on, so they do not try to kill it", () => {
    expect(render()).toContain("This device");
  });

  it("names the app rather than making somebody read a user agent to identify a phone", () => {
    const html = render();
    expect(html).toContain("Android app");
    expect(html).toContain("Web browser");
  });

  it("says a location is unavailable rather than rendering a gap", () => {
    expect(render()).toContain("Location not available");
  });

  it("shows an owner the crew's devices, attributed to a person", () => {
    role = "owner";
    const html = render();
    expect(html).toContain("The crew&#x27;s devices");
    expect(html).toContain("Riley Tech");
  });

  it("does not offer a member a list they cannot act on", () => {
    role = "member";
    const html = render();
    expect(html).not.toContain("The crew&#x27;s devices");
    // Their own devices are still theirs to manage.
    expect(html).toContain("Your devices");
    role = "owner";
  });
});
