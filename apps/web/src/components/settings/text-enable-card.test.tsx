/**
 * @vitest-environment happy-dom
 *
 * #594 — the hosted-number release, and WHERE its six digits go.
 *
 * `ReleaseHostedNumberDialog` (text-enable-card.tsx) is the fourth call site of
 * `useActionConfirmation`. It ends texting on a landline for good: the hosted row
 * is DELETEd, the plan slot frees, and text-enabling the same number again means a
 * fresh multi-day carrier review. The server therefore refuses it without proof of
 * who is asking, and everything below is about what the card does with that refusal.
 *
 * None of it is about copy. `HANDOVER_CONFIRM_WHERE.reprove` is word for word the
 * authenticator sentence, so nothing on screen tells the two paths apart — the only
 * observable difference is the DESTINATION of the digits, and a test pinned to the
 * wording would have passed throughout the lockout it is written to prevent.
 *
 * The last defect in this plumbing was a CALL-SITE property the hook's own suite
 * could not see: `demanded` runs from an `onError` written in one render, so a
 * refused code was judged against a stale "is the dialog open" and reported as
 * nothing at all — while the emailed path quietly minted a NEW code behind the one
 * the person was reading. The refused-code test drives that second refusal through
 * the handler the component actually passed, because re-reading the hook between
 * attempts is exactly what hid it.
 *
 * The rest of it lives in the CARD rather than in the hook, so the hook's own suite
 * cannot see any of it:
 *
 *   - the success lands against TWO caches, and the second sweep is this call site's
 *     alone. The order row the release was reached from converges server-side, so a
 *     card that refreshes only the numbers list goes on saying "Texting live, calls
 *     unchanged" over a number nobody can text.
 *   - the prompt has to be put away on the way out. It is a sibling of the release
 *     dialog rather than a child, so nothing closes it by itself: forget it and the
 *     confirm dialog is left stacked over a number that is already gone, with
 *     Cancel the only way out of it. Two ways out lead there — the success, and the
 *     retry that fails for some reason no code addresses — and only the first was
 *     ever reached with the prompt open.
 *   - BOTH dialogs have to go on success, and the release dialog for a second
 *     reason: closing it is also what clears the typed digits, so a card that leaves
 *     it standing leaves its destructive button lit over a row that is already gone.
 *     A second press there is a second DELETE.
 *   - the same button has to be dead for the whole stretch the DELETE is in flight,
 *     and the same digits have to be cleared by the OTHER way out, the cancel. Both
 *     are what makes the release two presses deep rather than one; the last block is
 *     about nothing else.
 *   - the typed digits are compared. They are what says WHICH number, on a screen
 *     that lists a card per landline with an identically worded button on each; the
 *     gate underneath only ever asks WHO.
 *   - the control exists only for an owner, only once texting is live, and only
 *     over a row that has not already been released. Every test in the first block
 *     mounts the one fixture where all three hold, so a later block mounts the ones
 *     where they do not.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiErrorCode, MemberRole } from "@loonext/shared";

import type { PhoneNumberSummary, TextEnablement } from "@/lib/api/types";

/** The workspace every key below is scoped to. */
const COMPANY = "c-1";

/** DELETE /v1/numbers/:id — the one irreversible act this card offers. */
const mutate = vi.fn();
/** "Email me a code" — the only thing the gate asks our API for up front. */
const requestCode = vi.fn();
/**
 * `useReleaseNumber().isPending`, driven per test.
 *
 * Pinned `false` everywhere except one: the mocked hook cannot flip it for itself,
 * and `false` is the truth at every assertion below — the DELETE has settled by
 * then. The state that is NOT reachable that way is the one the prompt sits in for
 * as long as the DELETE takes, which is where a second Confirm would land.
 */
let releasePending = false;
/** The caller's role. The release control is owner-only, so it is a variable. */
let role: MemberRole = "owner";

// Only the mutation hooks are replaced. `deriveTextEnableUiState` — which decides
// whether a release control exists at all — stays real, and so does the gate itself:
// a stub of either would be a second copy of the rule under test.
vi.mock("@/lib/api/numbers", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useReleaseNumber: () => ({ isPending: releasePending, mutate }),
}));

/**
 * Whether the gate is off emailing a code, as a value the card can be made to
 * re-read.
 *
 * The prompt's `pending` is `release.isPending || gate.requesting`, and only the
 * first half was ever reachable — so the second could be deleted and nothing here
 * would notice. It is not decoration: `confirm()` on the EMAIL path retries
 * synchronously, with none of the in-flight guarding the `reprove` path gets from
 * the hook's own ref, so this prop is the only thing standing between "Send it
 * again" and a second DELETE. React Query re-renders when the flag flips; so does
 * this.
 */
