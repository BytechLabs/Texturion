"use client";

import { useState } from "react";

import { SUPPORT_EMAIL } from "@/lib/marketing/business";

/**
 * The contact work-order form (COPY-DECK v2 /contact): name, business,
 * message, styled after the composer's shape (one card, a big message box,
 * one send action). Email is Loonext's only support channel, so submitting
 * composes a pre-filled message and opens the visitor's email app via a
 * mailto: link; we say so plainly under the button. No data is sent anywhere
 * by this page itself.
 */
/**
 * Compose the RFC 6068 mailto URL for the work order. Hfield values must be
 * percent-encoded (encodeURIComponent), NOT form-encoded: URLSearchParams
 * turns spaces into literal "+" characters, which mail clients (Outlook,
 * Apple Mail, Thunderbird) render verbatim in the drafted subject and body.
 */
export function buildMailto(
  name: string,
  business: string,
  message: string,
): string {
  const subject = name ? `Loonext question from ${name}` : "Loonext question";
  const signature = [name, business].filter(Boolean).join(", ");
  const body = signature ? `${message}\n\n${signature}` : message;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function ContactForm() {
  const [name, setName] = useState("");
  const [business, setBusiness] = useState("");
  const [message, setMessage] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Open the visitor's email client with the message pre-filled.
    window.location.href = buildMailto(name, business, message);
  }

  const fieldClass =
    "w-full rounded-[10px] bg-[color:var(--fr-frost)] px-3.5 py-2.5 text-[0.9375rem] text-[color:var(--fr-ink)] placeholder:text-[color:var(--fr-ink-55)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]";
  const labelClass =
    "block text-sm font-semibold text-[color:var(--fr-ink)]";

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="contact-name" className={labelClass}>
            Your name
          </label>
          <input
            id="contact-name"
            className={fieldClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="contact-business" className={labelClass}>
            Your business
          </label>
          <input
            id="contact-business"
            className={fieldClass}
            value={business}
            onChange={(e) => setBusiness(e.target.value)}
            autoComplete="organization"
            placeholder="Reyes Plumbing"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="contact-message" className={labelClass}>
          How can we help?
        </label>
        <textarea
          id="contact-message"
          className={fieldClass}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={6}
          required
        />
      </div>
      <button
        type="submit"
        className="inline-flex w-full items-center justify-center rounded-full bg-[color:var(--fr-cobalt)] px-7 py-3.5 text-[0.9375rem] font-semibold whitespace-nowrap text-white transition-colors duration-200 ease-out hover:bg-[color:var(--fr-cobalt-deep)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)] sm:w-auto"
      >
        Open in your email app
      </button>
      <p className="text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
        This opens your email app with the message ready to send to{" "}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="font-medium text-[color:var(--fr-cobalt)] underline decoration-[color:var(--fr-cobalt)]/35 underline-offset-4 hover:decoration-[color:var(--fr-cobalt)]"
        >
          {SUPPORT_EMAIL}
        </a>
        . Prefer to write it yourself? That address works too.
      </p>
    </form>
  );
}
