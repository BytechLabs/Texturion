import { cn } from "@/lib/utils";

/**
 * Content column for marketing pages (BLUEPRINT §1.4): max-width 1152px
 * (max-w-6xl), gutters 16px mobile / 24px desktop. Server component.
 */
export function Container({
  children,
  className,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: React.ElementType;
}) {
  return (
    <Tag className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", className)}>
      {children}
    </Tag>
  );
}