let codePending = false;
const codeWatchers = new Set<() => void>();
const subscribeCode = (notify: () => void) => {
  codeWatchers.add(notify);
  return () => {
    codeWatchers.delete(notify);
  };
};
const readCode = () => codePending;
function setCodePending(next: boolean) {
  codePending = next;
  for (const notify of codeWatchers) notify();
}

/** A hook rather than an object literal, so `isPending` can change mid-test. */
function useRequestHandoverCodeStub() {
  return {
    isPending: useSyncExternalStore(subscribeCode, readCode, readCode),
    mutate: requestCode,
  };
}

vi.mock("@/lib/api/ownership", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRequestHandoverCode: useRequestHandoverCodeStub,
}));

/** POST /v1/text-enablements/:id/cancel — the withdrawal, sent to the carrier. */
const cancelOrder = vi.fn();
/**
 * Whether that withdrawal is in flight, driven the same way as the two above and
 * for the same reason: `disabled={cancel.isPending}` is the only thing between a
 * second press and a second withdrawal, and a stub that can only answer `false`
 * leaves it untestable rather than merely untested.
 */
let cancelPending = false;
const cancelWatchers = new Set<() => void>();
const subscribeCancel = (notify: () => void) => {
  cancelWatchers.add(notify);
  return () => {
    cancelWatchers.delete(notify);
  };
};
const readCancel = () => cancelPending;
function setCancelPending(next: boolean) {
  cancelPending = next;
  for (const notify of cancelWatchers) notify();
}

function useCancelTextEnablementStub() {
  return {
    isPending: useSyncExternalStore(subscribeCancel, readCancel, readCancel),
    mutate: cancelOrder,
  };
}

// Only the one mutation is replaced; the rest of the module — including the upload,
// resubmit and verification hooks this card also reaches for — stays real.
vi.mock("@/lib/api/text-enablement", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCancelTextEnablement: useCancelTextEnablementStub,
}));

/**
 * The browser Supabase client, narrowed to the two MFA calls the `reprove` path
 * makes. Both verified against `@supabase/auth-js`: `listFactors()` resolves
 * `{ data: { totp, … }, error }` with only VERIFIED factors in `totp`, and
 * `challengeAndVerify({ factorId, code })` resolves `{ data, error }` after it has
 * already saved the refreshed session.
 */
const listFactors = vi.fn();
const challengeAndVerify = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowser: () => ({
    auth: { mfa: { listFactors, challengeAndVerify } },
  }),
  // Needed because the real API modules are loaded for everything that is not a
  // mutation hook, and their fetch client reads the token from here. No request is
  // made in this suite.
  getAccessToken: async () => "token",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => COMPANY,
  useActiveCompany: () => ({ companyId: COMPANY, role }),
}));

import {
  HANDOVER_CONFIRM_FIELD,
  HANDOVER_CONFIRM_REJECTED,
  HANDOVER_CONFIRM_RESEND,
  HANDOVER_CONFIRM_SUBMIT,
  HANDOVER_CONFIRM_SUBMITTING,
} from "@loonext/shared";

import { ApiError } from "@/lib/api/error";
import { keys } from "@/lib/api/keys";

import { TextEnableCard } from "./text-enable-card";

const FACTOR = "totp-factor-id";

/** A live hosted order — the only state that offers the release at all. */
const ORDER: TextEnablement = {
  id: "te-1",
  phone_e164: "+14155550142",
  country: "US",
  status: "completed",
  has_loa: true,
  has_bill: true,
  last_error: null,
  completed_at: "2026-07-20T12:00:00Z",
  cancelled_at: null,
  created_at: "2026-07-01T12:00:00Z",
};

/** The `phone_numbers[source=hosted]` row the order was matched to by E.164. */
const HOSTED = {
  id: "n-hosted",
  status: "active",
  country: "US",
  number_e164: "+14155550142",
  requested_area_code: null,
  created_at: "2026-07-20T12:00:00Z",
  source: "hosted",
} as unknown as PhoneNumberSummary;

/**
 * The cache the card writes back into. A real `QueryClient` rather than a spy: what
 * matters is which stored queries end up stale, and `invalidateQueries` matches by
 * key PREFIX — a spy would only ever confirm the argument we already wrote.
 */
let client: QueryClient;

