import * as Sentry from "@sentry/cloudflare";

import { linkifyUrls, toHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";
import { claimOpsEmailSlot, releaseOpsEmailSlot } from "./ops-email-throttle";

/**
 * The one way this product tells its operator something is wrong (D139).
 *
 * `key` is the grouping identity, not decoration: it becomes the Sentry
 * fingerprint, so repeats of one problem collapse into one issue the operator
 * can mute without silencing anything else.
 *
 * Sentry is primary and required config; email is an optional second copy,
 * with deliberately NO fallback recipient — the old `?? support@loonext.com`
 * default routed internal diagnostics into the queue customers write to. An
 * unset address is a configuration gap, and the place to notice it is Sentry.
 */
export interface OpsAlert {
  /** Stable identity for grouping. Same problem must always use the same key. */
  key: string;
  /** One line: what is wrong. Becomes the Sentry issue title. */
  summary: string;
  /** Optional detail — measurements, affected ids, timestamps. */
  detail?: string;
  /** Optional concrete first move for whoever reads this (#510). */
  action?: string;
  /** Sentry severity. Defaults to "warning"; use "error" to page. */
  level?: "warning" | "error";
  /**
   * Pre-built body, for an alert whose detail is genuinely tabular. Replaces
   * the default body only — the internal-alert footer is still appended.
   */
  html?: string;
}

/**
 * Report an operational problem. Best effort on both channels by design: this
 * runs inside crons and webhook handlers, where a failed alert must never be
 * the reason the actual work stops.
 */
export async function opsAlert(env: Env, alert: OpsAlert): Promise<void> {
  const { key, summary, detail, action, level = "warning" } = alert;

  try {
    Sentry.withScope((scope) => {
      scope.setFingerprint(["ops", key]);
      scope.setTag("ops_key", key);
      scope.setLevel(level);
      if (detail) scope.setExtra("detail", detail);
      if (action) scope.setExtra("action", action);
      Sentry.captureMessage(summary, level);
    });
  } catch (cause) {
    console.error(
      `ops alert ${key}: Sentry capture failed:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }

  if (!env.OPS_ALERT_EMAIL) return;

  const body = [summary, detail, action && `What to do: ${action}`]
    .filter(Boolean)
    .join("\n\n");

  await mailOperator(env, key, {
    subject: `[ops] ${summary}`,
    text: `${body}\n\nKey: ${key}\n`,
    html: alert.html
      ? `${alert.html}${opsFooterHtml(key)}`
      : opsEmailHtml(key, summary, detail, action),
  });
}

/**
 * The one send to the operator's mailbox, at most once per fingerprint per
 * hour (#652). Best effort: a failed send is logged and the slot handed back.
 */
async function mailOperator(
  env: Env,
  key: string,
  mail: { subject: string; text: string; html: string },
): Promise<void> {
  const recipient = env.OPS_ALERT_EMAIL;
  if (!recipient) return;
  const fingerprint = `ops:${key}`;
  if (!(await claimOpsEmailSlot(fingerprint))) return;

  try {
    await sendEmail(env, {
      to: [recipient],
      // No service-message footer, and replies go to ops, not to support.
      kind: "operational",
      replyTo: recipient,
      ...mail,
    });
  } catch (cause) {
    await releaseOpsEmailSlot(fingerprint);
    console.error(
      `ops alert ${key}: email failed:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

/** Deliberately plain, and deliberately not the customer `emailLayout`. */
function opsEmailHtml(
  key: string,
  summary: string,
  detail?: string,
  action?: string,
  link?: string,
): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const block = (s: string) =>
    `<p style="margin:0 0 12px;white-space:pre-wrap">${esc(s)}</p>`;

  return (
    `<div style="font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace">` +
    `<p style="margin:0 0 12px"><strong>${esc(summary)}</strong></p>` +
    (detail ? block(detail) : "") +
    (action ? block(`What to do: ${action}`) : "") +
    (link
      ? `<p style="margin:0 0 12px"><a href="${esc(link).replace(/"/g, "&quot;")}">Open in PostHog</a></p>`
      : "") +
    opsFooterHtml(key) +
    `</div>`
  );
}

/** The one line that must survive any body: this is not customer mail. */
function opsFooterHtml(key: string): string {
  const esc = key.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return (
    `<p style="margin:16px 0 0;font:13px/1.5 system-ui,sans-serif;color:#666">` +
    `Key: ${esc} — internal operational alert, not a customer message.</p>`
  );
}

/**
 * The migration seam for the alerts that predate `opsAlert`: it keeps the
 * caller's own subject and body verbatim, because those carry tables and lists
 * that `summary`/`detail` would flatten. Prefer `opsAlert` for anything new.
 */
export async function opsEmail(
  env: Env,
  alert: { key: string; subject: string; text: string; html?: string },
): Promise<void> {
  const { key, subject, text, html } = alert;

  try {
    Sentry.withScope((scope) => {
      scope.setFingerprint(["ops", key]);
      scope.setTag("ops_key", key);
      scope.setLevel("warning");
      scope.setExtra("detail", text);
      Sentry.captureMessage(subject, "warning");
    });
  } catch (cause) {
    console.error(
      `ops alert ${key}: Sentry capture failed:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }

  if (!env.OPS_ALERT_EMAIL) return;

  await mailOperator(env, key, {
    subject,
    text,
    html: html ? `${html}${opsFooterHtml(key)}` : opsEmailHtml(key, subject, text),
  });
}

/** What PostHog told us about an issue it opened or reopened (#652). */
export interface RelayedAlert {
  /** PostHog's grouping string; `ops:<key>` for an ops alert. */
  fingerprint: string;
  title: string;
  description?: string;
  status?: string;
  /** `$error_tracking_issue_created` or `$error_tracking_issue_reopened`. */
  event: string;
  /** Link to the issue in PostHog. */
  link?: string;
}

export type RelayOutcome = "sent" | "throttled" | "unconfigured";

/**
 * Mail an alert PostHog raised, under the same hourly slot as `opsAlert`.
 * Unlike `opsAlert` it throws when the send fails, so PostHog sees a non-2xx
 * answer and retries.
 */
export async function relayPostHogAlert(
  env: Env,
  alert: RelayedAlert,
): Promise<RelayOutcome> {
  const recipient = env.OPS_ALERT_EMAIL;
  if (!recipient) return "unconfigured";
  if (!(await claimOpsEmailSlot(alert.fingerprint))) return "throttled";

  const headline =
    alert.event === "$error_tracking_issue_reopened" ? "Issue reopened" : "New issue";
  const detail = [alert.description, alert.status && `Status: ${alert.status}`]
    .filter(Boolean)
    .join("\n\n");
  const text = [
    `${headline}: ${alert.title}`,
    detail,
    alert.link && `Open in PostHog: ${alert.link}`,
    `Key: ${alert.fingerprint}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    await sendEmail(env, {
      to: [recipient],
      kind: "operational",
      replyTo: recipient,
      subject: `[ops] ${alert.title}`,
      text: `${text}\n`,
      html: opsEmailHtml(
        alert.fingerprint,
        `${headline}: ${alert.title}`,
        detail || undefined,
        undefined,
        alert.link,
      ),
    });
  } catch (cause) {
    await releaseOpsEmailSlot(alert.fingerprint);
    throw cause;
  }
  return "sent";
}

/**
 * The ops counterpart to `emailLayout`, for a body that is already built HTML.
 * `emailLayout` is the CUSTOMER chrome — it signs every message as a service
 * message about the reader's account. `opsEmail` appends the key.
 */
export function opsBodyHtml(inner: string): string {
  return (
    `<div style="font:14px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;` +
    `color:#1a1a1a;max-width:640px">${inner}</div>`
  );
}

/**
 * The ops counterpart to `renderEmailHtml`, which is `emailLayout(...)` one
 * alias removed — thirteen ops senders reached the customer chrome through it
 * without ever naming it. Same paragraphs and links, no account voice;
 * `ops-alert.test.ts` sweeps for the alias.
 */
export function opsTextHtml(text: string): string {
  return opsBodyHtml(linkifyUrls(toHtml(text)));
}
