"use client";

import { List, Rows3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuChoiceItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuToggleItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n/provider";

export function InboxDisplayMenu({
  compact,
  onCompactChange,
  fullList,
  onFullListChange,
}: {
  compact: boolean;
  onCompactChange: (compact: boolean) => void;
  fullList: boolean;
  onFullListChange: (fullList: boolean) => void;
}) {
  const t = useT();
  const title = t("inbox.displayOptions");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" className="size-11 md:size-8" aria-label={title} title={title}>
          {compact ? <List aria-hidden /> : <Rows3 aria-hidden />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label={title}>
        <DropdownMenuRadioGroup
          value={compact ? "compact" : "preview"}
          onValueChange={(value) => onCompactChange(value === "compact")}
        >
          <DropdownMenuChoiceItem value="preview" className="min-h-11 md:min-h-8">
            {t("inbox.displayPreview")}
          </DropdownMenuChoiceItem>
          <DropdownMenuChoiceItem value="compact" className="min-h-11 md:min-h-8">
            {t("inbox.displayCompact")}
          </DropdownMenuChoiceItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator className="hidden lg:block" />
        <DropdownMenuToggleItem className="hidden lg:flex" checked={fullList} onCheckedChange={onFullListChange}>
          {t("inbox.displayListOnly")}
        </DropdownMenuToggleItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
