"use client";

import { useMemo } from "react";

import { SearchablePicker } from "@/components/ui/searchable-picker";
import {
  groupTimezones,
  supportedTimezones,
  timezoneLabel,
} from "@/lib/settings/timezone-options";
import { useT } from "@/i18n/provider";

/**
 * Searchable, grouped IANA timezone picker (D15, Settings > Workspace): the
 * shared `SearchablePicker` with one group per IANA area. The stored value may
 * predate the runtime's list (server default, another browser), so it is
 * prepended to its group and the current choice is always visible.
 */
export function TimezoneSelect({
  value,
  onChange,
  disabled,
  className,
  id,
}: {
  value: string;
  onChange: (zone: string) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const t = useT();

  const options = useMemo(() => {
    const zones = supportedTimezones();
    return groupTimezones(zones.includes(value) ? zones : [value, ...zones]).flatMap(
      (group) =>
        group.zones.map((zone) => ({
          value: zone,
          label: timezoneLabel(zone),
          group: group.region,
        })),
    );
  }, [value]);

  return (
    <SearchablePicker
      id={id}
      value={value}
      onValueChange={onChange}
      options={options}
      disabled={disabled}
      ariaLabel={t("settingsMore.timezoneLabel")}
      searchPlaceholder={t("settingsMore.timezoneSearchPlaceholder")}
      emptyLabel={t("settingsMore.timezoneNoMatch")}
      className={className ?? "sm:w-80"}
    />
  );
}
