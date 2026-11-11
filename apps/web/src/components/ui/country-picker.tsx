"use client";

import { useMemo } from "react";

import { SearchablePicker } from "@/components/ui/searchable-picker";
import { useLocale } from "@/i18n/provider";
import { countryNames } from "@/lib/geo/countries";

/**
 * #746: a country field, as the shared `SearchablePicker`.
 *
 * Names are the stored value (the address column is free text), in the
 * reader's language. A value that is not on the list, such as an enrichment's
 * "CA", is shown as it is and a typed one can be used as typed.
 */
export function CountryPicker({
  value,
  onValueChange,
  ariaLabel,
  placeholder,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
}) {
  const { locale } = useLocale();
  const options = useMemo(
    () => countryNames(locale).map((name) => ({ value: name, label: name })),
    [locale],
  );
  return (
    <SearchablePicker
      value={value}
      onValueChange={onValueChange}
      options={options}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      allowCustom
      className={className}
    />
  );
}