function tree(
  order: TextEnablement = ORDER,
  hostedNumber: PhoneNumberSummary | null = HOSTED,
) {
  return (
    <QueryClientProvider client={client}>
      <TextEnableCard order={order} hostedNumber={hostedNumber} />
    </QueryClientProvider>
  );
}

/** True once the card's success path marked the query under `key` stale. */
function refreshed(key: readonly unknown[]): boolean {
  return client.getQueryState(key)?.isInvalidated === true;
}

/**
 * Refuse the first attempt the way the server does, then let the retry through.
 *
 * The retry is the interesting call: what it carries is the difference between a
 * number that is released and a dialog that can never be satisfied.
 */
function refuseOnce(errorCode: string) {
  let refused = false;
  mutate.mockImplementation((_input: unknown, handlers?: {
    onSuccess?: (data: unknown) => void;
    onError?: (error: unknown) => void;
  }) => {
    if (!refused) {
      refused = true;
      handlers?.onError?.(new ApiError(errorCode as never, "nope", 403));
      return;
    }
    handlers?.onSuccess?.(HOSTED);
  });
}

/**
 * Refuse the first attempt and leave every later one in flight.
 *
 * For the refused-code test, whose second refusal has to arrive through the handler
 * the component passed rather than through a fresh read of the hook.
 */
function refuseThenHold(errorCode: string) {
  let refused = false;
  mutate.mockImplementation((_input: unknown, handlers?: {
    onError?: (error: unknown) => void;
  }) => {
    if (!refused) {
      refused = true;
      handlers?.onError?.(new ApiError(errorCode as never, "nope", 403));
    }
  });
}

/**
 * The input the release was retried with.
 *
 * Throws rather than returning `{}`, in both directions. Reading `calls[1]?.[0]`
 * alone made "the retry carried no code" and "there was no retry" the same green,
 * and made a THIRD call invisible — and a second retry here is a second DELETE
 * against a number that is already gone.
 */
function retriedWith(): { numberId?: string; code?: string } {
  if (mutate.mock.calls.length < 2) {
    throw new Error(
      "the release was never retried: mutate was called " +
        `${mutate.mock.calls.length} time(s), so there is no retry to inspect`,
    );
  }
  if (mutate.mock.calls.length > 2) {
    throw new Error(
      `the release was retried ${mutate.mock.calls.length - 1} times, not once: ` +
        "one answered prompt must produce one attempt",
    );
  }
  return mutate.mock.calls[1][0] as { numberId?: string; code?: string };
}

/** The one control that ends texting for good, inside the release dialog. */
const removeTexting = () =>
  screen.getByRole("button", { name: "Remove texting" }) as HTMLButtonElement;

/** The box the number is typed into. */
const confirmBox = () =>
  screen.getByLabelText(/to confirm/) as HTMLInputElement;

/** Mount the card, open the release dialog, and stop there. */
function openTheDialog(order: TextEnablement = ORDER) {
  const view = render(tree(order));
  fireEvent.click(screen.getByRole("button", { name: /Release this number/ }));
  return view;
}

/**
 * Mount the card, answer the type-to-confirm, and press the one destructive control
 * — i.e. get as far as whatever the server says next.
 *
 * The digits typed here are friction against a slip, not against the wrong person:
 * they say WHICH number, and it is the gate below that asks WHO. That the box
 * actually compares them is the last describe's business — this helper takes the
 * happy answer for granted so the tests either side of it are about the server.
 */
function pressRemoveTexting() {
  const view = openTheDialog();
  fireEvent.change(confirmBox(), { target: { value: "4155550142" } });
  fireEvent.click(removeTexting());
  return view;
}

/** Type six digits into the confirmation dialog and press Confirm. */
async function answer(digits: string) {
  fireEvent.change(screen.getByLabelText(HANDOVER_CONFIRM_FIELD), {
    target: { value: digits },
  });
  // Awaited: the `reprove` path talks to Supabase before it retries, and the
  // assertions are all about what happens after that answer comes back.
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: HANDOVER_CONFIRM_SUBMIT }),
    );
  });
}

afterEach(() => {
  cleanup();
  // Radix renders both dialogs into a portal that outlives `cleanup`, and much of
  // what is asserted here is the ABSENCE of a control.
  document.body.innerHTML = "";
});

