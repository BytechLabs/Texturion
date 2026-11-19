/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ArrivalLayer } from "./arrival-layer";

vi.mock("next/dynamic", () => ({
  default: () => function Field() {
    return <div data-testid="arrival-field" />;
  },
}));

vi.mock("@/lib/perf/after-lcp-and-load", () => ({
  afterLcpAndLoad: (start: () => void) => {
    start();
    return () => {};
  },
}));

const PAUSE_KEY = "loonext-hero-animation-paused";
const LABELS = { pauseLabel: "Pause animation", resumeLabel: "Resume animation" };
let reducedMotion = false;

beforeEach(() => {
  reducedMotion = false;
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({
    matches: reducedMotion,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal("requestIdleCallback", (start: () => void) => {
    start();
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

it("keeps a saved pause in force before boot and lets the visitor resume", async () => {
  window.localStorage.setItem(PAUSE_KEY, "1");
  render(<ArrivalLayer {...LABELS} />);

  const resume = await screen.findByRole("button", { name: LABELS.resumeLabel });
  expect(resume.closest('[aria-hidden="true"]')).toBeNull();
  expect(screen.queryByTestId("arrival-field")).toBeNull();

  fireEvent.click(resume);
  await expect(screen.findByTestId("arrival-field")).resolves.toBeInstanceOf(Element);
  expect(window.localStorage.getItem(PAUSE_KEY)).toBe("0");

  fireEvent.click(screen.getByRole("button", { name: LABELS.pauseLabel }));
  expect(screen.queryByTestId("arrival-field")).toBeNull();
  expect(window.localStorage.getItem(PAUSE_KEY)).toBe("1");
});

it("keeps the static illustration when reduced motion is requested", () => {
  reducedMotion = true;
  render(<ArrivalLayer {...LABELS} />);

  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByTestId("arrival-field")).toBeNull();
});
