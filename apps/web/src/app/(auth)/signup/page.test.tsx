// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import SignupPage from "./page";

const auth = vi.hoisted(() => ({
  signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
  resend: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/env", () => ({ publicEnv: { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "test-key" } }));
vi.mock("@/lib/supabase/browser", () => ({ getSupabaseBrowser: () => ({ auth }) }));
vi.mock("@/components/auth/oauth-buttons", () => ({ OAuthButtons: () => null }));
vi.mock("@/lib/analytics/events", () => ({
  trackSignupStarted: () => {},
  trackSignupCompleted: () => {},
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({}) }));
vi.mock("@/components/auth/turnstile", () => ({
  Turnstile: ({ onToken }: { onToken: (token: string) => void }) => (
    <>
      <button type="button" onClick={() => onToken("signup-token")}>Verify signup</button>
      <button type="button" onClick={() => onToken("resend-token")}>Verify resend</button>
    </>
  ),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
  window.sessionStorage.clear();
});

it("requires a fresh captcha and keeps the plan when resending after a minute", async () => {
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/signup?plan=pro");
  render(<SignupPage />);
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Ana" } });
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "ana@example.test" } });
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "example-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify signup" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  });

  expect(screen.getByText(/spam folder/i)).toBeTruthy();
  const resend = screen.getByRole("button", { name: "Resend confirmation email" });
  expect(resend.hasAttribute("disabled")).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
  expect(screen.queryByRole("button", { name: "Verify resend" })).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(resend.hasAttribute("disabled")).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Verify resend" }));
  await act(async () => {
    fireEvent.click(resend);
  });

  expect(auth.resend).toHaveBeenCalledExactlyOnceWith({
    type: "signup",
    email: "ana@example.test",
    options: {
      captchaToken: "resend-token",
      emailRedirectTo: `${window.location.origin}/onboarding?plan=pro`,
    },
  });
  expect(resend.hasAttribute("disabled")).toBe(true);
});
