/**
 * Pure logic for the /contact work-order form, kept out of the React component
 * so it can be unit-tested in the apps/web vitest node runner (no DOM library):
 * client-side validation, the request-body builder (including the honeypot
 * pass-through), the endpoint URL construction, the error-code to human-copy
 * map, and the network submit itself with an injectable fetch.
 *
 * The real POST /contact endpoint (apps/api/src/routes/contact.ts) is the
 * source of truth for validation; this file only pre-checks so the visitor
 * sees inline feedback before a round trip. It is a PUBLIC endpoint, so the
 * submit uses a plain fetch (never apiFetch, which attaches auth headers).
 */
import { SUPPORT_EMAIL } from "@/lib/marketing/business";

/** Minimum message length the server enforces (contactBodySchema, min(10)). */
export const CONTACT_MIN_MESSAGE = 10;

/** The one input the visitor never sees the machinery of. */
export interface ContactFormValues {
  name: string;
  email: string;
  message: string;
  /** Optional business name (maps to the endpoint's `company`). */
  company: string;
  /** Honeypot: humans leave it empty; whatever it holds is sent verbatim. */
  website: string;
}

export interface ContactFieldErrors {
  name?: string;
  email?: string;
  message?: string;
}

/**
 * Deliberately permissive email shape check: one `@`, a dot in the domain, no
 * spaces. The server runs the authoritative validation; this only spares the
 * visitor an obviously-doomed submit.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Client pre-check mirroring the server's required fields. */
export function validateContactForm(
  values: ContactFormValues,
): ContactFieldErrors {
  const errors: ContactFieldErrors = {};

  if (values.name.trim().length === 0) {
    errors.name = "Please enter your name.";
  }

  const email = values.email.trim();
  if (email.length === 0) {
    errors.email = "Please enter your email address.";
  } else if (!isValidEmail(email)) {
    errors.email = "Please enter a valid email address.";
  }

  if (values.message.trim().length < CONTACT_MIN_MESSAGE) {
    errors.message = `Please write at least ${CONTACT_MIN_MESSAGE} characters so we can help.`;
  }

  return errors;
}

export function hasFieldErrors(errors: ContactFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** The JSON body POSTed to the endpoint. */
export interface ContactRequestBody {
  name: string;
  email: string;
  message: string;
  company?: string;
  /** Honeypot value, always sent (empty for humans). */
  website: string;
}

/**
 * Build the request body. Text fields are trimmed (the server trims too);
 * `company` is omitted when blank so the endpoint sees an absent optional
 * rather than an empty string. The honeypot `website` is passed through as-is:
 * the server, not the client, decides what a filled honeypot means.
 */
export function buildContactRequestBody(
  values: ContactFormValues,
): ContactRequestBody {
  const body: ContactRequestBody = {
    name: values.name.trim(),
    email: values.email.trim(),
    message: values.message.trim(),
    website: values.website,
  };
  const company = values.company.trim();
  if (company.length > 0) {
    body.company = company;
  }
  return body;
}

/**
 * The endpoint lives at the API origin ROOT (not under /v1). Strip a trailing
 * slash from the base so we never build a double slash, matching the api
 * client's own join (lib/api/core.ts).
 */
export function contactEndpoint(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/$/, "")}/contact`;
}

/** Copy shown when the request never reached the server. */
export const CONTACT_NETWORK_ERROR =
  "Your message did not send. Please check your connection and try again.";

/**
 * Map the endpoint's error envelope to a sentence a human can act on. Keyed on
 * the stable `code` first (the reliable signal), with the HTTP status as a
 * backstop for a body we could not parse.
 */
export function messageForErrorCode(
  code: string | undefined,
  status?: number,
): string {
  if (code === "rate_limited" || status === 429) {
    return "We have received a lot of messages recently. Please try again in a little while.";
  }
  if (code === "validation_failed" || status === 422 || status === 400) {
    return "Some of the details need another look. Please check the fields and try again.";
  }
  return `Something went wrong on our end and your message did not send. Please try again, or email us at ${SUPPORT_EMAIL}.`;
}

export interface ContactSubmitConfig {
  /** Base API origin, e.g. publicEnv.NEXT_PUBLIC_API_URL. */
  apiBaseUrl: string;
  /** Injectable fetch for tests; defaults to the global. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export type ContactSubmitResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * POST the form to the real endpoint. Returns a settled result (never throws)
 * so the component can render an honest state for every outcome:
 * network failure, a mapped server error, or success.
 */
export async function submitContact(
  values: ContactFormValues,
  config: ContactSubmitConfig,
): Promise<ContactSubmitResult> {
  const fetchImpl = config.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(contactEndpoint(config.apiBaseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildContactRequestBody(values)),
      signal: config.signal,
    });
  } catch {
    return { ok: false, message: CONTACT_NETWORK_ERROR };
  }

  // 201 { ok: true } on success (any 2xx is treated as success).
  if (response.ok) {
    return { ok: true };
  }

  let code: string | undefined;
  try {
    const payload = (await response.json()) as {
      error?: { code?: string };
    };
    code = payload?.error?.code;
  } catch {
    code = undefined;
  }
  return { ok: false, message: messageForErrorCode(code, response.status) };
}

/**
 * Compose the RFC 6068 mailto URL for the fallback link (people who prefer
 * their own mail client). Field values must be percent-encoded
 * (encodeURIComponent), NOT form-encoded: URLSearchParams turns spaces into
 * literal "+" characters, which mail clients (Outlook, Apple Mail,
 * Thunderbird) render verbatim in the drafted subject and body.
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
