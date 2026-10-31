"use client"

import * as React from "react"

import { useT } from "@/i18n/provider"

import { SheetContent as SheetContentBase } from "./sheet-base"

/** The app's sheet: the close button reads the reader's language. */
function SheetContent(
  props: Omit<React.ComponentProps<typeof SheetContentBase>, "closeLabel">
) {
  const t = useT()
  return <SheetContentBase closeLabel={t("common.close")} {...props} />
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from "./sheet-base"
export { SheetContent }
