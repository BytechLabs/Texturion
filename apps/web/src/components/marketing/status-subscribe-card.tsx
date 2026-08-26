"use client";

import { useEffect, useRef, useState } from "react";

import { FrCard } from "@/components/marketing/fr";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { statusCopy } from "@/i18n/marketing/status";

/**
 * #477 — "email me instead of making me watch this page".
 *
 * ONE FIELD, ONE BUTTON, AND NOTHING TO CHOOSE. The person reading /status is
 * usually reading it because something is broken and they are already annoyed.
 * Anything that asks them to pick which components they care about, or how
 * often, spends their attention on a decision that has one sensible answer:
 * tell me when it breaks and tell me when it's fixed. The address field carries
 * `type=email` + `autoComplete=email` so the browser fills it rather than the
 * person typing it — the closest a form for an anonymous visitor gets to a
 * smart default, since there is nothing about them we could know.
 *
 * WHY IT SAYS THE SAME THING WHETHER OR NOT THE ADDRESS WAS ALREADY ON THE
 * LIST. The server answers identically for "we mailed you", "you were already
 * subscribed", and "the daily cap stopped us". A form that distinguishes those
 * is a form a stranger can use to find out whether an address is on our list.
 *
 * The card is rendered only when the worker can actually send (the page checks
 * the mailer's bindings first). A subscribe form that quietly drops addresses
 * is the same lie as a green dot with no probe behind it, which is the one
 * thing this page has always refused to do.
 *
 * Applying: Zen of Clarity (one card, one action), Prioritize Intent (the core
 * action first, nothing decorative around it), Smart Defaults via autofill,
 * and DESIGN-DIRECTION §2 — errors read through weight and `role=alert`, never
 * a bespoke red, because the palette has none.
 */

const fieldClass =
  "w-full rounded-[10px] bg-[color:var(--fr-frost)] px-3.5 py-2.5 text-[0.9375rem] text-[color:var(--fr-ink)] placeholder:text-[color:var(--fr-ink-55)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)] disabled:opacity-60";

type Status = "idle" | "submitting" | "done" | "error";

export function StatusSubscribeCard({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = statusCopy(locale);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (status === "done" || status === "error") noticeRef.current?.focus();
  }, [status]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");
    setMessage(null);
    try {
      const response = await fetch("/api/status/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `website` is the honeypot the contact form already uses: a field no
        // person sees, so anything in it came from a bot.
        body: JSON.stringify({ email, website: "", locale }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (response.ok) {
        setMessage(body.message ?? copy.confirmFallback);
        setStatus("done");
      } else {
        setMessage(body.error ?? copy.errorFallback);
        setStatus("error");
      }
    } catch {
      setMessage(copy.errorFallback);
      setStatus("error");
    }
  }

  return (
    <FrCard className="mt-10 p-6 sm:p-8">
      <h2 className="fr-eyebrow text-[color:var(--fr-ink)]">
        {copy.subscribeHeading}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
        {copy.subscribeIntro}
      </p>

      {status === "done" ? (
        <p
          ref={noticeRef}
          tabIndex={-1}
          role="status"
          className="mt-5 text-sm font-semibold text-[color:var(--fr-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)]"
        >
          {message}
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-5 space-y-3" noValidate>
          <label
            htmlFor="status-subscribe-email"
            className="block text-sm font-semibold text-[color:var(--fr-ink)]"
          >
            {copy.emailAddress}
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="status-subscribe-email"
              type="email"
              name="email"
              className={fieldClass}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              inputMode="email"
              placeholder={copy.emailPlaceholder}
              required
              disabled={status === "submitting"}
              aria-describedby={
                status === "error" ? "status-subscribe-error" : undefined
              }
              aria-invalid={status === "error" ? true : undefined}
            />
            <button
              type="submit"
              disabled={status === "submitting"}
              className="inline-flex items-center justify-center rounded-full bg-[color:var(--fr-olive)] px-7 py-3.5 text-[0.9375rem] font-semibold whitespace-nowrap text-[color:var(--fr-on-olive)] transition-colors duration-200 ease-out hover:bg-[color:var(--fr-olive-deep)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {status === "submitting" ? copy.sending : copy.emailMe}
            </button>
          </div>
          {status === "error" && message ? (
            <p
              id="status-subscribe-error"
              ref={noticeRef}
              tabIndex={-1}
              role="alert"
              className="text-sm font-semibold text-[color:var(--fr-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)]"
            >
              {message}
            </p>
          ) : null}
        </form>
      )}
    </FrCard>
  );
}
