import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { mountScope, PortalScope } from "./portal-scope";

/**
 * #116: portaled overlays live in document.body, outside the (app) tree's
 * .app-scope div. PortalScope must hold the scope classes on <body> for
 * exactly as long as an (app) route is mounted — without them, every portal
 * renders transparent surfaces and currentColor (white-in-dark) borders.
 * The suite runs in a node environment, so the class mechanics are pinned on
 * a stub target via the exported mountScope.
 */

function stubTarget() {
  const set = new Set<string>(["antialiased"]); // pre-existing body class
  return {
    set,
    classList: {
      add: (...tokens: string[]) => tokens.forEach((t) => set.add(t)),
      remove: (...tokens: string[]) => tokens.forEach((t) => set.delete(t)),
    },
  };
}

describe("mountScope", () => {
  it("adds every scope class and the cleanup removes exactly those", () => {
    const target = stubTarget();
    const cleanup = mountScope(target, "app-scope __golos_var");
    expect(target.set.has("app-scope")).toBe(true);
    expect(target.set.has("__golos_var")).toBe(true);

    cleanup();
    expect(target.set.has("app-scope")).toBe(false);
    expect(target.set.has("__golos_var")).toBe(false);
    // Pre-existing body classes are never disturbed.
    expect(target.set.has("antialiased")).toBe(true);
  });

  it("tolerates extra whitespace in the class string", () => {
    const target = stubTarget();
    mountScope(target, "  app-scope   x  ");
    expect(target.set.has("app-scope")).toBe(true);
    expect(target.set.has("x")).toBe(true);
    expect(target.set.has("")).toBe(false);
  });
});

describe("PortalScope", () => {
  it("renders no visual footprint of its own", () => {
    expect(renderToStaticMarkup(<PortalScope classes="app-scope" />)).toBe("");
  });
});
