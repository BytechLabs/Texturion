/**
 * Thread frame (Track B), the chrome around a demo thread.
 *
 * Two framings per BLUEPRINT §1.3:
 * - "desktop": a white card with a minimal stone browser-chrome hint (three
 *   dots + `loonext.app/inbox` URL), quietly reinforces "it's just the web,
 *   no download". Used by the hero right phone / deep-dive.
 * - "phone": a neutral rounded frame (stone ring, 28px radius), NO Apple/Android
 *   device chrome (keeps the PWA story honest). Used by the hero left phone and
 *   the dark band.
 *
 * The soft ambient shadow is the marketing exception to the app's no-card-shadow
 * rule (BLUEPRINT §1.3), allowed only on framed product visuals.
 */

import { ChevronLeft, Info } from "lucide-react";

import { cn } from "@/lib/utils";

import { DemoAvatar, DemoStatusPill } from "./thread-primitives";

const AMBIENT_SHADOW = "shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]";

/** The browser-chrome hint (three dots + neutral URL bar), v3 hairlines. */
function BrowserChrome({ url = "loonext.app/inbox" }: { url?: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-[color:var(--hairline)] bg-[color:var(--paper-2)] px-3 py-2">
      <div className="flex gap-1.5" aria-hidden>
        <span className="size-2.5 rounded-full bg-[rgba(11,43,38,0.18)]" />
        <span className="size-2.5 rounded-full bg-[rgba(11,43,38,0.18)]" />
        <span className="size-2.5 rounded-full bg-[rgba(11,43,38,0.18)]" />
      </div>
      {/* --ink-55 (4.9:1 on white) so this quiet URL hint clears WCAG AA and
          reads petrol-cast, not warm stone. A muted chrome hint, not body. */}
      <div className="mx-auto flex max-w-[60%] items-center rounded-md bg-white px-3 py-0.5 text-[11px] text-[color:var(--ink-55)]">
        {url}
      </div>
    </div>
  );
}

/** Thread header: contact name + number, status pill, assignee (G5). */
function ThreadHeader({
  name,
  number,
  status,
  assignee,
  showBack,
}: {
  name: string;
  number: string;
  status: "new" | "open" | "waiting" | "closed";
  assignee?: string;
  showBack?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-[color:var(--hairline)] px-3 py-2.5">
      {showBack && (
        <ChevronLeft
          className="size-5 shrink-0 text-[color:var(--ink-55)]"
          strokeWidth={1.75}
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold leading-tight text-[color:var(--day-ink)]">
          {name}
        </p>
        <p className="truncate text-[12px] tabular-nums text-[color:var(--ink-55)]">
          {number}
        </p>
      </div>
      <DemoStatusPill status={status} />
      {assignee && <DemoAvatar name={assignee} className="size-6 text-[10px]" />}
      {!assignee && (
        <Info
          className="size-4 shrink-0 text-[color:var(--ink-55)]"
          strokeWidth={1.75}
          aria-hidden
        />
      )}
    </div>
  );
}

export interface ThreadFrameProps {
  framing: "desktop" | "phone";
  contact: { name: string; number: string };
  status: "new" | "open" | "waiting" | "closed";
  assignee?: string;
  /** Push-notification banner drawn above the phone thread (dark band, §3.7). */
  pushBanner?: { title: string; body: string };
  children: React.ReactNode;
  className?: string;
}

export function ThreadFrame({
  framing,
  contact,
  status,
  assignee,
  pushBanner,
  children,
  className,
}: ThreadFrameProps) {
  if (framing === "phone") {
    return (
      <div
        className={cn(
          "relative mx-auto w-full max-w-[300px] overflow-hidden rounded-[28px] border-[6px] border-[color:var(--paper-edge)] bg-white",
          AMBIENT_SHADOW,
          className,
        )}
      >
        {pushBanner && (
          <div className="absolute inset-x-2 top-2 z-10 rounded-xl border border-[color:var(--hairline)] bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
            <div className="flex items-center gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[color:var(--petrol)] text-[10px] font-semibold text-white">
                J
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold text-[color:var(--day-ink)]">
                  {pushBanner.title}
                </p>
                <p className="truncate text-[11px] text-[color:var(--ink-55)]">
                  {pushBanner.body}
                </p>
              </div>
            </div>
          </div>
        )}
        <ThreadHeader
          name={contact.name}
          number={contact.number}
          status={status}
          assignee={assignee}
          showBack
        />
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[10px] border border-[color:var(--hairline)] bg-white",
        AMBIENT_SHADOW,
        className,
      )}
    >
      <BrowserChrome />
      <ThreadHeader
        name={contact.name}
        number={contact.number}
        status={status}
        assignee={assignee}
      />
      {children}
    </div>
  );
}
