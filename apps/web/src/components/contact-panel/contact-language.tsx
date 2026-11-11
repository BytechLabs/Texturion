"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { LOCALES, LOCALE_LABELS, isLocale, type Locale } from "@loonext/shared";

import { ChoiceCards } from "@/components/ui/choice-cards";
import { useT, type Translate } from "@/i18n/provider";
import { useCompany } from "@/lib/api/companies";
import { useUpdateContact } from "@/lib/api/contacts";
import { ApiError } from "@/lib/api/error";
import type { ContactDetail } from "@/lib/api/types";
import { offeredBesideDefault } from "@/lib/default-choice";

/** The choice that follows the workspace: ChoiceCards values are strings, the stored one is null. */
const INHERIT = "inherit";

function workspaceDefaultLabel(companyLocale: Locale | null, t: Translate) {
  return companyLocale
    ? t("contacts.sameAsWorkspaceNamed", { language: LOCALE_LABELS[companyLocale] })
    : t("contacts.sameAsWorkspace");
}

/** The language a contact hears from us in, as the picker names it. */
export function useContactLanguageLabel(locale: string | null | undefined): string {
  const t = useT();
  const company = useCompany();
  if (isLocale(locale)) return LOCALE_LABELS[locale];
  return workspaceDefaultLabel(
    isLocale(company.data?.locale) ? company.data.locale : null,
    t,
  );
}

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
    { value: null, label: workspaceDefaultLabel(companyLocale, t) },
    ...LOCALES.filter((locale) =>
      offeredBesideDefault(locale, companyLocale, stored),
    ).map((locale) => ({ value: locale, label: LOCALE_LABELS[locale] })),
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

  return (
    // No padding or heading of its own: the panel supplies both from its quiet
    // group, and the contact page from its field stack. Two callers, one
    // control, so a language can be set from either place a contact is read.
    <div className="space-y-1.5">
      <ChoiceCards<Locale | typeof INHERIT>
        value={current ?? INHERIT}
        onChange={(value) => choose(value === INHERIT ? null : value)}
        ariaLabel={t("contacts.languageGroupLabel")}
        options={choices.map((choice) => ({
          value: choice.value ?? INHERIT,
          label: choice.label,
        }))}
      />
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
