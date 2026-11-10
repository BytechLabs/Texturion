"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import { SettingsCard, SettingsPage } from "@/components/settings/section";
import { TrashList } from "@/components/settings/trash-list";
import { useT } from "@/i18n/provider";
import { useCanDeleteRecords } from "@/lib/hooks/use-records-delete";

/**
 * /settings/history/trash (#691) — deleted conversations, messages, calls and
 * voicemails, restorable for 30 days.
 *
 * It lives under History because that section already means "who changed what,
 * and the safety net behind it", and the section-access map keys on the first
 * path segment, so it inherits History's owner/admin gate with no new section
 * id. The page asks for records.delete on top, because that is what the API
 * requires of every call it makes.
 */
export default function TrashSettingsPage() {
  const t = useT();
  const canDelete = useCanDeleteRecords();

  return (
    <SettingsPage title={t("trash.title")} description={t("trash.description")}>
      <Link
        href="/settings/history"
        className="-mt-4 inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
      >
        <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        {t("settingsMore.navHistory")}
      </Link>
      {canDelete ? (
        <TrashList />
      ) : (
        <SettingsCard>
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t("trash.noAccess")}
          </p>
        </SettingsCard>
      )}
    </SettingsPage>
  );
}
