import { normalizeDeviceLocale } from "@loonext/shared";
import type { Locale } from "@loonext/shared";
import { useEffect, useState } from "react";
import { boundariesEn, boundariesFr } from "@/i18n/sections/boundaries";
import { commonEn, commonFr } from "@/i18n/sections/common";

// Root errors render everywhere. Loading only their sections keeps the app catalogue off marketing pages.
const boundaryCopy = {
  ...boundariesEn,
  retry: commonEn.retry,
} as const;

export function boundaryCopyFor(locale: Locale) {
  return locale === "fr-CA" ? { ...boundariesFr, retry: commonFr.retry } : boundaryCopy;
}

export function useBoundaryLocale(): Locale {
  const [locale, setLocale] = useState<Locale>("en");
  useEffect(() => {
    setLocale(normalizeDeviceLocale(navigator.language) ?? "en");
  }, []);
  return locale;
}

/** `misc.errorReference` with the digest filled in. */
export function boundaryReference(digest: string, locale: Locale = "en"): string {
  return boundaryCopyFor(locale).errorReference.replaceAll("{digest}", () => digest);
}
