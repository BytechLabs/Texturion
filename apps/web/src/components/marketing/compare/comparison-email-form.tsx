"use client";

import { useRef, useState } from "react";

import { publicEnv } from "@/env";
import { trackComparisonRequested } from "@/lib/analytics/events";

import { CONSENT_LABEL } from "./comparison-consent";

/**
 * #312 — the one thing a non-converting visitor can do besides leave.
 *
 * Somebody who reads this page and closes the tab is invisible: no account, no
 * email, no signal. Everything else #312 asked for was already shipped — the
 * 30-day money-back guarantee is the trial, and /contact already lets somebody
 * raise their hand. This is the population in between: interested enough to
 * compare, not ready to buy.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS HERE AND NOT A POPUP.
 *
 * `docs/marketing/CONVERSION.md` §7 is binding and bans "no chat-widget pop-up,
 * no modal on load" and "no competing CTAs". §2 permits exactly one thing: "A
 * secondary ... is allowed but must be visually quieter." So this is an inline
 * band under the ledger, quieter than "Start for $29" in every dimension — a
 * text link's weight rather than a filled pill, no eyebrow, no card.
 *
 * Exit-intent was the obvious alternative and is the most intrusive form of this
 * there is. It also does not exist in the codebase, so building it would have
 * meant adding the machinery §7 forbids using.
 *
 * ---------------------------------------------------------------------------
 * WHY THE OFFER IS THIS AND NOT A "LEAD MAGNET".
 *
 * The numbers on this page are sourced and dated per #403, and the person reading
 * them is often not the person who signs off. "Send me these numbers" is
 * therefore a real thing to want rather than a pretext for a capture form — they
 * can forward it. Nothing is gated: the whole comparison is already on the page
 * above, so this is a convenience, never a wall.
 * *Applying: Reciprocity, and NEVER a signup wall before value.*
 *
 * ---------------------------------------------------------------------------
 * ONE FIELD, AND WHY IT HAS NO SMART DEFAULT.
 *
 * The rule is never to ship an empty form — pre-fill from what you know. Here we
 * know nothing: an anonymous visitor with no account and no cookie we would read
 * for this. So the honest application is to ask for the smallest possible thing
 * (one field, no name, no company) rather than to invent a default. Said out loud
 * because "no defaults" normally means somebody forgot.
 */

type Status = "idle" | "submitting" | "sent" | "recorded";

export function ComparisonEmailForm({
  source = "compare_page",
}: {
  source?: "compare_page" | "pricing_page";
}) {
  const [email, setEmail] = useState("");
  const [consented, setConsented] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [website, setWebsite] = useState("");
  const confirmationRef = useRef<HTMLParagraphElement>(null);

  const submitting = status === "submitting";
  const done = status === "sent" || status === "recorded";

  const fieldClass =
    "w-full rounded-[10px] bg-[color:var(--fr-frost)] px-3.5 py-2.5 text-[0.9375rem] text-[color:var(--fr-ink)] placeholder:text-[color:var(--fr-ink-55)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)] disabled:opacity-60";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const trimmed = email.trim();
    if (trimmed === "" || !trimmed.includes("@")) {
      setError("Enter an email address we can send it to.");
      return;
    }
    // An unchecked box is not consent, and a pre-checked one would not be
    // express consent at all — so this is a real gate, not a formality.
    if (!consented) {
      setError("Tick the box so we know you are happy to be emailed.");
      return;
    }

    setError(null);
    setStatus("submitting");
    try {
      const response = await fetch(
        `${publicEnv.NEXT_PUBLIC_API_URL}/marketing/comparison`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed, source, website }),
        },
      );
      if (!response.ok) {
        setStatus("idle");
        setError(
          response.status === 429
            ? "We have had a lot of these today. Try again tomorrow."
            : "That did not go through. Try again in a moment.",
        );
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { sent?: boolean };
      // Honest either way: the server reports whether an email actually went.
      // With the commercial send unconfigured the consent is recorded and
      // nothing is sent, and claiming otherwise would be a lie the person can
      // check by looking in their inbox.
      setStatus(body.sent === true ? "sent" : "recorded");
      trackComparisonRequested();
      // Move focus to the confirmation so a screen reader hears the outcome
      // rather than being left on a button that has disappeared.
      requestAnimationFrame(() => confirmationRef.current?.focus());
    } catch {
      setStatus("idle");
      setError("That did not go through. Try again in a moment.");
    }
  }

  if (done) {
    return (
      <p
        ref={confirmationRef}
        tabIndex={-1}
        className="fr-body max-w-xl text-[color:var(--fr-ink-70)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--fr-olive)]"
      >
        {status === "sent"
          ? "Sent. It should be in your inbox in a moment, and every message we send has a one-click unsubscribe."
          : "Noted, and thank you. We are not sending marketing email yet, so you will hear from us only once there is something worth sending."}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-3" noValidate>
      <div className="space-y-1.5">
        <label
          htmlFor="comparison-email"
          className="block text-sm font-semibold text-[color:var(--fr-ink)]"
        >
          Send these numbers to
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="comparison-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@yourbusiness.com"
            className={fieldClass}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (error) setError(null);
            }}
            disabled={submitting}
            aria-invalid={error !== null ? true : undefined}
            aria-describedby={error !== null ? "comparison-email-error" : undefined}
          />
          {/* Quieter than the page's primary action by construction: an outlined
              pill against the cobalt fill of "Start for $29". CONVERSION.md §2
              permits a secondary CTA only on that condition. */}
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex shrink-0 items-center justify-center rounded-full border border-[color:var(--fr-ink-55)]/40 px-5 py-2.5 text-[0.9375rem] font-semibold whitespace-nowrap text-[color:var(--fr-ink)] transition-colors duration-200 ease-out hover:border-[color:var(--fr-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? "Sending..." : "Email it to me"}
          </button>
        </div>
      </div>

      <label className="flex items-start gap-2.5 text-[0.8125rem] leading-relaxed text-[color:var(--fr-ink-70)]">
        <input
          type="checkbox"
          checked={consented}
          onChange={(event) => {
            setConsented(event.target.checked);
            if (error) setError(null);
          }}
          disabled={submitting}
          className="mt-0.5 size-4 shrink-0 accent-[color:var(--fr-olive)]"
        />
        <span>{CONSENT_LABEL}</span>
      </label>

      {error !== null && (
        <p
          id="comparison-email-error"
          role="alert"
          className="text-sm font-semibold text-[color:var(--fr-ink)]"
        >
          {error}
        </p>
      )}

      {/* Honeypot: humans never see it, and a bot that fills it gets a normal
          success from the API and nothing happens. Hidden the same way the
          contact form hides its own. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
        }}
      >
        <label htmlFor="comparison-website">Website</label>
        <input
          id="comparison-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>
    </form>
  );
}
