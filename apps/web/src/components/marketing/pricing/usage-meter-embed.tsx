/**
 * Usage-meter embed (COPY-DECK v2 §S9 "Usage-meter caption (real component)").
 * The app's Usage screen pattern as static DOM. Since #178 the in-app screen
 * renders from the API's fair-use `status`, and for almost every crew that
 * status is 'quiet': one calm line, the fair-use policy, and the owner-set
 * spending cap — no count, no "of N" ceiling, no progress bar. This embed
 * mirrors that quiet resting state exactly, so the marketing demo says the
 * same thing the product does.
 *
 * Law 2: this renders INSIDE a <PanelFrame>'s `.app-scope` region, so every
 * token class below (bg-background, text-foreground, bg-secondary,
 * text-muted-foreground) resolves to the APP's own petrol theme, never marketing
 * cobalt. Server component, static. The single source for BOTH the home and
 * /pricing embeds — home/usage-meter.tsx re-exports this (no duplication).
 */

export function UsageMeterEmbed() {
  return (
    <div className="bg-background p-5 text-foreground">
      <p className="text-sm font-medium text-foreground">
        Well within fair use this month.
      </p>

      <p className="mt-3 text-sm text-muted-foreground">
        That&apos;s the whole screen for almost every crew. We reach out early
        if usage ever paces past what your plan covers, so you can just text.
      </p>

      {/* The owner-set spending cap stays reachable, always (SPEC §2). */}
      <div className="mt-4 flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-[13px]">
        <span className="text-muted-foreground">Spending cap</span>
        <span className="font-medium tabular-nums text-foreground">
          you set it
        </span>
      </div>
    </div>
  );
}
