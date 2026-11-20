"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/provider";
import type { Translate } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
import { fetchMe, useUpdateDisplayName } from "@/lib/api/me";
import { useAcceptInvite } from "@/lib/api/team";
import { writeCompanyCookie } from "@/lib/company/cookie";
import { endSessionOnThisDevice } from "@/lib/auth/end-session";
import { authErrorMessage } from "@/lib/auth/messages";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

type SessionState = "checking" | "authed" | "anonymous";
type ProfileState = "checking" | "form" | "ready" | "error";
const MIN_PASSWORD_LENGTH = 8;

function inviteErrorCopy(
  error: unknown,
  t: Translate,
): {
  title: string;
  body: string;
  wrongEmail: boolean;
} {
  if (error instanceof ApiError) {
    if (error.code === "forbidden") {
      return {
        title: t("onboarding.inviteWrongEmailTitle"),
        body: t("onboarding.inviteWrongEmailBody"),
        wrongEmail: true,
      };
    }
    if (error.code === "conflict") {
      return {
        title: t("onboarding.inviteConflictTitle"),
        body: error.message,
        wrongEmail: false,
      };
    }
    if (error.code === "not_found") {
      return {
        title: t("onboarding.inviteNotFoundTitle"),
        body: t("onboarding.inviteNotFoundBody"),
        wrongEmail: false,
      };
    }
  }
  return {
    title: t("onboarding.inviteErrorTitle"),
    body: t("onboarding.inviteErrorBody"),
    wrongEmail: false,
  };
}

/**
 * Invite acceptance (G3 URL /invite/[token]; token = invite id from the
 * email link). The Supabase invite link signs the user in on arrival; the
 * page then completes membership via POST /v1/invites/accept and lands in
 * /inbox (G12). Signed-out visitors are sent through /login first.
 */
export default function InviteAcceptPage() {
  const t = useT();
  const params = useParams<{ token: string }>();
  const { token } = params;
  const router = useRouter();
  const accept = useAcceptInvite();
  const updateName = useUpdateDisplayName();
  const attempted = useRef(false);
  const [sessionState, setSessionState] = useState<SessionState>("checking");
  const [profileState, setProfileState] = useState<ProfileState>("checking");
  const [profileRetry, setProfileRetry] = useState(0);
  const [name, setName] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let cancelled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled && session) setSessionState("authed");
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) {
        setSessionState("authed");
        return;
      }
      setTimeout(() => {
        if (!cancelled) {
          setSessionState((state) =>
            state === "checking" ? "anonymous" : state,
          );
        }
      }, 2500);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const acceptInvite = useRef(() => {
    if (attempted.current) return;
    attempted.current = true;
    accept.mutate(token, {
      onSuccess: (membership) => {
        // The new team becomes the active workspace immediately.
        writeCompanyCookie(membership.company_id);
        router.replace("/for-you");
        router.refresh();
      },
    });
  });

  useEffect(() => {
    if (sessionState !== "authed") return;
    let cancelled = false;
    void fetchMe()
      .then((me) => {
        if (cancelled) return;
        const needsName = me.display_name.trim() === "";
        const passwordRequired =
          me.has_password === false ||
          new URLSearchParams(window.location.search).get("setup") === "password";
        if (!needsName && !passwordRequired) {
          setProfileState("ready");
          acceptInvite.current();
        } else {
          setName(me.display_name);
          setNeedsPassword(passwordRequired);
          setProfileState("form");
        }
      })
      .catch(() => {
        if (!cancelled) setProfileState("error");
      });
    return () => {
      cancelled = true;
    };
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Retry reloads the profile within the same session.
  }, [sessionState, profileRetry]);

  async function submitProfile(e: React.SubmitEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (saving || !trimmed || (needsPassword && password.length < MIN_PASSWORD_LENGTH)) {
      return;
    }
    setSaving(true);
    try {
      await updateName.mutateAsync(trimmed);
      if (needsPassword) {
        const { error } = await getSupabaseBrowser().auth.updateUser({ password });
        if (error) {
          toast.error(authErrorMessage(error, t));
          return;
        }
        setPassword("");
        const inviteUrl = new URL(window.location.href);
        inviteUrl.searchParams.delete("setup");
        window.history.replaceState(window.history.state, "", inviteUrl);
      }
      setProfileState("ready");
      acceptInvite.current();
    } catch {
      toast.error(t("onboarding.inviteProfileSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function signOutAndLogin() {
    // Signing out to accept an invite as someone else is exactly the handover
    // that leaves the previous member's push subscription on this browser
    // (#264). No workspace is active here, so this only ends the browser's
    // subscription — the server prunes the row as dead on its next send.
    await endSessionOnThisDevice(null);
    router.push(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  if (sessionState === "checking") {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-full" />
        <p className="text-sm text-muted-foreground">
          {t("onboarding.openingInvite")}
        </p>
      </div>
    );
  }

  if (sessionState === "anonymous") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("onboarding.invitedTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("onboarding.invitedBody")}
        </p>
        <Button asChild className="w-full">
          <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>
            {t("onboarding.loginToAccept")}
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">
          {t("onboarding.noPasswordYet")}{" "}
          <Link
            href="/reset-password"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("onboarding.setOneHere")}
          </Link>
          .
        </p>
      </div>
    );
  }

  if (profileState === "error") {
    return (
      <div className="space-y-4">
        <p role="alert" className="text-sm text-destructive">
          {t("onboarding.inviteErrorBody")}
        </p>
        <Button
          className="w-full"
          onClick={() => {
            setProfileState("checking");
            setProfileRetry((retry) => retry + 1);
          }}
        >
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  if (profileState === "form") {
    return (
      <form method="post" onSubmit={(e) => { void submitProfile(e); }} className="space-y-4">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t(needsPassword ? "onboarding.inviteProfileTitle" : "onboarding.whatsYourName")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("onboarding.nameForTeammates")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-name">{t("onboarding.yourNameLabel")}</Label>
          <Input
            id="invite-name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder={t("onboarding.inviteNamePlaceholder")}
          />
        </div>
        {needsPassword ? (
          <div className="space-y-1.5">
            <Label htmlFor="invite-password">{t("onboarding.inviteChoosePassword")}</Label>
            <PasswordInput
              id="invite-password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              aria-describedby="invite-password-rule"
              required
            />
            <p id="invite-password-rule" className="text-sm text-muted-foreground">
              {t("onboarding.passwordTooShort")}
            </p>
          </div>
        ) : null}
        <Button
          type="submit"
          className="w-full"
          disabled={name.trim() === "" || saving}
        >
          {saving
            ? t("onboarding.joining")
            : t("onboarding.continue")}
        </Button>
      </form>
    );
  }

  if (accept.isError) {
    const copy = inviteErrorCopy(accept.error, t);
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.body}</p>
        {copy.wrongEmail ? (
          <Button onClick={() => void signOutAndLogin()} className="w-full">
            {t("onboarding.loginDifferentEmail")}
          </Button>
        ) : (
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">{t("onboarding.backToLogin")}</Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Skeleton className="h-7 w-44" />
      <Skeleton className="h-4 w-full" />
      <p className="text-sm text-muted-foreground">
        {t("onboarding.joiningTeam")}
      </p>
    </div>
  );
}
