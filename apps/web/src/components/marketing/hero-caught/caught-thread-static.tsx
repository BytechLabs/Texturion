/**
 * CaughtThreadStatic, the server-rendered "caught" thread (DESIGN-DIRECTION §3
 * Signature). A real, specific incoming customer message lands and is visibly
 * CLAIMED by a crew member's name, so it gets handled. This is the finished
 * caught state: it is what the LCP paints beside the H1, what no-JS paints, and
 * what reduced-motion paints. The client island (CaughtThread) hydrates after
 * first paint and replays the "catch" once for motion users.
 *
 * The one thing the page is remembered by: the promise word is marker-yellow
 * highlighted, the phone number and time are in the work-order mono, over the
 * painted-panel paper. Everything around it stays quiet.
 *
 * Pure DOM/CSS, no hooks. Marketing-scoped (reads the §3 tokens).
 */

import { cn } from "@/lib/utils";

import { CAUGHT } from "./caught-data";

/** A small round initials avatar, matching the app's member-avatar rule. */
function Avatar({
  initials,
  className,
}: {
  initials: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-full bg-[color:var(--petrol)] text-[11px] font-semibold text-white",
        className,
      )}
    >
      {initials}
    </span>
  );
}

export function CaughtThreadStatic({ claimed = true }: { claimed?: boolean }) {
  return (
    <div className="relative">
      {/* The framed thread card, the one consistent frame language (§4). */}
      <div className="overflow-hidden rounded-[14px] border border-[color:var(--hairline)] bg-[color:var(--card,#fff)] shadow-[0_24px_64px_-34px_rgba(11,79,73,0.4)]">
        {/* Thread header: the business number the customer texted. */}
        <div className="flex items-center justify-between gap-2 border-b border-[color:var(--hairline)] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Avatar initials={CAUGHT.customer.initials} />
            <div className="leading-tight">
              <p className="text-[14px] font-semibold text-[color:var(--ink)]">
                {CAUGHT.customer.name}
              </p>
              <p className="font-mono-mkt text-[12px] text-[color:var(--graphite)]">
                {CAUGHT.customer.number}
              </p>
            </div>
          </div>
          <span className="font-mono-mkt text-[12px] text-[color:var(--graphite)]">
            {CAUGHT.inboundTime}
          </span>
        </div>

        {/* The conversation. */}
        <div className="space-y-3 px-4 py-4">
          {/* Inbound: the real incoming customer message (the star). */}
          <div className="max-w-[86%]">
            <div className="rounded-[4px_16px_16px_16px] bg-[color:var(--paper)] px-3.5 py-2.5 text-[15px] leading-snug text-[color:var(--ink)]">
              {CAUGHT.inbound}
            </div>
          </div>

          {/* The claim event, a name attaches. This is the "caught" beat. */}
          <div
            className={cn(
              "flex items-center gap-2 py-0.5 text-[13px] text-[color:var(--graphite)]",
              !claimed && "opacity-0",
            )}
            data-claim
          >
            <Avatar initials={CAUGHT.crew.initials} className="size-5 text-[9px]" />
            <span>
              <span className="font-semibold text-[color:var(--deep)]">
                {CAUGHT.crew.name}
              </span>{" "}
              claimed this. On it.
            </span>
          </div>

          {/* Outbound: the crew reply, delivered. */}
          <div className="ml-auto max-w-[86%]">
            <div className="rounded-[16px_4px_16px_16px] bg-[color:var(--deep)] px-3.5 py-2.5 text-[15px] leading-snug text-white">
              {CAUGHT.reply}
            </div>
            <p className="mt-1 pr-1 text-right font-mono-mkt text-[11px] text-[color:var(--graphite)]">
              {CAUGHT.replyTime} · Delivered
            </p>
          </div>
        </div>
      </div>

      {/* The quiet caption, no fake "live" dot, no stamp; just the truth. */}
      <p className="mt-3 font-mono-mkt text-[13px] text-[color:var(--graphite)]">
        {CAUGHT.caption}
      </p>
    </div>
  );
}
