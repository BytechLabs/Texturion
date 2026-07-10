import { describe, expect, it } from "vitest";

import type { ClusterItem, DividerItem, EventItem, ThreadItem } from "./clusters";
import type { ConversationEvent, Message } from "@/lib/api/types";
import {
  ALL_CATEGORIES_ON,
  enabledCategories,
  filterThreadItems,
  isAllOn,
  parseThreadFilter,
  serializeThreadFilter,
  threadFilterEmptyCopy,
  toggleThreadCategory,
  type ThreadFilter,
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
    pinned_at: null,
    pinned_by_user_id: null,
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

/** A filter with only the named kinds on. */
function only(...on: Array<keyof ThreadFilter>): ThreadFilter {
  return {
    messages: on.includes("messages"),
    notes: on.includes("notes"),
    events: on.includes("events"),
  };
}

describe("parseThreadFilter (§5.1)", () => {
  it("defaults to all-on for absent/empty/all-unknown values", () => {
    expect(parseThreadFilter(null)).toEqual(ALL_CATEGORIES_ON);
    expect(parseThreadFilter(undefined)).toEqual(ALL_CATEGORIES_ON);
    expect(parseThreadFilter("")).toEqual(ALL_CATEGORIES_ON);
    expect(parseThreadFilter("bogus")).toEqual(ALL_CATEGORIES_ON);
  });

  it("reads a comma list of enabled kinds", () => {
    expect(parseThreadFilter("messages")).toEqual(only("messages"));
    expect(parseThreadFilter("notes,events")).toEqual(only("notes", "events"));
    expect(parseThreadFilter("messages,notes,events")).toEqual(
      ALL_CATEGORIES_ON,
    );
  });

  it("trims whitespace and drops unknown tokens", () => {
    expect(parseThreadFilter(" messages , bogus , events ")).toEqual(
      only("messages", "events"),
    );
  });
});

describe("serializeThreadFilter (§5.1)", () => {
  it("drops the param when all kinds are on (the default)", () => {
    expect(serializeThreadFilter(ALL_CATEGORIES_ON)).toBeNull();
  });

  it("emits the enabled kinds in canonical order", () => {
    expect(serializeThreadFilter(only("events", "messages"))).toBe(
      "messages,events",
    );
    expect(serializeThreadFilter(only("notes"))).toBe("notes");
  });

  it("round-trips any subset through parse", () => {
    for (const subset of [
      only("messages"),
      only("notes"),
      only("events"),
      only("messages", "notes"),
      only("messages", "events"),
      only("notes", "events"),
    ]) {
      const serialized = serializeThreadFilter(subset);
      expect(serialized).not.toBeNull();
      expect(parseThreadFilter(serialized)).toEqual(subset);
    }
  });
});

describe("toggleThreadCategory (§5.1)", () => {
  it("flips one kind and leaves the others untouched", () => {
    expect(toggleThreadCategory(ALL_CATEGORIES_ON, "notes")).toEqual(
      only("messages", "events"),
    );
    expect(toggleThreadCategory(only("messages"), "events")).toEqual(
      only("messages", "events"),
    );
  });

  it("refuses to turn off the last enabled kind (never a blank timeline)", () => {
    const last = only("messages");
    expect(toggleThreadCategory(last, "messages")).toBe(last);
  });
});

describe("isAllOn / enabledCategories", () => {
  it("isAllOn is true only when every kind is on", () => {
    expect(isAllOn(ALL_CATEGORIES_ON)).toBe(true);
    expect(isAllOn(only("messages", "notes"))).toBe(false);
  });

  it("enabledCategories lists the on kinds in canonical order", () => {
    expect(enabledCategories(ALL_CATEGORIES_ON)).toEqual([
      "messages",
      "notes",
      "events",
    ]);
    expect(enabledCategories(only("events", "messages"))).toEqual([
      "messages",
      "events",
    ]);
  });
});

describe("filterThreadItems (§5.1)", () => {
  it("all-on keeps the full interleaved stream (dividers included)", () => {
    expect(filterThreadItems(items, ALL_CATEGORIES_ON)).toEqual(items);
  });

  it("messages-only keeps inbound+outbound clusters (dividers dropped)", () => {
    expect(filterThreadItems(items, only("messages"))).toEqual([
      inbound,
      outbound,
    ]);
  });

  it("notes-only keeps note clusters", () => {
    expect(filterThreadItems(items, only("notes"))).toEqual([note]);
  });

  it("events-only keeps timeline event lines", () => {
    expect(filterThreadItems(items, only("events"))).toEqual([event]);
  });

  it("mixes kinds — messages+events keeps both, drops notes and dividers", () => {
    expect(filterThreadItems(items, only("messages", "events"))).toEqual([
      inbound,
      outbound,
      event,
    ]);
  });
});

describe("threadFilterEmptyCopy", () => {
  it("gives a distinct empty line for each single kind and for all-on", () => {
    expect(threadFilterEmptyCopy(only("messages"))).toMatch(/messages/i);
    expect(threadFilterEmptyCopy(only("notes"))).toMatch(/notes/i);
    expect(threadFilterEmptyCopy(only("events"))).toMatch(/happened/i);
    expect(threadFilterEmptyCopy(ALL_CATEGORIES_ON)).toMatch(/say hello/i);
  });

  it("uses a generic line when several kinds are on but empty", () => {
    expect(threadFilterEmptyCopy(only("messages", "events"))).toMatch(
      /current filters/i,
    );
  });
});