beforeEach(() => {
  role = "owner";
  releasePending = false;
  setCodePending(false);
  setCancelPending(false);
  cancelOrder.mockReset();
  mutate.mockReset();
  requestCode.mockReset();
  listFactors
    .mockReset()
    .mockResolvedValue({ data: { totp: [{ id: FACTOR }] }, error: null });
  challengeAndVerify.mockReset().mockResolvedValue({ data: {}, error: null });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // The two surfaces a released hosted number changes, seeded at the keys the app
  // really reads them under. `keys.textEnablements.list` sits UNDER the root the
  // card invalidates, so this also pins that the sweep is wide enough to reach it.
  client.setQueryData(keys.numbers(COMPANY), { data: [] });
  client.setQueryData(keys.textEnablements.list(COMPANY), { data: [] });
});

describe("releasing a text-enabled number, when the server asks who is doing this", () => {
  it("spends a stale-proof code on Supabase and retries with NO code", async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. `mfa_reprove_required` is not a secret the
    // server is waiting to be told — it is reading how long ago this session proved a
    // factor. So the digits are proved against SUPABASE here, which refreshes the
    // session, and the release is retried carrying nothing.
    refuseOnce("mfa_reprove_required");
    pressRemoveTexting();

    await answer("123456");

    expect(challengeAndVerify).toHaveBeenCalledWith({
      factorId: FACTOR,
      code: "123456",
    });
    // And the retry carries no code. `code: "123456"` here is the infinite loop:
    // nothing about the session would have changed, so the identical refusal comes
    // back to every correct code, forever.
    expect(retriedWith().code).toBeUndefined();
    // Still the same number the owner typed the digits of, not whatever the card
    // might be showing by now.
    expect(retriedWith().numberId).toBe("n-hosted");
    // Nothing was emailed either: their app makes the codes.
    expect(requestCode).not.toHaveBeenCalled();
    // And the prompt is put away. It is a sibling of the release dialog, so nothing
    // closes it on its own.
    expect(
      screen.queryByLabelText(HANDOVER_CONFIRM_FIELD),
      "the code prompt is still stacked over a number that is already released, with Cancel the only way out",
    ).toBeNull();
  });

  it("posts an emailed code to OUR API, and asks for one on open", async () => {
    refuseOnce("confirmation_code_required");
    pressRemoveTexting();

    // A dialog whose only working control is "Send it again" has wasted a trip.
    expect(requestCode).toHaveBeenCalledWith("release_number");
    await answer("123456");

    expect(retriedWith().code).toBe("123456");
    expect(retriedWith().numberId).toBe("n-hosted");
    // The other destination is untouched — our server checks the code it emailed.
    expect(challengeAndVerify).not.toHaveBeenCalled();
    expect(
      screen.queryByLabelText(HANDOVER_CONFIRM_FIELD),
      "the code prompt is still stacked over a number that is already released, with Cancel the only way out",
    ).toBeNull();
  });

  it("will not let Confirm land while a fresh code is still being emailed", async () => {
    // The email path retries the moment Confirm is pressed — no await, so none of
    // the in-flight guarding the `reprove` path gets from the hook applies. The
    // prompt's `pending` is the whole of it, and half that expression was
    // unreachable from here: `gate.requesting` could be dropped and every test
    // stayed green.
    //
    // The sequence is ordinary. The code has not arrived, so the owner presses
    // "Send it again" — and then, while that request is still out, presses Confirm
    // on digits from the older email. Without the guard that fires a DELETE at the
    // number a second time.
    refuseOnce("confirmation_code_required");
    pressRemoveTexting();

    setCodePending(true);
    fireEvent.click(
      screen.getByRole("button", { name: HANDOVER_CONFIRM_RESEND }),
    );
    fireEvent.change(screen.getByLabelText(HANDOVER_CONFIRM_FIELD), {
      target: { value: "123456" },
    });

    // Found by either label deliberately. Looking it up by the busy one would make
    // this test fail on the wording before it ever pressed anything, and the thing
    // worth failing on is the DELETE.
    const submit = screen.getByRole("button", {
      name: new RegExp(`^(${HANDOVER_CONFIRM_SUBMIT}|${HANDOVER_CONFIRM_SUBMITTING})$`),
    });
    await act(async () => {
      fireEvent.click(submit);
    });

    expect(
      mutate,
      "a second DELETE went out at a number whose release was already asked for",
    ).toHaveBeenCalledTimes(1);
    // And it said so, rather than sitting there looking pressable.
    expect(submit.textContent).toBe(HANDOVER_CONFIRM_SUBMITTING);
  });

  it("refreshes the order row it was reached from, not just the numbers list", async () => {
    // The one thing here that is not shared with the other three call sites. This
    // release is reached from a text-enablement order, and the order row converges
    // server-side after the hosted number goes: `useReleaseNumber` knows nothing
    // about that surface, so the card has to sweep it itself. Without it the card
    // keeps rendering "Texting live, calls unchanged" over a number nobody can text,
    // release control and all, until something else happens to refetch.
    refuseOnce("confirmation_code_required");
    pressRemoveTexting();

    await answer("123456");

    expect(
      refreshed(keys.textEnablements.list(COMPANY)),
      "the order list was left as it was, so the card still says 'Texting live' over a released number",
    ).toBe(true);
    expect(
      refreshed(keys.numbers(COMPANY)),
      "the numbers list was left as it was, so Settings → Numbers still lists the released row",
    ).toBe(true);
  });

  it("says a refused code was refused, once, and does not mint a second one", async () => {
    // The defect that lived for months. `demanded` runs from an `onError` written in
    // ONE render, and it decides "first attempt or refused code" from a value that
    // closure captured before the prompt existed. Judged wrong, a refused code
    // reported nothing at all — and on this path it also emailed a NEW code, which
    // invalidated the one the person was reading off their screen.
    //
    // So the second refusal is delivered through the handler the component itself
    // passed on the retry. Reading the hook again between attempts is precisely what
    // hides the bug.
    refuseThenHold("confirmation_code_required");
    pressRemoveTexting();
    await answer("123456");

    const retryHandlers = mutate.mock.calls[1]?.[1] as {
      onError?: (error: unknown) => void;
    };
    await act(async () => {
      retryHandlers.onError?.(
        new ApiError("confirmation_code_required" as never, "nope", 403),
      );
    });

    // The prompt is still standing, so there is somewhere to type the next code.
    expect(screen.queryByLabelText(HANDOVER_CONFIRM_FIELD)).not.toBeNull();
    // And it says what happened — exactly once.
    expect(screen.getAllByText(HANDOVER_CONFIRM_REJECTED)).toHaveLength(1);
    // The code in their inbox is still the one that works. A second mint behind
    // somebody still reading the first is how a correct code becomes a wrong one.
    expect(requestCode).toHaveBeenCalledTimes(1);
  });

  it("takes no second answer while the release it already fired is in flight", async () => {
    // The state every other test here skips past: the code has been sent and
    // the DELETE has not come back. `release.isPending` is the only thing holding the
    // prompt shut for that stretch — the hook's own `confirm` guard covers the
    // Supabase branch only, so on the emailed path a second press simply fires a
    // second DELETE and spends the code answering it.
    refuseThenHold("confirmation_code_required");
    const view = pressRemoveTexting();
    await answer("123456");

    releasePending = true;
    view.rerender(tree());

    const submit = screen.getByRole("button", { name: /Confirm/ });
    expect(
      (submit as HTMLButtonElement).disabled,
      "the prompt takes a second answer while its first DELETE is still in flight, firing a second release and burning the emailed code",
    ).toBe(true);
  });

  it("still reports a refusal no code could fix", () => {
    // A number already released, or a caller the server does not accept as the owner.
    // A code prompt in front of either hides the real reason behind digits that could
    // not have helped.
    mutate.mockImplementation((_input: unknown, handlers?: {
      onError?: (error: unknown) => void;
    }) => {
      handlers?.onError?.(new ApiError("conflict" as never, "Already released", 409));
    });
    pressRemoveTexting();

    expect(screen.queryByLabelText(HANDOVER_CONFIRM_FIELD)).toBeNull();
    // This card reports its failures inline, in the dialog the owner is looking at,
    // rather than through a toast.
    expect(screen.getByRole("alert").textContent).toBe("Already released");
    // And it stops there. A refusal the caller cannot answer must not be retried
    // behind their back: the second DELETE gets the same 409, and on a race it is
    // the attempt that releases somebody else's number.
    expect(
      mutate,
      "the card retried a refusal nobody answered — a second DELETE fired without a press",
    ).toHaveBeenCalledTimes(1);
    // Nothing was emailed either. A code minted for a failure no code can fix trains
    // the owner to expect one, and spends a mint doing it.
    expect(
      requestCode,
      "a code was emailed for a refusal no code could have fixed",
    ).not.toHaveBeenCalled();
  });

  it("puts the release dialog away too, so a second press can't fire a second DELETE", () => {
    // The gate never opens here — the server took the first attempt. What is left
    // over is the OTHER dialog, the one with the number typed into it, and only
    // `close(false)` shuts it. That same call is what clears `typed`, and `typed` is
    // what `matches` is computed from, so a success that forgets it leaves the
    // destructive button LIT over a hosted row that no longer exists. This is the
    // double-fire that was just fixed on close-workspace-card.tsx, on the surface
    // where the second press is a second DELETE against a released number.
    mutate.mockImplementation((_input: unknown, handlers?: {
      onSuccess?: (data: unknown) => void;
    }) => {
      handlers?.onSuccess?.(HOSTED);
    });
    pressRemoveTexting();

    const stillStanding = screen.queryByRole("button", {
      name: "Remove texting",
    });
    // Pressed rather than merely counted, so the assertion below is the real
    // consequence and not a proxy for it.
    if (stillStanding) fireEvent.click(stillStanding);
    expect(
      mutate,
      "the release dialog was left standing with `typed` intact, so a second press fired a second DELETE at a number that is already gone",
    ).toHaveBeenCalledTimes(1);
    expect(stillStanding).toBeNull();
  });

  it("puts the code prompt away when the retry fails for some other reason", () => {
    // The fallback branch no test above reaches with the prompt OPEN. Every other
    // failure here fails on the FIRST attempt, before a gate exists, so `gate.dismiss()`
    // in the fallback is a no-op in all of them and could be deleted unnoticed.
    //
    // The real sequence: the server asks for the emailed code, the owner types it, and
    // the retry comes back a conflict — somebody released the row in between. Without
    // the dismiss, the prompt stays stacked over an action that has already failed,
    // asking for digits that cannot fix a conflict, with the reason underneath it.
    let attempts = 0;
    mutate.mockImplementation((_input: unknown, handlers?: {
      onError?: (error: unknown) => void;
    }) => {
      attempts += 1;
      handlers?.onError?.(
        attempts === 1
          ? new ApiError("confirmation_code_required" as never, "nope", 403)
          : new ApiError("conflict" as never, "Already released", 409),
      );
    });
    pressRemoveTexting();
    // The gate really did open, so the absence asserted below is the dismiss rather
    // than a prompt that was never there.
    expect(screen.queryByLabelText(HANDOVER_CONFIRM_FIELD)).not.toBeNull();

    fireEvent.change(screen.getByLabelText(HANDOVER_CONFIRM_FIELD), {
      target: { value: "123456" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: HANDOVER_CONFIRM_SUBMIT }),
    );

    expect(
      screen.queryByLabelText(HANDOVER_CONFIRM_FIELD),
      "the code prompt is still up over an action that already reported an error — the only way out of it is Cancel, and the reason is behind it",
    ).toBeNull();
    // And the reason is readable, in the dialog underneath.
    expect(screen.getByRole("alert").textContent).toBe("Already released");
  });
});

