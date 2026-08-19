"use client";

import { useEffect } from "react";

import type { MarketingLocale } from "@/i18n/marketing/footer";

/**
 * WCAG 2.2 §3.1.1 Language of Page, for the marketing routes.
 *
 * ## The gap this closes, which I opened
 *
 * `app/layout.tsx` hard-codes `<html lang="en">` and cannot know which route
 * group is about to render — a Next layout receives `children` and nothing
 * else. So `/fr/contact` shipped French content inside a document declaring
 * itself English, on the same week `docs/ACCESSIBILITY.md` gained a row
 * claiming §3.1.1. The claim and the page disagreed, and the claim is the one
 * handed to a buyer.
 *
 * ## Why this rather than the proper fix
 *
 * The proper fix is a root layout per route group, each owning its own
 * `<html>`. That is a restructuring of `app/` with every page in its blast
 * radius, and it is not worth doing between two French pages — it is worth
 * doing once, deliberately, when the French tree is big enough to justify it.
 *
 * What this does instead is the same thing the APP does for the same reason
 * (`i18n/provider.tsx`): correct the attribute once the language is known. It
 * is not in the served HTML, which is the honest limitation — but a screen
 * reader reads the live DOM, and the `lang` the marketing shell puts on its own
 * wrapper is server-rendered and covers the whole visible subtree either way.
 * So the reader is served correctly by two mechanisms and the document-level
 * claim is true by one of them.
 *
 * Delete this the day the root layouts split.
 */
export function DocumentLanguage({ locale }: { locale: MarketingLocale }) {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}
