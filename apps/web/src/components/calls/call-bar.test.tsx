/**
 * #211 outbound parity: call bar gating. The transfer/consult affordance
 * lights on a SERVER-ADDRESSABLE signal (a successful GET /v1/calls/live/:session
 * read), never on mere sessionId presence (C1): a 4-part outbound call that fell
 * to the legacy webhook path (kill switch or a pre-#211 worker rollback) still
 * carries a sessionId but has no DO to address, so /live 404s and no dead
 * transfer button is shown. Placement/dialing UX stays SDK-driven ("Calling…").
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CallInfo } from "@/lib/softphone/state";

// Hoisted mock state the hooks read; each test seeds it before rendering.
const state: {
  calls: CallInfo[];
  activeId: string | null;
  live: { isSuccess: boolean; data?: { conversation_id: string | null } };
} = {
  calls: [],
  activeId: null,
  live: { isSuccess: false, data: undefined },
};

// The live-call read is the serverAddressable probe; the targets/transfer hooks
// and the member roster are only reached once the menu opens, so plain stubs.
vi.mock("@/lib/api/calls", () => ({
  useLiveCall: () => ({ isSuccess: state.live.isSuccess, data: state.live.data }),
  useTransferTargets: () => ({ isPending: false, data: { targets: [] } }),
  useTransferCall: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({ data: { data: [] } }),
}));
vi.mock("@/lib/softphone/provider", () => ({
  useSoftphone: () => ({
    ready: true,
    error: null,
    calls: state.calls,
    activeId: state.activeId,
    activeCall: state.calls.find((c) => c.id === state.activeId) ?? null,
    placeCall: vi.fn(),
    answer: vi.fn(),
    hangup: vi.fn(),
    toggleHold: vi.fn(),
    toggleMute: vi.fn(),
    sendDtmf: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { CallBar } from "./call-bar";

function outboundCall(overrides: Partial<CallInfo> = {}): CallInfo {
  return {
    id: "c1",
    sessionId: "sess-out-1",
    peer: { name: "Dana Roofer", number: "+16135551000" },
    direction: "outbound",
    phase: "active",
    muted: false,
    activeSince: Date.now() - 5000,
    ...overrides,
  };
}

function render(): string {
  return renderToStaticMarkup(<CallBar />);
}

afterEach(() => {
  state.calls = [];
  state.activeId = null;
  state.live = { isSuccess: false, data: undefined };
});

describe("CallBar transfer gating (#211 C1)", () => {
  it("shows the transfer affordance on an active outbound call the server can address", () => {
    state.calls = [outboundCall()];
    state.activeId = "c1";
    state.live = { isSuccess: true, data: { conversation_id: null } };
    expect(render()).toContain("Transfer this call");
  });

  it("hides the transfer affordance when the live read has NOT succeeded, even with a sessionId", () => {
    // A 4-part call that fell to legacy carries a sessionId but is not
    // serverAddressable: /live never resolves, so no dead transfer button.
    state.calls = [outboundCall()];
    state.activeId = "c1";
    state.live = { isSuccess: false, data: undefined };
    const html = render();
    expect(html).not.toContain("Transfer this call");
    // The rest of the card is still there; the member is on a live call.
    expect(html).toContain("Dana Roofer");
  });

  it("hides the transfer affordance when there is no sessionId at all", () => {
    state.calls = [outboundCall({ sessionId: null })];
    state.activeId = "c1";
    // A null sessionId disables useLiveCall, so it can never be successful.
    state.live = { isSuccess: false, data: undefined };
    expect(render()).not.toContain("Transfer this call");
  });
});

describe("CallBar outbound placement UX (#211, SDK-driven)", () => {
  it("a placed-but-not-yet-answered outbound call reads 'Calling…' and offers no transfer", () => {
    state.calls = [outboundCall({ phase: "connecting", activeSince: null })];
    state.activeId = "c1";
    // Even a serverAddressable live read must not surface transfer before the
    // call is 'active'; dialing UX stays driven by the SDK phase.
    state.live = { isSuccess: true, data: { conversation_id: null } };
    const html = render();
    expect(html).toContain("Calling");
    expect(html).not.toContain("Transfer this call");
  });

  it("is absent entirely when no calls are live", () => {
    expect(render()).toBe("");
  });
});
