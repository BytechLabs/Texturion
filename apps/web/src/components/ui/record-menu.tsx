"use client";

import { MoreHorizontal } from "lucide-react";
import * as React from "react";

import {
  ACTION_GROUPS,
  submenuItems,
  visibleActions,
  type RecordAction,
} from "@/lib/record-actions/types";
import { cn } from "@/lib/utils";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuToggleItem,
  ContextMenuTrigger,
} from "./context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuHint,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuToggleItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

/**
 * #712: renders a record's action list as a menu. The ⋯ button and the
 * right-click menu both mount THIS, so the two cannot drift: same items, same
 * order, same groups, same destructive styling, same separators.
 */
type Variant = "dropdown" | "context";

const KITS = {
  dropdown: {
    Item: DropdownMenuItem,
    Toggle: DropdownMenuToggleItem,
    Label: DropdownMenuLabel,
    Separator: DropdownMenuSeparator,
    Sub: DropdownMenuSub,
    SubTrigger: DropdownMenuSubTrigger,
    SubContent: DropdownMenuSubContent,
  },
  context: {
    Item: ContextMenuItem,
    Toggle: ContextMenuToggleItem,
    Label: ContextMenuLabel,
    Separator: ContextMenuSeparator,
    Sub: ContextMenuSub,
    SubTrigger: ContextMenuSubTrigger,
    SubContent: ContextMenuSubContent,
  },
} as const;

const ICON_CLASS = "size-4";

export function RecordMenuItems({
  actions,
  variant,
}: {
  actions: readonly RecordAction[];
  variant: Variant;
}) {
  const kit = KITS[variant];
  const visible = visibleActions(actions);
  return (
    <>
      {ACTION_GROUPS.map((group, index) => {
        const inGroup = visible.filter((action) => action.group === group);
        if (inGroup.length === 0) return null;
        const first = ACTION_GROUPS.slice(0, index).every(
          (earlier) => !visible.some((action) => action.group === earlier),
        );
        return (
          <React.Fragment key={group}>
            {!first && <kit.Separator />}
            {inGroup.map((action) => {
              const Icon = action.icon;
              const icon = Icon ? (
                <Icon className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
              ) : null;
              if (action.note) {
                return (
                  <kit.Label
                    key={action.id}
                    data-action={action.id}
                    className="max-w-64 whitespace-normal text-xs font-normal text-muted-foreground"
                  >
                    {action.label}
                  </kit.Label>
                );
              }
              if (action.submenu) {
                return (
                  <kit.Sub key={action.id}>
                    <kit.SubTrigger data-action={action.id}>
                      {icon}
                      {action.label}
                    </kit.SubTrigger>
                    <kit.SubContent>
                      {action.hint && (
                        <DropdownMenuHint>{action.hint}</DropdownMenuHint>
                      )}
                      <SubmenuItems action={action} variant={variant} />
                    </kit.SubContent>
                  </kit.Sub>
                );
              }
              if (action.checked !== undefined) {
                return (
                  <kit.Toggle
                    key={action.id}
                    data-action={action.id}
                    checked={action.checked}
                    disabled={action.disabled}
                    onSelect={
                      action.keepOpen && variant === "dropdown"
                        ? (event: Event) => event.preventDefault()
                        : undefined
                    }
                    onCheckedChange={() => action.onSelect?.()}
                  >
                    {icon}
                    {action.label}
                  </kit.Toggle>
                );
              }
              return (
                <kit.Item
                  key={action.id}
                  data-action={action.id}
                  variant={action.destructive ? "destructive" : "default"}
                  disabled={action.disabled}
                  onSelect={() => action.onSelect?.()}
                >
                  {icon}
                  {action.label}
                </kit.Item>
              );
            })}
          </React.Fragment>
        );
      })}
    </>
  );
}

/** Rendered inside the sub content, which Radix mounts only while it is open. */
function SubmenuItems({
  action,
  variant,
}: {
  action: RecordAction;
  variant: Variant;
}) {
  const kit = KITS[variant];
  return submenuItems(action).map((sub) => {
    const SubIcon = sub.icon;
    return (
      <kit.Item
        key={sub.id}
        data-action={`${action.id}.${sub.id}`}
        onSelect={sub.onSelect}
      >
        {SubIcon && (
          <SubIcon className={ICON_CLASS} strokeWidth={1.75} aria-hidden />
        )}
        <span>{sub.label}</span>
        {sub.trailing && (
          <span className="ml-auto pl-4 text-xs tabular-nums text-muted-foreground">
            {sub.trailing}
          </span>
        )}
      </kit.Item>
    );
  });
}

/**
 * The ⋯ menu for a record. Renders NOTHING when no action is allowed (#713: no
 * button that opens an empty menu).
 */
export function RecordOverflowMenu({
  actions,
  label,
  trigger,
  className,
  contentClassName,
  align = "end",
  before,
}: {
  actions: readonly RecordAction[];
  /** The trigger's accessible name. */
  label: string;
  /** Replaces the default ghost ⋯ button; must be a single element. */
  trigger?: React.ReactElement;
  className?: string;
  contentClassName?: string;
  align?: "start" | "center" | "end";
  /** View controls that are not record actions (e.g. the phone's "Show" filter). */
  before?: React.ReactNode;
}) {
  if (visibleActions(actions).length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label={label}
            className={cn(
              "tap-target grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          >
            <MoreHorizontal aria-hidden className="size-4" strokeWidth={1.75} />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={contentClassName}>
        {before}
        <RecordMenuItems actions={actions} variant="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Right-click, long-press (touch), and the context-menu key / Shift+F10 on a
 * focused row all open the SAME list the ⋯ button opens.
 *
 * - No allowed action: the row is returned untouched and the browser's own menu
 *   stays, so nothing of ours opens on a row with nothing to offer.
 * - Selected text inside the row keeps the browser's menu (copy, search).
 * - Closing returns focus to whatever had it, so a keyboard user is not dropped
 *   onto the page.
 *
 * `children` must be ONE element that accepts a ref and props (the row).
 */
export function RecordContextMenu({
  actions,
  children,
}: {
  actions: readonly RecordAction[];
  children: React.ReactElement;
}) {
  const restoreTo = React.useRef<HTMLElement | null>(null);
  if (visibleActions(actions).length === 0) return children;
  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        onContextMenuCapture={(event: React.MouseEvent<HTMLElement>) => {
          if (hasSelectionInside(event.currentTarget)) {
            // Stop our trigger, and let the browser's own menu through.
            event.stopPropagation();
            return;
          }
          const active = document.activeElement;
          restoreTo.current =
            active instanceof HTMLElement && active !== document.body
              ? active
              : null;
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreTo.current?.focus();
        }}
      >
        <RecordMenuItems actions={actions} variant="context" />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Is there highlighted text inside this element? */
export function hasSelectionInside(element: HTMLElement): boolean {
  const selection = typeof window === "undefined" ? null : window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return false;
  }
  return (
    selection.toString().trim() !== "" &&
    element.contains(selection.getRangeAt(0).commonAncestorContainer)
  );
}
