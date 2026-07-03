/**
 * Features bento (§H6). An asymmetric layout: one tall participatory anchor (the
 * switchable live inbox) plus supporting tiles, each a real shipping feature.
 * Not a symmetric feature grid.
 *
 * DESIGN-DIRECTION §0: no section number, no FILED/ticket costume. A composed
 * <Display> headline opens it; tiles sit on the paper panel; the marker check is
 * the "done" mark. Sits on the paper ground. Server components except the
 * switchable live island.
 */

import Link from "next/link";
import { FileUp, Search, Tag } from "lucide-react";

import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { Display, MarkerCheck } from "@/components/marketing/display";
import { ArrowLink } from "@/components/marketing/ledger/arrow-link";
import { LazyBentoLiveSwitch } from "./lazy-bento-live-switch";
import { BentoLiveSwitchStatic } from "./bento-live-switch-static";
import { LIVE_ROUTES } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

const SHARED_INBOX_HREF = LIVE_ROUTES.featuresSharedInbox;
const TEMPLATES_TAGS_HREF = LIVE_ROUTES.featuresTemplatesAndTags;

function TileShell({
  title,
  body,
  href,
  className,
  children,
}: {
  title: string;
  body: string;
  href: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex h-full flex-col rounded-[14px] border border-[color:var(--hairline)] bg-[color:var(--paper-2)] p-5 transition-colors hover:border-[color:var(--petrol)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--petrol)]/50",
        className,
      )}
    >
      <div className="flex-1">{children}</div>
      <div className="mt-4">
        <h3 className="flex items-center gap-1 text-[17px] font-semibold text-[color:var(--ink)]">
          {title}
          <svg
            viewBox="0 0 16 16"
            className="size-4 -translate-x-1 text-[color:var(--petrol)] opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M3 8h9" />
            <path d="m9 4 4 4-4 4" />
          </svg>
        </h3>
        <p className="mt-1.5 text-[14px] leading-relaxed text-[color:var(--ink-70)]">
          {body}
        </p>
      </div>
    </Link>
  );
}

/** A small tinted status pill row, matching the app's status vocabulary. */
function MiniPills() {
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className="rounded-full bg-[color:var(--petrol-12)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--deep)]">
        New
      </span>
      <span className="rounded-full bg-[color:var(--petrol-12)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--deep)]">
        Open
      </span>
      <span className="rounded-full bg-[color:var(--marker-40)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--ink)]">
        Waiting
      </span>
      <span className="rounded-full bg-[color:var(--paper)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--graphite)]">
        Closed
      </span>
    </div>
  );
}

