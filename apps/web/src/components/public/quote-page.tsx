"use client";

import { useEffect, useRef, useState } from "react";
import type { SubmitEvent } from "react";

import { DEFAULT_LOCALE, isLocale } from "@loonext/shared";
import type { Locale } from "@loonext/shared";

import { DocumentLanguage } from "@/components/marketing/document-language";
import { publicEnv } from "@/env";
import { makeTranslate } from "@/i18n/provider";

/**
 * #287 — the page a homeowner opens to read a quote and accept it.
 *
 * No account, no login, no shell, and quite possibly no prior knowledge of us
 * at all: this arrives as a link in a text from a plumber. The sibling of
 * `payment-page.tsx` and built to the same rules, because it is the same
 * reader on the same phone.
 *
 * # What it shows, and what it must not
 *
 * The business's name, the amount, and what the work is. NOT the customer's
 * own name, address or number — they know those, and this URL lives in SMS
 * logs, browser history, and whatever their phone backs up to. The API
 * enforces that half; this page could not render them if it wanted to.
 *
 * # One decision, and no pressure applied to it
 *
 * *Prioritize Intent*: the amount is the largest thing on the page and Accept
 * is the only button. Everything else is context for that one decision.
 *
 * The expiry is stated as a FACT, not as a countdown. Loss Aversion is a
 * legitimate tool on a subscription upgrade and a manipulative one here: this
 * is a stranger being asked to commit money to a trade they may still be
 * comparing, and a ticking clock on that decision is pressure rather than
 * information. It reads "This price holds until 23 August", once, in quiet
 * type.
 *
 * # Why there is no confirmation step
 *
 * *Ethical Friction* asks for a pause before irreversible acts, and accepting
 * is irreversible. But the friction belongs where a person might act by
 * accident, and nobody opens a texted link, reads a price and taps Accept by
 * accident. The amount sits directly above the button at 3rem, which is the
 * confirmation: you cannot press it without the number in your eye. A modal
 * asking "are you sure" would add a step to the one thing both parties want.
 */

interface QuoteView {
  locale?: string;
  business_name: string;
  amount_cents: number;
  currency: string;
  description: string;
  status: string;
  expires_at: string;
  can_accept: boolean;
  accept_token: string | null;
  decline_token?: string | null;
}

interface WithdrawnQuote {
  locale?: string;
  withdrawn: true;
  status: "withdrawn";
}

/** "$450.00" — the amount as a person reads it, in the quote's own currency. */
function formatAmount(cents: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(locale === "en" ? "en-CA" : locale, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/** "23 August" — a date, not a duration. See the note on pressure above. */
function formatExpiry(iso: string, locale: Locale): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "en" ? "en-CA" : locale, {
    day: "numeric",
    month: "long",
  }).format(at);
}

