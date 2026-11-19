import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

const SEGMENTED_INPUT_TYPES = new Set(["date", "datetime-local", "month", "time", "week"])

function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        // Native date and time controls can move focus within their own fields.
        type && SEGMENTED_INPUT_TYPES.has(type)
          ? "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring"
          : "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
