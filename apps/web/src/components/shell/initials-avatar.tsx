import { cn } from "@/lib/utils";

/**
 * The signed-in member's initials, drawn by CSS rather than written as text.
 * Like a photo, they picture who is signed in; they are not words a speech user
 * says to press the control, so they must not count as its visible label
 * (WCAG 2.5.3 Label in Name, axe `label-content-name-mismatch`).
 */
export function InitialsAvatar({
  initials,
  className,
}: {
  initials: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-initials={initials}
      className={cn("before:content-[attr(data-initials)]", className)}
    />
  );
}
