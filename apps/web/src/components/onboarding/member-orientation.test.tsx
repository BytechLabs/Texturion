/**
 * @vitest-environment happy-dom
 */
// Aliased: `render()` below is this file's own static-markup helper, and the
// two are not interchangeable: one returns a string, one mounts a tree.
import { cleanup, fireEvent, render as mount, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #286 — "An invited member sees a short, skippable, member-specific
 * orientation on first sign-in."
 *
 * Four things this must never do, each of which is the feature failing rather
 * than a detail: open for somebody who has already been through it, open
 * before the answer has landed, open for the owner who walked the setup
 * wizard, or trigger a browser permission prompt on mount.
 *
 * #521 adds a fifth: the joining note is the owner's words, so it appears once
 * and only where it was put, and its absence, the ordinary case for almost
 * every membership, leaves the four screens exactly as they were.
 */

const state: {
  role: string;
  firsts: { oriented: boolean } | undefined;
  /** What GET /v1/me/joining-note answered, as the hook hands it over. */
  joining: {
    data: { note: string | null; from: string | null } | undefined;
    isPending: boolean;
  };
  push: {
    supported: boolean;
    permission: string;
    subscribed: boolean;
    pending: boolean;
    error: string | null;
  };
} = {
  role: "member",
  firsts: { oriented: false },
  joining: { data: { note: null, from: null }, isPending: false },
  push: {
    supported: true,
    permission: "default",
    subscribed: false,
    pending: false,
    error: null,
  },
};

const marked = vi.fn();
const subscribe = vi.fn(async () => {});
const noteAsked = vi.fn();

vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: state.role }),
  useCompanyId: () => "c_1",
}));
vi.mock("@/lib/api/me-company", () => ({
  useMemberFirsts: (enabled: boolean) => ({
    data: enabled ? state.firsts : undefined,
  }),
  useJoiningNote: (enabled: boolean) => {
    noteAsked(enabled);
    return state.joining;
  },
  useMarkOriented: () => ({ mutate: marked }),
}));
vi.mock("@/lib/push/use-push-subscription", () => ({
  usePushSubscription: () => ({
    ...state.push,
    subscribe,
    unsubscribe: vi.fn(),
    phase: "idle",
  }),
}));

// The dialog is a Radix portal, which renders nothing at all in SSR — so an
// "it stays shut" assertion against the raw markup would pass whether it was
// shut or wide open. Swapped for a passthrough that honours `open`, which is
// what makes every assertion below a real one.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
}));

import { MemberOrientation, NotificationStep } from "./member-orientation";

function render(): string {
  return renderToStaticMarkup(<MemberOrientation />);
}

// This app's vitest does not set `globals`, so testing-library's automatic
// cleanup never registers and renders stack across tests.
afterEach(cleanup);

beforeEach(() => {
  state.role = "member";
  state.firsts = { oriented: false };
  // The ordinary answer: nobody wrote anything, which is most memberships.
  state.joining = { data: { note: null, from: null }, isPending: false };
  state.push = {
    supported: true,
    permission: "default",
    subscribed: false,
    pending: false,
    error: null,
  };
  marked.mockClear();
  subscribe.mockClear();
  noteAsked.mockClear();
});

describe("who it opens for", () => {
  it("opens for a new member, on the first screen", () => {
    const html = render();
    expect(html).toContain("One inbox, the whole crew");
    // Skippable from the very first screen, per the Acceptance line. A flow
    // you must finish to escape is a wall, and this one guards nothing.
    expect(html).toContain("Skip");
  });

  it("stays shut for somebody who has already been through it", () => {
    state.firsts = { oriented: true };
    expect(render()).toBe("");
  });

  it("stays shut while the answer is in flight", () => {
    // Flashing four screens at somebody who has been here for months, then
    // taking them away, is worse than the wait.
    state.firsts = undefined;
    expect(render()).toBe("");
  });

  it("stays shut for the person who built the workspace", () => {
    for (const role of ["owner", "admin"]) {
      state.role = role;
      expect(render(), role).toBe("");
    }
  });

  it("does not even ask the server about a role it is not for", () => {
    // The enable flag is the audience rule, not a second spelling of it. A
    // bookkeeper paying a round trip on every app load for a screen they can
    // never see is the kind of cost that never shows up in review.
    state.role = "bookkeeper";
    state.firsts = { oriented: false };
    expect(render()).toBe("");
  });
});

/**
 * #521: the words of whoever added them.
 *
 * No apostrophes in the fixture: `renderToStaticMarkup` escapes them, and a
 * `toContain` on the raw markup would then fail on a note that renders
 * perfectly well.
 */
const NOTE =
  "Cover the Riverside jobs this month. Anything from the Ellis account comes to me first.";

