/**
 * TradeThread (trades crew), v4 "FIRST RESPONSE" Law 2: the EXAMPLE
 * CONVERSATION on every /for/<trade> page, rendered as a static, server-only
 * depiction of the app's real thread built from the app's own component
 * patterns and tokens.
 *
 * It is designed to sit INSIDE a marketing <PanelFrame>, whose `.app-scope`
 * wrapper resolves every app token here to the product's real values: petrol
 * `--primary` outbound bubbles (`app-bubble-out` carries its own AA text
 * pair), the amber internal-note card, the calm paper ground, the app's radii
 * (`rounded-app-bub` with the squared inner corner, exactly like
 * components/thread/message-bubble.tsx). Marketing cobalt NEVER appears in
 * here; nothing in this file references an --fr-* token.
 *
 * Real product components that are server-safe are used directly (the inbox
 * <StatusPill>); the stateful ones (MessageBubble, ThreadHeader, Composer)
 * are reproduced as static DOM with the same classes and structure.
 *
 * Accessibility: the thread adds no tab stops (DESIGN-DIRECTION §7); the
 * photo placeholders carry content-describing labels. No text in this file
 * is a label about the artifact (Law 1): the chip and caption live on the
 * PanelFrame outside.
 */

import { CheckCheck, CircleCheck, ImageIcon, Lock } from "lucide-react";

import { StatusPill } from "@/components/inbox/status-pill";
import { cn } from "@/lib/utils";

import type {
  TradeBeat,
  TradeInboundBeat,
  TradeNoteBeat,
  TradeOutboundBeat,
  TradeScript,
} from "./scripts";

/** Initials, same rule as the app's avatar helpers. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Flat single-tone avatar: petrol tint fill, petrol-deep initials (the
 *  app's calm avatar treatment, PORTAL-UX §4). */
function Avatar({ name }: { name: string }) {
  return (
    <span
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-app-tint text-[11px] font-medium text-app-petrol-deep"
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** Static render of the app's G5 thread header: contact name + number, the
 *  real StatusPill, the assignee avatar. */
function Header({ script }: { script: TradeScript }) {
  return (
    <div className="flex items-center gap-3 border-b border-app-line bg-app-white px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold leading-tight text-app-ink">
          {script.contact.name}
        </p>
        <p className="truncate text-[12px] tabular-nums text-app-muted">
          {script.contact.number}
        </p>
      </div>
      <StatusPill status={script.status} />
      <Avatar name={script.assignee} />
    </div>
  );
}

/** DOM-drawn MMS thumbnail placeholder (no rasters on the site, ever). */
function PhotoThumb({ label }: { label: string }) {
  return (
    <div
      className="flex size-28 flex-col items-center justify-center gap-1 rounded-app-ctrl border border-app-line bg-app-line-soft text-center text-app-muted"
      role="img"
      aria-label={`Photo: ${label}`}
    >
      <ImageIcon className="size-5" strokeWidth={1.75} aria-hidden />
      <span className="px-2 text-[10px] leading-tight">{label}</span>
    </div>
  );
}

/** The app's D14 petrol "Done" pill, with the "Done · Name · time" detail. */
function DoneBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
      title={label}
    >
      <CircleCheck aria-hidden className="size-3" strokeWidth={2.25} />
      Done
      <span className="sr-only"> · {label}</span>
    </span>
  );
}

function InboundBeat({
  beat,
  done,
  doneLabel,
}: {
  beat: TradeInboundBeat;
  done: boolean;
  doneLabel: string;
}) {
  return (
    <div className="flex w-full flex-col items-start gap-1">
      {beat.photoLabel && (
        <div className={cn(done && "opacity-55")}>
          <PhotoThumb label={beat.photoLabel} />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-words rounded-app-bub border border-app-line bg-app-white px-3.5 py-2.5 text-[14px] leading-[1.5] text-app-ink [border-top-left-radius:5px] md:max-w-[80%]",
          done && "opacity-55",
        )}
      >
        <span className={cn(done && "line-through")}>{beat.body}</span>
      </div>
      <span className="flex items-center gap-1.5">
        {done && <DoneBadge label={doneLabel} />}
        <span className="text-[12px] text-muted-foreground">{beat.time}</span>
      </span>
    </div>
  );
}

