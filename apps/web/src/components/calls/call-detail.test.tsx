/**
 * #336: the call page paints at the click from the log's row, starts its
 * timeline at once, and holds back only what a list row cannot know. A failed
 * background refresh keeps the page; only a failed first read shows the error.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeTranslate } from "@/i18n/translate";
import type { CallDetail as CallDetailRow } from "@/lib/api/types";

const t = makeTranslate("en");

const query = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@/lib/api/calls", () => ({ useCall: () => query.current }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/calls/call-actions", () => ({ CallActions: () => null }));
vi.mock("@/components/calls/voicemail-player", () => ({
  VoicemailPlayer: () => <p>voicemail-player</p>,
}));
vi.mock("@/components/activity/activity-timeline", () => ({
  ActivityTimeline: ({ recordType, recordId }: { recordType: string; recordId: string }) => (
    <p>
      timeline:{recordType}:{recordId}
    </p>
  ),
}));

import { CallDetail } from "./call-detail";

function detail(overrides: Partial<CallDetailRow> = {}): CallDetailRow {
  return {
    id: "call-1",
    call_session_id: "sess-1",
    direction: "inbound",
    caller_e164: "+16135551000",
    contact_id: "ct-1",
    contact_name: "Dana Roofer",
    caller_name: null,
    phone_number_id: "pn-1",
    conversation_id: "conv-1",
    outcome: "voicemail",
    forward_seconds: 0,
    screening_result: null,
    stir_attestation: null,
    voicemail_seconds: 12,
    voicemail_transcript: null,
    voicemail_intake: null,
    answered_by_user_id: null,
    answered_by_name: null,
    started_at: "2026-11-13T15:00:00Z",
    ended_at: "2026-11-13T15:01:00Z",
    has_voicemail: true,
    voicemail_transcript_attempted_at: null,
    ...overrides,
  };
}

function shown(state: Record<string, unknown>): string {
  query.current = {
    isPending: false,
    isError: false,
    isLoadingError: false,
    isPlaceholderData: false,
    refetch: vi.fn(),
    ...state,
  };
  return renderToStaticMarkup(<CallDetail sessionId="sess-1" />).replaceAll("&#x27;", "'");
}

beforeEach(() => {
  query.current = {};
});

describe("CallDetail", () => {
  it("CD-1: paints the clicked row and its timeline, holding back the transcript sentence", () => {
    const html = shown({
      data: detail({ ended_at: null }),
      isPlaceholderData: true,
    });
    expect(html).toContain("Dana Roofer");
    expect(html).toContain("timeline:call:call-1");
    expect(html).not.toContain(t("shell.loadingCall"));
    expect(html).not.toContain(t("shell.transcriptNotYet"));
    expect(html).not.toContain(t("shell.endedLabel"));
  });

  it("CD-2: shows the real transcript sentence and the end once the detail lands", () => {
    const html = shown({ data: detail() });
    expect(html).toContain(t("shell.transcriptNotYet"));
    expect(html).toContain(t("shell.endedLabel"));
  });

  it("CD-3: keeps the page when a background refresh fails", () => {
    const html = shown({ data: detail(), isError: true });
    expect(html).toContain("Dana Roofer");
  });

  it("CD-4: shows the error when the first read fails", () => {
    const html = shown({ data: undefined, isError: true, isLoadingError: true });
    expect(html).not.toContain("Dana Roofer");
    expect(html).toContain(t("common.retry"));
  });

  it("CD-5: shows the skeleton with nothing to paint from", () => {
    expect(shown({ data: undefined, isPending: true })).toContain(t("shell.loadingCall"));
  });
});
