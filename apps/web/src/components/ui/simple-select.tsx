"use client";

import type { KeyboardEvent, MouseEvent } from "react";
import { CopyablePhoneNumber, useCopyPhoneNumber } from "@/components/ui/copyable-phone-number";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type SimpleSelectOption = {
  value: string;
  label: string;
  /** One line under the label in the open list. Never shown in the closed field. */
  description?: string;
  disabled?: boolean;
  copyValue?: string | null;
};

/**
 * #746: the one simple select, for a short list of single choices.
 *
 * The closed field shows the chosen label and nothing else. An option's
 * description is drawn in the open list only. A value that is not in `options`
 * (an unanswered column, a stored value older than the list) shows the
 * `placeholder`. `data-value` on the field and on every option is the stable
 * handle for tests and end-to-end drivers, which cannot read a Radix select
 * the way they read a platform one.
 *
 * Over about eight options, or a list people search by typing (time zones,
 * countries, teammates), use `SearchablePicker`. A few options with
 * consequences each use `ChoiceCards`.
 */
export function SimpleSelect({
  value,
  onValueChange,
  options,
  id,
  ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  placeholder,
  disabled,
  size,
  className,
  contentClassName,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SimpleSelectOption[];
  id?: string;
  ariaLabel?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  placeholder?: string;
  disabled?: boolean;
  size?: "sm" | "default";
  className?: string;
  contentClassName?: string;
}) {
  const chosen = options.find((option) => option.value === value);
  const copyPhoneNumber = useCopyPhoneNumber();

  function copyOption(event: MouseEvent | KeyboardEvent, number?: string | null) {
    if (!number) return;
    event.preventDefault();
    event.stopPropagation();
    void copyPhoneNumber(number);
  }

  function copyShortcut(event: KeyboardEvent, number?: string | null) {
    if ((event.metaKey || event.ctrlKey) && (event.key === "c" || event.key === "C")) copyOption(event, number);
  }

  const select = (
    <Select
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        size={size}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        data-value={value}
        className={className ?? "w-full"}
        onContextMenu={(event) => copyOption(event, chosen?.copyValue)}
        onKeyDown={(event) => copyShortcut(event, chosen?.copyValue)}
      >
        <SelectValue placeholder={placeholder}>{chosen?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent
        className={contentClassName ?? "max-w-[min(22rem,calc(100vw-2rem))]"}
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            description={option.description}
            disabled={option.disabled}
            data-value={option.value}
            onContextMenu={(event) => copyOption(event, option.copyValue)}
            onKeyDown={(event) => copyShortcut(event, option.copyValue)}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (!chosen?.copyValue) return select;
  return (
    <div className="flex items-center gap-2">
      {select}
      <CopyablePhoneNumber number={chosen.copyValue} iconOnly />
    </div>
  );
}