// #581: no `token` prop any more. It existed only to build the accept URL from
// the address bar, and that is precisely the credential this page must not use.
export function QuotePage({
  quote,
  notAvailable = false,
}: {
  quote?: QuoteView | WithdrawnQuote;
  notAvailable?: boolean;
}) {
  const [state, setState] = useState<
    "idle" | "sending" | "declining" | "accepted" | "declined" | "withdrawn" | "invalidName" | "failed" | "declineFailed"
  >(
    "idle",
  );
  const locale = isLocale(quote?.locale) ? quote.locale : DEFAULT_LOCALE;
  const t = makeTranslate(locale);
  const decisionHeading = useRef<HTMLHeadingElement>(null);
  const [name, setName] = useState("");
  useEffect(() => {
    if (state === "accepted" || state === "declined") decisionHeading.current?.focus();
  }, [state]);

  if (notAvailable || !quote || "withdrawn" in quote || state === "withdrawn") {
    const withdrawn = state === "withdrawn" || (quote && "withdrawn" in quote);
    return (
      <main lang={locale} className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <DocumentLanguage locale={locale} />
        <h1 className="text-xl font-semibold tracking-tight">
          {t(withdrawn ? "quotes.withdrawnTitle" : "quotes.unavailableTitle")}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          {t(withdrawn ? "quotes.withdrawnDetail" : "quotes.unavailableDetail")}
        </p>
      </main>
    );
  }

  const accepted = state === "accepted" || quote.status === "accepted";

  if (accepted) {
    return (
      <main lang={locale} className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <DocumentLanguage locale={locale} />
        <h1 ref={decisionHeading} tabIndex={-1} className="text-xl font-semibold tracking-tight">
          {t("quotes.acceptedTitle", { business: quote.business_name })}
        </h1>
        {/*
          The receipt half of the record. A person who accepts a price and sees
          only "thanks" has no evidence of what they agreed to, and this whole
          feature exists because "what did we quote?" was unanswerable.
        */}
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          {t("quotes.acceptedDetail", {
            amount: formatAmount(quote.amount_cents, quote.currency, locale),
            description: quote.description,
          })}
        </p>
      </main>
    );
  }

  if (state === "declined" || quote.status === "declined") {
    return (
      <main lang={locale} className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <DocumentLanguage locale={locale} />
        <h1 ref={decisionHeading} tabIndex={-1} className="text-xl font-semibold tracking-tight">
          {t("quotes.declinedTitle")}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          {t("quotes.declinedDetail", { business: quote.business_name })}
        </p>
      </main>
    );
  }

  const busy = state === "sending" || state === "declining";

  async function accept(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const credential = quote && "accept_token" in quote ? quote.accept_token : null;
    if (!credential || name.trim().length === 0 || busy) return;
    setState("sending");
    const base = publicEnv.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
    try {
      const response = await fetch(
        `${base}/q/${encodeURIComponent(credential)}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        },
      );
      if (response.status === 422) {
        setState("invalidName");
      } else if (response.status === 409) {
        const decision = await response.json() as { status?: string };
        setState(decision.status === "withdrawn" ? "withdrawn" : "failed");
      } else {
        setState(response.ok ? "accepted" : "failed");
      }
    } catch {
      setState("failed");
    }
  }

  async function decline() {
    const credential = quote && "decline_token" in quote ? quote.decline_token : null;
    if (!credential || busy) return;
    setState("declining");
    const base = publicEnv.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
    try {
      const result = await fetch(`${base}/q/${encodeURIComponent(credential)}/decline`, { method: "POST" });
      setState(result.ok ? "declined" : "declineFailed");
    } catch {
      setState("declineFailed");
    }
  }

  return (
    <main lang={locale} className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <DocumentLanguage locale={locale} />
      {/* The business, first: a stranger's first question is who this is from. */}
      <h1 className="text-[15px] text-muted-foreground">{quote.business_name}</h1>

      {/*
        The amount, largest. *Prioritize Intent* — the page is built around the
        one decision, and the figure is what the decision is about. Tabular
        numerals so it reads as money rather than as text.
      */}
      <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums">
        {formatAmount(quote.amount_cents, quote.currency, locale)}
      </p>

      <p className="mt-3 text-[15px] leading-relaxed text-foreground">
        {quote.description}
      </p>

      {quote.can_accept ? (
        <>
          <form className="mt-8 flex flex-col gap-3" onSubmit={(event) => { void accept(event); }}>
            <label className="flex flex-col gap-1.5 text-[15px] font-medium">
              {t("quotes.acceptNameLabel")}
              <input
                aria-invalid={state === "invalidName" || undefined}
                autoComplete="name"
                className="min-h-11 rounded-app-ctrl border border-input bg-background px-3 text-[16px]"
                maxLength={120}
                readOnly={busy}
                required
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (state === "invalidName") setState("idle");
                }}
              />
            </label>
            {state === "invalidName" && (
              <p role="alert" className="text-[15px] text-destructive">
                {t("quotes.acceptNameRequired")}
              </p>
            )}
            <button
              type="submit"
              disabled={busy || name.trim().length === 0}
              className="inline-flex min-h-[52px] items-center justify-center gap-1 rounded-app-ctrl bg-primary px-6 text-[16px] font-medium text-primary-foreground transition-colors duration-150 ease-out hover:opacity-90 disabled:opacity-60"
            >
              {state === "sending" ? t("quotes.accepting") : t("quotes.acceptAction")}
            </button>
          </form>

          {quote.decline_token && (
            <button
              type="button"
              onClick={() => { void decline(); }}
              disabled={busy}
              className="mt-2 min-h-11 rounded-app-ctrl px-3 text-[15px] font-medium text-primary hover:underline disabled:opacity-60"
            >
              {t("quotes.declineAction")}
            </button>
          )}

          {/* A fact, once, quietly. Not a countdown — see the header. */}
          <p className="mt-4 text-[13px] text-muted-foreground">
            {t("quotes.priceHolds", { date: formatExpiry(quote.expires_at, locale) })}
          </p>

          {state === "failed" && (
            <p role="alert" className="mt-4 text-[15px] text-destructive">
              {t("quotes.acceptFailed", { business: quote.business_name })}
            </p>
          )}
          {state === "declineFailed" && (
            <p role="alert" className="mt-4 text-[15px] text-destructive">
              {t("quotes.declineCustomerFailed", { business: quote.business_name })}
            </p>
          )}
        </>
      ) : (
        <p className="mt-8 text-[15px] leading-relaxed text-muted-foreground">
          {t("quotes.noLongerOpen", { business: quote.business_name })}
        </p>
      )}
    </main>
  );
}
