import type { ComponentType } from "react";

/**
 * #712: ONE action list per record type.
 *
 * A record's actions (label, icon, group, destructive, whether the viewer may
 * do it) are written once, by a builder per type, and every surface that offers
 * them (the ⋯ menu, the right-click / long-press menu) renders THAT list. Two
 * menus for one record can therefore never disagree, because there is only one
 * list to disagree with.
 *
 * Groups follow the #710 thread menu: what you do to the record's state,
 * then alerts, then attachments, then the spam / block / delete group last.
 */
export const ACTION_GROUPS = [
  "primary",
  "state",
  "alerts",
  "attachments",
  "danger",
] as const;

export type ActionGroup = (typeof ACTION_GROUPS)[number];

export type ActionIcon = ComponentType<{
  className?: string;
  strokeWidth?: number;
  "aria-hidden"?: boolean;
}>;

export interface RecordSubAction {
  id: string;
  label: string;
  /** Muted text at the row's end, e.g. the time a snooze preset resolves to. */
  trailing?: string;
  icon?: ActionIcon;
  onSelect: () => void;
}

export interface RecordAction {
  id: string;
  label: string;
  icon?: ActionIcon;
  group: ActionGroup;
  /**
   * Whether this viewer may do it. A false action is never rendered (#713: no
   * dead items), and a record with none allowed opens no menu at all.
   */
  allowed: boolean;
  destructive?: boolean;
  /** Defined means a toggle: it names a STATE and shows a trailing box (#465). */
  checked?: boolean;
  /** Toggles in the ⋯ menu stay open so several can be flipped in one pass. */
  keepOpen?: boolean;
  disabled?: boolean;
  /** Plain explanatory text, not something to press (e.g. a carrier STOP note). */
  note?: boolean;
  /** A submenu's muted explanatory line. */
  hint?: string;
  submenu?: RecordSubAction[];
  onSelect?: () => void;
}

/** The actions this viewer may take, in group order (stable within a group). */
export function visibleActions(actions: readonly RecordAction[]): RecordAction[] {
  const allowed = actions.filter((action) => action.allowed);
  return ACTION_GROUPS.flatMap((group) =>
    allowed.filter((action) => action.group === group),
  );
}

/** Just the ids, in render order. The parity tests compare these. */
export function actionIds(actions: readonly RecordAction[]): string[] {
  return visibleActions(actions).map((action) => action.id);
}
