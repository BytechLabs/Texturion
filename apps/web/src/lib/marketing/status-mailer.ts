/**
 * #477 — sending the status list's mail from the marketing worker.
 *
 * A second, deliberately tiny Resend client rather than a shared one. The API
 * worker's `email/resend.ts` is the full-featured version — HTML layouts,
 * suppression checks, the ledger, reply-to routing — and every one of those
 * features is a reason it depends on the database. This one must work when the
 * database does not, so it depends on nothing but `fetch`.
 *
 * WHY THIS CAN BE ABSENT, AND WHAT HAPPENS THEN. It needs two secrets on the
 * `loonext-web` worker (`RESEND_API_KEY`, `RESEND_FROM`) which are separate
 * from the API worker's. Until somebody sets them, `readMailer` returns null,
 * the subscribe form does not render at all, and the fan-out is a no-op. That
 * is the same rule the rest of this page follows: nothing renders that isn't
 * backed by something real. A form that accepts an address it can never mail is
 * the same lie as a green dot with no probe behind it.
 */

import type { Mailer } from "./status-subscribe";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface MailerEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
}

/**
 * A mailer, or null when this worker cannot send.
 *
 * `List-Unsubscribe` and `List-Unsubscribe-Post` go on every message, so a
 * subscriber can leave from their mail client's own button without opening
 * anything. Required by the bulk-sender rules Gmail and Yahoo enforce, and the
 * right behaviour regardless of who is enforcing it.
 */
export function buildMailer(env: MailerEnv | null | undefined): Mailer | null {
  const key = env?.RESEND_API_KEY;
  const from = env?.RESEND_FROM;
  if (!key || !from) return null;
  return {
    async send(message) {
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        };
        const body: Record<string, unknown> = {
          from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        };
        if (message.listUnsubscribeUrl) {
          body.headers = {
            "List-Unsubscribe": `<${message.listUnsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          };
        }
        const response = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          // The STATUS only. A Resend error body can echo the recipient, and
          // this line goes to a log that is not the place for an address.
          console.error(`#477 status mail: resend returned ${response.status}`);
          return false;
        }
        return true;
      } catch (cause) {
        console.error(
          `#477 status mail: send failed (${cause instanceof Error ? cause.name : "unknown"})`,
        );
        return false;
      }
    },
  };
}

export interface WorkerBindings extends MailerEnv {
  STATUS_FEED?: unknown;
}

/**
 * The KV binding and the mailer, from whichever Cloudflare context exists.
 *
 * Resolves to nulls off Workers — vitest, `next build`'s prerender pass, a
 * plain node render — so every caller has one shape to handle and none of them
 * need to know where they are running.
 */
export async function readWorkerBindings(): Promise<WorkerBindings | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    return (env ?? null) as WorkerBindings | null;
  } catch {
    return null;
  }
}
