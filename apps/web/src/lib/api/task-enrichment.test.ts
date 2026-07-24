/**
 * #214 — the enrichment session cache. enrichTaskFromMessage must call the API
 * once per (company, message) and reuse the result for the rest of the session
 * (the founder's "local caching"), and degrade to the empty enrichment on any
 * network error so task creation is never blocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./client";
import { enrichTaskFromMessage } from "./task-enrichment";
import type { TaskEnrichment } from "./types";

const mockFetch = vi.mocked(apiFetch);

const EMPTY: TaskEnrichment = {
  address: null,
  address_provenance: null,
  due_at: null,
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe("enrichTaskFromMessage", () => {
  it("calls the API once per message and reuses the cached result", async () => {
    const result: TaskEnrichment = {
      address: {
        street: "5 King St W",
        unit: null,
        city: "Toronto",
        state: null,
        postal_code: null,
        country: null,
      },
      address_provenance: "message",
      due_at: null,
    };
    mockFetch.mockResolvedValueOnce(result);

    const first = await enrichTaskFromMessage("co1", {
      message_id: "cache-msg-1",
      conversation_id: "conv",
      text: "fix sink at 5 King St W",
    });
    const second = await enrichTaskFromMessage("co1", {
      message_id: "cache-msg-1",
      conversation_id: "conv",
      text: "fix sink at 5 King St W",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first.address?.street).toBe("5 King St W");
  });

  it("degrades to the empty enrichment on a network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    const result = await enrichTaskFromMessage("co1", {
      message_id: "cache-msg-error",
      conversation_id: "conv",
      text: "fix sink",
    });
    expect(result).toEqual(EMPTY);
  });

  it("keys the cache by message, so a different message calls the API again", async () => {
    mockFetch.mockResolvedValue(EMPTY);
    await enrichTaskFromMessage("co1", {
      message_id: "cache-msg-A",
      conversation_id: "conv",
      text: "a",
    });
    await enrichTaskFromMessage("co1", {
      message_id: "cache-msg-B",
      conversation_id: "conv",
      text: "b",
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
