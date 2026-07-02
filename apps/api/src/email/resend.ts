import type { Env } from "../env";

export interface SendEmailInput {
  /** One address or several (Resend accepts both). */
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}

export interface SentEmail {
  id: string;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Resend REST client (SPEC §3: Resend owns ALL transactional email). Plain
 * `fetch` — no SDK — so the Worker's only email dependency is the platform
 * network edge. Sender comes from RESEND_FROM. Throws on any non-2xx so
 * callers (webhook handlers, crons) surface failures into their retry
 * machinery instead of silently dropping notifications.
 */
export async function sendEmail(
  env: Env,
  input: SendEmailInput,
): Promise<SentEmail> {
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: Array.isArray(input.to) ? input.to : [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!response.ok) {
    // Resend error bodies are JSON `{ name, message }`; keep whatever we got
    // for the thrown message but never let a broken body mask the status.
    const body = await response.text().catch(() => "");
    throw new Error(
      `Resend send failed: HTTP ${response.status}${body ? ` — ${body.slice(0, 500)}` : ""}`,
    );
  }

  const payload = (await response.json()) as { id?: unknown };
  if (typeof payload.id !== "string") {
    throw new Error("Resend send failed: response carried no email id.");
  }
  return { id: payload.id };
}
