/**
 * Thread frame, v4 "FIRST RESPONSE": the PRODUCT chrome around a demo thread
 * (the thread header with contact, status pill, assignee), rendered entirely
 * with the app's own tokens. It is NOT the marketing chrome anymore: the
 * white card, the one shadow, the browser-URL hint, and the phone bezel all
 * come from the foundation <PanelFrame> (fr/panel-frame.tsx), which wraps
 * its children in `.app-scope` so everything in here resolves the app's
 * petrol system (Law 2).
 *
 *   <PanelFrame chromeUrl="loonext.com/inbox">
 *     <ThreadFrame framing="desktop" …>…beats…</ThreadFrame>
 *   </PanelFrame>
 *
 * Framings:
 * - "desktop": the thread pane as the app draws it (header + body).
 * - "phone": the mobile thread (back chevron, optional push-notification
 *   banner). Stage it inside <PanelFrame phone> (optionally phoneDark for
 *   the app's real dark mode).
 *
 * <AppSurface> is baked into the root so the embed also reads in the app's
 * own face (Golos), not the marketing trio.
 */

import { ChevronLeft, Info } from "lucide-react";

import { cn } from "@/lib/utils";

import { AppSurface } from "./app-surface";
import { DemoAvatar, DemoStatusPill } from "./thread-primitives";

/** Thread header: contact name + number, status pill, assignee avatar. */
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
    <div className="flex items-center gap-2 border-b border-app-line px-3.5 py-2.5">
      {showBack && (
        <ChevronLeft
          className="size-5 shrink-0 text-app-muted-2"
          strokeWidth={1.75}
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold leading-tight text-app-ink">
          {name}
        </p>
        <p className="truncate text-[12px] tabular-nums text-app-muted-2">
          {number}
        </p>
      </div>
      <DemoStatusPill status={status} />
      {assignee && <DemoAvatar name={assignee} className="size-6 text-[10px]" />}
      {!assignee && (
        <Info
          className="size-4 shrink-0 text-app-muted-2"
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
  /** Push-notification banner drawn above the phone thread. */
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
  return (
    <AppSurface className={cn("relative", className)}>
      {framing === "phone" && pushBanner && (
        <div className="app-shadow-float absolute inset-x-2 top-2 z-10 rounded-app-card border border-app-line bg-app-white/95 px-3 py-2 backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="bg-primary flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold">
              L
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold text-app-ink">
                {pushBanner.title}
              </p>
              <p className="truncate text-[11px] text-app-muted">
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
        showBack={framing === "phone"}
      />
      {children}
    </AppSurface>
  );
}
