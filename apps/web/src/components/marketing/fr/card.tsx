import { cn } from "@/lib/utils";

/**
 * FR CARD (DESIGN-DIRECTION v4 §2): white surface on the ground, 12px
 * radius, the ONE card shadow. No border (Law 10: no hairline rules;
 * separation is space, radius, and Frost). For the frame around real product
 * embeds use <PanelFrame> (16px radius + app tokens inside) instead.
 *
 * Usage:
 *   <FrCard className="p-6">…</FrCard>
 *   <FrCard well className="p-6">…</FrCard>   // Frost card well, no shadow
 */
export function FrCard({
  className,
  well = false,
  children,
  as: Tag = "div",
}: {
  className?: string;
  /** Frost "card well" variant (§2): the wash instead of white + shadow. */
  well?: boolean;
  children: React.ReactNode;
  as?: React.ElementType;
}) {
  return (
    <Tag
      className={cn(
        "rounded-xl",
        well ? "bg-[color:var(--fr-frost)]" : "fr-card",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
