/**
 * Features bento (Track B) — §3.6 / COPY §H6.
 * Ledger identity (iteration 5): section `06` on the spine. Fixes the iter-4
 * risks (REFERENCES §4): (a) NOT a tidy 4×2 even grid — an asymmetric fractional
 * layout with one large participatory anchor + six supporting tiles (craft #6,
 * anti-bland #1); (b) the two live tiles become ONE genuinely switchable panel
 * the visitor drives (craft #7 / ELEVATE #5, anti-bland #7); (c) included items
 * use the self-drawing SignalCheck (craft #10). Every tile is a shipping feature
 * (SPEC). Server components except the switchable live island.
 */

import Link from "next/link";
import { FileUp, Search, Tag } from "lucide-react";

import { Reveal } from "@/components/marketing/ui/reveal";
import { LedgerSection } from "@/components/marketing/ledger/ledger-section";
import { SectionEyebrow } from "@/components/marketing/ledger/section-number";
import { SignalCheck } from "@/components/marketing/ledger/signal-check";
import { ArrowLink } from "@/components/marketing/ledger/arrow-link";
import { LazyBentoLiveSwitch } from "./lazy-bento-live-switch";
import { BentoLiveSwitchStatic } from "./bento-live-switch-static";
import { LIVE_ROUTES } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

// Each tile links to the standalone feature page that covers it (all live routes
// in site.ts): the inbox mechanics go to the shared-inbox page; saved replies
// and tags go to the templates-and-tags page.
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
        "group flex h-full flex-col rounded-[10px] border border-border bg-card p-5 transition-colors hover:border-primary/30",
        className,
      )}
    >
      <div className="flex-1">{children}</div>
      <div className="mt-4">
        <h3 className="flex items-center gap-1 text-[17px] font-semibold text-foreground">
          {title}
          <svg
            viewBox="0 0 16 16"
            className="size-4 -translate-x-1 text-primary opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
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
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
    </Link>
  );
}

/** A small tinted status pill row, matching the app's G4 pills. */
function MiniPills() {
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-teal-800 dark:text-primary">
        New
      </span>
      <span className="rounded-full bg-info/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-info">
        Open
      </span>
      <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-warning">
        Waiting
      </span>
      <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-stone-600 dark:text-muted-foreground">
        Closed
      </span>
    </div>
  );
}

export function Bento() {
  return (
    <LedgerSection n={6} id="features" defer intrinsic={1200}>
      <div className="max-w-2xl">
        <SectionEyebrow n={6} label="What a crew gets" />
        <h2 className="display-h2 mt-4 text-foreground">
          Everything a crew needs. Nothing a sales team invented.
        </h2>
      </div>

      {/* Asymmetric fractional grid: a tall participatory anchor (the switchable
          live tile) on the left, six supporting tiles in an uneven flow — not a
          symmetric 4×2 feature grid. */}
      <div className="mt-12 grid gap-4 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
        {/* The participatory anchor — one switchable live surface. */}
        <Reveal className="lg:sticky lg:top-24">
          <LazyBentoLiveSwitch fallback={<BentoLiveSwitchStatic />} />
        </Reveal>

        {/* Supporting tiles in an uneven 2-col supporting ratio. */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Internal notes. */}
          <Reveal delay={60}>
            <TileShell
              title="Internal notes."
              body="Talk about the job inside the conversation. Notes are marked, locked, and never sent to the customer."
              href={SHARED_INBOX_HREF}
            >
              <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-stone-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100">
                <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-amber-800 dark:text-warning">
                  Internal note · Priya
                </span>
                Dale, you&apos;re two streets over this afternoon
              </div>
            </TileShell>
          </Reveal>

          {/* Saved replies. */}
          <Reveal delay={120}>
            <TileShell
              title="Saved replies."
              body="Type “/” and send your on-my-way, quote-follow-up, or booking text in two taps. Write them once, stop retyping them forever."
              href={TEMPLATES_TAGS_HREF}
            >
              <div className="rounded-lg border border-border bg-background p-2 text-[13px]">
                <div className="flex items-center gap-1.5 border-b border-border pb-1.5 text-muted-foreground">
                  <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">
                    /
                  </span>
                  <span className="text-[12px]">saved replies</span>
                </div>
                <p className="truncate pt-1.5 text-foreground">On my way — 20 min</p>
                <p className="truncate text-muted-foreground">Quote follow-up</p>
              </div>
            </TileShell>
          </Reveal>

          {/* Tags. */}
          <Reveal delay={180}>
            <TileShell
              title="Tags that match how you sell."
              body="Quote sent, scheduled, won, lost — ready out of the box, editable to fit how you actually work."
              href={TEMPLATES_TAGS_HREF}
            >
              <div className="flex flex-wrap gap-1.5">
                {["Quote sent", "Scheduled", "Won", "Lost"].map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[12px] text-foreground"
                  >
                    <Tag className="size-3 text-primary" strokeWidth={1.75} aria-hidden />
                    {t}
                  </span>
                ))}
              </div>
            </TileShell>
          </Reveal>

          {/* Search. */}
          <Reveal delay={240}>
            <TileShell
              title="Search everything."
              body="Every message and contact, searchable. “What did we quote the Nguyens in March?” takes five seconds, not a phone poll."
              href={SHARED_INBOX_HREF}
            >
              <div className="rounded-lg border border-border bg-background p-2">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Search className="size-3.5" strokeWidth={1.75} aria-hidden />
                  <span className="text-[13px]">water heater</span>
                </div>
                <p className="mt-1.5 truncate text-[13px] text-foreground">
                  …quote for the{" "}
                  <mark className="rounded bg-primary/15 px-0.5 text-teal-800 dark:text-primary">
                    water heater
                  </mark>{" "}
                  swap…
                </p>
              </div>
            </TileShell>
          </Reveal>

          {/* Contacts, imported. */}
          <Reveal delay={240}>
            <TileShell
              title="Contacts, imported."
              body="Bring your customer list in with a CSV. We show you exactly what will import before anything does."
              href={SHARED_INBOX_HREF}
            >
              <div className="rounded-lg border border-border bg-background p-2 text-[12px]">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <FileUp className="size-3.5" strokeWidth={1.75} aria-hidden />
                  <span>customers.csv — 214 rows</span>
                </div>
                <div className="mt-1.5 flex items-center gap-1 text-primary">
                  <SignalCheck className="size-3.5" />
                  <span>212 ready · 2 skipped</span>
                </div>
              </div>
            </TileShell>
          </Reveal>

          {/* Mark it done — the D14 strikethrough. */}
          <Reveal delay={240}>
            <TileShell
              title="Mark it done."
              body="Tap any message to check it off, right in the thread. The whole crew sees what's handled — no separate to-do app."
              href={SHARED_INBOX_HREF}
            >
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                <span className="inline-flex items-center rounded-full bg-primary/10 p-0.5 text-primary">
                  <SignalCheck className="size-3.5" />
                </span>
                <span className="text-[13px] text-foreground line-through opacity-55">
                  Booked for tomorrow 9–11
                </span>
              </div>
              <div className="mt-2">
                <MiniPills />
              </div>
            </TileShell>
          </Reveal>
        </div>
      </div>

      {/* Inline CTA — arrow-expand secondary (craft #14). */}
      <div className="mt-8">
        <ArrowLink href="/signup">Get your number</ArrowLink>
      </div>
    </LedgerSection>
  );
}
