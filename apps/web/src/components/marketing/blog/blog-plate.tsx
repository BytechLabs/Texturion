import { blogArt, type BlogArtVariant } from "@/lib/marketing/blog-art";
import { cn } from "@/lib/utils";

/**
 * BLOG PLATE: renders a post's deterministic art spec (lib/marketing/blog-art)
 * as inline SVG on a Frost well. Server component, pure output — the plates
 * prerender with the page, cost nothing at runtime, and never become the LCP
 * (inline SVG geometry is not an LCP candidate; the H1 stays the story).
 *
 * Color mapping lives here: trail/tick/dock roles ride --fr-cobalt, the one
 * waiting mark is --fr-flare (§3.4.1 static-derivative), the one docked mark
 * is --fr-green (answered = handled). Card plates carry no accent marks at
 * all — see blog-art.ts.
 *
 * Decorative always: aria-hidden, focusable=false, fixed aspect box (CLS 0).
 */
export function BlogPlate({
  slug,
  dateline,
  variant,
  className,
}: {
  slug: string;
  dateline: string;
  variant: Exclude<BlogArtVariant, "og">;
  className?: string;
}) {
  const spec = blogArt(slug, dateline, variant);
  // All ticks join into ONE path (tiny vertical dashes on the 48px grid) so a
  // twelve-card index adds twelve elements of texture, not hundreds.
  const tickPath = spec.ticks
    .map((t) => `M${t.x} ${t.y - 2} L${t.x} ${t.y + 2}`)
    .join(" ");

  return (
    <div
      className={cn(
        "overflow-hidden bg-[color:var(--fr-frost)]",
        className,
      )}
    >
      <svg
        viewBox={`0 0 ${spec.width} ${spec.height}`}
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
        aria-hidden="true"
        focusable="false"
      >
        {tickPath ? (
          <path
            d={tickPath}
            stroke="var(--fr-cobalt)"
            strokeOpacity="0.12"
            strokeWidth="1"
            fill="none"
          />
        ) : null}

        {spec.trails.map((trail) => (
          <path
            key={trail.d}
            d={trail.d}
            fill="none"
            stroke="var(--fr-cobalt)"
            strokeOpacity={
              trail.role === "lead" ? 0.85 : trail.role === "mid" ? 0.3 : 0.14
            }
            strokeWidth={trail.role === "lead" ? 2.5 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* The dock: where every trail settles. */}
        <circle
          cx={spec.dock.x}
          cy={spec.dock.y}
          r="14"
          fill="none"
          stroke="var(--fr-cobalt)"
          strokeOpacity="0.18"
          strokeWidth="1.5"
        />
        <circle
          cx={spec.dock.x}
          cy={spec.dock.y}
          r="7"
          fill="none"
          stroke="var(--fr-cobalt)"
          strokeOpacity="0.45"
          strokeWidth="1.5"
        />

        {spec.waiting ? (
          <circle
            cx={spec.waiting.x}
            cy={spec.waiting.y}
            r="4.5"
            fill="var(--fr-flare)"
          />
        ) : (
          <circle
            cx={spec.dock.x}
            cy={spec.dock.y}
            r="2.5"
            fill="var(--fr-cobalt)"
          />
        )}

        {spec.docked ? (
          <circle
            cx={spec.docked.x}
            cy={spec.docked.y}
            r="4.5"
            fill="var(--fr-green)"
          />
        ) : null}
      </svg>
    </div>
  );
}
