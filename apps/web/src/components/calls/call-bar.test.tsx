/**
 * #211 outbound parity: call bar gating. The transfer/consult affordance
 * lights on a SERVER-ADDRESSABLE signal (a successful GET /v1/calls/live/:session
 * read), never on mere sessionId presence (C1): a 4-part outbound call that fell
 * to the legacy webhook path (kill switch or a pre-#211 worker rollback) still
 * carries a sessionId but has no DO to address, so /live 404s and the transfer
 * button never acts. #516 changed HOW that is expressed — disabled rather than
 * absent, matching both phones — because an absent control reads as a missing
 * feature; the requirement that it cannot act is unchanged.
 * Placement/dialing UX stays SDK-driven ("Calling…").
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
  useLiveCall: () => ({
    isSuccess: state.live.isSuccess,
    data: state.live.data,
    isError: false,
  }),
  // #516: the card reads these to size its own "still looking" window, so the
  // mock has to carry them — a mocked-away constant becomes NaN in the timeout
  // and the give-up would fire on the first tick.
  LIVE_NOTE_LOOKUP_ATTEMPTS: 4,
  LIVE_NOTE_LOOKUP_INTERVAL_MS: 1_200,
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

/**
 * The markup of ONE button, by its aria-label.
 *
 * #516 turned "is the control there" into "is the control enabled", and
 * asserting `disabled` against the whole card would pass on any disabled
 * button in the row — the notes button sits right next to transfer and is
 * disabled in most of these cases, so a card-wide check would have been green
 * for the wrong reason in exactly the tests that matter.
 */
function buttonByLabel(html: string, label: string): string {
  const start = html.lastIndexOf("<button", html.indexOf(`aria-label="${label}"`));
  if (start === -1) return "";
  return html.slice(start, html.indexOf("</button>", start));
}

/**
 * The ATTRIBUTE, not the substring. Every button in this card carries
 * `disabled:pointer-events-none disabled:opacity-50` in its Tailwind class
 * list, so a `toContain("disabled")` check reads true for an enabled button —
 * it passed the two negative cases and failed the positive one, which is the
 * useful direction for a mistake to fail in.
 */
function isDisabled(buttonHtml: string): boolean {
  return / disabled(=""|[ >])/.test(buttonHtml);
}

const transferButton = (html: string) =>
  buttonByLabel(html, "Transfer this call");
const notesButton = (html: string) =>
  buttonByLabel(html, "Finding this call&#x27;s conversation…");

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

  /**
   * #516 CHANGED WHAT "not addressable" LOOKS LIKE, and deliberately.
   *
   * #211 C1's requirement was that a call the server cannot address must not
   * offer a transfer that would fail — and it met it by REMOVING the button.
   * That is still met by disabling it, and removing it cost more than it
   * bought: the founder took a transferred call, saw no Messages and no
   * Transfer, and concluded the feature was missing. An absent control cannot
   * distinguish "not yet" from "not ever" from "not built".
   *
   * Both phones had already settled this the other way — InCallScreen.kt and
   * InCallView.swift each keep the control mounted and gate `enabled` — so the
   * web client was the odd one out, and these two tests were pinning the odd
   * one out in place.
   */
  it("disables, rather than removes, transfer when the live read has NOT succeeded", () => {
    // A 4-part call that fell to legacy carries a sessionId but is not
    // serverAddressable: /live never resolves, so the button must never act.
    state.calls = [outboundCall()];
    state.activeId = "c1";
    state.live = { isSuccess: false, data: undefined };
    const html = render();
    expect(html).toContain("Transfer this call");
    // The #211 requirement, still met: present, and inert.
    expect(isDisabled(transferButton(html))).toBe(true);
    // The rest of the card is still there; the member is on a live call.
    expect(html).toContain("Dana Roofer");
  });

  it("disables transfer when there is no sessionId at all", () => {
    state.calls = [outboundCall({ sessionId: null })];
    state.activeId = "c1";
    // A null sessionId disables useLiveCall, so it can never be successful.
    state.live = { isSuccess: false, data: undefined };
    expect(isDisabled(transferButton(render()))).toBe(true);
  });

  it("enables transfer once the server can address the session", () => {
    // The negative control for the two above: without this, disabling
    // everything forever would pass them both.
    state.calls = [outboundCall()];
    state.activeId = "c1";
    state.live = { isSuccess: true, data: { conversation_id: null } };
    expect(isDisabled(transferButton(render()))).toBe(false);
  });
});

describe("CallBar notes affordance (#516)", () => {
  it("keeps the notes button mounted while the thread is still being found", () => {
    // The reported bug: on a transferred call the conversation link can land a
    // beat after answer, and the button used to be absent until it did — which
    // on a failed resolve was forever. Mounted and honest instead.
    state.calls = [outboundCall()];
    state.activeId = "c1";
    state.live = { isSuccess: true, data: { conversation_id: null } };
    const html = render();
    expect(html).toContain("Finding this call&#x27;s conversation…");
    expect(isDisabled(notesButton(html))).toBe(true);
  });

  it("links to the thread once it is known", () => {
    state.calls = [outboundCall()];
    state.activeId = "c1";
    state.live = { isSuccess: true, data: { conversation_id: "conv-7" } };
    const html = render();
    expect(html).toContain("/inbox/conv-7");
    expect(html).toContain("Open the conversation to take notes");
    // No stale pending copy left behind next to a working link.
    expect(html).not.toContain("Finding this call");
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
