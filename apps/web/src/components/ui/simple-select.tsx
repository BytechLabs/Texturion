"use client";

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
  return (
    <Select
      value={value === "" ? undefined : value}
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
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
