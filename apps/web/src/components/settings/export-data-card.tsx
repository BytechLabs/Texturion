"use client";

import { Download } from "lucide-react";
import { toast } from "sonner";

import { SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDataExports, useRequestDataExport } from "@/lib/api/exports";
import { ApiError } from "@/lib/api/error";
import type { DataExport } from "@/lib/api/types";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/format/time";

/**
 * #227 — taking a copy of your workspace.
 *
 * PIPEDA and Quebec Law 25 both carry a portability right; before this it
 * existed on our privacy page and nowhere else. The build happens on a cron,
 * so the screen's job is to be honest about a thing that is not instant: say
 * it is being made, say when it is ready, and say plainly if it failed rather
 * than leaving someone refreshing a page forever.
 */
export function ExportDataCard() {
  const exports = useDataExports();
  const request = useRequestDataExport();

  const rows = exports.data?.data ?? [];
  const building = rows.find(
    (row) => row.status === "pending" || row.status === "running",
  );
  const latestReady = rows.find((row) => row.status === "ready");
  const latestFailed = rows.find((row) => row.status === "failed");

  return (
    <SettingsCard
      title="Export your data"
      description="A copy of everything in this workspace, in a format you can load somewhere else."
    >
      <div className="space-y-4 p-4 pt-0">
        <p className="text-sm text-muted-foreground">
          Contacts, conversations, messages, tasks, call history and voicemail
          transcripts, saved replies, tags and opt-outs. Photos and recordings
          are listed with where they live and how big they are, rather than
          copied.
        </p>

        {exports.isPending ? (
          <Skeleton className="h-9 w-40" />
        ) : building ? (
          <p className="text-sm">
            Building your export. It usually takes a few minutes, and we&apos;ll
            email you when it&apos;s ready — you can close this page.
          </p>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              request.mutate(undefined, {
                onSuccess: (result) =>
                  toast.success(
                    result.already_building
                      ? "One is already being built."
                      : "We're building your export. We'll email you when it's ready.",
                  ),
                onError: (cause) =>
                  toast.error(
                    cause instanceof ApiError
                      ? cause.message
                      : "Couldn't start the export. Try again in a moment.",
                  ),
              })
            }
            disabled={request.isPending}
          >
            {request.isPending ? "Starting…" : "Export my data"}
          </Button>
        )}

        {latestFailed && !building && (
          <p className="text-sm text-destructive">
            The last export didn&apos;t finish{" "}
            {formatRelativeTime(latestFailed.requested_at)}. Try again, and if
            it keeps failing let us know.
          </p>
        )}

        {latestReady && <ReadyExport row={latestReady} />}
      </div>
    </SettingsCard>
  );
}

/**
 * A finished export. The row counts are shown because they are the receipt:
 * they let someone tell a complete export from a truncated one without opening
 * every file.
 */
function ReadyExport({ row }: { row: DataExport }) {
  const total = Object.values(row.row_counts).reduce(
    (sum, count) => sum + count,
    0,
  );
  const expired = row.files.length === 0;

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {/* Labelled rather than "Export from <time>": a just-finished export
            renders that as "Export from now", which reads as a typo. */}
        <p className="text-sm font-medium">Latest export</p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {total.toLocaleString()} records ·{" "}
          <time
            dateTime={row.completed_at ?? row.requested_at}
            title={formatAbsoluteDateTime(row.completed_at ?? row.requested_at)}
          >
            {formatRelativeTime(row.completed_at ?? row.requested_at)}
          </time>
        </p>
      </div>

      {expired ? (
        <p className="text-sm text-muted-foreground">
          The download links have expired and the copy has been deleted. Ask for
          a fresh one above.
        </p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-2">
            {row.files.map((file) => (
              <li key={file.name}>
                <a
                  href={file.url}
                  download={file.name}
                  className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors duration-150 ease-out hover:bg-accent"
                >
                  <Download className="size-3" strokeWidth={1.75} aria-hidden />
                  {file.name}
                </a>
              </li>
            ))}
          </ul>
          {row.expires_at && (
            <p className="text-xs text-muted-foreground">
              These links work until{" "}
              {formatAbsoluteDateTime(row.expires_at)}, then the copy is
              deleted.
            </p>
          )}
        </>
      )}
    </div>
  );
}
