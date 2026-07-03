import { describe, expect, it } from "vitest";

import type { ClusterItem, DividerItem, EventItem, ThreadItem } from "./clusters";
import type { ConversationEvent, Message } from "@/lib/api/types";
import {
  filterThreadItems,
  parseThreadFilter,
  threadFilterEmptyCopy,
} from "./thread-filter";

function message(id: string, direction: Message["direction"]): Message {
  return {
    id,
    conversation_id: "c1",
    direction,
    body: `body-${id}`,
    status: direction === "note" ? null : "delivered",
    segments: null,
    encoding: null,
    sent_by_user_id: null,
    error_code: null,
    error_detail: null,
    telnyx_message_id: null,
    done_at: null,
    done_by_user_id: null,
    created_at: "2026-07-02T10:00:00Z",
  };
}

const divider: DividerItem = { kind: "divider", key: "d", label: "Today" };
const inbound: ClusterItem = {
  kind: "cluster",
  key: "c-in",
  direction: "inbound",
  senderUserId: null,
  messages: [message("1", "inbound")],
};
const outbound: ClusterItem = {
  kind: "cluster",
  key: "c-out",
  direction: "outbound",
  senderUserId: "u1",
  messages: [message("2", "outbound")],
};
const note: ClusterItem = {
  kind: "cluster",
  key: "c-note",
  direction: "note",
  senderUserId: "u1",
  messages: [message("3", "note")],
};
const event: EventItem = {
  kind: "event",
  key: "e1",
  event: {
    id: "e1",
    conversation_id: "c1",
    actor_user_id: "u1",
    type: "message_done",
    payload: { message_id: "1" },
    created_at: "2026-07-02T10:05:00Z",
  } as ConversationEvent,
};

const items: ThreadItem[] = [divider, inbound, outbound, note, event];

describe("parseThreadFilter (§5.1)", () => {
  it("defaults to all for absent/unknown values", () => {
    expect(parseThreadFilter(null)).toBe("all");
    expect(parseThreadFilter(undefined)).toBe("all");
    expect(parseThreadFilter("bogus")).toBe("all");
  });

  it("round-trips the four known values", () => {
    expect(parseThreadFilter("all")).toBe("all");
    expect(parseThreadFilter("messages")).toBe("messages");
    expect(parseThreadFilter("notes")).toBe("notes");
    expect(parseThreadFilter("events")).toBe("events");
  });
});

describe("filterThreadItems (§5.1)", () => {
  it("all keeps the full interleaved stream (dividers included)", () => {
    expect(filterThreadItems(items, "all")).toEqual(items);
  });

  it("messages keeps inbound+outbound clusters only", () => {
    const out = filterThreadItems(items, "messages");
    expect(out).toEqual([inbound, outbound]);
  });

  it("notes keeps note clusters only", () => {
    expect(filterThreadItems(items, "notes")).toEqual([note]);
  });

  it("events keeps timeline event lines only", () => {
    expect(filterThreadItems(items, "events")).toEqual([event]);
  });
});

describe("threadFilterEmptyCopy", () => {
  it("gives a distinct empty line per view", () => {
    expect(threadFilterEmptyCopy("messages")).toMatch(/messages/i);
    expect(threadFilterEmptyCopy("notes")).toMatch(/notes/i);
    expect(threadFilterEmptyCopy("events")).toMatch(/happened/i);
    expect(threadFilterEmptyCopy("all")).toMatch(/say hello/i);
  });
});
