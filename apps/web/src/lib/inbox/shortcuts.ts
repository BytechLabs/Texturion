/**
 * #694: the inbox list's single-key shortcuts.
 *
 * ONE KEYMAP drives both the key handler and the cheat sheet. The cheat sheet
 * is rendered from `INBOX_KEYMAP` and the handler looks keys up in it, so a
 * shortcut cannot exist without being listed, or be listed without working.
 *
 * Single-character shortcuts are a WCAG 2.1.4 risk for people who use speech
 * input or a keyboard they hit by accident, so they can be turned off
 * (`shortcut-preference.ts`) and they never fire while the person is typing.
 */
import type { MessageKey } from "@/i18n/translate";

export type ShortcutAction =
  | "next"
  | "previous"
  | "open"
  | "close"
  | "snooze"
  | "assign"
  | "tag"
  | "reply"
  | "toggleUnread"
  | "search"
  | "help";

export interface ShortcutDef {
  /** The `KeyboardEvent.key` that triggers it. */
  key: string;
  /** What the cheat sheet shows on the key cap. */
  cap: string;
  /** Message-catalog key for what it does. */
  label: MessageKey;
}

export const INBOX_KEYMAP: Record<ShortcutAction, ShortcutDef> = {
  next: { key: "j", cap: "j", label: "inbox.shortcutMoveDown" },
  previous: { key: "k", cap: "k", label: "inbox.shortcutMoveUp" },
  open: { key: "Enter", cap: "Enter", label: "inbox.shortcutOpen" },
  close: { key: "e", cap: "e", label: "inbox.shortcutClose" },
  snooze: { key: "s", cap: "s", label: "inbox.shortcutSnooze" },
  assign: { key: "a", cap: "a", label: "inbox.shortcutAssign" },
  tag: { key: "l", cap: "l", label: "inbox.shortcutTag" },
  reply: { key: "r", cap: "r", label: "inbox.shortcutReply" },
  toggleUnread: { key: "u", cap: "u", label: "inbox.shortcutToggleUnread" },
  search: { key: "/", cap: "/", label: "inbox.shortcutSearch" },
  help: { key: "?", cap: "?", label: "inbox.shortcutHelp" },
};

const ACTIONS = Object.keys(INBOX_KEYMAP) as ShortcutAction[];

/** Elements that own the keyboard for typing or for their own widget. */
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const TYPING_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);
const OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-composer]';
/** Elements whose own Enter/Space activation must not be hijacked. */
const ACTIVATABLE_SELECTOR =
  'a[href], button, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="switch"], [role="option"]';

/**
 * True when a key press belongs to whatever has focus rather than to the
 * inbox. jsdom does not implement `isContentEditable`, so the attribute is read
 * as well.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (TYPING_TAGS.has(target.tagName)) return true;
  if (target.isContentEditable) return true;
  const editable = target.getAttribute("contenteditable");
  if (editable !== null && editable !== "false") return true;
  const role = target.getAttribute("role");
  if (role !== null && TYPING_ROLES.has(role)) return true;
  return target.closest(OVERLAY_SELECTOR) !== null;
}

/**
 * The action a keydown asks for, or null when it is not ours to handle.
 *
 * Returns null while typing, inside a dialog or menu, with a modifier held, or
 * during IME composition. Enter is left alone on a focused link or button so
 * the native activation is not run twice.
 */
export function shortcutForEvent(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "altKey" | "target" | "isComposing" | "defaultPrevented"
  >,
): ShortcutAction | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;

  const action = ACTIONS.find((candidate) => INBOX_KEYMAP[candidate].key === event.key);
  if (!action) return null;

  if (
    action === "open" &&
    event.target instanceof HTMLElement &&
    event.target.closest(ACTIVATABLE_SELECTOR) !== null
  ) {
    return null;
  }
  return action;
}

const COMPOSER_FOCUS_EVENT = "loonext:focus-composer";
const COMPOSER_FOCUS_TTL_MS = 5_000;
let composerFocusRequestedAt: number | null = null;

/** Ask the thread's composer to take focus when it is on screen. */
export function requestComposerFocus(): void {
  composerFocusRequestedAt = Date.now();
  window.dispatchEvent(new Event(COMPOSER_FOCUS_EVENT));
}

/** True once per request, and only while the request is fresh. */
export function consumeComposerFocus(): boolean {
  const at = composerFocusRequestedAt;
  composerFocusRequestedAt = null;
  return at !== null && Date.now() - at <= COMPOSER_FOCUS_TTL_MS;
}

export function onComposerFocusRequest(listener: () => void): () => void {
  window.addEventListener(COMPOSER_FOCUS_EVENT, listener);
  return () => window.removeEventListener(COMPOSER_FOCUS_EVENT, listener);
}
