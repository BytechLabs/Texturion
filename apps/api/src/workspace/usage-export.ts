/**
 * #304 — what a bookkeeper needs beside the Stripe invoice.
 *
 * ── WHAT THIS IS, AND WHAT IT REFUSES TO BE ───────────────────────────────
 *
 * The issue asks for "a usage and billing export for a period that reconciles
 * to the Stripe invoice". It cannot reconcile to the invoice, and saying so is
 * the whole design:
 *
 * - We persist NO Stripe invoice lines. `handleInvoicePaid` flips a
 *   registration flag; there is no invoice table and no stripe_invoice_id
 *   anywhere. Nothing built from our data can restate one.
 * - We persist NO plan history. `companies.plan` is the plan in force now.
 *   Pricing a closed month would mean applying today's plan to a period the
 *   workspace may have been on a different one.
 *
 * A bookkeeper who ties out to a number that is nearly right makes decisions
 * on it, so this export prices nothing. It reports COUNTS — which is precisely
 * what the invoice cannot already tell them, the issue's own "the detail
 * behind it lives in the product with no way out". Money is what the invoice
 * already does say.
 *
 * ── THE ONE THING IT ADDS THAT NOBODY ELSE HAS ────────────────────────────
 *
 * `usage_events.stripe_reported_at` records whether each metered row has been
 * handed to Stripe. Segments metered inside the window but not yet reported
 * are on NO invoice and will land on a later one. That gap is the single
 * biggest reason a careful bookkeeper's total disagrees with Stripe's, and it
 * is otherwise invisible from either side.
 *
 * ── WHAT IT NAMES RATHER THAN OMITS ───────────────────────────────────────
 *
 * Storage is a STOCK, not a flow — api_storage_usage is a point-in-time total,
 * so it is labelled "as of now" rather than folded into the window. Inbound is
 * labelled never-billed. And the document lists what Stripe's invoice contains
 * that this does not, because a reader comparing two totals needs to know
 * which lines exist on only one side before they start looking for an error.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { readUsageWindow } from "../billing/usage-window";
import { storedBytes, type StorageUsageRow } from "../billing/stored-bytes";
import { csvSafeText, serializeCsv } from "../routes/core/csv";

export interface UsageExportFilters {
  /** Inclusive start of the window, ISO. */
  from?: string;
  /** Inclusive end, ISO. Absent means the period is still running. */
  to?: string;
}

export interface UsageExportArgs {
  exportId: string;
  companyId: string;
  filters: UsageExportFilters;
  prefix: string;
  now: Date;
}

/** One reported figure: what it is, the number, and what it does NOT mean. */
export interface UsageLine {
  label: string;
  value: string;
  note: string;
}

/**
 * The lines a bookkeeper reads, in the order they read them.
 *
 * Every line carries its own caveat rather than deferring to a footnote,
 * because the figure and the reason it might not match are read together or
 * not at all.
 */
export function usageLines(args: {
  outboundSegments: number;
  reportedSegments: number;
  unreportedSegments: number;
  inboundSegments: number;
  voiceSeconds: number;
  storageBytes: number;
}): UsageLine[] {
  return [
    {
      label: "Text segments sent",
      value: String(args.outboundSegments),
      note:
        "The billed measure. A long text is more than one segment, and a " +
        "picture message counts as three.",
    },
    {
      label: "— of those, reported to Stripe",
      value: String(args.reportedSegments),
      note: "Already handed over, so already on an invoice or on its way to one.",
    },
    {
      label: "— of those, not yet reported",
      value: String(args.unreportedSegments),
      note:
        args.unreportedSegments === 0
          ? "Everything in this window has been reported."
          : "On no invoice yet. These land on a later one, and this is the " +
            "most likely reason a total here is higher than Stripe's.",
    },
    {
      label: "Text segments received",
      value: String(args.inboundSegments),
      note: "Never billed. Shown so the volume is visible, not because it is charged.",
    },
    {
      label: "Call minutes",
      value: String(Math.floor(args.voiceSeconds / 60)),
      note:
        "Calls this workspace dialled — forwarded legs and outbound calls. " +
        "Someone ringing in is paid for by their own carrier, not by this " +
        "workspace.",
    },
    {
      label: "Files stored (bytes), as of now",
      value: String(args.storageBytes),
      note:
        "A running total, not a figure for this window: it is what is stored " +
        "today, including files from before the period and excluding anything " +
        "deleted since.",
    },
  ];
}

