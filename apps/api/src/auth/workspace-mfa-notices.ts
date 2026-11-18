import { getDb } from "../db";
import { emailLayout, linkifyUrls, toHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";
import { unwrap } from "../routes/core/http";

const SEND_INTERVAL_MS = 550;

interface WorkspaceMfaNotice {
  member_id: string;
  required_at: string;
  grace_until: string | null;
  kind: "enabled" | "reminder";
  email: string;
  workspace_name: string;
  locale: string;
  timezone: string | null;
}

export async function sendWorkspaceMfaNotices(env: Env, now: Date, companyId?: string) {
  const db = getDb(env);
  const notices = unwrap<WorkspaceMfaNotice[]>(
    await db.rpc("claim_workspace_mfa_notices", {
      p_now: now.toISOString(),
      p_company_id: companyId ?? null,
    }),
    "claim workspace two-factor notices",
  );

  let failures = 0;
  for (const [index, notice] of notices.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, SEND_INTERVAL_MS));
    try {
      await sendWorkspaceMfaNotice(env, notice);
    } catch {
      const release = await db.rpc("release_workspace_mfa_notice", {
        p_member_id: notice.member_id,
        p_required_at: notice.required_at,
        p_kind: notice.kind,
      });
      if (release.error) console.error("Could not release a workspace two-factor notice.");
      failures += 1;
    }
  }
  if (failures > 0) throw new Error(`Workspace two-factor notice errors: ${failures}.`);
}

async function sendWorkspaceMfaNotice(env: Env, notice: WorkspaceMfaNotice) {
  const locale = notice.locale === "fr-CA" ? "fr-CA" : "en";
  const french = locale === "fr-CA";
  const workspace = notice.workspace_name.replace(/\s+/g, " ").trim();
  const graceUntil = notice.grace_until ? new Date(notice.grace_until) : null;
  const deadline = graceUntil && graceUntil > new Date(notice.required_at)
    ? new Intl.DateTimeFormat(french ? "fr-CA" : "en-CA", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: notice.timezone ?? "UTC",
      }).format(graceUntil)
    : null;
  const subject = notice.kind === "enabled"
    ? (french ? `L’authentification à deux facteurs est requise pour ${workspace}`
      : `Two-factor authentication is required for ${workspace}`)
    : (french ? `Rappel de sécurité pour ${workspace}` : `Security reminder for ${workspace}`);
  const instructions = french
    ? (deadline ? `Configurez l’authentification à deux facteurs avant le ${deadline} pour garder accès à cet espace.`
      : "Configurez l’authentification à deux facteurs pour accéder à cet espace.")
    : (deadline ? `Set up two-factor authentication by ${deadline} to keep access to this workspace.`
      : "Set up two-factor authentication to access this workspace.");
  const alreadySetUp = french
    ? "Si vous l’avez déjà configurée, vous pouvez continuer à utiliser cet espace."
    : "If you already set it up, you can keep using this workspace.";
  const link = new URL("/settings/account#two-factor", env.APP_ORIGIN).href;
  const text = [subject, instructions, ...(notice.kind === "enabled" ? [alreadySetUp] : []), link].join("\n\n");
  await sendEmail(env, {
    to: notice.email,
    subject,
    text,
    html: emailLayout(linkifyUrls(toHtml(text)), locale),
    locale,
    critical: true,
    idempotencyKey: `workspace-mfa:${notice.member_id}:${notice.required_at}:${notice.kind}`,
  });
}
