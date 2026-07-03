import { ArrowRight, Check } from "lucide-react";

import { cn } from "@/lib/utils";

import type { NavFeatured } from "../nav-links";

/**
 * The featured promo cell in the Product mega-menu (VISUALS §5b): a petrol-tinted
 * card that carries a *mini live-thread snippet* built from the app's real thread
 * grammar, an inbound white bubble, then a teal-50 outbound reply with a
 * Delivered check, plus a "See the shared inbox →" link. This is the personality
 * moment that makes the menu read as a brand site, not a list of links. The
 * snippet is scripted from COPY §H4 (the water-heater thread), so the menu, the
 * hero, and the deep-dive tell one story. Static DOM (no image, no JS), it is
 * cheap, themeable, and crisp at every DPR.
 *
 * The whole cell is one link; a NavigationMenuLink wraps it at the call site so it
 * participates in keyboard nav and closes the menu on select.
 */
export function FeaturedCell({
  featured,
  className,
}: {
  featured: NavFeatured;
  className?: string;
}) {
  const { eyebrow, title, cta, icon: Icon } = featured;

  return (
    <div
      className={cn(
        "group/featured flex h-full flex-col justify-between rounded-[10px] border border-primary/15 bg-primary/[0.06] p-4 dark:bg-primary/10",
        className,
      )}
    >
      <div>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-teal-800 uppercase dark:text-primary">
          <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
          {eyebrow}
        </span>

        {/* Mini live-thread snippet, the app's real thread grammar. */}
        <div className="mt-3 space-y-1.5" aria-hidden>
          <div className="max-w-[85%] rounded-lg rounded-tl-sm border border-border bg-card px-2.5 py-1.5 text-[12px] leading-snug text-foreground shadow-sm">
            Our water heater is showing error E110 and there&apos;s water
            pooling underneath
          </div>
          <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-sm bg-teal-50 px-2.5 py-1.5 text-[12px] leading-snug text-teal-900 dark:bg-teal-950/60 dark:text-teal-100">
            On my way. I can be there by 9. Don&apos;t run hot water till then.
            <span className="mt-0.5 flex items-center justify-end gap-0.5 text-[10px] text-teal-700/70 dark:text-teal-300/70">
              <Check className="size-2.5" strokeWidth={2.5} aria-hidden />
              Delivered
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <p className="text-[15px] font-semibold text-foreground">{title}</p>
        <span className="mt-0.5 inline-flex items-center gap-1 text-[13px] font-medium text-primary">
          {cta}
          <ArrowRight
            className="size-3.5 -translate-x-0.5 transition-transform group-hover/featured:translate-x-0"
            strokeWidth={1.75}
            aria-hidden
          />
        </span>
      </div>
    </div>
  );
}
