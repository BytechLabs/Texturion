import { cn } from "@/lib/utils";

/**
 * FR SECTION BAND (DESIGN-DIRECTION v4 §4, Law 10). The one way marketing
 * content sits on a page: a full-width band in one of the four sanctioned
 * grounds, with the §4 rhythm baked in (padding-block 6rem desktop / 4rem
 * mobile) and the §4 container (max-width 72rem, padding-inline 1.5rem
 * mobile / 2rem from md). Separation between bands is SPACE and the Frost
 * wash, never a hairline rule.
 *
 * Grounds:
 *   "white"  — Signal White, the dominant ground (default).
 *   "frost"  — the only wash, for alternating bands.
 *   "ink"    — the deliberately-separate band. Sanctioned for exactly one
 *              band-scale use: the footer already is one of the two, so think
 *              twice before reaching for this.
 *   "cobalt" — the ONE full-bleed final-CTA band, home page only (§2).
 *
 * Both dark grounds read their label from an `--fr-on-*` token rather than
 * `text-white` (#362 phase 8). On dark the accent lifts to lime and the
 * separate band lifts to #2c2f22, so a white label would go from 10.35:1 to
 * 1.54:1 on the accent — legible to illegible, with nothing to notice it.
 *
 * Usage:
 *   <FrSection ground="frost" id="pattern">…</FrSection>
 */
export function FrSection({
  ground = "white",
  id,
  className,
  containerClassName,
  bleed = false,
  children,
  as: Tag = "section",
}: {
  /** Band ground; see the sanctioned list above. */
  ground?: "white" | "frost" | "ink" | "cobalt";
  id?: string;
  className?: string;
  /** Extra classes on the inner container (grid setup etc.). */
  containerClassName?: string;
  /** True renders children full-bleed with no inner container. */
  bleed?: boolean;
  children: React.ReactNode;
  as?: React.ElementType;
}) {
  const grounds: Record<string, string> = {
    white: "bg-[color:var(--fr-ground)] text-[color:var(--fr-ink)]",
    frost: "bg-[color:var(--fr-frost)] text-[color:var(--fr-ink)]",
    ink: "bg-[color:var(--fr-inverse)] text-[color:var(--fr-on-inverse)]",
    cobalt: "bg-[color:var(--fr-olive)] text-[color:var(--fr-on-olive)]",
  };
  return (
    <Tag id={id} className={cn(grounds[ground], "py-16 md:py-24", className)}>
      {bleed ? (
        children
      ) : (
        <div
          className={cn(
            "mx-auto w-full max-w-[72rem] px-6 md:px-8",
            containerClassName,
          )}
        >
          {children}
        </div>
      )}
    </Tag>
  );
}

/**
 * The bare §4 container for chrome that is not a band (nav rows, footer
 * columns): max-width 72rem, padding-inline 1.5rem / 2rem from md.
 */
export function FrContainer({
  className,
  children,
  as: Tag = "div",
}: {
  className?: string;
  children: React.ReactNode;
  as?: React.ElementType;
}) {
  return (
    <Tag className={cn("mx-auto w-full max-w-[72rem] px-6 md:px-8", className)}>
      {children}
    </Tag>
  );
}
