import { homeCopy, type HomeCopy } from "@/i18n/marketing/home";
import type { MarketingLocale } from "@/i18n/marketing/footer";
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
 * Cells 1 to 3 are anchors carrying the real components in miniature (app
 * tokens inside PanelFrames, Law 2); the dark-mode phone is the fourth anchor.
 * The rest are typographic. id="day" keeps lib/marketing/site.ts
 * HOME_ANCHORS.features honest.
 *
 * #491 GREW THIS SECTION, and it is the section that most deserved it. Its
 * whole job is answering "will it do X" for the checklist shopper, and it
 * answered only for texting: no calls, no jobs, no assistant, on a page whose
 * heading promises "everything a crew needs". Three cells were added and the
 * contacts cell was rewritten from an import feature into what it actually is.
 */

const typographicCells = (
  copy: HomeCopy,
): readonly { title: string; body: React.ReactNode }[] => [
  { title: copy.bentoTagsTitle, body: copy.bentoTagsBody },
  { title: copy.bentoPhotosTitle, body: copy.bentoPhotosBody },
  { title: copy.bentoSearchTitle, body: copy.bentoSearchBody },
  { title: copy.bentoHistoryTitle, body: copy.bentoHistoryBody },
  { title: copy.bentoCallsTitle, body: copy.bentoCallsBody },
  { title: copy.bentoJobTitle, body: copy.bentoJobBody },
  { title: copy.bentoLouTitle, body: copy.bentoLouBody },
  { title: copy.bentoDoneTitle, body: copy.bentoDoneBody },
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

export function Bento({ locale = "en" }: { locale?: MarketingLocale } = {}) {
  const copy = homeCopy(locale);
  const TYPOGRAPHIC_CELLS = typographicCells(copy);
  return (
    <FrSection ground="frost" id="day">
      <h2 className="fr-h2 max-w-2xl">
        {copy.bentoTitle}
      </h2>

      {/* grid-cols-1 (minmax(0,1fr)) everywhere: the truncated inbox rows in
          the anchor embeds must never widen the track on small screens. */}
      <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* 1 · Assign and track (anchor: the real status/assign patterns). */}
        <FrCard className="p-6 lg:col-span-2">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
            <div>
              <CellHeader title={copy.bentoAssignTitle}>
                {copy.bentoAssignBody}
              </CellHeader>
              <p className="font-body-mkt mt-4 rounded-[10px] bg-[color:var(--fr-frost)] px-3.5 py-2.5 text-[13px] leading-[1.6] text-[color:var(--fr-ink-70)]">
                {copy.bentoTwoNumbersBody}
              </p>
            </div>
            <PanelFrame
              ariaLabel={copy.bentoAssignAria}
              embedClassName="rounded-2xl"
            >
              <AppSurface>
                <AssignTrackEmbed locale={locale} />
              </AppSurface>
            </PanelFrame>
          </div>
        </FrCard>

        {/* 9 · Built for the truck (anchor: the app's own dark mode in a
            phone frame; the tall cell). */}
        <FrCard className="p-6 lg:row-span-2">
          <CellHeader title={copy.bentoTruckTitle}>
            {copy.bentoPhoneBody}
          </CellHeader>
          <PanelFrame
            phone
            phoneDark
            className="mt-6"
            ariaLabel={copy.bentoTruckAria}
          >
            <AppSurface>
              <StaticThread
                script={DARK_BAND_SCRIPT}
                framing="phone"
                pushBanner={{
                  title: copy.bentoPushTitle,
                  body: copy.bentoPushBody,
                }}
                bodyClassName="flex flex-col gap-3 px-3 pb-4 pt-14"
              />
            </AppSurface>
          </PanelFrame>
        </FrCard>

        {/* 2 · Internal notes (anchor: the amber locked note). */}
        <FrCard className="p-6">
          <CellHeader title={copy.bentoNotesTitle}>
            {copy.bentoNotesBody}
          </CellHeader>
          <PanelFrame
            className="mt-5"
            ariaLabel={copy.bentoNotesAria}
            embedClassName="rounded-2xl"
          >
            <AppSurface>
              <NotesEmbed locale={locale} />
            </AppSurface>
          </PanelFrame>
        </FrCard>

        {/* 3 · Saved replies (anchor: the "/" picker). */}
        <FrCard className="p-6">
          <CellHeader title={copy.bentoTemplatesTitle}>
            Type &quot;/&quot; and send your on-my-way, quote-follow-up, or
            booking text in two taps. Write them once, stop retyping them
            forever.
          </CellHeader>
          <PanelFrame
            className="mt-5"
            ariaLabel={copy.bentoTemplatesAria}
            embedClassName="rounded-2xl"
          >
            <AppSurface>
              <SavedRepliesEmbed locale={locale} />
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
