"use client";

import { useEffect, useRef, useState } from "react";

import { publicEnv } from "@/env";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";

import {
  buildMailto,
  hasFieldErrors,
  submitContact,
  validateContactForm,
  type ContactFieldErrors,
  type ContactFormValues,
} from "./contact-form-logic";

/**
 * The contact work-order form (COPY-DECK v2 /contact): name, email, business,
 * message, styled after the composer's shape (one card, a big message box, one
 * send action). Submitting POSTs to the real PUBLIC endpoint
 * `${NEXT_PUBLIC_API_URL}/contact` (a plain fetch, no auth headers); on success
 * the form is replaced by a plain confirmation. A pre-filled mailto stays as a
 * fallback link for people who prefer their own mail client. All pure logic
 * (validation, request body, honeypot pass-through, error mapping, submit)
 * lives in ./contact-form-logic so it can be unit-tested in the node runner.
 */

const EMPTY: ContactFormValues = {
  name: "",
  email: "",
  message: "",
  company: "",
  website: "",
};

type Status = "idle" | "submitting" | "success";

export function ContactForm() {
  const [values, setValues] = useState<ContactFormValues>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<ContactFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  // Bumped on every error event so the alert is (re)focused only then, not on
  // each keystroke that clears a field's error.
  const [errorNonce, setErrorNonce] = useState(0);

  const errorRef = useRef<HTMLDivElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (errorNonce > 0) errorRef.current?.focus();
  }, [errorNonce]);

  useEffect(() => {
    if (status === "success") confirmationRef.current?.focus();
  }, [status]);

  function update<K extends keyof ContactFormValues>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    // Clear this field's inline error as the visitor corrects it.
    setFieldErrors((errs) => {
      if (!(key in errs)) return errs;
      const next = { ...errs };
      delete next[key as keyof ContactFieldErrors];
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "submitting") return; // prevent double submit

    const errors = validateContactForm(values);
    setFieldErrors(errors);
    setFormError(null);
    if (hasFieldErrors(errors)) {
      setErrorNonce((n) => n + 1);
      return;
    }

    setStatus("submitting");
    const result = await submitContact(values, {
      apiBaseUrl: publicEnv.NEXT_PUBLIC_API_URL,
    });
    if (result.ok) {
      setStatus("success");
      return;
    }
    setStatus("idle");
    setFormError(result.message);
    setErrorNonce((n) => n + 1);
  }

  const fieldClass =
    "w-full rounded-[10px] bg-[color:var(--fr-frost)] px-3.5 py-2.5 text-[0.9375rem] text-[color:var(--fr-ink)] placeholder:text-[color:var(--fr-ink-55)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)] disabled:opacity-60";
  const labelClass = "block text-sm font-semibold text-[color:var(--fr-ink)]";
  // The FR palette has no error red (§2: nine colors are the law; flare is
  // whitelist-only, never body text). Errors read through weight, the alert
  // role, and aria-invalid, not a bespoke color.
  const errorTextClass = "text-sm font-semibold text-[color:var(--fr-ink)]";
  const submitting = status === "submitting";

  if (status === "success") {
    return (
      <div
        ref={confirmationRef}
        tabIndex={-1}
        role="status"
        className="rounded-xl bg-[color:var(--fr-frost)] p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)] sm:p-8"
      >
        <h2 className="fr-h3 text-[color:var(--fr-ink)]">
          Thanks, your message was sent.
        </h2>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink-70)]">
          We read every message and reply within one business day. If it is
          urgent, you can also email us at{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-[color:var(--fr-cobalt)] underline decoration-[color:var(--fr-cobalt)]/35 underline-offset-4 hover:decoration-[color:var(--fr-cobalt)]"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>
    );
  }

  const showSummary = formError !== null || hasFieldErrors(fieldErrors);

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {showSummary && (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="rounded-[10px] bg-[color:var(--fr-frost)] px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
        >
          <p className={errorTextClass}>
            {formError ?? "Please fix the highlighted fields and try again."}
          </p>
          {hasFieldErrors(fieldErrors) && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-[color:var(--fr-ink-70)]">
              {fieldErrors.name && <li>{fieldErrors.name}</li>}
              {fieldErrors.email && <li>{fieldErrors.email}</li>}
              {fieldErrors.message && <li>{fieldErrors.message}</li>}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="contact-name" className={labelClass}>
            Your name
          </label>
          <input
            id="contact-name"
            className={fieldClass}
            value={values.name}
            onChange={(e) => update("name", e.target.value)}
            autoComplete="name"
            disabled={submitting}
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={fieldErrors.name ? "contact-name-error" : undefined}
          />
          {fieldErrors.name && (
            <p id="contact-name-error" className={errorTextClass}>
              {fieldErrors.name}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="contact-email" className={labelClass}>
            Your email
          </label>
          <input
            id="contact-email"
            type="email"
            className={fieldClass}
            value={values.email}
            onChange={(e) => update("email", e.target.value)}
            autoComplete="email"
            disabled={submitting}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={
              fieldErrors.email ? "contact-email-error" : undefined
            }
          />
          {fieldErrors.email && (
            <p id="contact-email-error" className={errorTextClass}>
              {fieldErrors.email}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="contact-business" className={labelClass}>
          Your business{" "}
          <span className="font-normal text-[color:var(--fr-ink-55)]">
            (optional)
          </span>
        </label>
        <input
          id="contact-business"
          className={fieldClass}
          value={values.company}
          onChange={(e) => update("company", e.target.value)}
          autoComplete="organization"
          placeholder="Reyes Plumbing"
          disabled={submitting}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="contact-message" className={labelClass}>
          How can we help?
        </label>
        <textarea
          id="contact-message"
          className={fieldClass}
          value={values.message}
          onChange={(e) => update("message", e.target.value)}
          rows={6}
          disabled={submitting}
          aria-invalid={fieldErrors.message ? true : undefined}
          aria-describedby={
            fieldErrors.message ? "contact-message-error" : undefined
          }
        />
        {fieldErrors.message && (
          <p id="contact-message-error" className={errorTextClass}>
            {fieldErrors.message}
          </p>
        )}
      </div>

      {/* Honeypot: off-screen, hidden from the a11y tree, never tab-focusable,
          and excluded from autofill. A human never sees or fills it; a bot that
          does gets a silent 201 from the server. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-9999px",
          width: 1,
          height: 1,
          overflow: "hidden",
        }}
      >
        <label htmlFor="contact-website">Website</label>
        <input
          id="contact-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(e) => update("website", e.target.value)}
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex w-full items-center justify-center rounded-full bg-[color:var(--fr-cobalt)] px-7 py-3.5 text-[0.9375rem] font-semibold whitespace-nowrap text-white transition-colors duration-200 ease-out hover:bg-[color:var(--fr-cobalt-deep)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)] disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
      >
        {submitting ? "Sending..." : "Send message"}
      </button>

      <p className="text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
        Prefer your own email app?{" "}
        <a
          href={buildMailto(values.name, values.company, values.message)}
          className="font-medium text-[color:var(--fr-cobalt)] underline decoration-[color:var(--fr-cobalt)]/35 underline-offset-4 hover:decoration-[color:var(--fr-cobalt)]"
        >
          Write to {SUPPORT_EMAIL}
        </a>{" "}
        instead.
      </p>
    </form>
  );
}