/**
 * What Stripe's invoice has that this document does not.
 *
 * Listed explicitly because the first thing a careful reader does with two
 * totals is look for their own mistake. These are the legitimate differences,
 * and naming them is the difference between a useful artifact and one that
 * starts a support thread.
 */
export const NOT_ON_THIS_DOCUMENT = [
  "The monthly plan charge, and any extra phone numbers.",
  "Tax.",
  "Credits, refunds and proration from a plan change mid-period.",
  "Anything metered after this window closed, including the unreported " +
    "segments above once they are handed over.",
];

export async function buildUsageExport(
  db: SupabaseClient,
  args: UsageExportArgs,
  put: (path: string, body: string, contentType: string) => Promise<void>,
): Promise<{ segments: number; partial: boolean }> {
  // The window's start is required by the caller; an absent one would mean
  // "since the beginning of time", which is a different document and not one
  // anybody asked for.
  const from = args.filters.from;
  if (!from) {
    throw new Error("a usage export needs a period start");
  }
  const to = args.filters.to ?? null;

  const totals = await readUsageWindow(db, args.companyId, { from, to });

  // A stock, read separately and labelled as such. It deliberately does not go
  // through the window reader: no amount of date filtering makes a
  // point-in-time total into a figure for a past month.
  const { data: storageRow, error: storageError } = await db.rpc(
    "api_storage_usage",
    { p_company_id: args.companyId },
  );
  if (storageError) {
    throw new Error(`usage export storage read failed: ${storageError.message}`);
  }
  const storageBytes = storedBytes(storageRow as StorageUsageRow);

  const lines = usageLines({ ...totals, storageBytes });
  const generatedAt = args.now.toISOString();

  await put(
    `${args.prefix}/usage.html`,
    renderUsageDocument({ from, to, lines, generatedAt }),
    "text/html; charset=utf-8",
  );
  await put(
    `${args.prefix}/usage.csv`,
    serializeCsv([
      ["measure", "value", "what it does not mean"],
      ...lines.map((line) => [
        csvSafeText(line.label),
        line.value,
        csvSafeText(line.note),
      ]),
    ]),
    "text/csv; charset=utf-8",
  );

  return {
    segments: totals.outboundSegments,
    // Unreported segments mean the window's own figure is not final. Saying so
    // in the receipt keeps the "was this whole?" question answerable from the
    // export row alone, without reopening the file.
    partial: totals.unreportedSegments > 0,
  };
}

/** HTML-escape. Nothing here is user-written, but the shell is shared. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderUsageDocument(args: {
  from: string;
  to: string | null;
  lines: UsageLine[];
  generatedAt: string;
}): string {
  const period =
    args.to === null
      ? `From ${args.from} — this period has not finished yet`
      : `${args.from} to ${args.to}`;

  const rows = args.lines
    .map(
      (line) => `    <tr>
      <td class="label">${escapeHtml(line.label)}</td>
      <td class="value">${escapeHtml(line.value)}</td>
      <td class="note">${escapeHtml(line.note)}</td>
    </tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Usage — ${escapeHtml(period)}</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 32px; color: #1a1a1a; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 24px 0 8px; }
  .meta { color: #656565; margin-bottom: 20px; }
  .note-box { border-left: 3px solid #656565; padding: 8px 12px; margin: 12px 0;
              background: #f3f3f3; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid #e0e0e0; padding: 6px 8px;
           vertical-align: top; text-align: left; }
  .label { width: 18em; }
  .value { width: 8em; text-align: right; font-variant-numeric: tabular-nums; }
  .note { color: #656565; }
  ul { margin: 8px 0; padding-left: 20px; }
</style>
</head>
<body>
<h1>Usage</h1>
<p class="meta">${escapeHtml(period)} · produced ${escapeHtml(args.generatedAt)}</p>
<p class="note-box">This is what we measured. It is not a copy of the Stripe
invoice and the two are not expected to match line for line — see what is not
on this document, below.</p>
<table>
  <thead><tr><th>Measure</th><th>Count</th><th>What it does not mean</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
<h2>What is not on this document</h2>
<ul>
${NOT_ON_THIS_DOCUMENT.map((item) => `  <li>${escapeHtml(item)}</li>`).join("\n")}
</ul>
<p class="note-box">Nothing here is priced. The plan a workspace was on during
a period that has already closed is not something this product keeps, so
applying today's rates to it would produce a number that looks authoritative
and is not. The invoice is where the money is.</p>
</body>
</html>
`;
}