describe("who the release is offered to, and over what", () => {
  /** The one control that ends texting for good. */
  const releaseControl = () =>
    screen.queryByRole("button", { name: /Release this number/ });

  // The fixture every test above mounts, asserted once from the other side. Without
  // it the three negatives below could all pass on a mistyped query rather than on
  // the guard they are written for — each of them changes exactly one thing from
  // here, so this is what makes them mean anything.
  it("offers it to the owner of a live order over a number still held", () => {
    render(tree());
    expect(releaseControl()).not.toBeNull();
  });

  it("does not offer it to an admin", () => {
    role = "admin";
    render(tree());
    expect(
      releaseControl(),
      "an admin is offered a control only an owner can complete — they type the number out and are refused",
    ).toBeNull();
  });

  it("does not offer it over a row that is already released", () => {
    render(tree(ORDER, { ...HOSTED, status: "released" } as PhoneNumberSummary));
    expect(
      releaseControl(),
      "the card offers to release a number that is already gone; the DELETE comes back a conflict",
    ).toBeNull();
  });

  it("does not offer it while the carrier is still reviewing", () => {
    render(tree({ ...ORDER, status: "pending" }));
    // This order's own control, so the absence below is about the guard rather than
    // about a card that failed to render.
    expect(
      screen.queryByRole("button", { name: /Cancel text-enablement/ }),
      "this order's own control is gone too, so the absence asserted next proves nothing",
    ).not.toBeNull();
    expect(
      releaseControl(),
      "texting was never turned on and the card offers to remove it, next to the cancel that is the real way out",
    ).toBeNull();
  });
});

