/**
 * #714: every route that changes a contact, task, conversation or call records
 * its event in record_activity, and this test is what keeps that true.
 *
 * It reads the route files as TEXT, lists every mutating route (post, patch,
 * put, delete), and requires each one to be classified here as one of
 *
 *   - "records"         the handler (or a helper it calls) writes through
 *                       `recordActivity` / `recordActivityForPhone`;
 *   - "trigger:<name>"  the change is a write to a table whose
 *                       `record_activity_from_<name>` trigger records it, which
 *                       is checked against the migrations;
 *   - "none:<why>"      the route does not change one of the four records (a
 *                       personal preference, a workspace-level vocabulary, a
 *                       read that happens to be a POST), with the reason.
 *
 * A new mutating route that is not in the table fails, so adding one is a
 * decision somebody writes down. A "records" route whose write was removed
 * fails. A table entry for a route that no longer exists fails, so the table
 * cannot go stale.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTES = join(HERE, "..", "routes");
const MIGRATIONS = join(HERE, "..", "..", "..", "..", "supabase", "migrations");

const WRITERS = [
  "recordActivity(",
  "recordActivityForPhone(",
  "recordBulkTagActivity(",
  "recordBulkConversationActivity(",
];

type Classification = "records" | `trigger:${string}` | `none:${string}`;

const PREFERENCE = "none:a per-member preference, not a change to the record";
const AI = "none:an AI read or cache; nothing a member changed";
const SETTINGS = "none:workspace settings or vocabulary, not a record";

/** Keyed `file#METHOD path`. */
const CLASSIFIED: Record<string, Classification> = {
  // ---- contacts ----------------------------------------------------------
  "contacts#POST /contacts": "trigger:contacts",
  "contacts#PATCH /contacts/:id": "trigger:contacts",
  "contacts#DELETE /contacts/:id": "trigger:contacts",
  "contacts#POST /contacts/import": "trigger:contacts",
  "contacts#POST /contacts/import-vcard": "trigger:contacts",
  "contacts#POST /contacts/:id/opt-out": "trigger:conversation_events",
  "contacts#POST /contacts/:id/opt-out/revoke": "trigger:conversation_events",
  "contacts#DELETE /contacts/:id/opt-out": "trigger:conversation_events",
  "contacts#POST /contacts/:id/merge": "trigger:contacts",
  "contacts#POST /contacts/:id/unmerge": "trigger:contacts",
  "contacts#POST /contacts/:id/tags": "records",
  "contacts#DELETE /contacts/:id/tags/:tag_id": "records",
  "contacts#POST /contacts/bulk": "records",
  "contacts#POST /contacts/:id/phones": "records",
  "contacts#DELETE /contacts/:id/phones/:phoneId": "records",
  "contacts#POST /contacts/:id/addresses": "records",
  "contacts#PATCH /contacts/:id/addresses/:addressId": "records",
  "contacts#DELETE /contacts/:id/addresses/:addressId": "records",
  "contacts#PUT /contact-fields": SETTINGS,
  "contact#POST /contact": "trigger:messages",
  // ---- conversations -----------------------------------------------------
  "conversations#POST /conversations/bulk": "records",
  "conversations#PATCH /conversations/:id": "trigger:conversation_events",
  "conversations#POST /conversations/:id/notes": "records",
  "conversations#POST /ai/outcome": AI,
  "conversations#POST /conversations/:id/reply-suggestions": AI,
  "conversations#POST /conversations/:id/summary": AI,
  "conversations#POST /conversations/:id/wrap-up-transcript": AI,
  "conversations#POST /conversations/:id/read": PREFERENCE,
  "conversations#DELETE /conversations/:id/read": PREFERENCE,
  "conversations#POST /conversations/:id/snooze": PREFERENCE,
  "conversations#DELETE /conversations/:id/snooze": PREFERENCE,
  "conversations#PUT /conversations/:id/mute": PREFERENCE,
  "conversations#DELETE /conversations/:id/mute": PREFERENCE,
  "conversations#PUT /conversations/:id/follow": PREFERENCE,
  "conversations#DELETE /conversations/:id/follow": PREFERENCE,
  "conversations#POST /conversations/:id/tags": "trigger:conversation_events",
  "conversations#DELETE /conversations/:id/tags/:tag_id": "trigger:conversation_events",
  "compose#POST /conversations": "trigger:messages",
  // ---- messages, scheduled texts, blocks ---------------------------------
  "messages#POST /messages/send": "trigger:messages",
  "messages#POST /messages/:id/retry": "trigger:messages",
  "messages#PATCH /messages/:id": "trigger:task_events",
  "scheduled-messages#POST /scheduled-messages": "trigger:scheduled_messages",
  "scheduled-messages#PATCH /scheduled-messages/:id": "trigger:scheduled_messages",
  "scheduled-messages#DELETE /scheduled-messages/:id": "trigger:scheduled_messages",
  "blocked-senders#POST /blocked-senders": "trigger:blocked_senders",
  "blocked-senders#DELETE /blocked-senders/:id": "records",
  // ---- trash -------------------------------------------------------------
  "trash#DELETE /messages/:id":
    "none:a message is not one of the four records; the read hides its text row while it is in the Trash",
  "trash#DELETE /conversations/:id": "trigger:conversations_trash",
  "trash#POST /conversations/delete": "trigger:conversations_trash",
  "trash#DELETE /calls/:id/voicemail":
    "none:removes the recording; the call itself and its activity row stay",
  "trash#DELETE /calls/:id": "trigger:calls_trash",
  "trash#POST /trash/restore": "trigger:conversations_trash",
  "trash#DELETE /trash/:kind/:id":
    "none:a permanent purge erases rows; the activity of a purged task is blanked by api_purge_trash_item",
  // ---- calls -------------------------------------------------------------
  "calls#POST /calls/browser": "trigger:calls",
  "live-calls#POST /calls/live/decline-mine": "trigger:calls",
  "live-calls#POST /calls/live/:sessionId/transfer": "trigger:calls",
  "live-calls#POST /calls/live/:sessionId/consult": "trigger:calls",
  "live-calls#POST /calls/live/:sessionId/consult/complete": "trigger:calls",
  "live-calls#POST /calls/live/:sessionId/consult/cancel": "trigger:calls",
  "live-calls#POST /calls/live/:sessionId/ring-me": "trigger:calls",
  "live-calls#POST /calls/live/:sessionId/decline": "trigger:calls",
  // ---- tasks -------------------------------------------------------------
  "tasks#POST /tasks": "trigger:task_events",
  "tasks#POST /tasks/enrich": AI,
  "tasks#POST /tasks/bulk": "trigger:task_events",
  "tasks#PATCH /tasks/:id": "trigger:task_events",
  "tasks#POST /tasks/:id/tags": "trigger:task_events",
  "tasks#DELETE /tasks/:id/tags/:tag_id": "trigger:task_events",
  "tasks#PUT /tasks/:id/reminders": "trigger:task_events",
  "tasks#DELETE /tasks/:id": "trigger:task_events",
  "task-activity#POST /tasks/:id/comments": "records",
  "task-activity#PATCH /tasks/:id/comments/:commentId":
    "none:a comment is its own record in the task feed; naming a teammate is recorded when it is posted",
  "task-activity#DELETE /tasks/:id/comments/:commentId":
    "none:a comment is its own record in the task feed",
  "task-activity#POST /tasks/:id/subscription": PREFERENCE,
  "task-activity#DELETE /tasks/:id/subscription": PREFERENCE,
  "task-references#POST /tasks/:id/links": "trigger:task_events",
  "task-references#DELETE /tasks/:id/links/:otherId": "trigger:task_events",
  // ---- tags (the workspace vocabulary) -----------------------------------
  "tags#PATCH /tags/:id": SETTINGS,
  "tags#DELETE /tags/:id": SETTINGS,
  "tags#POST /tags/:id/merge": SETTINGS,
  // ---- the public API ----------------------------------------------------
  "public-api#POST ${PUBLIC_API_BASE}/contacts": "trigger:contacts",
  "public-api#POST ${PUBLIC_API_BASE}/messages": "trigger:messages",
  "public-api#POST ${PUBLIC_API_BASE}/tasks": "trigger:task_events",
  "public-api#POST ${PUBLIC_API_BASE}/webhooks": SETTINGS,
  "public-api#DELETE ${PUBLIC_API_BASE}/webhooks/:id": SETTINGS,
};

