/**
 * @vitest-environment happy-dom
 *
 * A refetched signed URL must not restart a voicemail somebody is listening
 * to. The player keeps the URL it started with, takes a newer one only after
 * the element fails or while it has played nothing, and asks for a new one
 * when the one it has fails with nothing newer cached.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const voicemail = vi.hoisted(() => ({
  data: undefined as { url: string; seconds: number; transcript: string | null } | undefined,
  refetch: vi.fn(),
}));

vi.mock("@/lib/api/calls", () => ({
  useVoicemailUrl: () => ({
    data: voicemail.data,
    isFetching: false,
    isError: false,
    refetch: voicemail.refetch,
  }),
}));

import { VoicemailPlayer } from "./voicemail-player";

const player = () => <VoicemailPlayer callSessionId="sess-1" seconds={42} />;

function audio(): HTMLAudioElement {
  return document.querySelector("audio") as HTMLAudioElement;
}

function playing(element: HTMLAudioElement) {
  Object.defineProperty(element, "paused", { configurable: true, get: () => false });
  Object.defineProperty(element, "played", { configurable: true, get: () => ({ length: 1 }) });
}

function failed(element: HTMLAudioElement) {
  Object.defineProperty(element, "error", { configurable: true, get: () => ({ code: 2 }) });
  fireEvent.error(element);
}

function open() {
  const view = render(player());
  fireEvent.click(screen.getByRole("button", { name: /Play voicemail/ }));
  return view;
}

beforeEach(() => {
  voicemail.data = { url: "https://signed/one", seconds: 42, transcript: null };
  voicemail.refetch.mockReset();
});
afterEach(cleanup);

describe("VoicemailPlayer", () => {
  it("VP-1: keeps playing the first URL when a newer one arrives", () => {
    const { rerender } = open();
    expect(audio().getAttribute("src")).toBe("https://signed/one");
    playing(audio());
    voicemail.data = { url: "https://signed/two", seconds: 42, transcript: null };
    rerender(player());
    expect(audio().getAttribute("src")).toBe("https://signed/one");
  });

  it("VP-2: takes the newer URL once the element fails", () => {
    const { rerender } = open();
    playing(audio());
    voicemail.data = { url: "https://signed/two", seconds: 42, transcript: null };
    rerender(player());
    failed(audio());
    expect(audio().getAttribute("src")).toBe("https://signed/two");
    expect(voicemail.refetch).not.toHaveBeenCalled();
  });

  it("VP-3: asks for a new URL when the one it has fails and nothing newer is cached", () => {
    open();
    failed(audio());
    expect(voicemail.refetch).toHaveBeenCalledTimes(1);
  });

  it("VP-4: takes a newer URL while paused before playing any of the recording", () => {
    const { rerender } = open();
    voicemail.data = { url: "https://signed/two", seconds: 42, transcript: null };
    rerender(player());
    expect(audio().getAttribute("src")).toBe("https://signed/two");
  });

  it("VP-5: a player handed another call never keeps the previous call's recording", () => {
    const { rerender } = open();
    playing(audio());
    voicemail.data = undefined;
    rerender(<VoicemailPlayer callSessionId="sess-2" seconds={42} />);
    expect(audio()).toBeNull();
    voicemail.data = { url: "https://signed/other-call", seconds: 42, transcript: null };
    rerender(<VoicemailPlayer callSessionId="sess-2" seconds={42} />);
    expect(audio().getAttribute("src")).toBe("https://signed/other-call");
  });
});
