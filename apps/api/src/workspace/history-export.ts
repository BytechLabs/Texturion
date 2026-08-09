import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveNumberAccess } from "../auth/number-access";
import type { MemberRole } from "@loonext/shared";
import { csvSafeText, serializeCsv } from "../routes/core/csv";

/**
 * #304 — one customer's message history, as something you can hand to somebody.
 *
 * The case the issue opens with: a dispute or an insurance claim needs the
 * texts with one customer over a date range, it is time-sensitive, and the
 * current answer is screenshots. The #227 privacy dump does not answer it —
 * that is every row the workspace holds, in JSONL, driven by a legal right.
 *
 * ── THE THREE DECISIONS IN HERE ───────────────────────────────────────────
 *
 * 1. HTML, not PDF. A lawyer or an adjuster will not read a CSV, so there has
 *    to be a document — but a PDF generator is a dependency and a per-render
 *    cost inside a Worker, for a file every browser can already produce from
 *    HTML with Print → Save as PDF. The CSV ships beside it for the bookkeeper.
 *
 * 2. ACCESS IS RESOLVED AT BUILD TIME, from the requester's role NOW. #304
 *    names this as the easiest place in the product to leak a number by
 *    accident, "because export code paths tend to bypass the list-view
 *    filters". Somebody who could see a number last week and cannot today does
 *    not get it in a file produced today.
 *
 * 3. IT SAYS WHAT IT LEFT OUT. An export silently missing the messages on a
 *    number the requester cannot see is a document somebody puts in front of an
 *    adjuster believing it is complete. If anything was withheld, the document
 *    says so, in the document.
 */

/** What the request asked for, as stored on `data_exports.filters`. */
export interface HistoryFilters {
  contact_id?: string;
  /** ISO instants. Absent means from the beginning / until now. */
  from?: string;
  to?: string;
}

interface ConversationRow {
  id: string;
  phone_number_id: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  direction: string;
  body: string | null;
  status: string | null;
  created_at: string;
}

interface CallRow {
  id: string;
  conversation_id: string | null;
  direction: string;
  outcome: string | null;
  voicemail_transcript: string | null;
  started_at: string;
}

/**
 * A message or a call, as the document reads them.
 *
 * ONE CHRONOLOGY, not two files. #304 asks for a call and voicemail export
 * "with the same filters", and the obvious reading is a second document — but
 * the person this is for is following a conversation with a PERSON. A call at
 * two o'clock sitting between two texts is part of the story, and handing an
 * adjuster two files to interleave by hand is handing them the work.
 */
interface Entry {
  at: string;
  kind: "message" | "call";
  who: string;
  what: string;
}

/** One page of messages per round trip. */
const PAGE = 500;

/**
 * A ceiling on one document.
 *
 * A thread with forty thousand messages is not a document anybody reads, and
 * building it is a Worker timeout and a cost event (#251). The cap is stated in
 * the file rather than enforced silently: a truncated history handed to an
 * adjuster as if it were whole is the failure this whole feature exists to
 * avoid.
 */
export const HISTORY_MESSAGE_CAP = 5000;

export interface HistoryResult {
  messages: number;
  /** True when the cap or an access rule kept something out of the file. */
  partial: boolean;
}

