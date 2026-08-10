"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/provider";

import { GateSignOut } from "./gate-escape";

/**
 * What a dead session looks like on an authenticated gate (#207, #257).
 *
 * The middleware fails open on an auth blip — a present session cookie plus a
 * `getUser()` error suppresses the /login redirect on purpose, so an expired
 * or revoked session reaches the page instead of being bounced. Every gate has
 * to handle that itself, and a gate that treats "no session" as "still
 * loading" sits on a skeleton forever with no sign-out and no way back: the
 * customer has to know to hand-type /login. Shared so both the app shell and
 * the onboarding wizard say the same thing and offer the same two exits.
 *
 * `GateSignOut` renders regardless of session state, which is the point —
 * `GateEscape` hides itself without one, so this is the only escape left.
 */
export function SessionExpiredCard() {
  const t = useT();
  const router = useRouter();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm text-muted-foreground">
        {t("shell.sessionExpired")}
      </p>
      <Button onClick={() => router.replace("/login")} size="sm">
        {t("shell.goToSignIn")}
      </Button>
      <GateSignOut />
    </div>
  );
}
