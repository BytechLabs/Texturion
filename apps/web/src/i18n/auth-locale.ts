import { DEFAULT_LOCALE, isLocale, normalizeDeviceLocale } from "@loonext/shared";
import type { Locale } from "@loonext/shared";

export const AUTH_LOCALE_HEADER = "x-loonext-auth-locale";
export const AUTH_LOCALE_COOKIE = "loonext-auth-locale";

export function authLocale(
  hint: string | null | undefined,
  acceptLanguage: string | null,
): Locale {
  if (isLocale(hint)) return hint;
  const preferences = (acceptLanguage ?? "").split(",").map((preference) => {
    const [tag, weight] = preference.trim().split(";q=");
    return { locale: normalizeDeviceLocale(tag), weight: Number(weight ?? 1) };
  });
  return preferences
    .filter(({ locale, weight }) => locale !== null && weight > 0 && weight <= 1)
    .toSorted((first, second) => second.weight - first.weight)[0]?.locale ?? DEFAULT_LOCALE;
}