export async function buildConversationHistory(
  db: SupabaseClient,
  args: {
    exportId: string;
    companyId: string;
    requestedBy: string;
    filters: HistoryFilters;
    prefix: string;
    now: Date;
  },
  putObject: (path: string, body: string, contentType: string) => Promise<void>,
): Promise<HistoryResult> {
  const contactId = args.filters.contact_id;
  if (!contactId) throw new Error("conversation_history export has no contact_id");

  // The requester's role NOW. Read rather than trusted from the request: an
  // export produced today is read today, and access is a question about today.
  const { data: member, error: memberError } = await db
    .from("company_members")
    .select("role")
    .eq("company_id", args.companyId)
    .eq("user_id", args.requestedBy)
    // #581/C14: ACTIVE. Removing somebody sets `deactivated_at` and never deletes the
    // row — history keeps its attribution, and `team.ts` says so at the offboarding
    // itself — so without this the lookup happily finds the membership of a member who
    // was removed an hour ago, and the export below is built with their old role. The
    // branch beneath, whose comment says "they left", could not fire for the one case it
    // was written for: leaving does not remove the row.
    .is("deactivated_at", null)
    .maybeSingle();
  if (memberError) {
    throw new Error(`history export role read failed: ${memberError.message}`);
  }
  if (!member) {
    // They left. An export they asked for is not a reason to hand their old
    // workspace's messages to whoever collects the link.
    throw new Error("the member who requested this export is no longer in the workspace");
  }

  const access = await resolveNumberAccess(db, {
    companyId: args.companyId,
    userId: args.requestedBy,
    role: (member as { role: string }).role as MemberRole,
  });

  const { data: contactRows, error: contactError } = await db
    .from("contacts")
    .select("id,name,phone_e164")
    .eq("company_id", args.companyId)
    .eq("id", contactId)
    .limit(1);
  if (contactError) {
    throw new Error(`history export contact read failed: ${contactError.message}`);
  }
  const contact = (contactRows ?? [])[0] as
    | { id: string; name: string | null; phone_e164: string }
    | undefined;
  if (!contact) throw new Error("history export: no such contact");

  // Every thread with this customer, then the ones the requester may see.
  const { data: convRows, error: convError } = await db
    .from("conversations")
    .select("id,phone_number_id")
    .eq("company_id", args.companyId)
    .eq("contact_id", contactId);
  if (convError) {
    throw new Error(`history export conversation read failed: ${convError.message}`);
  }
  const conversations = (convRows ?? []) as ConversationRow[];
  const hidden = new Set(access.hiddenNumberIds ?? []);
  const visible = conversations.filter(
    (row) => !(row.phone_number_id !== null && hidden.has(row.phone_number_id)),
  );
  // #106: withheld, and SAID so below. A document quietly missing a thread is
  // worse than one that names the gap.
  const withheldThreads = conversations.length - visible.length;
  // Calls kept out for the same reason, counted separately: a customer whose
  // texts are all visible but whose calls came in on a restricted line would
  // otherwise produce a document that looks complete.
  let withheldCalls = 0;

  const messages: MessageRow[] = [];
  let capped = false;
  for (const conversation of visible) {
    for (let page = 0; ; page += 1) {
      let query = db
        .from("messages")
        .select("id,conversation_id,direction,body,status,created_at")
        .eq("company_id", args.companyId)
        .eq("conversation_id", conversation.id);
      if (args.filters.from) query = query.gte("created_at", args.filters.from);
      if (args.filters.to) query = query.lte("created_at", args.filters.to);
      const { data, error } = await query
        .order("created_at", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) {
        throw new Error(`history export message read failed: ${error.message}`);
      }
      const rows = (data ?? []) as unknown as MessageRow[];
      messages.push(...rows);
      if (messages.length >= HISTORY_MESSAGE_CAP) {
        capped = true;
        break;
      }
      if (rows.length < PAGE) break;
    }
    if (capped) break;
  }

  // The calls, read the same way and through the same access rule: by the
  // conversations already filtered above, so there is one place where "may
  // this person see it" is decided rather than two that can disagree.
  const visibleIds = new Set(visible.map((row) => row.id));
  const calls: CallRow[] = [];
  if (!capped) {
    let query = db
      .from("calls")
      .select("id,conversation_id,direction,outcome,voicemail_transcript,started_at")
      .eq("company_id", args.companyId)
      .eq("contact_id", contactId);
    if (args.filters.from) query = query.gte("started_at", args.filters.from);
    if (args.filters.to) query = query.lte("started_at", args.filters.to);
    const { data, error } = await query.order("started_at", { ascending: true });
    if (error) {
      throw new Error(`history export call read failed: ${error.message}`);
    }
    for (const call of (data ?? []) as unknown as CallRow[]) {
      // A call whose thread this person cannot see, or which never threaded at
      // all, is not in the file — and is counted, so the document says a gap
      // exists rather than quietly having one.
      if (call.conversation_id !== null && visibleIds.has(call.conversation_id)) {
        calls.push(call);
      } else {
        withheldCalls += 1;
      }
    }
  }

  // One chronology across every thread and both kinds, because the reader is
  // following a conversation with a person, not with a phone line.
  const entries: Entry[] = [
    ...messages.map((row) => ({
      at: row.created_at,
      kind: "message" as const,
      who: row.direction === "inbound" ? "Customer" : "Us",
      what: row.body ?? "",
    })),
    ...calls.map((row) => ({
      at: row.started_at,
      kind: "call" as const,
      who: row.direction === "inbound" ? "Customer called" : "We called",
      // The transcript IS the content of a voicemail; without it the row says
      // only that somebody rang, which an adjuster cannot use.
      what: row.voicemail_transcript?.trim()
        ? `Voicemail: ${row.voicemail_transcript.trim()}`
        : callOutcome(row.outcome),
    })),
  ];
  entries.sort((a, b) => a.at.localeCompare(b.at));
  const included = entries.slice(0, HISTORY_MESSAGE_CAP);

  await putObject(
    `${args.prefix}/history.html`,
    renderHistoryDocument({
      contactName: contact.name,
      contactPhone: contact.phone_e164,
      from: args.filters.from ?? null,
      to: args.filters.to ?? null,
      generatedAt: args.now.toISOString(),
      entries: included,
      withheldThreads,
      withheldCalls,
      capped,
    }),
    "text/html; charset=utf-8",
  );

  await putObject(
    `${args.prefix}/history.csv`,
    serializeCsv([
      ["at", "kind", "who", "what"],
      ...included.map((row) => [
        row.at,
        row.kind,
        row.who,
        // The same injection guard the contacts export uses. A body beginning
        // "=" is a formula in a spreadsheet, and these bodies are written by
        // strangers.
        csvSafeText(row.what),
      ]),
    ]),
    "text/csv; charset=utf-8",
  );

  return {
    messages: included.length,
    partial: capped || withheldThreads > 0 || withheldCalls > 0,
  };
}

