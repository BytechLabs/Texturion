/**
 * Usage-meter embed (COPY-DECK v2 §S9 "Usage-meter caption (real component)").
 * The app's Usage screen pattern as static DOM. Since #85/#95 the in-app screen
 * is CALM by default — a plain message count and the owner-set spending cap, no
 * "of N" ceiling and no progress bar — and only surfaces a detailed meter when a
 * limit is actually near or usage is trending over what you pay. This embed
 * mirrors that calm resting state (the honest common case), so the marketing
 * demo matches what a customer actually sees.
 *
 * Law 2: this renders INSIDE a <PanelFrame>'s `.app-scope` region, so every
 * token class below (bg-background, text-foreground, bg-secondary,
 * text-muted-foreground) resolves to the APP's own petrol theme, never marketing
 * cobalt. Server component, static. The single source for BOTH the home and
 * /pricing embeds — home/usage-meter.tsx re-exports this (no duplication).
 */

export function UsageMeterEmbed() {
  const sent = 212;

  return (
    <div className="bg-background p-5 text-foreground">
      <div className="flex flex-wrap items-end gap-x-2.5 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums text-foreground">
          {sent}
        </span>
        <span className="pb-0.5 text-sm text-muted-foreground">
          messages sent this period
        </span>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        You&apos;re comfortably within your plan. We email you only if you start
        heading over, so you can just text.
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
