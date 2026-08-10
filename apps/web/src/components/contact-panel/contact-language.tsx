"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { LOCALES, LOCALE_LABELS, isLocale, type Locale } from "@loonext/shared";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/provider";
import { useCompany } from "@/lib/api/companies";
import { useUpdateContact } from "@/lib/api/contacts";
import { ApiError } from "@/lib/api/error";
import type { ContactDetail } from "@/lib/api/types";

/**
 * #228 - the language THIS customer hears from us in.
 *
 * # Three states, and the third one is the whole control
 *
 * `contacts.locale` is nullable and the null means "whatever the business
 * works in", not English. So a two-state control would be a broken one: a
 * dispatcher who set somebody to English by mistake could never put them back
 * to following the workspace, and the record would silently stop tracking a
 * later switch to French. The way back has to be a state you can choose, which
 * is why it is a chip and not the absence of one.
 *
 * # The inherit chip names the language it inherits
 *
 * "Same as workspace" alone is a promise to look somewhere else. Naming the
 * language inside it, "Same as workspace (English)", answers on the spot the
 * question the label otherwise creates. It falls back to the bare wording only
 * while the workspace answer is still loading, or against a server that
 * predates this field: naming a language we have not actually read would be a
 * guess presented as a fact, and English is exactly the guess this feature
 * exists to stop making.
 *
 * *Applying: Smart Defaults (the current answer is always the selected one),
 * and the panel's own honesty rule, that an inferred value is never dressed up
 * as a chosen one.*
 */
export function ContactLanguage({ contact }: { contact: ContactDetail }) {
  const t = useT();
  const company = useCompany();
  const update = useUpdateContact(contact.id);
  const radioRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Guarded rather than read straight off the view: a workspace loaded from a
  // server without this column would otherwise render "Same as workspace
  // (undefined)".
  const companyLocale = isLocale(company.data?.locale)
    ? company.data.locale
    : null;
  // Optimistic selection, matching the workspace card next door and for the
  // reason its comment gives: disabling the just-focused radio drops keyboard
  // focus to <body>, so arrow-keying through the group would strand the caret
  // on the first press. It also means the chip moves at the click rather than
  // after a round trip, which is the difference between a control that
  // responds and three greyed-out chips.
  const stored = isLocale(contact.locale) ? contact.locale : null;
  const [pending, setPending] = useState<Locale | null | undefined>(undefined);
  const current = pending === undefined ? stored : pending;
  useEffect(() => {
    if (pending !== undefined && stored === pending) setPending(undefined);
  }, [stored, pending]);

  const choices: { value: Locale | null; label: string }[] = [
    {
      value: null,
      label: companyLocale
        ? t("contacts.sameAsWorkspaceNamed", {
            language: LOCALE_LABELS[companyLocale],
          })
        : t("contacts.sameAsWorkspace"),
    },
    ...LOCALES.map((locale) => ({ value: locale, label: LOCALE_LABELS[locale] })),
  ];

  function choose(value: Locale | null) {
    if (value === current) return;
    setPending(value);
    update.mutate(
      { locale: value },
      {
        onSuccess: () =>
          toast.success(
            t(
              value
                ? "contacts.languageSaved"
                : "contacts.languageBackToWorkspace",
            ),
          ),
        onError: (cause) => {
          // Put the chip back where it was. An optimistic move that survived a
          // failed save would show a language this customer is not set to.
          setPending(undefined);
          toast.error(
            cause instanceof ApiError
              ? cause.message
              : t("contacts.languageSaveFailed"),
          );
        },
      },
    );
  }

  // The same roving-tabindex radiogroup contract the settings screens teach:
  // one Tab stop for the group, arrows move focus and selection together.
  // Always found, and that is why there is no "nothing selected" branch here:
  // `current` is normalised above to null or a known language, and all three
  // are chips. Following the workspace is a state, not the absence of one.
  const currentIndex = choices.findIndex((choice) => choice.value === current);
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const from = currentIndex;
    let next = from;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = (from + 1) % choices.length;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = (from - 1 + choices.length) % choices.length;
        break;
      default:
        return;
    }
    event.preventDefault();
    radioRefs.current[next]?.focus();
    choose(choices[next].value);
  }

  return (
    // No padding or heading of its own: the panel supplies both from its quiet
    // group, and the contact page from its field stack. Two callers, one
    // control, so a language can be set from either place a contact is read.
    <div className="space-y-1.5">
      <div
        role="radiogroup"
        aria-label={t("contacts.languageGroupLabel")}
        onKeyDown={onKeyDown}
        className="flex flex-wrap gap-1.5"
      >
        {choices.map((choice, i) => {
          const selected = choice.value === current;
          return (
            <Button
              key={choice.value ?? "inherit"}
              ref={(el) => {
                radioRefs.current[i] = el;
              }}
              variant="ghost"
              size="sm"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => choose(choice.value)}
              // Wraps rather than overflows: the thread panel is resizable
              // down to 260px, and "Same as workspace (Francais (Canada))" is
              // wider than that on one line. The shared button is nowrap by
              // default, which would push the whole panel sideways.
              className={
                "h-auto max-w-full whitespace-normal rounded-full border px-2.5 py-1 text-left text-[12px] leading-snug " +
                (selected
                  ? "border-primary/50 bg-accent/50"
                  : "border-border-subtle")
              }
            >
              {choice.label}
            </Button>
          );
        })}
      </div>
      {/* The one sentence that stops this being read as a translator. Said here
          rather than only in Settings, because this is where somebody picks
          French for a customer and then waits for their own typing to arrive
          in French. */}
      <p className="text-xs text-muted-foreground">
        {t("contacts.languageNote")}
      </p>
    </div>
  );
}