describe("the box that asks WHICH number", () => {
  // Not the gate's job, and nothing above covers it: every test in this file types
  // the right digits. The gate asks WHO is doing this; these six ask WHICH number
  // they meant. Settings → Numbers lists a card per landline, each with an
  // identically worded destructive button, so the digits are the only thing standing
  // between a slip on the wrong card and texting ending on the wrong line. This file
  // is the only test of TextEnableCard anywhere in the repo — if it does not pin the
  // comparison, nothing does.
  it("stays dead until this number's own digits are typed", () => {
    openTheDialog();

    expect(
      removeTexting().disabled,
      "an empty confirmation box releases the number — the dialog is one press deep, not two",
    ).toBe(true);

    // One digit off, then PRESSED — "disabled" is the mechanism and this is the
    // consequence, and it is the consequence that matters on a screen full of
    // identically worded buttons.
    fireEvent.change(screen.getByLabelText(/to confirm/), {
      target: { value: "4155550143" },
    });
    fireEvent.click(removeTexting());
    expect(
      mutate,
      "a DELETE fired for digits that are not this number's — the slip this box exists to catch ends texting on the wrong landline",
    ).not.toHaveBeenCalled();
  });

  it("accepts the number as the label writes it", () => {
    // The other half of the same rule: a box that only accepts a bare ten digits
    // rejects the string it is telling people to copy. `formatPhone` renders
    // "(415) 555-0142" on the label and in the placeholder, so punctuation is not
    // part of the answer — and neither is a leading country code.
    openTheDialog();

    fireEvent.change(screen.getByLabelText(/to confirm/), {
      target: { value: "(415) 555-0142" },
    });
    expect(
      removeTexting().disabled,
      "the box refuses the exact string on its own label and in its own placeholder — copy it and nothing happens",
    ).toBe(false);

    fireEvent.change(screen.getByLabelText(/to confirm/), {
      target: { value: "14155550142" },
    });
    expect(
      removeTexting().disabled,
      "the box refuses the number typed with its country code, which is how the E.164 it is compared against reads",
    ).toBe(false);
  });

  it("stays dead over an order carrying no digits at all", () => {
    // The other end of the same comparison, and the only case where an EMPTY box
    // satisfies it: `typedDigits === expectedDigits` is `"" === ""`, so without the
    // emptiness check the destructive button is lit the moment the dialog opens,
    // over a label with no number on it to type. Reachable only from a
    // `phone_e164` that arrived blank, which is why it is one cheap line rather
    // than a scenario — but it collapses the whole control when it happens.
    openTheDialog({ ...ORDER, phone_e164: "" });

    expect(
      removeTexting().disabled,
      "an empty box releases a number whose digits are blank — the confirmation is zero presses deep",
    ).toBe(true);
  });
});

