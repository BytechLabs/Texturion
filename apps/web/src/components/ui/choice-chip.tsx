"use client";

import { Check } from "lucide-react";
import { forwardRef } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * #726: one option in a row of choices. A chosen chip is filled and carries a
 * check; an unchosen one is a plain outline, so a single option on its own can
 * never be mistaken for the answer.
 */
export const ChoiceChip = forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button> & { chosen: boolean }
>(function ChoiceChip({ chosen, className, children, ...props }, ref) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "h-auto max-w-full gap-1 whitespace-normal rounded-full border px-2.5 py-1 text-left text-[12px] leading-snug",
        chosen
          ? "border-primary bg-primary font-medium text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
          : "border-border bg-transparent text-app-muted hover:text-app-ink",
        className,
      )}
      {...props}
    >
      {chosen && <Check className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />}
      {children}
    </Button>
  );
});