interface RouteText {
  key: string;
  body: string;
}

const REGISTRATION =
  /\b[A-Za-z]+Routes\.(post|patch|put|delete)\(\s*[`"]([^`"]+)[`"]/g;

function routesOf(file: string): RouteText[] {
  const source = readFileSync(join(ROUTES, `${file}.ts`), "utf8");
  const found = [...source.matchAll(REGISTRATION)];
  return found.map((match, index) => {
    const end = found[index + 1]?.index ?? source.length;
    return {
      key: `${file}#${match[1].toUpperCase()} ${match[2]}`,
      body: source.slice(match.index, end),
    };
  });
}

const FILES = [...new Set(Object.keys(CLASSIFIED).map((key) => key.split("#")[0]))];

function triggers(): string {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(join(MIGRATIONS, name), "utf8"))
    .join("\n");
}

/** Every route a handler registers, as the guard sees it. */
export function listedRoutes(): RouteText[] {
  return FILES.flatMap(routesOf);
}

describe("record_activity guard (#714)", () => {
  const routes = listedRoutes();

  it("reads a believable number of routes", () => {
    // A parser that silently matched nothing would pass everything below.
    expect(routes.length).toBeGreaterThan(70);
  });

  it("classifies every mutating route of the four record types", () => {
    const missing = routes.map((r) => r.key).filter((key) => !(key in CLASSIFIED));
    expect(
      missing,
      `Unclassified mutating routes. Record an activity event for each (apps/api/src/activity/record.ts), or add it to CLASSIFIED with the trigger that records it or the reason it changes none of a contact, task, conversation or call:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("has no entry for a route that no longer exists", () => {
    const present = new Set(routes.map((r) => r.key));
    const stale = Object.keys(CLASSIFIED).filter((key) => !present.has(key));
    expect(stale).toEqual([]);
  });

  it("requires a route classified as 'records' to write an activity event", () => {
    const silent = routes
      .filter((r) => CLASSIFIED[r.key] === "records")
      .filter((r) => !WRITERS.some((writer) => r.body.includes(writer)))
      .map((r) => r.key);
    expect(silent, `Routes that record nothing:\n${silent.join("\n")}`).toEqual([]);
  });

  it("requires every trigger a route relies on to exist in the migrations", () => {
    const sql = triggers();
    const named = new Set(
      Object.values(CLASSIFIED)
        .filter((c): c is `trigger:${string}` => c.startsWith("trigger:"))
        .map((c) => c.slice("trigger:".length)),
    );
    const absent = [...named].filter(
      (name) => !sql.includes(`create trigger record_activity_from_${name}\n`),
    );
    expect(absent, `Missing record_activity_from_<name> triggers:\n${absent.join("\n")}`).toEqual([]);
  });

  it("gives every 'none' a reason", () => {
    const bare = Object.entries(CLASSIFIED).filter(
      ([, c]) => c.startsWith("none:") && c.length < 12,
    );
    expect(bare).toEqual([]);
  });
});