describe("what keeps the release two presses deep", () => {
  it("won't take a second press while the DELETE it fired is in flight", () => {
    // `mutate` answers nothing, so the release stays in flight exactly as it does
    // between the request and the response — the stretch every other test here
    // skips past. The dialog is still standing over it with the digits typed and
    // `matches` still true, so `release.isPending` is the only thing between the
    // owner and a second DELETE at a number whose release is already running.
    // This is the double-fire just fixed on close-workspace-card.tsx.
    const view = pressRemoveTexting();
    expect(mutate).toHaveBeenCalledTimes(1);

    releasePending = true;
    view.rerender(tree());

    // Found by the in-flight label, and PRESSED — "disabled" is the mechanism and
    // the second DELETE is the consequence, and it is the consequence that is
    // irreversible.
    const inFlight = screen.getByRole("button", {
      name: "Releasing…",
    }) as HTMLButtonElement;
    fireEvent.click(inFlight);

    expect(
      mutate,
      "a second press fired a second DELETE at a number whose release was already in flight",
    ).toHaveBeenCalledTimes(1);
    expect(inFlight.disabled).toBe(true);
  });

  it("comes back empty after Keep texting, digits and failure both", () => {
    // The exit nothing above takes. Cancelling has to run `close(false)` rather
    // than `setOpen(false)`, because `close(false)` is the only thing that clears
    // `typed` — and `typed` is what `matches` is computed from. Leave either half
    // out and reopening the dialog finds the number still in the box and the
    // destructive button ALREADY LIT: the confirmation is one press deep instead
    // of two, which is the entire friction the control exists for.
    mutate.mockImplementation((_input: unknown, handlers?: {
      onError?: (error: unknown) => void;
    }) => {
      handlers?.onError?.(
        new ApiError("conflict" as never, "Already released", 409),
      );
    });
    pressRemoveTexting();
    // Both things that must not survive the exit are really here first, so the
    // absences asserted after the reopen are the clear rather than a state that
    // was never reached.
    expect(confirmBox().value).toBe("4155550142");
    expect(screen.getByRole("alert").textContent).toBe("Already released");

    fireEvent.click(screen.getByRole("button", { name: "Keep texting" }));
    fireEvent.click(screen.getByRole("button", { name: /Release this number/ }));

    expect(
      confirmBox().value,
      "the number is still typed into a reopened dialog, so the destructive button is lit on open and the release is one press deep",
    ).toBe("");
    expect(removeTexting().disabled).toBe(true);
    expect(
      screen.queryByRole("alert"),
      "a failure from the previous attempt is still on screen under a dialog that has not been submitted",
    ).toBeNull();
  });

  it("clears the last failure when the retry goes out", () => {
    // The dialog stays open on a failure, with the digits intact, so pressing
    // again is the ordinary way to retry. The old reason has to go with the new
    // attempt: left up, "Already released" sits under a release that is at that
    // moment in flight and may well succeed.
    let attempts = 0;
    mutate.mockImplementation((_input: unknown, handlers?: {
      onError?: (error: unknown) => void;
    }) => {
      attempts += 1;
      if (attempts === 1) {
        handlers?.onError?.(
          new ApiError("conflict" as never, "Already released", 409),
        );
      }
      // The retry is left in flight — the stretch the stale reason would be read in.
    });
    pressRemoveTexting();
    expect(screen.getByRole("alert").textContent).toBe("Already released");

    fireEvent.click(removeTexting());

    expect(mutate).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole("alert"),
      "the previous attempt's reason is still on screen underneath a retry that is in flight",
    ).toBeNull();
  });
});

