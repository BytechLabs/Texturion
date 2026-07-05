import { describe, expect, it } from "vitest";

import type { ConversationEvent, Message } from "@/lib/api/types";

import { buildThreadItems, dayDividerLabel } from "./clusters";

const NOW = new Date("2026-07-01T18:00:00Z");

let seq = 0;
function msg(partial: Partial<Message> & { created_at: string }): Message {
  seq += 1;
  return {
    id: partial.id ?? `m-${String(seq).padStart(3, "0")}`,
    conversation_id: "c-1",
    direction: "inbound",
    body: "hello",
    status: "received",
    segments: 1,
    encoding: "GSM-7",
    sent_by_user_id: null,
    error_code: null,
    error_detail: null,
    telnyx_message_id: null,
    done_at: null,
    done_by_user_id: null,
    pinned_at: null,
    pinned_by_user_id: null,
    attachments: [],
    ...partial,
  };
}

function evt(created_at: string, type: ConversationEvent["type"] = "assigned"): ConversationEvent {
  seq += 1;
  return {
    id: `e-${String(seq).padStart(3, "0")}`,
    conversation_id: "c-1",
    actor_user_id: "u-1",
    type,
    payload: {},
    created_at,
  };
}

describe("buildThreadItems clustering", () => {
  it("clusters same sender within 3 minutes, splits past the gap", () => {
    const items = buildThreadItems(
      [
        msg({ created_at: "2026-07-01T15:00:00Z" }),
        msg({ created_at: "2026-07-01T15:02:59Z" }),
        msg({ created_at: "2026-07-01T15:07:00Z" }),
      ],
      [],
      NOW,
    );
    // divider + cluster(2) + cluster(1)
    expect(items.map((i) => i.kind)).toEqual(["divider", "cluster", "cluster"]);
    expect(items[1].kind === "cluster" && items[1].messages).toHaveLength(2);
    expect(items[2].kind === "cluster" && items[2].messages).toHaveLength(1);
  });

  it("splits clusters on direction and on author change", () => {
    const items = buildThreadItems(
      [
        msg({ created_at: "2026-07-01T15:00:00Z" }),
        msg({
          created_at: "2026-07-01T15:00:30Z",
          direction: "outbound",
          status: "sent",
          sent_by_user_id: "u-1",
        }),
        msg({
          created_at: "2026-07-01T15:01:00Z",
          direction: "outbound",
          status: "sent",
          sent_by_user_id: "u-2",
        }),
        msg({
          created_at: "2026-07-01T15:01:20Z",
          direction: "note",
          status: null,
          sent_by_user_id: "u-2",
        }),
      ],
      [],
      NOW,
    );
    const clusters = items.filter((i) => i.kind === "cluster");
    expect(clusters).toHaveLength(4); // inbound | u-1 out | u-2 out | u-2 note
  });

  it("sorts unordered input by (created_at, id)", () => {
    const items = buildThreadItems(
      [
        msg({ id: "m-b", created_at: "2026-07-01T15:01:00Z" }),
        msg({ id: "m-a", created_at: "2026-07-01T15:00:00Z" }),
      ],
      [],
      NOW,
    );
    const cluster = items[1];
    expect(cluster.kind).toBe("cluster");
    expect(
      cluster.kind === "cluster" && cluster.messages.map((m) => m.id),
    ).toEqual(["m-a", "m-b"]);
  });
});

describe("buildThreadItems dividers", () => {
  it("inserts a divider at each day boundary with the right label", () => {
    const items = buildThreadItems(
      [
        msg({ created_at: "2026-06-12T10:00:00Z" }),
        msg({ created_at: "2026-06-30T10:00:00Z" }),
        msg({ created_at: "2026-07-01T10:00:00Z" }),
      ],
      [],
      NOW,
    );
    const dividers = items.filter((i) => i.kind === "divider");
    expect(dividers.map((d) => d.kind === "divider" && d.label)).toEqual([
      "Jun 12",
      "Yesterday",
      "Today",
    ]);
  });

  it("labels other years absolutely", () => {
    expect(dayDividerLabel(new Date("2025-06-12T10:00:00Z"), NOW)).toBe(
      "Jun 12 2025",
    );
  });
});

describe("buildThreadItems events", () => {
  it("places system lines chronologically and breaks clusters", () => {
    const items = buildThreadItems(
      [
        msg({ created_at: "2026-07-01T15:00:00Z" }),
        msg({ created_at: "2026-07-01T15:01:00Z" }),
      ],
      [evt("2026-07-01T15:00:30Z")],
      NOW,
    );
    expect(items.map((i) => i.kind)).toEqual([
      "divider",
      "cluster",
      "event",
      "cluster",
    ]);
  });
});
