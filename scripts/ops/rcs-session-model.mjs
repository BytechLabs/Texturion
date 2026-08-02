/**
 * [#450] Does RCS Conversational's session billing beat per-segment SMS, for
 * the way THIS product is actually used?
 *
 *   node scripts/ops/rcs-session-model.mjs
 *   node scripts/ops/rcs-session-model.mjs --days 180
 *
 * Read-only, so there is no --apply.
 *
 * ---------------------------------------------------------------------------
 * THE QUESTION, AND WHY IT IS ONE NUMBER
 *
 * SMS bills per segment. RCS Conversational bills per 24-HOUR SESSION —
 * unlimited exchanges inside it — at roughly twice a single SMS. So the entire
 * business case reduces to one quantity: how many outbound segments do we send
 * inside a typical 24-hour window of one conversation?
 *
 *   segments per session  <  the RCS multiplier  →  RCS costs MORE
 *   segments per session  >  the RCS multiplier  →  RCS costs LESS
 *
 * #450 states this plainly: "If the median conversation is 3 segments, session
 * billing is a loss; if it is 10, it is a large win. That single number decides
 * this." This computes the number rather than arguing about it.
 *
 * ---------------------------------------------------------------------------
 * WHAT A SESSION IS HERE
 *
 * A rolling 24 hours per conversation, opened by the first message and closed
 * exactly 24 hours later, then the next message opens the next one. NOT a
 * calendar day: bucketing by date would split an evening exchange across
 * midnight into two sessions, which understates how much a session covers and
 * therefore biases the answer AGAINST RCS. The rolling window is what the
 * carriers actually bill, and it is barely more code.
 *
 * Only sessions containing at least one OUTBOUND message count. A 24 hours in
 * which a customer texted us and nobody replied costs nothing under either
 * model, and counting it would drag the average down with windows neither
 * scheme charges for.
 *
 * The SMS side counts what we are BILLED, not what we sent: the quantity comes
 * from `usage_events`, which is the row Stripe is metered from and which
 * carries 3 for an MMS. `messages.segments` is the carrier's part count and
 * stands in only where no usage row exists — a message that never finalized,
 * which was never billed either.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS REFUSES TO DO
 *
 * The same refusal `retention-report.mjs` makes, for the same reason. A mean
 * computed from forty sessions is not evidence about a messaging channel, and
 * #450's own devil's advocate warns that RCS "sounds strategic and consumes a
 * quarter". So the verdict is WITHHELD below a session floor rather than
 * printed with a caveat somebody reads past. A number you are told not to
 * trust still anchors you; a number you are not shown cannot.
 *
 * It also refuses to name a single break-even. The multiplier is vendor
 * pricing we do not have yet — that is the Telnyx question in #373 — so the
 * output is a table across plausible multipliers. Whatever number comes back,
 * the answer is read off rather than recomputed.
 *
 * ---------------------------------------------------------------------------
 * THE MULTIPLIER CAME BACK, AND IT DOES NOT EXIST — 2026-08-02
 *
 * Telnyx does not sell RCS by the session. Their published messaging pricing
 * states, in its own words, that "RCS Rich text messages are charged per
 * segment" and "RCS Rich Media is charged per message"; the words "session",
 * "conversational" and "24-hour" do not appear on the page at all.
 *
 * So the premise this whole script models — unlimited exchanges inside one
 * 24-hour charge — is not on offer from our provider, and no value of
 * MULTIPLIERS below describes a price anybody can buy. See VENDOR-QUESTIONS.md
 * R5 for the figures and the rest of the finding.
 *
 * The script is kept, and still runs, for two honest reasons: the segments-per-
 * session distribution is a real fact about how this product is used, and if a
 * provider ever does offer session billing the model is already written. The
 * banner it now prints exists so nobody re-runs it, reads the break-even table,
 * and believes it is describing a purchasable price.
 */
import { runScript } from "./lib.mjs";

/** How much of the past to read, in days. */
const DEFAULT_DAYS = 90;

/** The billing window RCS Conversational uses. */
const SESSION_MS = 24 * 60 * 60 * 1000;

/**
 * Fewest billable sessions before a verdict is printed at all.
 *
 * Not a statistical threshold, a judgement: below this the answer is one
 * chatty customer, and #450 would be decided by an accident of who signed up.
 */
const THIN_BELOW = 200;

/** The multipliers to report against, since the real one is not known yet. */
const MULTIPLIERS = [1.5, 2, 2.5, 3, 4];

/** PostgREST page size. */
const PAGE = 1000;

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

/**
 * Every message in the window, oldest first.
 *
 * Notes are excluded at the source: an internal note is not a message anybody
 * is billed for, and counting it would inflate the session length that decides
 * this.
 */
async function readAll(db, table, select, where) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await db.select(table, select, {
      ...where,
      limit: String(PAGE),
      offset: String(offset),
    });
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

async function readMessages(db, sinceIso) {
  return readAll(db, "messages", "id,conversation_id,direction,segments,created_at", {
    created_at: `gte.${sinceIso}`,
    direction: "in.(inbound,outbound)",
    order: "created_at.asc",
  });
}

/**
 * What each outbound message actually cost us, in billed segments.
 *
 * `usage_events` is the row Stripe is metered from, so it is the only honest
 * answer to "what did this cost" — and it is where an MMS carries 3 rather
 * than the 1 part the carrier reports.
 */
async function readBilledQuantities(db, sinceIso) {
  const rows = await readAll(db, "usage_events", "message_id,quantity", {
    created_at: `gte.${sinceIso}`,
    message_id: "not.is.null",
    order: "created_at.asc",
  });
  const byMessage = new Map();
  for (const row of rows) byMessage.set(row.message_id, Number(row.quantity ?? 0));
  return byMessage;
}

