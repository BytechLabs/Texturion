"use client";

import { ArrowRight, Download, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/provider";
import { APP_VERSION, useAppRelease, useUpdateRequirement } from "@/lib/api/app-release";

/**
 * #339 — the two things we can say about an old build, and they are not the
 * same kind of thing at all.
 *
 * SOFT (this file's default): a calm, dismissible card. An update exists and is
 * worth having. It costs nothing to ignore, so it does not get a modal, does
 * not steal focus, and does not come back for the rest of the session once
 * dismissed. Modelled on the invite banner, which is the same shape of
 * message: ambient, never blocking.
 *
 * BLOCK: a full screen the person cannot get past. Reserved by D71 for
 * security or genuine incompatibility, because for a plumber standing in a
 * customer's basement, being locked out is worse than almost any bug it would
 * protect them from. It always names WHY and always offers the way out.
 *
 * Applying: Zen of Clarity (the soft card carries one sentence and one action),
 * Ethical Friction (the block is deliberate weight for a deliberate decision,
 * never used for a nice-to-have), and the Safety Principle — an update demand
 * that appears without explanation reads as a hijack, so both surfaces carry
 * the server's own reason.
 */

/**
 * Dismissed per RECOMMENDED VERSION, per browser session.
 *
 * Keyed on the version rather than a single flag so a click somebody made last
 * week cannot swallow the next release's notice. Exported for its own test:
 * getting this wrong is silent, and the symptom is a prompt nobody ever sees
 * again.
 */
export const dismissKey = (version: string | null) =>
  `jt-update-dismissed:${version ?? "unknown"}`;

export function UpdatePrompt() {
  const t = useT();
  const requirement = useUpdateRequirement();
  const { data: policy } = useAppRelease();
  const [dismissed, setDismissed] = useState(false);

  // sessionStorage is unavailable during SSR, so the hydrate runs client-side.
  useEffect(() => {
    if (!policy?.recommended_version) return;
    try {
      setDismissed(sessionStorage.getItem(dismissKey(policy.recommended_version)) === "1");
    } catch {
      // A browser with storage disabled simply sees the card each session.
    }
  }, [policy?.recommended_version]);

  if (requirement === "block") return <UpdateBlock />;
  if (requirement !== "soft" || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(dismissKey(policy?.recommended_version ?? null), "1");
    } catch {
      // Dismissal that does not persist is still a dismissal for this view.
    }
  };

  return (
    <div
      className="fixed bottom-4 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2"
      role="status"
    >
      <div className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-lg">
        <Download className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("shell.updateReadyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {/* The server's reason, when it gave one. Never invented here: a
                demand we cannot explain is one the reader should not trust. */}
            {policy?.message ?? t("shell.updateReadyBody")}
          </p>
          <Button
            size="sm"
            className="mt-3"
            onClick={() => window.location.reload()}
          >
            {t("shell.updateReload")}
            {/* Right chevron on the forward action, per the paywall/CTA rule. */}
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("shell.updateDismiss")}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/**
 * The floor. A full-screen stop, with the reason and the way out.
 *
 * No dismiss control on purpose — a block somebody can click past is not a
 * block, and pretending otherwise would be worse than not having one. The
 * version is shown because the first thing support will ask is "what are you
 * running", and the person is, by construction, unable to reach the settings
 * screen that would tell them.
 */
function UpdateBlock() {
  const t = useT();
  const { data: policy } = useAppRelease();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
          <Download className="size-6 text-foreground" aria-hidden />
        </div>
        <h1 className="mt-6 text-xl font-semibold">{t("shell.updateBlockTitle")}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {policy?.message ?? t("shell.updateBlockBody")}
        </p>
        <Button className="mt-6 w-full" onClick={() => window.location.reload()}>
          {t("shell.updateBlockAction")}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
        <p className="mt-4 text-xs text-muted-foreground">
          {t("shell.updateVersion", {
            version: APP_VERSION ?? t("shell.updateUnknownVersion"),
          })}
          {policy?.minimum_version
            ? t("shell.updateMinimum", { version: policy.minimum_version })
            : ""}
        </p>
      </div>
    </div>
  );
}