/**
 * #604 — withdrawing the order, which is the other irreversible thing this card
 * offers.
 *
 * Cancelling is a request to the carrier, not a local flag, so the same two rules
 * hold as for the release above: one press must send one withdrawal, and the reason
 * an attempt failed must not still be on screen under the next one. Both guards
 * existed and neither was reachable — nothing in this file had ever pressed that
 * button, so either could have been deleted without a test noticing.
 */
describe("withdrawing a text-enablement order", () => {
  /** Non-terminal, so the card offers the cancel. Deliberately not `live`. */
  const IN_PROGRESS: TextEnablement = {
    ...ORDER,
    status: "in-progress",
    completed_at: null,
  };

  /** Mount with an order that can still be withdrawn, and open the dialog. */
  function openCancel() {
    const view = render(tree(IN_PROGRESS, null));
    fireEvent.click(
      screen.getByRole("button", { name: /Cancel text-enablement…/ }),
    );
    return view;
  }

  /** The control that actually sends it. */
  const withdraw = () =>
    screen.getByRole("button", {
      name: /^(Cancel text-enablement|Cancelling…)$/,
    }) as HTMLButtonElement;

  it("sends one withdrawal however many times it is pressed", () => {
    openCancel();

    fireEvent.click(withdraw());
    // What the real hook does the instant the request goes out, and what the stub
    // could never say before: the card is now mid-request. Inside `act` so the
    // re-render lands before the next press, exactly as it would in a browser —
    // outside it, React has not repainted yet and the button under the second
    // click is still the old one.
    act(() => {
      setCancelPending(true);
    });
    fireEvent.click(withdraw());
    fireEvent.click(withdraw());

    expect(
      cancelOrder,
      "a second withdrawal went to the carrier for an order already being withdrawn",
    ).toHaveBeenCalledTimes(1);
    // And it says which of the two states it is in, rather than looking pressable.
    expect(withdraw().textContent).toBe("Cancelling…");
  });

  it("does not leave the last failure standing under the next attempt", () => {
    cancelOrder.mockImplementation(
      (
        _input: undefined,
        handlers?: { onError?: (error: unknown) => void },
      ) => {
        // Only the first attempt fails, and the second is left in flight — the
        // stretch during which a stale reason would be read as this attempt's.
        if (cancelOrder.mock.calls.length === 1) {
          handlers?.onError?.(
            new ApiError(
              "conflict" as ApiErrorCode,
              "The carrier already closed this order.",
              409,
            ),
          );
        }
      },
    );
    openCancel();

    fireEvent.click(withdraw());
    expect(screen.getByRole("alert").textContent).toBe(
      "The carrier already closed this order.",
    );

    fireEvent.click(withdraw());

    expect(cancelOrder).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole("alert"),
      "the previous attempt's reason is still on screen under a retry that is in flight",
    ).toBeNull();
  });
});