/**
 * Fold messages into rolling 24-hour sessions per conversation.
 *
 * Returns one entry per BILLABLE session: how many outbound segments it
 * carried, and how many messages of both directions it covered.
 */
export function foldSessions(messages, billed = new Map()) {
  const byConversation = new Map();
  for (const message of messages) {
    const list = byConversation.get(message.conversation_id) ?? [];
    list.push(message);
    byConversation.set(message.conversation_id, list);
  }

  const sessions = [];
  for (const list of byConversation.values()) {
    list.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    let openedAt = null;
    let current = null;
    for (const message of list) {
      const at = Date.parse(message.created_at);
      if (current === null || at - openedAt >= SESSION_MS) {
        if (current !== null && current.outboundSegments > 0) sessions.push(current);
        openedAt = at;
        current = { outboundSegments: 0, messages: 0, outboundMessages: 0 };
      }
      current.messages += 1;
      if (message.direction === "outbound") {
        current.outboundMessages += 1;
        // The billed quantity when there is one, the carrier's part count
        // otherwise. A message with neither never finalized (queued, or failed
        // before send) and was never billed, so it contributes nothing —
        // counting it as one would charge us for something we were not.
        current.outboundSegments += billed.has(message.id)
          ? billed.get(message.id)
          : Number(message.segments ?? 0);
      }
    }
    if (current !== null && current.outboundSegments > 0) sessions.push(current);
  }
  return sessions;
}

function bar(count, max, width = 28) {
  if (max === 0) return "";
  return "#".repeat(Math.max(1, Math.round((count / max) * width)));
}

await runScript("rcs-session-model", async ({ args, db }) => {
  const days = Number(args.days ?? DEFAULT_DAYS);
  if (!Number.isFinite(days) || days < 1) {
    throw new Error("--days must be a positive number of days.");
  }
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();

  const messages = await readMessages(db, sinceIso);
  const billed = await readBilledQuantities(db, sinceIso);
  const sessions = foldSessions(messages, billed);

  const segmentCounts = sessions.map((session) => session.outboundSegments);
  const totalSegments = segmentCounts.reduce((sum, n) => sum + n, 0);
  const mean = sessions.length === 0 ? 0 : totalSegments / sessions.length;

  console.log(`  RCS Conversational vs per-segment SMS (#450)`);
  console.log(`  Window:   last ${days} days (since ${sinceIso.slice(0, 10)})`);
  console.log(`  Messages: ${messages.length} (inbound + outbound, notes excluded)`);
  console.log(`  Sessions: ${sessions.length} billable 24h windows`);
  console.log("");

  if (sessions.length === 0) {
    console.log("  No billable sessions in this window. Nothing to model.\n");
    return;
  }

  console.log(`  Outbound segments per session`);
  console.log(`    mean      ${mean.toFixed(2)}`);
  console.log(`    median    ${median(segmentCounts).toFixed(2)}`);
  console.log(`    p75       ${percentile(segmentCounts, 75)}`);
  console.log(`    p90       ${percentile(segmentCounts, 90)}`);
  console.log(`    max       ${Math.max(...segmentCounts)}`);
  console.log("");

  // The shape matters as much as the average: a mean of 4 built from mostly-1
  // sessions and a few 40s is a different business case from a mean of 4 built
  // from sessions that are all 3 to 5.
  const buckets = new Map();
  for (const count of segmentCounts) {
    const key = count >= 10 ? "10+" : String(count);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const ordered = [...Array(10).keys()].map(String).concat("10+");
  const maxBucket = Math.max(...[...buckets.values()]);
  console.log(`  Distribution`);
  for (const key of ordered) {
    const count = buckets.get(key) ?? 0;
    if (count === 0) continue;
    const share = ((count / sessions.length) * 100).toFixed(1);
    console.log(
      `    ${key.padStart(3)} segs  ${String(count).padStart(6)}  ${share.padStart(5)}%  ${bar(count, maxBucket)}`,
    );
  }
  console.log("");

  if (sessions.length < THIN_BELOW) {
    // Withheld, not caveated. See the header.
    console.log(
      `  VERDICT WITHHELD. ${sessions.length} sessions is below the ${THIN_BELOW} this\n` +
        `  script will decide on. The distribution above is real and worth\n` +
        `  reading; the mean is not yet evidence about a messaging channel, and\n` +
        `  #450 is explicit that a misleading number would be worse than none.\n` +
        `  Re-run when there is more traffic.\n`,
    );
    return;
  }

  console.log(`  Break-even against the RCS session price`);
  console.log(`  (multiplier = one RCS session priced as N single SMS segments)`);
  console.log(
    `  HYPOTHETICAL: Telnyx bills RCS per SEGMENT, not per session (R5,\n` +
      `  2026-08-02). No multiplier below is a price we can actually buy.`,
  );
  console.log("");
  for (const multiplier of MULTIPLIERS) {
    const rcsCost = sessions.length * multiplier;
    const delta = ((rcsCost - totalSegments) / totalSegments) * 100;
    const verdict = delta < 0 ? `RCS CHEAPER by ${(-delta).toFixed(0)}%` : `RCS dearer by ${delta.toFixed(0)}%`;
    console.log(`    ${multiplier.toFixed(1)}x   ${verdict}`);
  }
  console.log("");
  console.log(
    `  Read it off: RCS would win whenever a session price sits below\n` +
      `  ${mean.toFixed(2)}x a single SMS segment. Telnyx sells no such price — RCS\n` +
      `  Rich text is per segment there, so every exchange bills every message\n` +
      `  exactly as SMS does. This table applies only to a provider that\n` +
      `  offers session billing (VENDOR-QUESTIONS.md R5).\n`,
  );
}, { readOnly: true });
