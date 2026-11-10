"use client";

import { Ban } from "lucide-react";

import {
  LoadError,
  SettingsCard,
  SettingsPage,
} from "@/components/settings/section";
import { useMemberNames } from "@/components/inbox/member-avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/provider";
import { useBlockedSenders, useUnblockSender } from "@/lib/api/blocked-senders";
import { ApiError } from "@/lib/api/error";
import { formatPhone } from "@/lib/format/phone";
import { formatRelativeTime } from "@/lib/format/time";
import { toast } from "sonner";

/**
 * Settings → Blocked numbers: every number this workspace sends straight to
 * spam, who blocked it and when. A back-office list, web only, like the other
 * settings lists; the phones block and unblock from the thread and the contact.
 */
export default function BlockedNumbersPage() {
  const t = useT();
  const list = useBlockedSenders();
  const unblock = useUnblockSender();
  const memberNames = useMemberNames();

  const rows = list.data?.data ?? [];

  return (
    <SettingsPage
      title={t("blockedNumbers.title")}
      description={t("blockedNumbers.intro")}
    >
      {list.isError ? (
        <LoadError
          message={t("blockedNumbers.loadFailed")}
          onRetry={() => void list.refetch()}
        />
      ) : list.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : rows.length === 0 ? (
        <SettingsCard title={t("blockedNumbers.empty")}>
          <p className="text-sm text-muted-foreground">
            {t("blockedNumbers.emptyBody")}
          </p>
        </SettingsCard>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {rows.map((row) => {
            const who = row.blocked_by
              ? (memberNames.get(row.blocked_by) ?? t("blockedNumbers.teammate"))
              : null;
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <Ban
                  className="size-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium tabular-nums">
                    {formatPhone(row.phone_e164)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {who
                      ? t("blockedNumbers.blockedBy", { name: who })
                      : t("blockedNumbers.blockedByUnknown")}
                    {" · "}
                    {formatRelativeTime(row.created_at, new Date(), t)}
                  </p>
                  {row.reason && (
                    <p className="text-xs text-muted-foreground">
                      {t("blockedNumbers.reason", { reason: row.reason })}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={unblock.isPending}
                  aria-label={t("blockedNumbers.unblockRowAria", {
                    number: formatPhone(row.phone_e164),
                  })}
                  onClick={() =>
                    unblock.mutate(row.id, {
                      onSuccess: () => toast.success(t("blockedNumbers.unblocked")),
                      onError: (e) =>
                        toast.error(
                          e instanceof ApiError
                            ? e.message
                            : t("blockedNumbers.unblockFailed"),
                        ),
                    })
                  }
                >
                  {t("blockedNumbers.unblockRowAction")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsPage>
  );
}
