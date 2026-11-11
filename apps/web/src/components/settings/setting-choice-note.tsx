"use client";

import { roleHasCapability, type CompanySettingKey } from "@loonext/shared";
import { UserCircle } from "lucide-react";

import { useT } from "@/i18n/provider";
import { useSettingChoices } from "@/lib/api/companies";
import { useActiveCompany } from "@/lib/company/provider";
import { formatCalendarDate } from "@/lib/format/time";

/**
 * #749: under a setting that can lose a customer, who chose the value it has
 * now and when, once it is off its default. Silent at the default, so the line
 * only ever appears beside a choice somebody made.
 */
export function SettingChoiceNote({
  settingKey,
  defaultLabel,
}: {
  settingKey: CompanySettingKey;
  /** The default as this card names it, e.g. "Ring everyone". */
  defaultLabel: string;
}) {
  const t = useT();
  const { role } = useActiveCompany();
  const choices = useSettingChoices(roleHasCapability(role, "settings.manage"));
  const choice = choices.data?.data.find((row) => row.key === settingKey);
  if (!choice) return null;

  const text =
    choice.chosen_by && choice.chosen_at
      ? t("settings.choiceChosenBy", {
          name: choice.chosen_by,
          date: formatCalendarDate(choice.chosen_at, t.locale),
          default: defaultLabel,
        })
      : t("settings.choiceChangedFromDefault", { default: defaultLabel });

  return (
    <p className="mt-3 flex items-start gap-1.5 text-[13px] text-muted-foreground">
      <UserCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>{text}</span>
    </p>
  );
}
