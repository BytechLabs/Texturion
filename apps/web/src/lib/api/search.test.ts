import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "./core";
import { normalizeSearch } from "./search-normalize";
import type {
  SearchAttachmentHit,
  SearchConversationHit,
  SearchResult,
  SearchTaskHit,
  SearchTemplateHit,
} from "./types";

/**
 * `fetchSearch` (lib/api/search.ts) is a thin wrapper over the app client —
 * GET /v1/search with `q` (+ `cursor` on later conversation pages). These
 * tests exercise exactly that composition with the HTTP edge stubbed by an
 * injected fetch (the core.test.ts pattern): what the request looks like on
 * the wire, and that the full D29 five-arm payload — conversations (now with
 * the matched message's `direction`), contacts, tasks, attachments,
 * templates — parses through unchanged. The fixtures are typed against the
 * Search* interfaces, so a drift from the api_search_v2 shape fails to
 * compile before it fails at runtime.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const fetchSpy = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(String(input), init),
  );
  const request = createApiClient({
    baseUrl: "https://api.jobtext.test",
    getAccessToken: async () => "test-token",
    fetch: fetchSpy as unknown as typeof fetch,
  });
  return { request, fetchSpy };
}

/** Reproduces fetchSearch's call against the injected client. */
function search(
  request: ReturnType<typeof makeClient>["request"],
  q: string,
  cursor?: string,
): Promise<SearchResult> {
  return request<SearchResult>("/v1/search", {
    companyId: "company-1",
    searchParams: { q, cursor },
  });
}

// A note-borne conversation hit — `direction` is the D29 addition that lets
// the UI label it as an internal note rather than a customer message.
const CONVERSATION_HIT: SearchConversationHit = {
  id: "conv-1",
  status: "open",
  is_spam: false,
  last_message_at: "2026-07-01T10:00:00Z",
  contact: { id: "contact-1", name: "Jo Beaulieu", phone_e164: "+16135550100" },
  matched_message_id: "msg-1",
  matched_at: "2026-07-01T09:59:00Z",
  direction: "note",
  snippet: "ordered the <b>furnace</b> part",
};

// `done` is the derived read of the source message's done_at (D17).
const TASK_HIT: SearchTaskHit = {
  id: "task-1",
  title: "Order the furnace part",
  conversation_id: "conv-1",
  done: false,
  matched_at: "2026-07-01T09:00:00Z",
};

// Generic note/task rows only — MMS media has no filename (D29, on purpose).
const ATTACHMENT_HIT: SearchAttachmentHit = {
  id: "att-1",
  file_name: "invoice.pdf",
  owner_type: "note",
  conversation_id: "conv-1",
  content_type: "application/pdf",
  created_at: "2026-07-01T08:00:00Z",
};

const TEMPLATE_HIT: SearchTemplateHit = {
  id: "tpl-1",
  name: "Quote follow-up",
  snippet: "Hi — just checking you got the quote we sent over.",
};

const FULL_PAGE: SearchResult = {
  conversations: [CONVERSATION_HIT],
  contacts: [{ id: "contact-1", name: "Jo Beaulieu", phone_e164: "+16135550100" }],
  tasks: [TASK_HIT],
  attachments: [ATTACHMENT_HIT],
  templates: [TEMPLATE_HIT],
  next_cursor: null,
};

describe("search — request shape on the wire", () => {
  it("GETs /v1/search with q and drops the absent cursor", async () => {
    const { request, fetchSpy } = makeClient(() =>
      jsonResponse(200, FULL_PAGE),
    );
    await search(request, "furnace");

    const [url, init] = fetchSpy.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.origin).toBe("https://api.jobtext.test");
    expect(parsed.pathname).toBe("/v1/search");
    expect(parsed.searchParams.get("q")).toBe("furnace");
    expect(parsed.searchParams.has("cursor")).toBe(false);

    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["X-Company-Id"]).toBe("company-1");
  });

  it("carries the opaque cursor on later conversation pages", async () => {
    const { request, fetchSpy } = makeClient(() =>
      jsonResponse(200, {
        ...FULL_PAGE,
        // Cursored pages suppress the ride-along arms server-side.
        contacts: [],
        tasks: [],
        attachments: [],
        templates: [],
      }),
    );
    await search(request, "furnace", "b3BhcXVl");

    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.searchParams.get("cursor")).toBe("b3BhcXVl");
  });
});

describe("search — the D29 five-arm payload parses through unchanged", () => {
  it("returns every arm verbatim for the UI sections", async () => {
    const { request } = makeClient(() => jsonResponse(200, FULL_PAGE));
    const result = await search(request, "furnace");
    expect(result).toEqual(FULL_PAGE);

    // Note hits are labelable: the matched message's direction is exposed.
    expect(result.conversations[0].direction).toBe("note");
    // Task completion is the derived boolean, not a status column (D17).
    expect(result.tasks[0].done).toBe(false);
    // The attachment deep link target rides along with the hit.
    expect(result.attachments[0].conversation_id).toBe("conv-1");
    expect(result.attachments[0].owner_type).toBe("note");
    // The template snippet is plain text (left(body, 160) — no <b> markers).
    expect(result.templates[0].snippet).not.toMatch(/<\/?b>/);
  });

  it("parses the calm empty page — five empty arms, no cursor", async () => {
    const empty: SearchResult = {
      conversations: [],
      contacts: [],
      tasks: [],
      attachments: [],
      templates: [],
      next_cursor: null,
    };
    const { request } = makeClient(() => jsonResponse(200, empty));
    const result = await search(request, "zz");
    expect(result).toEqual(empty);
  });

  it("normalizes a v1-shaped payload — the D29 arms coalesce to empty, no throw", () => {
    // A pre-D29 Worker (independent deploy, or a rollback) answers with only
    // the two original arms and no cursor. The palette reads `.tasks.length`
    // etc unconditionally, so the absent arms MUST come back as [] — a bare
    // `.length` on undefined would TypeError and unmount the whole shell.
    const v1Payload = {
      conversations: [CONVERSATION_HIT],
      contacts: [{ id: "contact-1", name: "Jo Beaulieu", phone_e164: "+16135550100" }],
    } as unknown as SearchResult;

    const normalized = normalizeSearch(v1Payload);

    expect(normalized.conversations).toEqual([CONVERSATION_HIT]);
    expect(normalized.tasks).toEqual([]);
    expect(normalized.attachments).toEqual([]);
    expect(normalized.templates).toEqual([]);
    expect(normalized.next_cursor).toBeNull();
    // The five arms every UI section maps over are all arrays.
    expect(() =>
      normalized.tasks.length +
      normalized.attachments.length +
      normalized.templates.length,
    ).not.toThrow();
  });

  it("passes a full D29 payload through normalization unchanged", () => {
    expect(normalizeSearch(FULL_PAGE)).toEqual(FULL_PAGE);
  });

  it("surfaces the §7 error envelope as a typed ApiError", async () => {
    const { request } = makeClient(() =>
      jsonResponse(422, {
        error: { code: "validation_failed", message: "q: too long." },
      }),
    );
    await expect(search(request, "x".repeat(201))).rejects.toMatchObject({
      code: "validation_failed",
      status: 422,
      message: "q: too long.",
    });
  });
});
