/** @vitest-environment happy-dom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { prefetchByHref } = vi.hoisted(() => ({
  prefetchByHref: new Map<string, boolean | null | undefined>(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    children,
    className,
  }: {
    href: string;
    prefetch?: boolean | null;
    children: React.ReactNode;
    className?: string;
  }) => {
    prefetchByHref.set(href, prefetch);
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  },
}));

import { Footer } from "./footer";

afterEach(() => {
  cleanup();
  prefetchByHref.clear();
});

describe("the footer's status link", () => {
  // The router keeps a prefetched static page for 30 minutes (next.config.ts
  // staleTimes), which would show an incident line that long after it changed.
  it("is never prefetched, in either language", () => {
    render(<Footer />);
    expect(prefetchByHref.get("/status")).toBe(false);
    cleanup();
    render(<Footer locale="fr-CA" />);
    expect(prefetchByHref.get("/fr/etat-du-service")).toBe(false);
  });

  it("leaves every other footer link on the default prefetch", () => {
    render(<Footer />);
    expect(prefetchByHref.get("/pricing")).toBeUndefined();
    expect(prefetchByHref.size).toBeGreaterThan(10);
  });
});
