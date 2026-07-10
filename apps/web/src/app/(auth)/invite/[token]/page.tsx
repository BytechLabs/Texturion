"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/error";
import { fetchMe, useUpdateDisplayName } from "@/lib/api/me";
import { useAcceptInvite } from "@/lib/api/team";
import { writeCompanyCookie } from "@/lib/company/cookie";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

type SessionState = "checking" | "authed" | "anonymous";
/** Once authed: are we still checking the profile, asking for a name, or done. */
type NameState = "checking" | "needs-name" | "ready";

function inviteErrorCopy(error: unknown): {
  title: string;
  body: string;
  wrongEmail: boolean;
} {
  if (error instanceof ApiError) {
    if (error.code === "forbidden") {
      return {
        title: "This invite belongs to another email",
        body: "Log in with the email address the invite was sent to, then open the link again.",
        wrongEmail: true,
      };
    }
    if (error.code === "conflict") {
      return {
        title: "This invite can't be used",
        body: error.message,
        wrongEmail: false,
      };
    }
    if (error.code === "not_found") {
      return {
        title: "This invite link doesn't work",
        body: "It may have been revoked. Ask your team to send a new one.",
        wrongEmail: false,
      };
    }
  }
  return {
    title: "Something went wrong",
    body: "We couldn't accept the invite. Check your connection and try again.",
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
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();
  const accept = useAcceptInvite();
  const updateName = useUpdateDisplayName();
  const attempted = useRef(false);
  const [sessionState, setSessionState] = useState<SessionState>("checking");
  // #112: an invitee must have a display name before joining — the team sees
  // it everywhere (members list, avatars, notes). Existing accounts and
  // invite-created ones can arrive with an empty profile name (they never pass
  // through the signup form), so gate acceptance on it.
  const [nameState, setNameState] = useState<NameState>("checking");
  const [name, setName] = useState("");

  // Wait for the session — the invite link's tokens are consumed client-side
  // just after load, so "no session yet" isn't "signed out" for a moment.
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

  // Authenticated → check the profile name. Has one → accept immediately;
  // empty → ask for it (the form below), then accept.
  useEffect(() => {
    if (sessionState !== "authed") return;
    let cancelled = false;
    void fetchMe()
      .then((me) => {
        if (cancelled) return;
        if (me.display_name.trim()) {
          setNameState("ready");
          acceptInvite.current();
        } else {
          setNameState("needs-name");
        }
      })
      .catch(() => {
        // /me is unreachable — don't strand the invitee: let them accept, and
        // set a name later from the account sheet.
        if (cancelled) return;
        setNameState("ready");
        acceptInvite.current();
      });
    return () => {
      cancelled = true;
    };
  }, [sessionState]);

  function submitName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") return;
    updateName.mutate(trimmed, {
      onSuccess: () => {
        setNameState("ready");
        acceptInvite.current();
      },
      onError: () => toast.error("Couldn't save your name. Try again."),
    });
  }

  async function signOutAndLogin() {
    await getSupabaseBrowser().auth.signOut();
    router.push(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  if (sessionState === "checking") {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-full" />
        <p className="text-sm text-muted-foreground">Opening your invite…</p>
      </div>
    );
  }

  if (sessionState === "anonymous") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          You&apos;re invited
        </h1>
        <p className="text-sm text-muted-foreground">
          Log in to join your team&apos;s shared inbox. Use the email address
          this invite was sent to.
        </p>
        <Button asChild className="w-full">
          <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>
            Log in to accept
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">
          No password yet?{" "}
          <Link
            href="/reset-password"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Set one here
          </Link>
          .
        </p>
      </div>
    );
  }

  // #112: authed but no profile name yet — collect it before joining.
  if (sessionState === "authed" && nameState === "needs-name") {
    return (
      <form onSubmit={submitName} className="space-y-4">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">
            What&apos;s your name?
          </h1>
          <p className="text-sm text-muted-foreground">
            Your teammates will see this on messages, notes, and tasks.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-name">Your name</Label>
          <Input
            id="invite-name"
            autoFocus
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder="Alex Rivera"
          />
        </div>
        <Button
          type="submit"
          className="w-full"
          disabled={name.trim() === "" || updateName.isPending}
        >
          {updateName.isPending ? "Joining…" : "Continue"}
        </Button>
      </form>
    );
  }

  if (accept.isError) {
    const copy = inviteErrorCopy(accept.error);
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.body}</p>
        {copy.wrongEmail ? (
          <Button onClick={() => void signOutAndLogin()} className="w-full">
            Log in with a different email
          </Button>
        ) : (
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Back to log in</Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Skeleton className="h-7 w-44" />
      <Skeleton className="h-4 w-full" />
      <p className="text-sm text-muted-foreground">Joining your team…</p>
    </div>
  );
}
