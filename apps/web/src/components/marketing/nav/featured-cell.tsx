import { ArrowRight, Check } from "lucide-react";

import { cn } from "@/lib/utils";

import type { NavFeatured } from "../nav-links";

/**
 * The featured promo cell in the Product mega-menu, light skin (v3 spec §6):
 * a quiet porcelain inset (--paper-2, hairline border) carrying a *mini
 * live-thread snippet* in the product's real thread grammar — an inbound
 * #F0F4F2 bubble, then a petrol outbound reply with a small Delivered tick.
 * Product-UI recreation radii: 12px bubbles. Static DOM (no image, no JS):
 * cheap, themeable, crisp at every DPR.
 *
 * The whole cell is one link; a NavigationMenuLink wraps it at the call site
 * so it participates in keyboard nav and closes the menu on select.
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
        "group/featured flex h-full flex-col justify-between rounded-[10px] border border-[rgba(11,43,38,0.08)] bg-[color:var(--paper-2)] p-4",
        className,
      )}
    >
      <div>
        {/* Sentence case; body face (v3 §3: mono is figures-only). */}
        <span className="font-body-mkt inline-flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--ink-55)]">
          <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
          {eyebrow}
        </span>

        {/* Mini live-thread snippet, the app's real thread grammar. */}
        <div className="mt-3 space-y-1.5" aria-hidden>
          <div className="max-w-[85%] rounded-[12px] bg-[#F0F4F2] px-2.5 py-1.5 text-[12px] leading-snug text-[color:var(--day-ink)]">
            Our water heater is showing error E110 and there&apos;s water
            pooling underneath
          </div>
          <div className="ml-auto max-w-[85%] rounded-[12px] bg-[color:var(--petrol)] px-2.5 py-1.5 text-[12px] leading-snug text-white">
            On my way. I can be there by 9. Don&apos;t run hot water till then.
            <span className="font-mono-mkt mt-0.5 flex items-center justify-end gap-0.5 text-[10px] text-white/90">
              <Check className="size-2.5" strokeWidth={2.5} aria-hidden />
              Delivered
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <p className="text-[15px] font-semibold text-[color:var(--day-ink)]">
          {title}
        </p>
        <span className="mt-0.5 inline-flex items-center gap-1 text-[13px] font-medium text-[color:var(--petrol)]">
          {cta}
          <ArrowRight className="size-3.5" strokeWidth={1.75} aria-hidden />
        </span>
      </div>
    </div>
  );
}
