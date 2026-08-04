import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #286 — "An invited member sees a short, skippable, member-specific
 * orientation on first sign-in."
 *
 * Four things this must never do, each of which is the feature failing rather
 * than a detail: open for somebody who has already been through it, open
 * before the answer has landed, open for the owner who walked the setup
 * wizard, or trigger a browser permission prompt on mount.
 */

const state: {
  role: string;
  firsts: { oriented: boolean } | undefined;
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

vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: state.role }),
  useCompanyId: () => "c_1",
}));
vi.mock("@/lib/api/me-company", () => ({
  useMemberFirsts: (enabled: boolean) => ({
    data: enabled ? state.firsts : undefined,
  }),
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

beforeEach(() => {
  state.role = "member";
  state.firsts = { oriented: false };
  state.push = {
    supported: true,
    permission: "default",
    subscribed: false,
    pending: false,
    error: null,
  };
  marked.mockClear();
  subscribe.mockClear();
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