/**
 * What a call without a voicemail says.
 *
 * The raw outcome is a database word. A document read by somebody outside this
 * company should say what happened in the words they would use.
 */
function callOutcome(outcome: string | null): string {
  switch (outcome) {
    case "answered": return "Call — answered";
    case "missed": return "Call — missed";
    case "voicemail": return "Call — went to voicemail, nothing recorded";
    default: return "Call";
  }
}

/** HTML-escape. The bodies are written by people outside the workspace. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The document.
 *
 * Deliberately plain: no script, no external stylesheet, no image. It has to
 * open on a court clerk's machine and print the same way it looks, and every
 * one of those things is a way for it not to.
 */
export function renderHistoryDocument(args: {
  contactName: string | null;
  contactPhone: string;
  from: string | null;
  to: string | null;
  generatedAt: string;
  entries: Entry[];
  withheldThreads: number;
  withheldCalls: number;
  capped: boolean;
}): string {
  const who = args.contactName?.trim()
    ? `${args.contactName.trim()} (${args.contactPhone})`
    : args.contactPhone;
  const period =
    args.from || args.to
      ? `${args.from ?? "the beginning"} to ${args.to ?? "now"}`
      : "the whole history";

  // Said in the document, not in an email beside it. The document is what gets
  // forwarded, printed and filed; a caveat that does not travel with it is a
  // caveat nobody reads.
  const notes: string[] = [];
  if (args.withheldThreads > 0) {
    notes.push(
      `${args.withheldThreads} conversation${args.withheldThreads === 1 ? "" : "s"} ` +
        `with this customer ${args.withheldThreads === 1 ? "is" : "are"} on a phone ` +
        `number the person who requested this export cannot see, and ${args.withheldThreads === 1 ? "is" : "are"} ` +
        `not included.`,
    );
  }
  if (args.withheldCalls > 0) {
    notes.push(
      `${args.withheldCalls} call${args.withheldCalls === 1 ? "" : "s"} with ` +
        `this customer ${args.withheldCalls === 1 ? "is" : "are"} not included: ` +
        `${args.withheldCalls === 1 ? "it came" : "they came"} in on a phone ` +
        `number the person who requested this export cannot see, or on no ` +
        `thread at all.`,
    );
  }
  if (args.capped) {
    notes.push(
      `This history is longer than ${HISTORY_MESSAGE_CAP} messages. The oldest ` +
        `${HISTORY_MESSAGE_CAP} in the period are included; narrow the dates for the rest.`,
    );
  }

  const rows = args.entries
    .map(
      (row) => `    <tr>
      <td class="when">${escapeHtml(row.at)}</td>
      <td class="who">${escapeHtml(row.who)}</td>
      <td class="body">${escapeHtml(row.what)}</td>
    </tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Message history — ${escapeHtml(who)}</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 32px; color: #1a1a1a; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #656565; margin-bottom: 20px; }
  .note { border-left: 3px solid #656565; padding: 8px 12px; margin: 12px 0;
          background: #f3f3f3; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid #e0e0e0; padding: 6px 8px;
           vertical-align: top; text-align: left; }
  .when { white-space: nowrap; color: #656565; width: 12em; }
  .who { white-space: nowrap; width: 6em; }
  .body { white-space: pre-wrap; }
</style>
</head>
<body>
<h1>Message history — ${escapeHtml(who)}</h1>
<p class="meta">${escapeHtml(period)} · ${args.entries.length} entr${
    args.entries.length === 1 ? "y" : "ies"
  }${
    ""
  } · produced ${escapeHtml(args.generatedAt)}</p>
${notes.map((note) => `<p class="note">${escapeHtml(note)}</p>`).join("\n")}
<table>
  <thead><tr><th>When</th><th>Who</th><th>Message</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
</body>
</html>
`;
}
