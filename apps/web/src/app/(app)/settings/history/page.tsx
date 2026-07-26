"use client";

import { Download, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuditLog, type AuditLogFilters } from "@/lib/api/audit-log";
import { getApiBaseUrl } from "@/lib/api/client";
import { useMembers } from "@/lib/api/team";
import type { AuditEntry } from "@/lib/api/types";
import { useCompanyId } from "@/lib/company/provider";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/format/time";
import {
  auditActor,
  auditSentence,
  AUDIT_ACTION_LABELS,
} from "@/lib/settings/audit-sentence";
import { getAccessToken } from "@/lib/supabase/browser";

/** Everyone / all actions. Sentinel values, since a Select cannot hold "". */
const ANY = "any";

/**
 * Smart default rather than an empty form: a month is the window an owner
 * almost always wants, and it keeps the first query bounded. Widening is one
 * field away.
 */
function defaultSince(): string {
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return from.toISOString().slice(0, 10);
}

function toIsoStart(day: string): string | undefined {
  return day ? new Date(`${day}T00:00:00`).toISOString() : undefined;
}

function toIsoEnd(day: string): string | undefined {
  if (!day) return undefined;
  const end = new Date(`${day}T00:00:00`);
  end.setDate(end.getDate() + 1); // the filter is exclusive on `until`
  return end.toISOString();
}

/**
 * /settings/history (#231) — who changed what in this workspace.
 *
 * The one screen an owner opens after something went wrong, so it answers in
 * sentences, not identifiers: "Sam removed a member from the workspace",
 * with the raw change one click away for whoever needs it. Filter by person,
 * by kind of change, and by date; export the window as CSV for an insurer or
 * a security questionnaire.
 *
 * Owner/admin only — the API enforces it, and a member's request 403s.
 */
export default function HistorySettingsPage() {
  const companyId = useCompanyId();
  const members = useMembers();
  const [actor, setActor] = useState<string>(ANY);
  const [action, setAction] = useState<string>(ANY);
  const [since, setSince] = useState<string>(defaultSince);
  const [until, setUntil] = useState<string>("");
  const [exporting, setExporting] = useState(false);

  const filters: AuditLogFilters = useMemo(
    () => ({
      actor: actor === ANY ? undefined : actor,
      action: action === ANY ? undefined : action,
      since: toIsoStart(since),
      until: toIsoEnd(until),
    }),
    [actor, action, since, until],
  );

  const log = useAuditLog(filters);
  const entries = useMemo(
    () => log.data?.pages.flatMap((page) => page.data) ?? [],
    [log.data],
  );

  async function exportCsv() {
    setExporting(true);
    try {
      const url = new URL(`${getApiBaseUrl()}/v1/audit-log`);
      url.searchParams.set("format", "csv");
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
      const token = await getAccessToken();
      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token ?? ""}`,
          "X-Company-Id": companyId,
        },
      });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "workspace-history.csv";
      anchor.click();
      URL.revokeObjectURL(href);
    } catch {
      toast.error("Couldn't export the history. Try again in a moment.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <SettingsPage
      title="History"
      description="Every change to your workspace — who made it, and when."
    >
      <SettingsCard>
        {/* Filters: tightly grouped (one job), separated from the list below. */}
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="history-actor">Person</Label>
            <Select value={actor} onValueChange={setActor}>
              <SelectTrigger id="history-actor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Everyone</SelectItem>
                {(members.data?.data ?? []).map((member) => (
                  <SelectItem key={member.user_id} value={member.user_id}>
                    {member.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="history-action">Change</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger id="history-action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Everything</SelectItem>
                {Object.entries(AUDIT_ACTION_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="history-since">From</Label>
            <Input
              id="history-since"
              type="date"
              value={since}
              onChange={(event) => setSince(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="history-until">To</Label>
            <Input
              id="history-until"
              type="date"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Kept for 12 months. This record cannot be edited, by anyone.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void exportCsv()}
            disabled={exporting || entries.length === 0}
          >
            <Download className="size-4" strokeWidth={1.75} aria-hidden />
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </SettingsCard>

      {log.isError ? (
        <LoadError onRetry={() => void log.refetch()} />
      ) : log.isPending ? (
        <SettingsCard>
          <div className="space-y-3 p-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-3/5" />
          </div>
        </SettingsCard>
      ) : entries.length === 0 ? (
        <SettingsCard>
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <ShieldCheck
              className="size-6 text-muted-foreground"
              strokeWidth={1.5}
              aria-hidden
            />
            <p className="text-sm font-medium">Nothing in this window</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Changes to your team, your numbers and your settings show up here
              as they happen. Widen the dates to look further back.
            </p>
          </div>
        </SettingsCard>
      ) : (
        <SettingsCard>
          <ul className="divide-y">
            {entries.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} />
            ))}
          </ul>
          {log.hasNextPage && (
            <div className="border-t p-3 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void log.fetchNextPage()}
                disabled={log.isFetchingNextPage}
              >
                {log.isFetchingNextPage ? "Loading…" : "Show older"}
              </Button>
            </div>
          )}
        </SettingsCard>
      )}
    </SettingsPage>
  );
}

/**
 * One change. The sentence carries the meaning; the raw before/after is
 * folded away for the one reader in a hundred who needs to see exactly what
 * the field held.
 */
function HistoryRow({ entry }: { entry: AuditEntry }) {
  const hasDetail =
    Object.keys(entry.before).length > 0 || Object.keys(entry.after).length > 0;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[15px] leading-snug">{auditSentence(entry)}</p>
        <time
          dateTime={entry.occurred_at}
          title={formatAbsoluteDateTime(entry.occurred_at)}
          className="shrink-0 text-xs tabular-nums text-muted-foreground"
        >
          {formatRelativeTime(entry.occurred_at)}
        </time>
      </div>
      {hasDetail && (
        <details className="mt-1.5">
          <summary className="cursor-pointer list-none text-xs text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground">
            Details
          </summary>
          <dl className="mt-2 grid gap-1 text-xs text-muted-foreground">
            <div className="flex gap-2">
              <dt className="w-16 shrink-0">By</dt>
              <dd>
                {auditActor(entry)}
                {entry.actor_ip ? ` · ${entry.actor_ip}` : ""}
              </dd>
            </div>
            {Object.keys(entry.before).length > 0 && (
              <div className="flex gap-2">
                <dt className="w-16 shrink-0">Was</dt>
                <dd className="break-all font-mono">
                  {JSON.stringify(entry.before)}
                </dd>
              </div>
            )}
            {Object.keys(entry.after).length > 0 && (
              <div className="flex gap-2">
                <dt className="w-16 shrink-0">Now</dt>
                <dd className="break-all font-mono">
                  {JSON.stringify(entry.after)}
                </dd>
              </div>
            )}
          </dl>
        </details>
      )}
    </li>
  );
}
