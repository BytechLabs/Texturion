import { cn } from "@/lib/utils";

/**
 * Scroll-reveal wrapper (BLUEPRINT §1.5): opacity 0→1 + translateY 12px→0,
 * 300ms ease-out, ONCE, triggered at ~20% visibility.
 *
 * PERF (iteration-4 Lighthouse fix): this is now a PURE SERVER COMPONENT — it
 * emits only the `data-reveal` markup and ships ZERO per-instance JS. Previously
 * every <Reveal> was its own client island with its own IntersectionObserver +
 * useState + useEffect; the home page renders ~28 of them, so that was ~28
 * hydrating islands' worth of main-thread work on load (a real slice of the TBT
 * blocker). A single <RevealActivator> (mounted once in the marketing layout)
 * now installs ONE shared IntersectionObserver that toggles `data-revealed` on
 * every `[data-reveal]` element — 28 islands → 0 + one tiny activator.
 *
 * The animation lives in globals.css ([data-reveal]); CLS-safe (children render
 * into an already-reserved box, only opacity/transform change). Reduced motion
 * is honored in CSS (forces the revealed state); the activator also reveals
 * everything immediately when IntersectionObserver is unavailable, and a
 * fail-safe timer in the activator reveals anything still hidden so no content
 * is ever permanently invisible if JS is slow.
 *
 * `delay` supports the §1.5 stagger (60ms steps, max 4 items) via a CSS
 * transition-delay, applied only once revealed.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  /** Stagger delay in ms (§1.5: 60ms per item, capped by the caller). */
  delay?: number;
  as?: React.ElementType;
}) {
  return (
    <Tag
      data-reveal=""
      style={
        delay
          ? ({ "--reveal-delay": `${delay}ms` } as React.CSSProperties)
          : undefined
      }
      className={className}
    >
      {children}
    </Tag>
  );
}

/**
 * Convenience wrapper for a staggered group (§1.5: 60ms steps, max 4). Wrap each
 * child once; items past the 4th share the last delay so the cap holds.
 */
export function RevealGroup({
  children,
  className,
}: {
  children: React.ReactNode[];
  className?: string;
}) {
  return (
    <div className={cn(className)}>
      {children.map((child, i) => (
        <Reveal key={i} delay={Math.min(i, 3) * 60}>
          {child}
        </Reveal>
      ))}
    </div>
  );
}
