"use client";

import { SettingsCard } from "@/components/settings/section";
import { TrashList } from "@/components/settings/trash-list";
import { PageHeader } from "@/components/ui/page-header";
import { useT } from "@/i18n/provider";
import { useCanDeleteRecords } from "@/lib/hooks/use-records-delete";

/**
 * #735: the Trash, one step from anywhere. Deleted conversations, messages,
 * calls, contacts and tasks wait here for 30 days, then are purged. It used to
 * live under Settings › History, where nobody looking for something they had
 * just deleted would think to look.
 */
export default function TrashPage() {
  const t = useT();
  const canDelete = useCanDeleteRecords();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 md:px-6">
      <PageHeader title={t("trash.title")} description={t("trash.description")} />
      {canDelete ? (
        <TrashList />
      ) : (
        <SettingsCard>
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t("trash.noAccess")}
          </p>
        </SettingsCard>
      )}
    </div>
  );
}