export function Bento() {
  return (
    <Section id="features" defer intrinsic={1200}>
      <div className="max-w-2xl">
        <p className="font-mono-mkt flex items-center gap-2.5 text-[13px] font-medium tracking-[0.04em] text-[color:var(--graphite)]">
          <span aria-hidden className="h-px w-6 bg-[color:var(--petrol)]/50" />
          What a crew gets
        </p>
        <Display as="h2" size="h2" className="mt-4">
          Everything a crew needs. Nothing a sales team{" "}
          <Display.Emph>invented</Display.Emph>.
        </Display>
      </div>

      <div className="mt-12 grid gap-4 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
        {/* The participatory anchor: one switchable live surface. */}
        <Reveal className="lg:sticky lg:top-24">
          <LazyBentoLiveSwitch fallback={<BentoLiveSwitchStatic />} />
        </Reveal>

        <div className="grid gap-4 sm:grid-cols-2">
          <Reveal delay={60}>
            <TileShell
              title="Internal notes."
              body="Talk about the job inside the conversation. Notes are marked, locked, and never sent to the customer."
              href={SHARED_INBOX_HREF}
            >
              <div className="rounded-lg border border-dashed border-[color:var(--marker)] bg-[color:var(--marker-40)]/40 px-3 py-2 text-[13px] leading-relaxed text-[color:var(--ink)]">
                <span className="font-mono-mkt mb-1 flex items-center gap-1 text-[11px] font-medium text-[color:var(--graphite)]">
                  Internal note · Priya
                </span>
                Dale, you&apos;re two streets over this afternoon
              </div>
            </TileShell>
          </Reveal>

          <Reveal delay={120}>
            <TileShell
              title="Saved replies."
              body="Type “/” and send your on-my-way, quote-follow-up, or booking text in two taps. Write them once, stop retyping them forever."
              href={TEMPLATES_TAGS_HREF}
            >
              <div className="rounded-lg border border-[color:var(--hairline)] bg-[color:var(--paper)] p-2 text-[13px]">
                <div className="flex items-center gap-1.5 border-b border-[color:var(--hairline)] pb-1.5 text-[color:var(--graphite)]">
                  <span className="font-mono-mkt rounded bg-[color:var(--paper-2)] px-1.5 py-0.5 text-[11px]">
                    /
                  </span>
                  <span className="text-[12px]">saved replies</span>
                </div>
                <p className="truncate pt-1.5 text-[color:var(--ink)]">
                  On my way, 20 min
                </p>
                <p className="truncate text-[color:var(--graphite)]">
                  Quote follow-up
                </p>
              </div>
            </TileShell>
          </Reveal>

          <Reveal delay={180}>
            <TileShell
              title="Tags that match how you sell."
              body="Quote sent, scheduled, won, lost: ready out of the box, editable to fit how you actually work."
              href={TEMPLATES_TAGS_HREF}
            >
              <div className="flex flex-wrap gap-1.5">
                {["Quote sent", "Scheduled", "Won", "Lost"].map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full border border-[color:var(--hairline)] bg-[color:var(--paper)] px-2 py-0.5 text-[12px] text-[color:var(--ink)]"
                  >
                    <Tag className="size-3 text-[color:var(--petrol)]" strokeWidth={1.75} aria-hidden />
                    {t}
                  </span>
                ))}
              </div>
            </TileShell>
          </Reveal>

          <Reveal delay={240}>
            <TileShell
              title="Search everything."
              body="Every message and contact, searchable. “What did we quote the Nguyens in March?” takes five seconds, not a phone poll."
              href={SHARED_INBOX_HREF}
            >
              <div className="rounded-lg border border-[color:var(--hairline)] bg-[color:var(--paper)] p-2">
                <div className="flex items-center gap-1.5 text-[color:var(--graphite)]">
                  <Search className="size-3.5" strokeWidth={1.75} aria-hidden />
                  <span className="text-[13px]">water heater</span>
                </div>
                <p className="mt-1.5 truncate text-[13px] text-[color:var(--ink)]">
                  …quote for the{" "}
                  <mark className="rounded bg-[color:var(--marker-40)] px-0.5 text-[color:var(--ink)]">
                    water heater
                  </mark>{" "}
                  swap…
                </p>
              </div>
            </TileShell>
          </Reveal>

          <Reveal delay={240}>
            <TileShell
              title="Contacts, imported."
              body="Bring your customer list in with a CSV. We show you exactly what will import before anything does."
              href={SHARED_INBOX_HREF}
            >
              <div className="rounded-lg border border-[color:var(--hairline)] bg-[color:var(--paper)] p-2 text-[12px]">
                <div className="flex items-center gap-1.5 text-[color:var(--graphite)]">
                  <FileUp className="size-3.5" strokeWidth={1.75} aria-hidden />
                  <span>customers.csv, 214 rows</span>
                </div>
                <div className="mt-1.5 flex items-center gap-1 text-[color:var(--petrol)]">
                  <MarkerCheck className="size-3.5" color="petrol" draw={false} />
                  <span>212 ready · 2 skipped</span>
                </div>
              </div>
            </TileShell>
          </Reveal>

          <Reveal delay={240}>
            <TileShell
              title="Mark it done."
              body="Tap any message to check it off, right in the thread. The whole crew sees what's handled, no separate to-do app."
              href={SHARED_INBOX_HREF}
            >
              <div className="flex items-center gap-2 rounded-lg border border-[color:var(--hairline)] bg-[color:var(--paper)] px-3 py-2">
                <MarkerCheck className="size-4" color="petrol" draw={false} />
                {/* Struck-through "done" line: --graphite (7.4:1 on paper), no
                    opacity dilution (opacity-55 dropped it to 3.8:1, below AA).
                    The strikethrough already reads it as handled. */}
                <span className="text-[13px] text-[color:var(--graphite)] line-through">
                  Booked for tomorrow 9 to 11
                </span>
              </div>
              <div className="mt-2">
                <MiniPills />
              </div>
            </TileShell>
          </Reveal>
        </div>
      </div>

      <div className="mt-8">
        <ArrowLink href="/signup">Get your number</ArrowLink>
      </div>
    </Section>
  );
}
