"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/provider";
import { checkFeedLink, type FeedLinkCheck } from "@/lib/calendar/check-feed-link";
import { formatTimestamp } from "@/lib/format/time";
import {
  useCalendarFeed,
  useCreateCalendarFeed,
  useRevokeCalendarFeed,
} from "@/lib/api/calendar";

/**
 * #245 — your scheduled work, in the calendar you already use.
 *
 * #744: the read-only option inside the one Calendar section. A link that was
 * just created is fetched once to prove it answers.
 *
 * ## Evaluation
 *
 * A per-member subscription URL: created, rotated, revoked. The whole card is
 * one decision ("do I want this?") and one irreversible moment ("here is the
 * URL, it will not be shown again").
 *
 * ## The constraints that shaped it
 *
 * *Prioritize Intent* — the card is built around the single action. Somebody
 * arriving here either has no feed and wants one, or has one and wants it gone.
 * Nothing else is offered, and the explanation is two sentences rather than a
 * paragraph about calendar standards.
 *
 * *Ethical Friction* — revoking breaks a subscription somebody's week may
 * depend on, silently, from their point of view: their calendar simply stops
 * updating. So it takes a second press, and the second press says what breaks
 * rather than asking "are you sure".
 *
 * *Zen of Clarity* — the URL is not displayed once it has been acknowledged.
 * Keeping a live credential on screen in a settings page somebody screen-shares
 * is a hazard with no upside, and the server could not show it again anyway.
 *
 * *Meaningful Highlights* — "last read 6 minutes ago" is the one fact that
 * answers the question people actually have, which is "did this work?". A
 * subscription that has never been polled looks identical to a working one
 * without it.
 */
export function CalendarFeedCard() {
  const t = useT();
  const status = useCalendarFeed();
  const create = useCreateCalendarFeed();
  const revoke = useRevokeCalendarFeed();

  /** Shown once, then gone — the server keeps only a hash. */
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  /** null while the check is running; set once the link has answered or not. */
  const [linkCheck, setLinkCheck] = useState<FeedLinkCheck | null>(null);
  const [checkRun, setCheckRun] = useState(0);

  useEffect(() => {
    if (!url) return;
    let current = true;
    void checkFeedLink(url).then((result) => {
      if (current) setLinkCheck(result);
    });
    return () => {
      current = false;
    };
  }, [url, checkRun]);

  function recheck() {
    setLinkCheck(null);
    setCheckRun((n) => n + 1);
  }

  const active = status.data?.active === true;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // A clipboard refusal is not an error worth a toast: the URL is on
      // screen and selectable, which is the fallback every browser leaves.
      setCopied(false);
    }
  }

  return (
    <div id="calendar-read-only-feed">
      {status.isLoading ? (
        <Skeleton className="h-9 w-48" />
      ) : url ? (
        /*
         * The one irreversible moment. Amber rather than red: nothing has gone
         * wrong, but this is the only time the URL exists and closing the panel
         * without copying it means rotating to get another.
         */
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-amber-600"
              aria-hidden
            />
            <div className="min-w-0 flex-1 space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {t("calendarFeed.shownOnceTitle")}
                </p>
                <p className="text-[13px] leading-relaxed text-app-muted">
                  {t("calendarFeed.shownOnceDetail")}
                </p>
              </div>
              {/* Selectable, so a clipboard refusal still leaves a way through. */}
              <code className="block overflow-x-auto break-all rounded border bg-background px-3 py-2 font-mono text-xs">
                {url}
              </code>
              {/* #744: the product proves the link answers before the person
                  pastes it somewhere that would only say "could not subscribe". */}
              <div role="status" className="flex flex-wrap items-center gap-2 text-[13px]">
                {linkCheck === null ? (
                  <span className="text-app-muted">
                    {t("calendarFeed.linkChecking")}
                  </span>
                ) : linkCheck.state === "working" ? (
                  <span className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                    <Check className="size-4" aria-hidden />
                    {t("calendarFeed.linkWorking")}
                  </span>
                ) : (
                  <>
                    <span className="flex items-center gap-1.5 font-medium text-destructive">
                      <AlertTriangle className="size-4" aria-hidden />
                      {linkCheck.state === "error"
                        ? t("calendarFeed.linkBroken", {
                            status: String(linkCheck.status),
                          })
                        : t("calendarFeed.linkUnreachable")}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={recheck}
                    >
                      {t("calendarFeed.linkCheckAgain")}
                    </Button>
                  </>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={copy}>
                  {copied ? (
                    <Check className="size-4" aria-hidden />
                  ) : (
                    <Copy className="size-4" aria-hidden />
                  )}
                  {copied ? t("calendarFeed.copied") : t("calendarFeed.copy")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setUrl(null);
                    setLinkCheck(null);
                    setCopied(false);
                  }}
                >
                  {t("calendarFeed.done")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : active ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-[13px] text-app-muted">
            <CalendarClock className="size-4 shrink-0" aria-hidden />
            {/*
              The fact that answers "did this work?". A feed nothing has polled
              looks identical to a working one without it — and the commonest
              way this fails is somebody copying the URL and never finishing in
              their calendar app.
            */}
            {status.data?.last_read_at
              ? t("calendarFeed.lastRead", {
                  when: formatTimestamp(status.data.last_read_at, {
                    style: "long",
                    t,
                  }),
                })
              : t("calendarFeed.neverRead")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={create.isPending}
              onClick={() =>
                create.mutate(undefined, {
                  onSuccess: (data) => setUrl(data.url),
                  onError: () => toast.error(t("calendarFeed.failed")),
                })
              }
            >
              {t("calendarFeed.rotate")}
            </Button>
            {confirmingRevoke ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={revoke.isPending}
                onClick={() =>
                  revoke.mutate(undefined, {
                    onSuccess: () => setConfirmingRevoke(false),
                    onError: () => toast.error(t("calendarFeed.failed")),
                  })
                }
              >
                {/* The second press says WHAT BREAKS rather than "are you sure". */}
                {t("calendarFeed.revokeConfirm")}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingRevoke(true)}
              >
                {t("calendarFeed.revoke")}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          disabled={create.isPending}
          onClick={() =>
            create.mutate(undefined, {
              onSuccess: (data) => setUrl(data.url),
              onError: () => toast.error(t("calendarFeed.failed")),
            })
          }
        >
          <CalendarClock className="size-4" aria-hidden />
          {t("calendarFeed.create")}
        </Button>
      )}
    </div>
  );
}
