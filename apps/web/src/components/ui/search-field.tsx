"use client";

import { Search, X } from "lucide-react";
import { forwardRef, useRef } from "react";

import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * #733: the one search box. A search icon inside on the left, a clear button
 * on the right once there is something to clear, and focus kept in the field
 * when it is cleared so a keyboard user is not dropped to the page. Every list
 * and settings search draws this.
 */
export const SearchField = forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<typeof Input>, "type" | "value" | "onChange"> & {
    value: string;
    onValueChange: (value: string) => void;
    /** Defaults to "Clear search". */
    clearLabel?: string;
    containerClassName?: string;
  }
>(function SearchField(
  { value, onValueChange, clearLabel, containerClassName, className, ...input },
  forwardedRef,
) {
  const t = useT();
  const ownRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className={cn("relative", containerClassName)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        strokeWidth={1.75}
      />
      <Input
        {...input}
        ref={(node) => {
          ownRef.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn("h-9 pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden", className)}
      />
      {value !== "" && (
        <button
          type="button"
          onClick={() => {
            onValueChange("");
            ownRef.current?.focus();
          }}
          aria-label={clearLabel ?? t("common.clearSearch")}
          className="tap-target absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
});