function OutboundBeat({
  beat,
  done,
  doneLabel,
}: {
  beat: TradeOutboundBeat;
  done: boolean;
  doneLabel: string;
}) {
  return (
    <div className="flex w-full flex-col items-end gap-1">
      <div
        className={cn(
          "app-bubble-out max-w-[85%] whitespace-pre-wrap break-words rounded-app-bub px-3.5 py-2.5 text-[14px] leading-[1.5] [border-top-right-radius:5px] md:max-w-[80%]",
          done && "opacity-55",
        )}
      >
        <span className={cn(done && "line-through")}>{beat.body}</span>
      </div>
      <span className="flex items-center gap-1.5">
        {done && <DoneBadge label={doneLabel} />}
        {/* The app's G5 delivery-state line: time · Delivered ✓✓. */}
        <span className="text-[12px] text-muted-foreground">
          <span>{beat.time}</span>
          <span aria-hidden> · </span>
          <span>
            Delivered{" "}
            <CheckCheck
              aria-hidden
              className="inline size-3"
              strokeWidth={1.75}
            />
          </span>
        </span>
      </span>
    </div>
  );
}

function NoteBeat({
  beat,
  done,
  doneLabel,
}: {
  beat: TradeNoteBeat;
  done: boolean;
  doneLabel: string;
}) {
  return (
    <div className="flex w-full flex-col items-end gap-1">
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-words rounded-app-bub border border-app-amber-line bg-app-amber-bg px-3.5 py-2.5 text-[14px] leading-[1.5] text-app-amber-ink [border-bottom-right-radius:5px] md:max-w-[80%]",
          done && "opacity-55",
        )}
      >
        <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-app-amber">
          <Lock className="size-3" strokeWidth={1.75} aria-hidden />
          Internal note · {beat.by}
        </span>
        <span className={cn(done && "line-through")}>{beat.body}</span>
      </div>
      <span className="flex items-center gap-1.5">
        {done && <DoneBadge label={doneLabel} />}
        <span className="text-[12px] text-muted-foreground">{beat.time}</span>
      </span>
    </div>
  );
}

function renderBeat(
  beat: TradeBeat,
  doneSet: ReadonlySet<string>,
  doneLabels: Readonly<Record<string, string>>,
) {
  if (beat.kind === "event") {
    return (
      <p key={beat.id} className="py-1 text-center text-[12px] text-app-muted">
        {beat.text}
      </p>
    );
  }
  const done = doneSet.has(beat.id);
  const doneLabel = doneLabels[beat.id] ?? "Done";
  if (beat.kind === "inbound") {
    return (
      <InboundBeat key={beat.id} beat={beat} done={done} doneLabel={doneLabel} />
    );
  }
  if (beat.kind === "outbound") {
    return (
      <OutboundBeat key={beat.id} beat={beat} done={done} doneLabel={doneLabel} />
    );
  }
  return <NoteBeat key={beat.id} beat={beat} done={done} doneLabel={doneLabel} />;
}

/** Static composer pill at rest, matching the app's composer card (empty
 *  draft, Send inactive). Pure depiction: spans only, zero tab stops. */
function ComposerAtRest() {
  return (
    <div className="border-t border-app-line bg-app-white px-3 pb-3 pt-2">
      <div className="flex items-end gap-1 rounded-app-card border border-app-line bg-app-white px-2 py-1.5">
        <span className="min-h-9 flex-1 px-2 py-2 text-[14px] leading-6 text-muted-foreground">
          Text message
        </span>
        <span className="mb-0.5 inline-flex h-8 items-center gap-1.5 rounded-app-ctrl bg-primary px-3 text-[13px] font-semibold opacity-45">
          Send
        </span>
      </div>
    </div>
  );
}

export interface TradeThreadProps {
  script: TradeScript;
  className?: string;
}

/**
 * The full static thread: header, beats on the app's paper ground, composer
 * at rest. Put it inside a <PanelFrame chip="example-conversation" …>.
 */
export function TradeThread({ script, className }: TradeThreadProps) {
  const doneSet = new Set(script.doneIds ?? []);
  const doneLabels = script.doneLabels ?? {};

  return (
    <div className={cn("font-sans bg-background text-foreground", className)}>
      <Header script={script} />
      <div className="flex flex-col gap-3 px-4 py-4">
        {script.beats.map((beat) => renderBeat(beat, doneSet, doneLabels))}
      </div>
      <ComposerAtRest />
    </div>
  );
}
