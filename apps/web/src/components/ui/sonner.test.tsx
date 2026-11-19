/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n/provider";

import { UNDO_DURATION_MS, undoableToast } from "./optimistic-undo";
import { Toaster } from "./sonner";

afterEach(async () => {
  await act(async () => {
    toast.dismiss();
    await vi.runOnlyPendingTimersAsync();
  });
  cleanup();
  vi.useRealTimers();
});

it("keeps an Undo available past five seconds while its button has focus", async () => {
  vi.useFakeTimers();
  const onUndo = vi.fn();
  const onCommit = vi.fn();
  render(
    <LocaleProvider userLocale="fr-CA">
      <button type="button">Continue</button>
      <Toaster />
    </LocaleProvider>,
  );

  await act(async () => {
    undoableToast({ message: "Conversation fermée", undoLabel: "Annuler", onUndo, onCommit });
    await vi.advanceTimersByTimeAsync(50);
  });
  const region = screen.getByRole("region", { name: "Notifications récentes (Alt+T)" });
  const list = within(region).getByRole("list");
  const undo = within(region).getByRole("button", { name: "Annuler" });

  fireEvent.keyDown(document, { key: "t", code: "KeyT", altKey: true });
  expect(document.activeElement).toBe(list);
  act(() => { undo.focus(); });
  fireEvent.mouseLeave(list, { relatedTarget: screen.getByRole("button", { name: "Continue" }) });
  await act(() => vi.advanceTimersByTimeAsync(UNDO_DURATION_MS + 1000));

  expect(undo.isConnected).toBe(true);
  expect(document.activeElement).toBe(undo);
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent.click(undo);
  expect(onUndo).toHaveBeenCalledOnce();
});

it("resumes the unused Undo time when focus leaves the toast", async () => {
  vi.useFakeTimers();
  const onCommit = vi.fn();
  render(
    <>
      <button type="button">Continue</button>
      <Toaster />
    </>,
  );
  const prior = screen.getByRole("button", { name: "Continue" });
  prior.focus();
  await act(async () => {
    undoableToast({ message: "Conversation closed", undoLabel: "Undo", onUndo: vi.fn(), onCommit });
    await vi.advanceTimersByTimeAsync(50);
  });
  const undo = screen.getByRole("button", { name: "Undo" });

  await act(() => vi.advanceTimersByTimeAsync(1000));
  act(() => { undo.focus(); });
  await act(() => vi.advanceTimersByTimeAsync(UNDO_DURATION_MS));
  expect(onCommit).not.toHaveBeenCalled();

  fireEvent.keyDown(undo, { key: "Escape", code: "Escape" });
  expect(document.activeElement).toBe(prior);
  await act(() => vi.advanceTimersByTimeAsync(3500));
  expect(onCommit).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(onCommit).toHaveBeenCalledOnce();
  expect(undo.isConnected).toBe(false);
});

it("resumes the other notices when the focused Undo disappears", async () => {
  vi.useFakeTimers();
  const onCommit = vi.fn();
  render(
    <>
      <button type="button">Continue</button>
      <Toaster />
    </>,
  );
  const prior = screen.getByRole("button", { name: "Continue" });
  prior.focus();
  await act(async () => {
    undoableToast({ message: "Conversation closed", undoLabel: "Undo close", onUndo: vi.fn(), onCommit });
    undoableToast({ message: "Conversation archived", undoLabel: "Undo archive", onUndo: vi.fn() });
    await vi.advanceTimersByTimeAsync(50);
  });

  const undo = screen.getByRole("button", { name: "Undo archive" });
  act(() => { undo.focus(); });
  fireEvent.click(undo);
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(undo.isConnected).toBe(false);
  expect(document.activeElement).toBe(prior);
  await act(() => vi.advanceTimersByTimeAsync(UNDO_DURATION_MS));
  expect(onCommit).toHaveBeenCalledOnce();
});
