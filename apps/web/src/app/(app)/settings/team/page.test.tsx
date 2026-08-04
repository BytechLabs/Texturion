/**
 * @vitest-environment happy-dom
 *
 * #521 — the note an owner can put on an invite.
 *
 * The assertions worth having are all about what happens when nobody uses it.
 * An optional field that quietly changes the shape of the request, blocks a
 * submit, or adds a step is not optional, and none of that is visible on the
 * screen: the invite still looks sent.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` is hoisted above every `const` in this file, so the spies have to
// be created inside `vi.hoisted` — a plain `const` above the mock is still a
// temporal-dead-zone reference by the time the factory runs.
const { createInvite, invites } = vi.hoisted(() => ({
  createInvite: vi.fn(),
  // Mutable so a test can put a pending invite in the list; the default is the
  // empty workspace every other assertion here wants.
  invites: { rows: [] as Record<string, unknown>[] },
}));

vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({
    isPending: false,
    isError: false,
    data: {
      data: [
        {
          id: "m1",
          user_id: "u1",
          role: "owner",
          display_name: "Dana",
          deactivated_at: null,
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    },
    refetch: vi.fn(),
  }),
  useInvites: () => ({
    isPending: false,
    isError: false,
    data: { data: invites.rows },
    refetch: vi.fn(),
  }),
  useCreateInvite: () => ({ isPending: false, mutate: createInvite }),
  useRevokeInvite: () => ({ isPending: false, mutate: vi.fn() }),
  useUpdateMemberRole: () => ({ isPending: false, mutate: vi.fn() }),
  useDeactivateMember: () => ({ isPending: false, mutate: vi.fn() }),
  useMemberHoldings: () => ({
    isPending: false,
    data: { conversations: 0, tasks: 0 },
  }),
}));
vi.mock("@/lib/api/companies", () => ({
  useCompany: () => ({
    isPending: false,
    isError: false,
    // A limit with room in it: a full workspace disables the whole form, which
    // would make every assertion below pass for the wrong reason.
    data: { plan: "pro", seat_limit: 10, mfa_required_at: null },
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: "owner", userId: "u1" }),
  useCompanyId: () => "c_1",
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
// The other cards on this page each open their own queries. They are not what
// is under test, and mocking them keeps this harness about the invite form.
vi.mock("@/components/settings/ownership-card", () => ({
  OwnershipCard: () => null,
}));
vi.mock("@/components/settings/require-two-factor-card", () => ({
  RequireTwoFactorCard: () => null,
}));
vi.mock("@/components/settings/member-access-dialog", () => ({
  MemberAccessDialog: () => null,
}));

import TeamSettingsPage from "./page";

// This app's vitest does not set `globals`, so testing-library's automatic
// cleanup never registers and renders stack across tests.
afterEach(cleanup);

beforeEach(() => {
  createInvite.mockReset();
  invites.rows = [];
});

function noteField(): HTMLTextAreaElement {
  return screen.getByLabelText(
    "What to tell them (optional)",
  ) as HTMLTextAreaElement;
}

/** A pending invite, as GET /v1/invites returns one. */
function pendingInvite(note: string | null) {
  return {
    id: "ffffffff-1111-4222-8333-444444444444",
    company_id: "c_1",
    email: "tech@example.com",
    role: "member",
    invited_by: "u1",
    expires_at: "2099-01-01T00:00:00Z",
    accepted_at: null,
    revoked_at: null,
    created_at: "2026-07-10T00:00:00Z",
    note,
  };
}

function inviteSomebody(note?: string) {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "tech@example.com" },
  });
  if (note !== undefined) {
    fireEvent.change(noteField(), { target: { value: note } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Invite" }));
}

describe("the invite note (#521)", () => {
  it("sends the invite it always sent when the field is ignored", async () => {
    render(<TeamSettingsPage />);
    inviteSomebody();

    await waitFor(() => expect(createInvite).toHaveBeenCalled());
    // Not `""`. Blank means nobody wrote anything, and an empty string would
    // have this client claiming otherwise.
    expect(createInvite.mock.calls[0][0]).toEqual({
      email: "tech@example.com",
      role: "member",
      note: null,
    });
  });

  it("treats a note of nothing but spaces as no note", async () => {
    render(<TeamSettingsPage />);
    inviteSomebody("   \n  ");

    await waitFor(() => expect(createInvite).toHaveBeenCalled());
    expect(createInvite.mock.calls[0][0].note).toBeNull();
  });

  it("sends what the owner actually wrote", async () => {
    render(<TeamSettingsPage />);
    inviteSomebody("Riverside jobs are yours this month.");

    await waitFor(() => expect(createInvite).toHaveBeenCalled());
    expect(createInvite.mock.calls[0][0].note).toBe(
      "Riverside jobs are yours this month.",
    );
  });

  it("stops at the cap the server would refuse at", () => {
    render(<TeamSettingsPage />);
    expect(noteField().maxLength).toBe(500);
  });

  it("keeps the count out of the way until the writer is near the cap", () => {
    render(<TeamSettingsPage />);
    expect(screen.queryByText(/characters left/)).toBeNull();

    // A note most owners would write. Still no counter: a permanent one reads
    // as a word budget on a field most invites leave empty.
    fireEvent.change(noteField(), { target: { value: "x".repeat(200) } });
    expect(screen.queryByText(/characters left/)).toBeNull();

    fireEvent.change(noteField(), { target: { value: "x".repeat(460) } });
    expect(screen.getByText("40 characters left")).toBeTruthy();

    fireEvent.change(noteField(), { target: { value: "x".repeat(499) } });
    expect(screen.getByText("1 character left")).toBeTruthy();
  });

  it("says the note is read once on joining, and nothing about email", () => {
    render(<TeamSettingsPage />);
    expect(
      screen.getByText(/They see this once, when they join/),
    ).toBeTruthy();
    // A brand-new address is emailed by Supabase Auth from a template this
    // repo does not control, and it carries no note. Only the fallback for an
    // address that already has an account renders one, so promising the mail
    // would be false for the ordinary invite.
    expect(screen.queryByText(/invite email/i)).toBeNull();
  });

  it("speaks the remaining count to a screen reader", () => {
    render(<TeamSettingsPage />);
    fireEvent.change(noteField(), { target: { value: "x".repeat(460) } });

    const count = screen.getByText("40 characters left");
    // Announced as it changes, and reachable from the field itself: the count
    // sits inside the one element `aria-describedby` points at.
    const region = count.closest("[aria-live]");
    expect(region).toBeTruthy();
    expect(noteField().getAttribute("aria-describedby")).toBe(region?.id);
  });

  it("shows the owner what a pending invite says", () => {
    // No edit path exists by design, so a read path is the only way to check
    // it before the new member reads it once and it is gone.
    invites.rows = [pendingInvite("Riverside jobs are yours this month.")];
    render(<TeamSettingsPage />);

    expect(
      screen.getByText("Riverside jobs are yours this month."),
    ).toBeTruthy();
  });

  it("adds nothing to a pending invite that was sent without one", () => {
    invites.rows = [pendingInvite(null)];
    render(<TeamSettingsPage />);

    expect(screen.getByText("tech@example.com")).toBeTruthy();
    expect(document.querySelector("blockquote")).toBeNull();
  });
});
