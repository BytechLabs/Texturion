import type { Metadata } from "next";
import { cache } from "react";

import { resolveLocale } from "@loonext/shared";

import { publicEnv } from "@/env";
import { makeTranslate } from "@/i18n/translate";
import type { Translate } from "@/i18n/translate";

export function publicPageLoader<T>(page: "q" | "pay" | "photos") {
  return cache(async (token: string): Promise<T | null> => {
    const base = publicEnv.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
    const response = await fetch(`${base}/${page}/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    return response.ok ? (await response.json()) as T : null;
  });
}

export function publicPageMetadata(
  locale: string | undefined,
  title: Parameters<Translate>[0],
): Metadata {
  return {
    title: makeTranslate(resolveLocale(locale, null))(title),
    robots: { index: false, follow: false, nocache: true },
  };
}
