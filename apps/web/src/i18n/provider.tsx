"use client";

import { createContext, useContext, useMemo } from "react";

import {
  DEFAULT_LOCALE,
  resolveUiLocale,
  type Locale,
} from "@loonext/shared";

import { CATALOGS, type Catalog } from "./catalog";

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

/**
 * `t("payments.askAction")`, and `t("payments.askFor", { amount: "$250" })`.
 *
 * The key is a dotted path and it is TYPED: a typo, a renamed section or a
 * string that only exists in one language does not compile. That is the whole
 * reason the catalogue is TypeScript — a missing key in a JSON message file is
 * a runtime fallback nobody sees until a French reader does.
 */
export type MessageKey = {
  [Section in keyof Catalog]: `${Section & string}.${keyof Catalog[Section] & string}`;
}[keyof Catalog];

/**
 * A lookup that knows which language it speaks.
 *
 * The `locale` is carried ON the function rather than passed beside it because
 * the two always travel together and a signature that takes both is a signature
 * that can be given a mismatched pair. One caller needs it: `parseErrorBody`
 * decides whether the reader can use the server's English sentence, and it
 * already receives `t`.
 */
export type Translate = ((
  key: MessageKey,
  vars?: Record<string, string | number>,
) => string) & { readonly locale: Locale };

const LocaleContext = createContext<LocaleValue>({
  locale: DEFAULT_LOCALE,
  t: makeTranslate(DEFAULT_LOCALE),
});

/**
 * Build the lookup for one locale.
 *
 * Exported so a server component or a test can translate without a provider —
 * and because a hook that is the ONLY way to reach the catalogue would push
 * every non-component caller back to a hardcoded string, which is the defect
 * this whole change is about.
 */
export function makeTranslate(locale: Locale): Translate {
  /*
   * The locale this translator actually SPEAKS, which is not always the one it
   * was asked for: an unrecognised locale reads the English catalogue, and it
   * has to report English. Reporting the requested one would tell
   * `parseErrorBody` the reader needs translating and then hand it English
   * generic copy — strictly worse than the specific English it replaced.
   */
  const resolved: Locale = locale in CATALOGS ? locale : DEFAULT_LOCALE;
  const catalog = CATALOGS[resolved];
  const fallback = CATALOGS[DEFAULT_LOCALE];
  const translate = (key: MessageKey, vars?: Record<string, string | number>) => {
    const [section, name] = key.split(".") as [keyof Catalog, string];
    const table = catalog[section] as Record<string, string> | undefined;
    /*
     * English is the fallback for a MISSING string, and only for a missing one.
     * `tsc` makes that unreachable through the typed key above; it exists for
     * the case the type cannot see — a build where the two catalogues were
     * edited in separate deploys — because a reader meeting an English sentence
     * has lost a translation, and a reader meeting `payments.askAction` has
     * lost the product.
     */
    const raw =
      table?.[name] ??
      (fallback[section] as Record<string, string> | undefined)?.[name] ??
      key;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (match, token: string) =>
      token in vars ? String(vars[token]) : match,
    );
  };
  return Object.assign(translate, { locale: resolved });
}

/**
 * A translator that always delegates to whichever one is current.
 *
 * For the callers holding a ref rather than a value — a long-lived state
 * machine built once, whose owner re-renders in a new language. The `locale`
 * is a getter for the same reason the call is a delegation: a copy taken at
 * construction would report the language the machine was BORN in, which is the
 * bug this whole shape exists to avoid.
 */
export function forwardTranslate(current: () => Translate): Translate {
  const forward = (key: MessageKey, vars?: Record<string, string | number>) =>
    current()(key, vars);
  return Object.defineProperty(forward, "locale", {
    get: () => current().locale,
  }) as Translate;
}

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

/**
 * A resolver for `packages/shared`, whose keys are plain strings.
 *
 * #228: shared modules compose text out of keys and do not own a catalogue, so
 * they take a lookup. They cannot take a {@link Translate} — its key type comes
 * from this app's catalogue and the shared package cannot see it — so the key
 * widens to `string` here, at the one boundary, rather than every shared module
 * carrying a cast.
 */
export function sayWith(t: Translate): (key: string) => string {
  return (key) => t(key as MessageKey);
}

/**
 * The same lookup, forced to ENGLISH whatever the reader's language is.
 *
 * There is exactly one caller and it is deliberate: `supportSubjectFor` puts
 * this in a mail subject, and a subject line is the support inbox's index. One
 * carrier suspension reported from Montreal and from Calgary has to arrive
 * under one heading, or the pattern that matters most — five reports of one
 * failure in a morning — is the one that stops being visible.
 */
export const sayEnglish = sayWith(makeTranslate(DEFAULT_LOCALE));
