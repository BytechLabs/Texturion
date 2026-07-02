/**
 * Features bento (Track B) — §3.6 / COPY §H6. Eight tiles; every tile is a
 * shipping feature (SPEC). Two large tiles render as live DOM using the shared
 * thread primitives (Assign & track, Photos both ways); the six standard tiles
 * are crafted live-DOM feature visuals (the §10 raster crops are gated on the
 * seed-capture wave — DOM visuals keep the page honest and sharp with no
 * placeholder images, BLUEPRINT §13.2/§13.1). No "example — real interface"
 * captions (the ONE label lives on §3.4).
 *
 * Tiles link to the relevant standalone /features page (site.ts LIVE_ROUTES).
 * Server components except the two ThreadDemo islands.
 */

import Link from "next/link";
import { ArrowRight, CircleCheck, FileUp, Search, Tag } from "lucide-react";

import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { ThreadDemo } from "@/components/marketing/thread-demo/thread-demo";
import {
  ASSIGN_TILE_SCRIPT,
  PHOTOS_TILE_SCRIPT,
} from "@/components/marketing/thread-demo/script";
import { LIVE_ROUTES } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

// Each tile links to the standalone feature page that covers it (all live routes
// in site.ts): the inbox mechanics (notes, search, contacts, mark-done) go to
// the shared-inbox page; saved replies and tags go to the templates-and-tags page.
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
          <ArrowRight
            className="size-4 -translate-x-1 text-primary opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
            strokeWidth={1.75}
            aria-hidden
          />
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
    <Section id="features">
      <div className="max-w-2xl">
        <h2 className="display-h2 text-foreground">
          Everything a crew needs. Nothing a sales team invented.
        </h2>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Tile 1 — Assign & track (LARGE, live DOM), with multi-number callout. */}
        <Reveal className="sm:col-span-2 sm:row-span-2">
          <div className="flex h-full flex-col rounded-[10px] border border-border bg-card p-5">
            <div className="flex-1">
              <ThreadDemo
                script={ASSIGN_TILE_SCRIPT}
                framing="desktop"
                hideControls
                bodyClassName="min-h-[200px]"
              />
            </div>
            <div className="mt-4">
              <h3 className="text-[17px] font-semibold text-foreground">
                Assign and track.
              </h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
                Every conversation has one owner and one status — new, open,
                waiting, or closed. At a glance, you know what&apos;s handled and
                what&apos;s not.
              </p>
              {/* Multi-number beat — the two-location buyer's exact use case. */}
              <p className="mt-3 rounded-lg bg-primary/5 px-3 py-2 text-[13px] leading-relaxed text-foreground">
                Two locations, or an office line and a field line? Pro gives you
                two separate numbers, each with its own inbox.
              </p>
            </div>
          </div>
        </Reveal>

        {/* Tile 2 — Internal notes. */}
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

        {/* Tile 3 — Saved replies. */}
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

        {/* Tile 4 — Tags. */}
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

        {/* Tile 5 — Photos, both ways (LARGE, live DOM). */}
        <Reveal className="sm:col-span-2 sm:row-span-2" delay={60}>
          <div className="flex h-full flex-col rounded-[10px] border border-border bg-card p-5">
            <div className="flex-1">
              <ThreadDemo
                script={PHOTOS_TILE_SCRIPT}
                framing="desktop"
                hideControls
                bodyClassName="min-h-[200px]"
              />
            </div>
            <div className="mt-4">
              <h3 className="text-[17px] font-semibold text-foreground">
                Photos, both ways.
              </h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
                Customers text you a picture of the problem; you text back a
                photo of the finished job. Receiving photos is always free.
              </p>
            </div>
          </div>
        </Reveal>

        {/* Tile 6 — Search. */}
        <Reveal delay={120}>
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

        {/* Tile 7 — Contacts, imported. */}
        <Reveal delay={180}>
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
              <div className="mt-1.5 flex items-center gap-1 text-success">
                <CircleCheck className="size-3.5" strokeWidth={1.75} aria-hidden />
                <span>212 ready · 2 skipped</span>
              </div>
            </div>
          </TileShell>
        </Reveal>

        {/* Tile 8 — Mark it done (the D14 strikethrough). */}
        <Reveal delay={240} className="sm:col-span-2 lg:col-span-2">
          <TileShell
            title="Mark it done."
            body="Tap any message to check it off, right in the thread. The whole crew sees what's handled — no separate to-do app."
            href={SHARED_INBOX_HREF}
          >
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
              <span className="inline-flex items-center rounded-full bg-primary/10 p-0.5 text-primary">
                <CircleCheck className="size-3.5" strokeWidth={2} aria-hidden />
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

      {/* Inline CTA — closes the second half of the mid-page dead zone (§3.6). */}
      <div className="mt-8">
        <Link
          href="/signup"
          className="inline-flex items-center gap-1 text-[15px] font-medium text-primary underline-offset-2 hover:underline"
        >
          Get your number
          <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
        </Link>
      </div>
    </Section>
  );
}
