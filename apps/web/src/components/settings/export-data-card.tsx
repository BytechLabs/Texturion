"use client";

import { Download } from "lucide-react";
import { toast } from "sonner";

import { SettingsCard } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/provider";
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
  const t = useT();
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
      title={t("settings.exportDataTitle")}
      description={t("settings.exportDataDescription")}
    >
      <div className="space-y-4 p-4 pt-0">
        <p className="text-sm text-muted-foreground">
          {t("settings.exportDataContents")}
        </p>

        {exports.isPending ? (
          <Skeleton className="h-9 w-40" />
        ) : building ? (
          <p className="text-sm">{t("settings.exportDataBuilding")}</p>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              request.mutate(undefined, {
                onSuccess: (result) =>
                  toast.success(
                    result.already_building
                      ? t("settings.exportDataAlready")
                      : t("settings.exportDataStarted"),
                  ),
                onError: (cause) =>
                  toast.error(
                    cause instanceof ApiError
                      ? cause.message
                      : t("settings.exportDataStartFailed"),
                  ),
              })
            }
            disabled={request.isPending}
          >
            {request.isPending
              ? t("settings.exportDataStarting")
              : t("settings.exportDataAction")}
          </Button>
        )}

        {latestFailed && !building && (
          <p className="text-sm text-destructive">
            {t("settings.exportDataFailed", {
              when: formatRelativeTime(latestFailed.requested_at),
            })}
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
  const t = useT();
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
        <p className="text-sm font-medium">{t("settings.exportDataLatest")}</p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {t("settings.exportDataRecords", { count: total.toLocaleString() })} ·{" "}
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
          {t("settings.exportDataExpired")}
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
              {t("settings.exportDataLinksExpire", {
                when: formatAbsoluteDateTime(row.expires_at),
              })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
