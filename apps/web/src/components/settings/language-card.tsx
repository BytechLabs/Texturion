"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { LOCALES, LOCALE_LABELS, isLocale, type Locale } from "@loonext/shared";

import { SettingsCard } from "@/components/settings/section";
import { useUpdateCompany } from "@/lib/api/companies";
import { ApiError } from "@/lib/api/error";
import type { CompanyView } from "@/lib/api/types";

/**
 * #228 - the language the automated texts go out in.
 *
 * Design notes, and the principles behind them:
 *
 * - **The help text says what this does NOT do, and that is the whole card.**
 *   An owner reading "Language" on a settings screen reasonably expects the app
 *   itself to change language, and what they get is four text messages. Being
 *   told afterwards is being misled; being told here is a decision they can
 *   make. The second half matters just as much: a workspace that wrote its own
 *   away message keeps the sentence it wrote, because translating somebody's
 *   own words back at them would be worse than leaving them alone.
 *
 * - **Both languages are visible, not folded into a dropdown.** A menu that
 *   hides half of a two-item list costs a click and buys nothing.
 *   *Applying: Zen of Clarity, and Chunking, since two items is not a list
 *   anybody needs help managing.*
 *
 * - **The keyboard contract is the one this screen already teaches.** Same
 *   roving-tabindex radiogroup as call screening and after-hours calling: one
 *   learned pattern across the settings surface, not a third.
 *
 * There is no "no language" state and there must not be: every automated send
 * has to resolve one, and a workspace that had cleared it would be a workspace
 * whose texts fall back to a default it never chose.
 */
export function LanguageCard({
  company,
  canEdit,
}: {
  company: CompanyView;
  canEdit: boolean;
}) {
  const update = useUpdateCompany();
  const [error, setError] = useState<string | null>(null);
  const radioRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Optimistic selection, as the neighbouring radiogroups do it: the choice
  // moves at the click, and the radios are never disabled mid-interaction
  // (disabling the just-focused radio drops keyboard focus).
  const [pending, setPending] = useState<Locale | null>(null);
  const active = pending ?? company.locale;
  useEffect(() => {
    if (pending !== null && company.locale === pending) setPending(null);
  }, [company.locale, pending]);

  function choose(value: Locale) {
    if (value === active) return;
    setError(null);
    setPending(value);
    update.mutate(
      { locale: value },
      {
        onSuccess: () => toast.success("Language saved."),
        onError: (cause) => {
          setPending(null);
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Couldn't save the language. Try again.",
          );
        },
      },
    );
  }

  const currentIndex = LOCALES.indexOf(active);
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!canEdit) return;
    const from = currentIndex === -1 ? 0 : currentIndex;
    let next = from;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = (from + 1) % LOCALES.length;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = (from - 1 + LOCALES.length) % LOCALES.length;
        break;
      default:
        return;
    }
    event.preventDefault();
    radioRefs.current[next]?.focus();
    choose(LOCALES[next]);
  }

  return (
    <SettingsCard
      title="Language"
      description="The language the texts we send on your behalf go out in."
    >
      {canEdit ? (
        <div
          role="radiogroup"
          aria-label="Language"
          onKeyDown={onKeyDown}
          className="flex flex-wrap gap-2"
        >
          {LOCALES.map((locale, i) => {
            const selected = active === locale;
            return (
              <button
                key={locale}
                ref={(el) => {
                  radioRefs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected || (currentIndex === -1 && i === 0) ? 0 : -1}
                onClick={() => choose(locale)}
                className={
                  "rounded-md border px-3 py-2 text-sm font-medium transition-colors duration-150 " +
                  (selected
                    ? "border-primary/50 bg-accent/40"
                    : "border-border-subtle hover:bg-accent/20")
                }
              >
                {LOCALE_LABELS[locale]}
              </button>
            );
          })}
        </div>
      ) : (
        /* Guarded like the contact control next door, rather than trusting the
           API's non-null guarantee. An unrecognised value renders an empty
           paragraph otherwise, so a member would be told the workspace language
           is nothing at all. */
        <p className="text-sm">
          {isLocale(company.locale) ? LOCALE_LABELS[company.locale] : "English"}
        </p>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        It changes four texts: the after-hours away reply, the missed-call
        text-back, the emergency acknowledgment, and the rating ask. It does not
        translate this app, and it does not translate a message you wrote
        yourself. An away message you typed keeps the words you typed.
      </p>
      <p className="mt-1.5 text-xs text-muted-foreground">
        A customer set to their own language on their contact record keeps it.
        This is what everyone else hears from you.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {!canEdit && (
        <p className="mt-3 text-xs text-muted-foreground">
          Only owners and admins can change the language.
        </p>
      )}
    </SettingsCard>
  );
}
