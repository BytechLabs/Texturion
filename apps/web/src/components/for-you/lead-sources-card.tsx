"use client";

/**
 * #301 — where these customers came from, on the home surface.
 *
 * # What this has to achieve
 *
 * "Where do my customers come from?" is the question every small-business
 * owner asks and almost none can answer, and it is the one with the most money
 * attached: a contractor spending $2,000 a month with no idea which half works
 * is the normal case. This panel is the answer, and it has to be an answer
 * somebody can act on rather than a chart.
 *
 * *Applying: Meaningful Highlights & Context — the leading source is the
 * headline, in words, and the table sits under it. An owner does not act on a
 * bar chart; they act on "most of your work came from the truck this month".*
 *
 * *Applying: Chunking — the top four sources, then everything else folded into
 * one row. A list of eleven channels is a list nobody reads to the bottom.*
 *
 * # The coverage line is the most important thing on this card
 *
 * #301's fourth Acceptance line is "reporting distinguishes attributed from
 * unknown, and never infers silently", and this panel is where that either
 * happens or does not. A ranking built on a third of the conversations could
 * be reordered completely by the other two thirds, and an owner acting on it
 * would be spending real money on an artefact.
 *
 * So the unknown count is a ROW in the table rather than a footnote, and the
 * server's `note` prints above everything when coverage is thin. Both come
 * from the API rather than being computed here, so a phone and a laptop cannot
 * disagree about how much of this to believe.
 *
 * # It disappears when there is nothing true to say
 *
 * Not a zero state and not an encouraging placeholder: a workspace with no
 * conversations in the window is told nothing, and one with no sources set up
 * gets a single sentence about how to start rather than a table of one row
 * reading "unknown: 40", which is a scolding rather than a finding.
 */
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { useT, type Translate } from "@/i18n/provider";
import { useLeadSourceReport, type LeadSourceReport } from "@/lib/api/reports";

/** How many sources get their own row before the rest are folded together. */
const TOP_N = 4;

/**
 * The headline, in words, or null when no honest one exists.
 *
 * Silent when the leading source is under a third of the attributed work: at
 * that point "most of your work came from X" is simply false, and the table
 * says it better than a sentence would.
 */
export function leadingSentence(
  report: LeadSourceReport,
  t: Translate,
): string | null {
  const top = report.sources[0];
  if (!top) return null;
  const attributed = report.total - report.unknown;
  if (attributed === 0) return null;
  const share = top.total / attributed;
  if (share < 0.34) return null;
  return t("inbox.leadSourcesLeading", {
    name: top.name,
    count: top.total,
    total: attributed,
  });
}

/** The rows to render: the top few, then everything else as one. */
export function visibleRows(
  report: LeadSourceReport,
  t: Translate,
): { name: string; total: number }[] {
  const rows = report.sources
    .slice(0, TOP_N)
    .map((source) => ({ name: source.name, total: source.total }));
  const rest = report.sources.slice(TOP_N);
  if (rest.length > 0) {
    rows.push({
      name: t("inbox.leadSourcesMore", { count: rest.length }),
      total: rest.reduce((sum, source) => sum + source.total, 0),
    });
  }
  return rows;
}

export function LeadSourcesCard() {
  const t = useT();
  const report = useLeadSourceReport(30);

  if (report.isLoading) {
    return <Skeleton className="h-32 w-full rounded-xl" />;
  }
  const data = report.data;
  // Nothing happened this month. Silence, not a zero.
  if (!data || data.total === 0) return null;

  // Sources exist as a feature but this workspace has set none up, so every
  // conversation is unknown. One sentence about how to start beats a table
  // whose only row is a reproach.
  if (data.sources.length === 0) {
    return (
      // #540: the same micro-header as the populated branch and as the other
      // three measures. BOTH branches need it — patching only the one with data
      // is how a row lines up in a screenshot taken on a busy workspace and
      // stays ragged on the empty one every new crew actually sees first.
      <section>
        <h2 className="flex items-baseline justify-between gap-2 px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted-2">
          <span className="flex items-baseline gap-2">
            {t("inbox.leadSourcesTitle")}
          </span>
        </h2>
        <div className="overflow-hidden rounded-app-card border border-app-line bg-app-paper p-4">
        <p className="text-sm text-muted-foreground">
          {t("inbox.leadSourcesNoneSetUp")}
        </p>
        <Link
          href="/settings/numbers"
          className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {t("inbox.leadSourcesSetOneUp")}
          <ArrowRight className="size-3.5" />
        </Link>
        </div>
      </section>
    );
  }

  const headline = leadingSentence(data, t);
  const rows = visibleRows(data, t);
  const max = Math.max(...rows.map((row) => row.total), data.unknown, 1);

  return (
    // #540: the same micro-header as the other three measures, so the four card
    // tops line up. See pipeline-card.tsx for why the row's alignment is the
    // point rather than a detail.
    <section>
      <h2 className="flex items-baseline justify-between gap-2 px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-app-muted-2">
        <span className="flex items-baseline gap-2">
          {t("inbox.leadSourcesTitle")}
        </span>
      </h2>
      <div className="overflow-hidden rounded-app-card border border-app-line bg-app-paper p-4">
      {headline && <p className="text-sm">{headline}</p>}
      {data.note && (
        <p
          role="status"
          className="mt-2 rounded-md border border-border-subtle bg-accent/40 px-3 py-2 text-xs"
        >
          {data.note}
        </p>
      )}

      <ul className="mt-3 space-y-1.5">
        {rows.map((row) => (
          <Row key={row.name} name={row.name} total={row.total} max={max} />
        ))}
        {data.unknown > 0 && (
          // A ROW, never a footnote. Left in the same list and the same scale
          // as the sources, because that is the only presentation in which an
          // owner can see it competing with them.
          <Row
            name={t("inbox.leadSourcesUnknown")}
            total={data.unknown}
            max={max}
            muted
          />
        )}
      </ul>

      <p className="mt-3 text-xs text-muted-foreground">
        {t(
          data.total === 1
            ? "inbox.leadSourcesFooterOne"
            : "inbox.leadSourcesFooterMany",
          { count: data.total },
        )}
      </p>
      </div>
    </section>
  );
}

function Row({
  name,
  total,
  max,
  muted = false,
}: {
  name: string;
  total: number;
  max: number;
  muted?: boolean;
}) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={
          "min-w-[7rem] truncate text-sm " + (muted ? "text-muted-foreground" : "")
        }
      >
        {name}
      </span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-accent/60">
        <span
          className={"block h-full rounded-full " + (muted ? "bg-muted-foreground/40" : "bg-primary/70")}
          style={{ width: `${Math.round((total / max) * 100)}%` }}
        />
      </span>
      <span className="w-8 text-right text-sm tabular-nums">{total}</span>
    </li>
  );
}
