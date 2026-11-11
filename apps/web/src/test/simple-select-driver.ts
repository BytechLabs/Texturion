import { fireEvent } from "@testing-library/react";

/**
 * Drives a `SimpleSelect` (a Radix select) the way a keyboard does, so a test
 * can answer one and read the answer back. The closed field and every option
 * carry `data-value`, which is the handle the platform `<select>` gave tests
 * with `.value`.
 */
export function selectedValue(trigger: HTMLElement): string {
  return trigger.getAttribute("data-value") ?? "";
}

/** Open the select and choose the option with this value. */
export function chooseOption(trigger: HTMLElement, value: string): void {
  fireEvent.keyDown(trigger, { key: "Enter" });
  const option = document.querySelector<HTMLElement>(
    `[role="option"][data-value="${value}"]`,
  );
  if (!option) {
    throw new Error(`select-option:${value}`);
  }
  fireEvent.keyDown(option, { key: "Enter" });
}
