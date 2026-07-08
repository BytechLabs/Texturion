import { FrCard, FrSection, PanelFrame } from "@/components/marketing/fr";
import { cn } from "@/lib/utils";
import { AppSurface } from "@/components/marketing/thread-demo/app-surface";
import { DARK_BAND_SCRIPT } from "@/components/marketing/thread-demo/script";
import { StaticThread } from "@/components/marketing/thread-demo/static-thread";

import {
  AssignTrackEmbed,
  NotesEmbed,
  SavedRepliesEmbed,
} from "./bento-embeds";

/**
 * S6 · EVERYTHING A CREW NEEDS (COPY-DECK v2, Frost band; eleven-section
 * ruling 2026-07-07: old S7 is merged in as cell 9). Conversion job: answer
 * "will it do X" for the checklist shopper without sending them off the page.
 *
 * Nine cells. Cells 1 to 3 are anchors carrying the real components in
 * miniature (app tokens inside PanelFrames, Law 2); cell 9 is the fourth
 * anchor: the product's own dark mode inside a phone Panel Frame. The rest
 * are typographic. id="day" keeps lib/marketing/site.ts HOME_ANCHORS.features
 * honest.
 */

const TYPOGRAPHIC_CELLS: readonly { title: string; body: React.ReactNode }[] = [
  {
    title: "Tags that match how you sell.",
    body: "Quote sent, scheduled, won, lost. Ready out of the box, editable to fit how you actually work.",
  },
  {
    title: "Photos, both ways.",
    body: "Customers text you a picture of the problem, and receiving photos is always free, on every plan. Want to text back a photo of the finished job? Picture messaging is a $5/mo add-on with 150 sends a month included.",
  },
  {
    title: "Search everything.",
    body: 'Every message and contact, searchable. "What did we quote the Nguyens in March?" takes five seconds, not a phone poll.',
  },
  {
    title: "Contacts, imported.",
    body: "Bring your customer list in with a CSV. We show you exactly what will import before anything does.",
  },
  {
    title: "Mark it done.",
    body: "Tap any message to check it off, right in the thread. The whole crew sees what's handled. No separate to-do app.",
  },
];

function CellHeader({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <h3 className="fr-h3 text-[color:var(--fr-ink)]">{title}</h3>
      <p className="font-body-mkt mt-2 text-[15px] leading-[1.65] text-[color:var(--fr-ink-70)]">
        {children}
      </p>
    </>
  );
}

export function Bento() {
  return (
    <FrSection ground="frost" id="day">
      <h2 className="fr-h2 max-w-2xl">
        Everything a crew needs. Nothing a sales team invented.
      </h2>

      {/* grid-cols-1 (minmax(0,1fr)) everywhere: the truncated inbox rows in
          the anchor embeds must never widen the track on small screens. */}
      <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* 1 · Assign and track (anchor: the real status/assign patterns). */}
        <FrCard className="p-6 lg:col-span-2">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
            <div>
              <CellHeader title="Assign and track.">
                Every conversation has one owner and one status: new, open,
                waiting, or closed. At a glance, you know what&apos;s handled
                and what&apos;s not.
              </CellHeader>
              <p className="font-body-mkt mt-4 rounded-[10px] bg-[color:var(--fr-frost)] px-3.5 py-2.5 text-[13px] leading-[1.6] text-[color:var(--fr-ink-70)]">
                Two locations, or an office line and a field line? Pro gives
                you two separate numbers, each with its own inbox.
              </p>
            </div>
            <PanelFrame
              ariaLabel="Conversations with one owner and one status each"
              embedClassName="rounded-2xl"
            >
              <AppSurface>
                <AssignTrackEmbed />
              </AppSurface>
            </PanelFrame>
          </div>
        </FrCard>

        {/* 9 · Built for the truck (anchor: the app's own dark mode in a
            phone frame; the tall cell). */}
        <FrCard className="p-6 lg:row-span-2">
          <CellHeader title="Built for the truck, not the desk.">
            Works on every phone your crew already carries. No download, no app
            store, no IT day. Open the link, add it to your home screen, and it
            behaves like an app: push notifications when a customer texts,
            one-handed replies from the job site, and a dark mode that
            doesn&apos;t blind you at 6am.
          </CellHeader>
          <PanelFrame
            phone
            phoneDark
            chip="scripted-demo"
            className="mt-6"
            ariaLabel="A 6am no-hot-water conversation, answered from a phone"
          >
            <AppSurface>
              <StaticThread
                script={DARK_BAND_SCRIPT}
                framing="phone"
                pushBanner={{
                  title: "Loonext",
                  body: "New text from Marcus T",
                }}
                bodyClassName="flex flex-col gap-3 px-3 pb-4 pt-14"
              />
            </AppSurface>
          </PanelFrame>
        </FrCard>

        {/* 2 · Internal notes (anchor: the amber locked note). */}
        <FrCard className="p-6">
          <CellHeader title="Internal notes.">
            Talk about the job inside the conversation. Notes are marked,
            locked, and never sent to the customer.
          </CellHeader>
          <PanelFrame
            className="mt-5"
            ariaLabel="An internal note the customer never sees"
            embedClassName="rounded-2xl"
          >
            <AppSurface>
              <NotesEmbed />
            </AppSurface>
          </PanelFrame>
        </FrCard>

        {/* 3 · Saved replies (anchor: the "/" picker). */}
        <FrCard className="p-6">
          <CellHeader title="Saved replies.">
            Type &quot;/&quot; and send your on-my-way, quote-follow-up, or
            booking text in two taps. Write them once, stop retyping them
            forever.
          </CellHeader>
          <PanelFrame
            className="mt-5"
            ariaLabel="The saved-reply picker above the composer"
            embedClassName="rounded-2xl"
          >
            <AppSurface>
              <SavedRepliesEmbed />
            </AppSurface>
          </PanelFrame>
        </FrCard>

        {/* 4 to 8 · typographic cells; the last runs wide so the lg grid
            closes with no hole. */}
        {TYPOGRAPHIC_CELLS.map((cell, i) => (
          <FrCard
            key={cell.title}
            className={cn(
              "p-6",
              i === TYPOGRAPHIC_CELLS.length - 1 && "lg:col-span-2",
            )}
          >
            <CellHeader title={cell.title}>{cell.body}</CellHeader>
          </FrCard>
        ))}
      </div>
    </FrSection>
  );
}
