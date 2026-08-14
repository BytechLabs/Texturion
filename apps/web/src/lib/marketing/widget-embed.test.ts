/**
 * @vitest-environment happy-dom
 */
/**
 * #232 — the embed script, loaded the way a visitor's browser loads it.
 *
 * The real verification for this file happened in a browser, against a
 * deliberately hostile host theme (`button { width:100% !important; background:
 * red !important; font-size:40px !important }`) — the launcher rendered 87px
 * wide, in our ink, at 15px, with no border, because a shadow root is the only
 * mechanism that keeps a WordPress theme out.
 *
 * jsdom cannot reproduce that: it does not do cascade isolation, so asserting
 * it here would assert nothing. What it CAN hold is the half that is behaviour
 * rather than paint — and that half is the accessibility contract, which is
 * exactly the part that decays silently when somebody edits the script later.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

const SOURCE = readFileSync("public/widget.js", "utf8");

function mount(attrs: Record<string, string> = {}): ShadowRoot {
  document.body.innerHTML = "";
  const script = document.createElement("script");
  script.src = "https://app.loonext.com/widget.js";
  script.setAttribute("data-key", "11111111-1111-4111-8111-111111111111");
  for (const [name, value] of Object.entries(attrs)) {
    script.setAttribute(name, value);
  }
  document.head.appendChild(script);
  // `document.currentScript` is null outside real script evaluation, so it is
  // stubbed to the tag we just added — which is what the browser would report.
  Object.defineProperty(document, "currentScript", {
    value: script,
    configurable: true,
  });
  new Function(SOURCE)();
  const host = document.querySelector("[data-loonext-widget]");
  return (host as HTMLElement).shadowRoot!;
}

describe("the embed", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts into a shadow root rather than the host page", () => {
    // Not a style assertion — a structural one. Everything the widget draws has
    // to be inside the root, or a host theme reaches it.
    const root = mount();
    expect(root).not.toBeNull();
    expect(document.body.querySelector("button")).toBeNull();
    expect(root.querySelector(".launch")).not.toBeNull();
  });

  it("says so loudly when the snippet was pasted without its key", () => {
    // The one error worth a console line: the widget would otherwise fail
    // silently on every page of somebody's site.
    document.body.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://app.loonext.com/widget.js";
    document.head.appendChild(script);
    Object.defineProperty(document, "currentScript", {
      value: script,
      configurable: true,
    });
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args[0]);
    try {
      new Function(SOURCE)();
    } finally {
      console.error = original;
    }
    expect(String(errors[0])).toContain("data-key");
    expect(document.querySelector("[data-loonext-widget]")).toBeNull();
  });

  it("is a real dialog: opens, announces itself, and takes focus", () => {
    const root = mount();
    const launcher = root.querySelector(".launch") as HTMLButtonElement;
    const panel = root.querySelector(".panel") as HTMLElement;

    expect(panel.hidden).toBe(true);
    expect(launcher.getAttribute("aria-expanded")).toBe("false");

    launcher.click();

    expect(panel.hidden).toBe(false);
    expect(launcher.getAttribute("aria-expanded")).toBe("true");
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-modal")).toBe("true");
    // The first thing a keyboard or screen-reader user needs is to BE in the
    // dialog they just opened.
    expect((root.activeElement as HTMLElement)?.id).toBe("lx-name");
  });

  it("returns focus to the launcher on Escape", () => {
    // A dialog that drops focus on the body leaves a keyboard user at the top
    // of the page with no idea what happened.
    const root = mount();
    const launcher = root.querySelector(".launch") as HTMLButtonElement;
    const panel = root.querySelector(".panel") as HTMLElement;

    launcher.click();
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(panel.hidden).toBe(true);
    expect(root.activeElement).toBe(launcher);
  });

  it("traps Tab inside the dialog", () => {
    // Without this, Tab walks out of the dialog into the host page's own links
    // behind it — silently, for a screen-reader user.
    const root = mount();
    const launcher = root.querySelector(".launch") as HTMLButtonElement;
    const panel = root.querySelector(".panel") as HTMLElement;
    launcher.click();

    const focusable = panel.querySelectorAll<HTMLElement>(
      "button, input:not([tabindex='-1']), textarea",
    );
    focusable[focusable.length - 1].focus();
    panel.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );

    expect(root.activeElement).toBe(focusable[0]);
  });

  it("keeps the honeypot reachable by a bot and invisible to a person", () => {
    // Off-screen rather than `display:none`: some bots skip hidden fields, and
    // the entire point is that they fill this one in.
    const root = mount();
    const honeypot = root.querySelector(".hp input") as HTMLInputElement;
    expect(honeypot).not.toBeNull();
    expect(honeypot.getAttribute("tabindex")).toBe("-1");
    expect(SOURCE).toContain("left:-9999px");
    expect(SOURCE).not.toContain(".hp{display:none");
  });

  it("stays inside its size budget", () => {
    // #232: under 15KB, on somebody else's site, competing with their own
    // scripts for a visitor's connection.
    expect(Buffer.byteLength(SOURCE)).toBeLessThan(15 * 1024);
  });
});
