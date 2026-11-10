/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  INBOX_KEYMAP,
  shortcutForEvent,
  type ShortcutAction,
} from "./shortcuts";

afterEach(() => {
  document.body.innerHTML = "";
});

function press(key: string, target: EventTarget | null = document.body, extra = {}) {
  return shortcutForEvent({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    defaultPrevented: false,
    target,
    ...extra,
  });
}

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.firstElementChild as HTMLElement;
}

describe("the inbox keymap", () => {
  it("maps j, k and e from the one keymap", () => {
    expect(press("j")).toBe("next");
    expect(press("k")).toBe("previous");
    expect(press("e")).toBe("close");
  });

  it("covers every shortcut the issue lists", () => {
    const keys: Record<string, ShortcutAction> = {
      j: "next",
      k: "previous",
      Enter: "open",
      e: "close",
      s: "snooze",
      a: "assign",
      l: "tag",
      r: "reply",
      u: "toggleUnread",
      "/": "search",
      "?": "help",
    };
    for (const [key, action] of Object.entries(keys)) {
      expect(INBOX_KEYMAP[action].key).toBe(key);
      expect(press(key)).toBe(action);
    }
  });

  it("ignores other keys, capitals, and modified keys", () => {
    expect(press("x")).toBeNull();
    expect(press("J")).toBeNull();
    expect(press("j", document.body, { ctrlKey: true })).toBeNull();
    expect(press("j", document.body, { metaKey: true })).toBeNull();
    expect(press("j", document.body, { isComposing: true })).toBeNull();
  });
});

describe("no shortcut fires while typing", () => {
  const targets: Record<string, string> = {
    input: '<input type="text" />',
    "search input": '<input type="search" />',
    checkbox: '<input type="checkbox" />',
    textarea: "<textarea></textarea>",
    select: "<select><option>a</option></select>",
    contenteditable: '<div contenteditable="true">x</div>',
    "the composer": '<div data-composer><span tabindex="0">x</span></div>',
    "a textbox role": '<div role="textbox" tabindex="0"></div>',
    "a dialog": '<div role="dialog"><button>ok</button></div>',
    "a menu": '<div role="menu"><div role="menuitem">x</div></div>',
  };

  for (const [name, html] of Object.entries(targets)) {
    it(`stays silent in ${name}`, () => {
      const root = mount(html);
      const target =
        root.querySelector<HTMLElement>("input, textarea, select, span, button, [role=menuitem]") ??
        root;
      for (const action of Object.keys(INBOX_KEYMAP) as ShortcutAction[]) {
        expect(press(INBOX_KEYMAP[action].key, target)).toBeNull();
      }
    });
  }

  it("leaves Enter to a focused link or button", () => {
    const button = mount("<button>Open</button>");
    expect(press("Enter", button)).toBeNull();
    const link = mount('<a href="/x">x</a>');
    expect(press("Enter", link)).toBeNull();
  });
});
