import { toast } from "sonner";

import { UNDO_DURATION_MS } from "./optimistic-undo";

/**
 * #724: "Task created." with a way to the task. A creation toast whose thing
 * is somewhere else carries Open, and stays up as long as an Undo would, so
 * there is time to take it. A creation that already shows its result (it
 * navigated there, or the new row appears in place) keeps a plain toast; the
 * guard in `created-toast.test.ts` holds the list of those.
 */
export function createdToast({
  message,
  openLabel,
  onOpen,
}: {
  message: string;
  openLabel: string;
  onOpen: () => void;
}): string | number {
  return toast.success(message, {
    duration: UNDO_DURATION_MS,
    action: { label: openLabel, onClick: onOpen },
  });
}
