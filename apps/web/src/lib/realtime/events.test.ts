import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  messageStatusPatch,
  PAYMENT_EVENT_TYPES,
  REALTIME_EVENTS,
  type MessageStatusEvent,
} from "./events";

describe("messageStatusPatch", () => {
  it("always carries the delivery status (null for notes)", () => {
    expect(messageStatusPatch({ message_id: "m1", status: "delivered" })).toEqual(
      { status: "delivered" },
    );
    expect(messageStatusPatch({ message_id: "m1", status: null })).toEqual({
      status: null,
    });
  });

  it("applies the D14 done fields when the payload carries them", () => {
    const event: MessageStatusEvent = {
      message_id: "m1",
      status: "received",
      done_at: "2026-07-04T10:00:00Z",
      done_by_user_id: "u1",
    };
    expect(messageStatusPatch(event)).toEqual({
      status: "received",
      done_at: "2026-07-04T10:00:00Z",
      done_by_user_id: "u1",
    });
  });

  it("applies the #3 pin fields when the payload carries them", () => {
    const event: MessageStatusEvent = {
      message_id: "m1",
      status: "received",
      pinned_at: "2026-07-04T11:00:00Z",
      pinned_by_user_id: "u2",
    };
    expect(messageStatusPatch(event)).toEqual({
      status: "received",
      pinned_at: "2026-07-04T11:00:00Z",
      pinned_by_user_id: "u2",
    });
  });

  it("carries an explicit clear (null) for done/pin when present in the payload", () => {
    const event: MessageStatusEvent = {
      message_id: "m1",
      status: "received",
      done_at: null,
      done_by_user_id: null,
      pinned_at: null,
      pinned_by_user_id: null,
    };
    expect(messageStatusPatch(event)).toEqual({
      status: "received",
      done_at: null,
      done_by_user_id: null,
      pinned_at: null,
      pinned_by_user_id: null,
    });
  });

  it("omits done/pin keys entirely when absent, so an old payload never wipes local state", () => {
    // A pre-migration payload with only the delivery status must NOT introduce
    // done_at/pinned_at keys (which would overwrite live done/pin state with
    // undefined→null on merge).
    const patch = messageStatusPatch({ message_id: "m1", status: "sent" });
    expect(patch).toEqual({ status: "sent" });
    expect("done_at" in patch).toBe(false);
    expect("pinned_at" in patch).toBe(false);
  });
});

/**
 * #607 A6 — `PAYMENT_EVENT_TYPES` had no consumer, so nothing could tell it was
 * wrong.
 *
 * `handlePaymentUpdated` deliberately ignores `event.type` (all three outcomes
 * want the same refetch), which left the list read by exactly one thing: the
 * test that iterates it. A list iterated only by its own test is checked
 * against itself — deleting `"payment_refunded"` from it left both files green.
 *
 * ## Why the migration and not a second hand-written list
 *
 * The set is DECIDED by the trigger's `when (...)` clause. A hand-written copy
 * here would be a third vocabulary, which is the shape this repo has already
 * been burned by (#548/#554): it agrees with itself while disagreeing with the
 * database. So the answer is read out of the file that ships — the same choice
 * `scripts/check-conversation-events.mjs` makes, and for the same reason.
 *
 * ## Why LATEST rather than "exactly one"
 *
 * Rule 5 says an amendment to `broadcast_payment_change` is a second
 * `create or replace` migration, and there are now two files touching it. A
 * guard demanding exactly one definition fails the day somebody does the right
 * thing — that is the A5 finding, live on Android as this is written. So this
 * takes the LAST file in sort order that creates the TRIGGER, since that is
 * what decides the set.
 */
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");
const MIGRATIONS = join(REPO_ROOT, "supabase/migrations");

/** The event name on the wire, as the trigger publishes it. */
const PAYMENT_EVENT = "payment.updated";

function triggerMigration(): { name: string; sql: string } {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  let found: { name: string; sql: string } | null = null;
  for (const name of files) {
    // Comments stripped FIRST. These migrations argue about the scope in prose
    // directly above the statement, quoting labels they deliberately do not
    // include, and a parser that read those would report a set the database
    // never had.
    const sql = readFileSync(join(MIGRATIONS, name), "utf8").replace(
      /--[^\n]*/g,
      "",
    );
    if (/create\s+trigger[\s\S]*?broadcast_payment_change\s*\(\s*\)/i.test(sql)) {
      found = { name, sql };
    }
  }
  if (!found) {
    throw new Error(
      "No migration creates a trigger on broadcast_payment_change. This guard " +
        "is reading nothing, which is worse than not running.",
    );
  }
  return found;
}

describe("the payment broadcast vocabulary", () => {
  it("found the trigger, so a passing run means something", () => {
    // The failure mode of every filesystem-derived check: a path that silently
    // reads nothing makes each assertion below vacuously true.
    const { sql } = triggerMigration();
    expect(sql).toContain("conversation_events");
    expect(sql).toContain(PAYMENT_EVENT);
  });

  it("is the exact set the trigger publishes, both directions", () => {
    const { name, sql } = triggerMigration();
    // The `when (...)` clause of the create-trigger statement, and only that —
    // the function body above it names `conversation_event_type` values in its
    // own casts.
    const when = /create\s+trigger[\s\S]*?\bwhen\s*\(([\s\S]*?)\)\s*execute/i.exec(
      sql,
    );
    expect(when, `no WHEN clause in ${name}`).not.toBeNull();
    const published = [
      ...new Set([...when![1].matchAll(/'([a-z0-9_]+)'/gi)].map((m) => m[1])),
    ].sort();
    const listed = [...PAYMENT_EVENT_TYPES].sort();

    // Set equality, stated in both directions so a failure says which one it
    // is. A missing label is a broadcast this client believes it never
    // receives; an extra one is a promise the database does not keep.
    expect(
      published,
      `${name} publishes labels PAYMENT_EVENT_TYPES does not list`,
    ).toEqual(listed);
    expect(
      listed,
      `PAYMENT_EVENT_TYPES lists labels ${name} does not publish`,
    ).toEqual(published);
  });

  it("names the event the trigger actually sends", () => {
    // The other half of the contract, and one an earlier client got wrong in
    // exactly this shape: a listener for `task.updated`, which nothing
    // broadcasts, and rows that simply never refreshed.
    const { sql } = triggerMigration();
    expect(REALTIME_EVENTS).toContain(PAYMENT_EVENT);
    expect(sql).toContain(`'${PAYMENT_EVENT}'`);
  });
});
