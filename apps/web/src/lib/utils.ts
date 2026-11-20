import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function withOccurrenceKeys<T>(items: readonly T[], keyOf: (item: T) => string) {
  const occurrences = new Map<string, number>();
  return items.map((item) => {
    const value = keyOf(item);
    const occurrence = occurrences.get(value) ?? 0;
    occurrences.set(value, occurrence + 1);
    return { item, key: `${occurrence}:${value}` };
  });
}