describe("the joining note", () => {
  it("opens with their words above ours", () => {
    state.joining = { data: { note: NOTE, from: "Dana" }, isPending: false };
    const html = render();
    expect(html).toContain(NOTE);
    // The order is the whole point. The four screens explain the product; this
    // is the only thing on screen that explains the job.
    expect(html.indexOf(NOTE)).toBeLessThan(
      html.indexOf("One inbox, the whole crew"),
    );
    // The construction the invite mail signs the same note with, and above the
    // quote rather than under it, so nobody reads a person's words as ours.
    expect(html).toContain("Dana says");
    expect(html.indexOf("Dana says")).toBeLessThan(html.indexOf(NOTE));
  });

  it("shows an unattributed note as somebody's words, not as ours", () => {
    // `from` is null whenever the name could not be resolved. The note is
    // still a person talking, so it is still quoted and still attributed, just
    // not to a name.
    state.joining = { data: { note: NOTE, from: null }, isPending: false };
    const html = render();
    expect(html).toContain(NOTE);
    expect(html).toContain("<blockquote");
    expect(html).toContain("They said");
    expect(html.indexOf("They said")).toBeLessThan(html.indexOf(NOTE));
  });

  it("leaves the orientation exactly as it was when there is no note", () => {
    // The ordinary case, by a wide margin: every membership older than the
    // field, every owner who made their own workspace, every plain invite.
    const html = render();
    expect(html).toContain("One inbox, the whole crew");
    expect(html).not.toContain("<blockquote");
    expect(html).not.toContain("<figure");
  });

  it("does not hold the orientation shut while the note is in flight", () => {
    // Almost every member has no note at all, so a member who will never see
    // one must not wait on a request about one. A call that is slow or
    // retrying would otherwise hold the whole flow shut for as long as it took.
    state.joining = { data: undefined, isPending: true };
    const html = render();
    expect(html).toContain("One inbox, the whole crew");
    expect(html).not.toContain("<blockquote");
  });

  it("opens anyway when the note cannot be read", () => {
    // Losing the note is a shame; losing the orientation over it would be a
    // bug.
    state.joining = { data: undefined, isPending: false };
    expect(render()).toContain("One inbox, the whole crew");
  });

  it("shows it once, on the first screen only", () => {
    state.joining = { data: { note: NOTE, from: "Dana" }, isPending: false };
    mount(<MemberOrientation />);
    expect(screen.getByText(NOTE)).toBeTruthy();

    fireEvent.click(screen.getByText("Next"));

    expect(screen.getByText("You answer as the business")).toBeTruthy();
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it("is not asked for at all for a role that could never see it", () => {
    // Same rule as the firsts read: an owner paying a round trip on every app
    // load for a screen that cannot open is a cost nobody ever notices.
    state.role = "owner";
    render();
    expect(noteAsked).toHaveBeenCalledWith(false);
    expect(noteAsked).not.toHaveBeenCalledWith(true);
  });

  it("stops being asked for once the member has been through the flow", () => {
    // The expensive half of the same cost. A member is the audience forever,
    // so a read gated on the role alone runs on every shell load for the rest
    // of their membership, for a dialog that opened once months ago.
    state.firsts = { oriented: true };
    render();
    expect(noteAsked).toHaveBeenCalledWith(false);
    expect(noteAsked).not.toHaveBeenCalledWith(true);
  });
});

describe("the browser prompt", () => {
  it("is never triggered by rendering", () => {
    // G8: the permission prompt follows a deliberate tap or it does not
    // happen. Mounting the hook is a read. This is the whole difference
    // between #286's "with context" and the cold ask it objects to.
    render();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("is offered on the last screen, with the reason above it", () => {
    // Rendered directly, because the step lives in component state and the
    // point of the assertion is the BRANCH: an ask that only ever appears
    // after three screens explaining what it is for.
    const html = renderToStaticMarkup(<NotificationStep onDone={() => {}} />);
    expect(html).toContain("Turn on notifications");
    expect(html).toContain("Not now");
  });

  it("is not offered where it cannot or should not be asked", () => {
    // Re-asking somebody who already said no is how an app gets muted for
    // good, and a browser without push has nothing to offer at all. Each of
    // these gets one button out instead.
    for (const push of [
      { ...state.push, supported: false },
      { ...state.push, permission: "denied" },
      { ...state.push, subscribed: true },
    ]) {
      state.push = push;
      const html = renderToStaticMarkup(<NotificationStep onDone={() => {}} />);
      expect(html, JSON.stringify(push)).not.toContain("Turn on notifications");
      expect(html, JSON.stringify(push)).toContain("Start working");
    }
  });
});

describe("marking it done", () => {
  it("records nothing until they act", () => {
    // Rendering is not consent. If a mount counted as "oriented", a member
    // whose app crashed on the first screen would never see it again.
    render();
    expect(marked).not.toHaveBeenCalled();
  });
});
