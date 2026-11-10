"use client";

import { LoadError, SettingsPage } from "@/components/settings/section";
import { AutomaticTextsGroups } from "@/components/settings/automatic-texts-groups";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/provider";
import { useCompany } from "@/lib/api/companies";
import { useActiveCompany } from "@/lib/company/provider";

export default function AutomaticTextsSettingsPage() {
  const t = useT();
  const company = useCompany();
  const { role } = useActiveCompany();
  const canEdit = role === "owner" || role === "admin";

  return (
    <SettingsPage
      title={t("settingsMore.autoTextsTitle")}
      description={t("settingsMore.autoTextsIntro")}
    >
      {company.isPending ? (
        <div
          className="space-y-6"
          aria-label={t("settingsMore.autoTextsLoading")}
        >
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-56 w-full rounded-lg" />
        </div>
      ) : company.isError ? (
        <LoadError onRetry={() => company.refetch()} />
      ) : (
        <AutomaticTextsGroups company={company.data} canEdit={canEdit} />
      )}
    </SettingsPage>
  );
}
