"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n/provider";

/**
 * The one "are you sure" dialog (#733). A title, an optional body, Cancel and
 * one confirm button. It never closes itself on confirm: the caller closes it
 * once the work succeeded, so a failure leaves it open to retry.
 *
 * A form, a typed confirmation or a code entry is not this: those have fields
 * to fill and keep their own Dialog. `children` is for a small extra body
 * (a checkbox, a note) that sits between the description and the buttons.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  pendingLabel,
  pending = false,
  onConfirm,
  tone = "destructive",
  confirmDisabled = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  /** Only where the dialog's wording is "Keep it" rather than "Cancel". */
  cancelLabel?: ReactNode;
  pendingLabel?: ReactNode;
  pending?: boolean;
  onConfirm: () => void;
  tone?: "destructive" | "default";
  confirmDisabled?: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description !== undefined && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <Button
            variant={tone}
            disabled={pending || confirmDisabled}
            onClick={onConfirm}
          >
            {pending && pendingLabel !== undefined ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
