/**
 * #480 step 5: the two derivations that decide which realtime topics this client
 * joins. The subscription set is the security boundary now (D88), so the wire
 * format and the "when does the socket rebuild" key are pinned here rather than
 * left to the one effect that consumes them.
 */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { numberTopicKey, realtimeTopics } from "./provider";

const COMPANY = "11111111-1111-1111-1111-111111111111";

describe("numberTopicKey", () => {
  it("is empty for a member with no visible numbers", () => {
    // Not a degenerate case: a member denied every number still joins the
    // company topic and works (realtimeTopics below).
    expect(numberTopicKey([])).toBe("");
  });

  it("is the same key for the same set in a different order", () => {
    // THE reason this is a string and not the array. Every /v1/me refetch hands
    // back a fresh array, and the socket effect depends on this value — if the
    // key moved with the server's row order, a routine poll would tear the whole
    // socket down and rebuild it.
    expect(numberTopicKey([{ id: "n2" }, { id: "n1" }, { id: "n3" }])).toBe(
      numberTopicKey([{ id: "n1" }, { id: "n3" }, { id: "n2" }]),
    );
  });

  it("changes when the set changes", () => {
    const before = numberTopicKey([{ id: "n1" }, { id: "n2" }]);
    expect(numberTopicKey([{ id: "n1" }])).not.toBe(before);
    expect(numberTopicKey([{ id: "n1" }, { id: "n2" }, { id: "n3" }])).not.toBe(
      before,
    );
  });

  it("takes the rows verbatim — no second opinion on access or status", () => {
    // The company view is already access-filtered server-side, and a number
    // being suspended or failed to provision says nothing about whether its
    // events may be received. Anything dropped here would be this file deciding
    // access a second time, which is the drift D88 exists to prevent.
    const numbers = [
      { id: "active", status: "active" },
      { id: "failed", status: "provision_failed" },
      { id: "suspended", status: "active", suspended_at: "2026-07-30T00:00:00Z" },
    ];
    expect(numberTopicKey(numbers)).toBe("active,failed,suspended");
  });
});

describe("realtimeTopics", () => {
  it("joins the company topic alone when there is no visible number", () => {
    expect(realtimeTopics(COMPANY, "")).toEqual([`company:${COMPANY}`]);
  });

  it("builds the per-number topic exactly as the server publishes it", () => {
    // Character-for-character `broadcast_number_scoped`
    // (supabase/migrations/20260730040000_number_scoped_topics.sql) and the
    // shape `is_company_topic_member` authorizes. A typo here is silent: the
    // join is simply refused and that number goes quiet.
    expect(realtimeTopics(COMPANY, "n1")).toEqual([
      `company:${COMPANY}`,
      `company:${COMPANY}:number:n1`,
    ]);
  });

  it("keeps the company topic alongside every per-number topic", () => {
    // The company topic is never traded away for the per-number ones. It carries
    // registration.updated, read.notifications and access.changed, and it is the
    // ONLY route for call.updated on a call whose number was deleted —
    // calls.phone_number_id is `on delete set null`, so that event has no
    // per-number topic to arrive on (D88 addendum).
    expect(realtimeTopics(COMPANY, "n1,n2")).toEqual([
      `company:${COMPANY}`,
      `company:${COMPANY}:number:n1`,
      `company:${COMPANY}:number:n2`,
    ]);
  });

  it("composes with numberTopicKey with no ids lost or invented", () => {
    const numbers = [{ id: "b" }, { id: "a" }];
    const topics = realtimeTopics(COMPANY, numberTopicKey(numbers));
    expect(topics).toHaveLength(numbers.length + 1);
    expect(new Set(topics).size).toBe(topics.length);
    for (const { id } of numbers) {
      expect(topics).toContain(`company:${COMPANY}:number:${id}`);
    }
  });
});

/**
 * A PREMISE of the provider, not our code: the subscription set now changes at
 * runtime, so the socket effect tears the company topic down and re-opens it
 * under the same name in a single React commit.
 *
 * That is only safe because `removeChannel` drops the channel from the client's
 * registry synchronously. `client.channel(topic)` hands back the EXISTING
 * channel for a topic it still holds, and `subscribe()` is a no-op on a channel
 * that is not closed — so if the removal ever became asynchronous, a rebuild
 * would register a second set of handlers on the dying channel and leave the
 * company topic silently dead for the rest of the session. Asserted here so a
 * supabase-js upgrade that changes it fails a test instead of the inbox.
 */
describe("realtime-js remove-then-reopen (premise)", () => {
  /** Neither of these is in the public types; the premise is about them anyway. */
  type ChannelInternals = { channelAdapter: { state: string } };
  type SocketInternals = {
    socketAdapter: { isConnected: () => boolean; push: (data: unknown) => void };
  };

  it("frees the topic name synchronously, so the rebuild gets a fresh channel", () => {
    const client = createClient("https://project.supabase.co", "anon-key");
    const first = client.channel(`company:${COMPANY}`, {
      config: { private: true },
    });
    // Put the channel in the state a LIVE one is in when the effect rebuilds:
    // joined, on a connected socket. That is the case where a leave could
    // plausibly wait for the server's ack, so testing a never-subscribed channel
    // would prove the easy half only.
    (first as unknown as ChannelInternals).channelAdapter.state = "joined";
    const socket = (client.realtime as unknown as SocketInternals).socketAdapter;
    socket.isConnected = () => true;
    socket.push = () => {};

    void client.removeChannel(first); // exactly what the effect cleanup does

    expect(client.realtime.getChannels()).toHaveLength(0);
    const second = client.channel(`company:${COMPANY}`, {
      config: { private: true },
    });
    expect(second).not.toBe(first);
  });
});
