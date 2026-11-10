"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface PickerOption {
  id: string;
  label: string;
}

/**
 * The small chooser behind the s, a and l shortcuts. A list of real buttons, so
 * Tab, Enter and Escape work and the first option has focus when it opens.
 */
export function ShortcutPicker({
  title,
  options,
  empty,
  onPick,
  onClose,
}: {
  title: string;
  options: PickerOption[];
  /** Shown when there is nothing to pick. */
  empty: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {options.map((option, index) => (
              <li key={option.id}>
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  autoFocus={index === 0}
                  onClick={() => {
                    onPick(option.id);
                    onClose();
                  }}
                >
                  {option.label}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
