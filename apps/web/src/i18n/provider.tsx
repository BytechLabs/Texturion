"use client";

import { createContext, useContext, useEffect, useMemo } from "react";

import {
  DEFAULT_LOCALE,
  resolveUiLocale,
  type Locale,
} from "@loonext/shared";

import { makeTranslate, type Translate } from "./translate";

export {
  forwardTranslate,
  makeTranslate,
  sayEnglish,
  sayWith,
  type MessageKey,
  type Translate,
} from "./translate";

/**
 * #228 Phase 1 — which language this reader reads, and the function that says
 * so.
 *
 * ## The resolution happens HERE and nowhere else
 *
 * `resolveUiLocale` in @loonext/shared is the rule (user > device > company >
 * English) and all three clients hand-port it. What is local to the browser is
 * the DEVICE half: `navigator.language` cannot be read on the server, and
 * reading it during render would make the first paint disagree with the second
 * — a hydration mismatch that React resolves by silently discarding the server
 * HTML, on every page load, for every reader.
 *
 * So the device locale is read from the `lang` attribute the document was
 * SERVED with when a server answer exists, and from the navigator only in the
 * browser. The provider takes it as a prop rather than reaching for it, which
 * is what makes the whole thing testable without a DOM.
 */
interface LocaleValue {
  locale: Locale;
  t: Translate;
}

const LocaleContext = createContext<LocaleValue>({
  locale: DEFAULT_LOCALE,
  t: makeTranslate(DEFAULT_LOCALE),
});

export function LocaleProvider({
  /** The member's own setting, from `/v1/me`. Null until they choose one. */
  userLocale,
  /** The workspace's language, from the company record. */
  companyLocale,
  /**
   * What the DEVICE says. Passed in rather than read here so the value is the
   * same on the server render and the first client one — see the header.
   */
  deviceLocale,
  children,
}: {
  userLocale?: string | null;
  companyLocale?: string | null;
  deviceLocale?: string | null;
  children: React.ReactNode;
}) {
  const value = useMemo<LocaleValue>(() => {
    const locale = resolveUiLocale(userLocale, deviceLocale, companyLocale);
    return { locale, t: makeTranslate(locale) };
  }, [userLocale, deviceLocale, companyLocale]);

  /*
   * WCAG 2.2 §3.1.1 Language of Page — LEVEL A, and it was failing.
   *
   * `app/layout.tsx` hard-codes `<html lang="en">`, which was true of every
   * page until this provider existed and false of every French one after. The
   * consequence is not cosmetic: a screen reader picks its pronunciation rules
   * from this attribute, so VoiceOver and NVDA read French sentences with an
   * English engine — the words are there and the speech is not French. It also
   * tells a translation tool and a search engine the page is English.
   *
   * Set here rather than in the layout because the layout renders on the
   * SERVER, where no member's locale exists: the language is a person's
   * setting, resolved from `/v1/me` after the document has already been sent.
   *
   * The value is a BCP-47 tag, which is what `Locale` already is — "en" and
   * "fr-CA" both being valid tags is the reason the catalogue's keys can be
   * used here unchanged.
   */
  useEffect(() => {
    document.documentElement.lang = value.locale;
  }, [value.locale]);

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

/**
 * The reader's language and their words.
 *
 * Defaults to English OUTSIDE a provider rather than throwing. A hook that
 * throws when unmounted from its context turns a missing provider into a blank
 * screen; this turns it into an English one, which is what every reader had
 * before this existed.
 */
export function useLocale(): LocaleValue {
  return useContext(LocaleContext);
}

/** The common case: just the words. */
export function useT(): Translate {
  return useContext(LocaleContext).t;
}
