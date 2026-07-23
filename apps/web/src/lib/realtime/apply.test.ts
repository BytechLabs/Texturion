import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { type ThreadData } from "@/lib/api/cache";
import { keys } from "@/lib/api/keys";
import type { Message } from "@/lib/api/types";

import { applyLiveThreadAppend } from "./apply";

const COMPANY = "company-1";
const CONV = "conv-1";

function message(id: string, createdAt: string): Message {
  return {
    id,
    conversation_id: CONV,
    direction: "inbound",
    body: `body-${id}`,
    status: "received",
    segments: null,
    encoding: null,
    sent_by_user_id: null,
    error_code: null,
    error_detail: null,
    telnyx_message_id: null,
    done_at: null,
    done_by_user_id: null,
    pinned_at: null,
    pinned_by_user_id: null,
    created_at: createdAt,
    attachments: [],
  };
}

function seedThread(qc: QueryClient, messages: Message[]) {
  const data: ThreadData = {
    pages: [{ data: messages, next_cursor: null }],
    pageParams: [undefined],
  };
  qc.setQueryData(keys.thread(COMPANY, CONV), data);
}

function threadMessages(qc: QueryClient): Message[] {
  const data = qc.getQueryData<ThreadData>(keys.thread(COMPANY, CONV));
  return (data?.pages ?? []).flatMap((p) => p.data);
}

describe("applyLiveThreadAppend (#215 open-thread live append)", () => {
  it("appends a live inbound message into an OPEN thread (newest-first, deduped)", () => {
    const qc = new QueryClient();
    seedThread(qc, [message("m1", "2026-07-23T10:00:00.000Z")]);

    const patched = applyLiveThreadAppend(qc, COMPANY, CONV, [
      message("m2", "2026-07-23T10:05:00.000Z"),
    ]);

    expect(patched).toBe(true);
    const ids = threadMessages(qc).map((m) => m.id);
    expect(ids).toEqual(["m2", "m1"]); // newest-first
  });

  it("is idempotent — re-applying the same message does not duplicate it", () => {
    const qc = new QueryClient();
    seedThread(qc, [message("m1", "2026-07-23T10:00:00.000Z")]);
    const m2 = message("m2", "2026-07-23T10:05:00.000Z");

    applyLiveThreadAppend(qc, COMPANY, CONV, [m2]);
    applyLiveThreadAppend(qc, COMPANY, CONV, [m2]);

    expect(threadMessages(qc).map((m) => m.id)).toEqual(["m2", "m1"]);
  });

  it("does NOT depend on spam state — the caller opened the thread, so it appends (spam is only inbox-list-gated)", () => {
    // applyLiveThreadAppend takes no spam flag by design: an OPEN thread appends
    // live whether or not the conversation is spam (SPEC §6.3 gates only the
    // inbox list, which the provider handles separately). This pins that #215
    // invariant so the fix can't regress back to a pre-append spam short-circuit.
    const qc = new QueryClient();
    seedThread(qc, [message("m1", "2026-07-23T10:00:00.000Z")]);
    expect(
      applyLiveThreadAppend(qc, COMPANY, CONV, [
        message("m2", "2026-07-23T10:05:00.000Z"),
      ]),
    ).toBe(true);
    expect(threadMessages(qc)).toHaveLength(2);
  });

  it("no-ops (returns false) when the thread was never opened — nothing cached to patch", () => {
    const qc = new QueryClient();
    const patched = applyLiveThreadAppend(qc, COMPANY, CONV, [
      message("m1", "2026-07-23T10:00:00.000Z"),
    ]);
    expect(patched).toBe(false);
    expect(qc.getQueryData(keys.thread(COMPANY, CONV))).toBeUndefined();
  });
});
