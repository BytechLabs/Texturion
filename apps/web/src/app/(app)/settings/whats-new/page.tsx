"use client";

import { WHATS_NEW, unseenEntries } from "@loonext/shared";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { SettingsCard, SettingsPage } from "@/components/settings/section";
import { sayWith, useT } from "@/i18n/provider";
import { useCompany } from "@/lib/api/companies";
import { markWhatsNewSeen, readWhatsNewSeen } from "@/lib/whats-new/seen";
import { cn } from "@/lib/utils";

/**
 * #321 — what's new, in the product.
 *
 * # Why a settings section and not a modal
 *
 * #321 is explicit: "the audience is holding a phone on a job site; anything
 * that blocks the inbox is a failure." So this is somewhere you GO, marked with
 * a dot when there is something behind it, and never something that arrives
 * over the top of a customer conversation.
 *
 * *Applying: Ethical Friction inverted — the manual reserves interruption for
 * high-stakes actions, and telling somebody about a feature is the opposite of
 * that. Zen of Clarity — a dated list, one line and two sentences each, with a
 * way in. Chunking — the new ones are marked rather than separated, because two
 * lists of the same thing is a decision the reader has to make for no reason.*
 *
 * # Each entry points at the thing
 *
 * "The value is in taking someone to the thing on the screen where it now
 * exists." An entry with no single home links nowhere rather than sending
 * somebody somewhere approximate.
 *
 * # The stamp happens on open, not on load
 *
 * Opening this page is what "I have seen it" means. Stamping it when the app
 * boots would clear the marker for somebody who never looked, which is the one
 * way to make the feature actively misleading.
 */
export default function WhatsNewSettingsPage() {
  const t = useT();
  // #228: the changelog names catalogue keys, so it reads in the reader's
  // language rather than in whichever one it was written in.
  const say = sayWith(t);
  const company = useCompany();
  const joinedAt = company.data?.created_at ?? null;

  // Captured BEFORE the stamp below, so the entries that were new when they
  // arrived stay marked while they read them.
  const [seenAtOpen] = useState(() => readWhatsNewSeen());
  useEffect(() => {
    markWhatsNewSeen();
  }, []);

  const unseen = useMemo(
    () => new Set(unseenEntries(seenAtOpen, joinedAt).map((e) => e.title)),
    [seenAtOpen, joinedAt],
  );

  return (
    <SettingsPage
      title={t("appShell.whatsNewTitle")}
      description={t("appShell.whatsNewDescription")}
    >
      {WHATS_NEW.map((entry) => (
        <SettingsCard key={`${entry.date}-${entry.title}`} title={say(entry.title)}>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <time
                dateTime={entry.date}
                className="text-xs tabular-nums text-muted-foreground"
              >
                {new Date(`${entry.date}T00:00:00Z`).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              </time>
              {unseen.has(entry.title) && (
                <span
                  className={cn(
                    "rounded-full bg-primary/10 px-2 py-0.5 text-[11px]",
                    "font-medium text-primary",
                  )}
                >
                  {t("appShell.whatsNewBadge")}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{say(entry.body)}</p>
            {entry.href && (
              <Link
                href={entry.href}
                className="inline-block text-sm font-medium text-primary hover:underline"
              >
                {t("appShell.whatsNewGoLook")}
              </Link>
            )}
          </div>
        </SettingsCard>
      ))}
      <p className="text-[13px] text-muted-foreground">
        {t("appShell.whatsNewFootnote")}
      </p>
    </SettingsPage>
  );
}
