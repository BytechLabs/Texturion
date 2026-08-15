/**
 * @vitest-environment happy-dom
 *
 * Only the first block renders to static markup and asserts words. Everything after
 * it needs a real DOM: the grace window is chosen inside a dialog that static markup
 * never opens, and what #594 broke is not on screen at all — it is WHERE the six
 * digits get sent.
 */
import {
  act,
  cleanup,
  fireEvent,
  render as mount,
  screen,
} from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #314 — the owner's workspace-wide switch.
 *
 * The grace window is the entire safety of this control. This block pins what the
 * card says about a window that is already running: that a crew inside it is told
 * they are fine, and that the deadline is promised not to move. Choosing the window
 * — and being told that "Immediately" is a lockout — happens inside the dialog, so
 * it is the block after this one.
 */

/** The save this card fires. Driven per test, including its callbacks. */
const mutate = vi.fn();
/** "Email me a code" — the only thing the gate asks our API for up front. */
const requestCode = vi.fn();

/**
 * Whether the save is in flight, as a value the card can be made to re-read.
 *
 * Three separate guards on this card are spelled `setMfa.isPending` — the switch,
 * the "Require it" button, and the first half of the confirmation prompt's
 * `pending` — and a stub that can only ever answer `false` leaves all three
 * untestable rather than merely untested: each one could be deleted and nothing
 * would notice. React Query re-renders when this flips, so the stub below does too.
 */
let saving = false;
const savingWatchers = new Set<() => void>();
const subscribeSaving = (notify: () => void) => {
  savingWatchers.add(notify);
  return () => {
    savingWatchers.delete(notify);
  };
};
const readSaving = () => saving;
function setSaving(next: boolean) {
  saving = next;
  for (const notify of savingWatchers) notify();
}

/**
 * Stands in for `useSetWorkspaceMfa`. A hook rather than an object literal so
 * `isPending` can change mid-test and the card re-renders on it.
 */
function useSetWorkspaceMfaStub() {
  return {
    isPending: useSyncExternalStore(subscribeSaving, readSaving, readSaving),
    mutate,
  };
}

/**
 * #537 audit: the confirmation gate reaches for the code-request mutation, which
 * needs a QueryClient. The hook is swapped for a spy; `importOriginal` keeps the rest
 * of the module real, so nothing that decides a RULE is replaced by a copy of it.
 */
vi.mock("@/lib/api/ownership", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRequestHandoverCode: () => ({ isPending: false, mutate: requestCode }),
}));

// Same rule for the save itself. `useActionConfirmation` is deliberately NOT mocked:
// the defect #594 is about is a property of how THIS card calls it.
vi.mock("@/lib/api/mfa", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSetWorkspaceMfa: useSetWorkspaceMfaStub,
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
  // Needed because the real `@/lib/api/mfa` and `@/lib/api/ownership` are loaded for
  // everything that is not stubbed, and their fetch client reads the token from here.
  // No request is made in this suite.
  getAccessToken: async () => "token",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => "c-1",
  useActiveCompany: () => ({ companyId: "c-1", role: "owner" }),
}));

import {
  HANDOVER_CONFIRM_FIELD,
  HANDOVER_CONFIRM_REJECTED,
  HANDOVER_CONFIRM_RESEND,
  HANDOVER_CONFIRM_SUBMIT,
  HANDOVER_CONFIRM_SUBMITTING,
  type ApiErrorCode,
} from "@loonext/shared";

import { sayEnglish } from "@/i18n/provider";

import { ApiError } from "@/lib/api/error";
import { formatAbsoluteDateTime } from "@/lib/format/time";
import { toast } from "sonner";

import { RequireTwoFactorCard } from "./require-two-factor-card";

const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

/**
 * Both dialogs on this card, and the dropdown inside one of them, render through
 * portals into `document.body` rather than into the container `cleanup` removes.
 */
function tidy() {
  cleanup();
  document.body.innerHTML = "";
}

/** The card's one control. Which way it goes is decided by what it is showing. */
function flipTheSwitch() {
  fireEvent.click(
    screen.getByRole("switch", { name: "Require two-factor authentication" }),
  );
}

describe("RequireTwoFactorCard", () => {
  it("says why it matters when nothing is required yet", () => {
    const html = renderToStaticMarkup(
      <RequireTwoFactorCard required={false} graceUntil={null} />,
    );
    expect(html).toContain("Not required");
    expect(html).toContain("stolen password");
  });

  it("tells a crew inside the grace window that they keep working", () => {
    const html = renderToStaticMarkup(
      <RequireTwoFactorCard required graceUntil={future} />,
    );
    expect(html).toContain("grace period running");
    // The reassurance is the point: enforcement that starts the instant
    // somebody toggles a setting is how this becomes an outage mid-shift.
    expect(html).toContain("everyone keeps working as normal");
  });

  it("promises the deadline will not move, because an owner repeats it to their crew", () => {
    const html = renderToStaticMarkup(
      <RequireTwoFactorCard required graceUntil={future} />,
    );
    expect(html).toContain("won&#x27;t move it");
  });

  it("says plainly when it is actually in force", () => {
    const html = renderToStaticMarkup(
      <RequireTwoFactorCard required graceUntil={past} />,
    );
    expect(html).toContain("in force now");
    // And no stale promise about a deadline that has already passed.
    expect(html).not.toContain("grace period running");
  });
});

/**
 * …and the window the crew actually gets.
 *
 * The number in that dropdown decides who can still open the app tomorrow, and it is
 * only reachable through a dialog — so it needs the DOM. Two things are pinned here:
 * that the window on screen is the window that reaches the wire, and that the one
 * option which is not a window at all says what it really does.
 *
 * Nothing here asks for a code, because the server does not ask on the way ON —
 * friction belongs on the door that opens, and the refusals are the block below.
 */
describe("…and the window the crew gets to comply", () => {
  afterEach(tidy);
  beforeEach(() => {
    setSaving(false);
    mutate.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  /** Open the card with nothing required yet, and ask for it. */
  function openTheDialog() {
    mount(<RequireTwoFactorCard required={false} graceUntil={null} />);
    flipTheSwitch();
  }

  /**
   * Choose a window. Driven by keyboard — the trigger opens on ArrowDown and an
   * option takes Enter.
   */
  function pickGrace(option: string) {
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("option", { name: option }), {
      key: "Enter",
    });
  }

  it("saves the fourteen days it recommended, and repeats the deadline back", () => {
    // The default is the whole promise. If the chosen window never reaches the save,
    // the crew gets whatever the server falls back to — and the owner has already
    // told them a date.
    const deadline = new Date(Date.now() + 14 * 86_400_000).toISOString();
    mutate.mockImplementation((_input: unknown, handlers?: {
      onSuccess?: (data: unknown) => void;
    }) => {
      handlers?.onSuccess?.({ required: true, grace_until: deadline });
    });
    openTheDialog();

    fireEvent.click(screen.getByRole("button", { name: "Require it" }));

    expect(mutate.mock.calls[0][0]).toEqual({ required: true, graceDays: 14 });
    // And the date read back is the one the SERVER settled on, because that is the
    // one an owner repeats to a crew standing in front of them.
    expect(toast.success).toHaveBeenCalledWith(
      `On. Everyone has until ${formatAbsoluteDateTime(deadline)}.`,
    );
  });

  it("calls Immediately what it is, and sends the zero that means it", () => {
    mutate.mockImplementation(() => {});
    openTheDialog();

    // Nothing alarming while the recommended window stands.
    expect(screen.queryByText(/locked out of the workspace/)).toBeNull();

    pickGrace("Immediately");

    // "Immediately" reads like a speed setting. It is an outage: the person choosing
    // it can be the first one shut out of their own workspace, and this is the only
    // sentence anywhere that says so before they press the button.
    expect(
      screen.queryByText(/including you, if you have not set it up/),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Require it" }));

    // And the zero has to survive the trip. A grace window that is not the one on
    // screen is the same outage arriving on a day nobody was told about.
    expect(mutate.mock.calls[0][0]).toEqual({ required: true, graceDays: 0 });
  });

  it("lets the owner back out without setting anything", () => {
    // The deliberate pause in front of this switch is only worth having if the way out
    // of it works. This dialog is the one place the grace window is chosen, and the
    // button beside Cancel writes a workspace-wide setting whose deadline the server
    // then refuses to move — so a Cancel that only looks like one leaves somebody
    // holding exactly that, having decided against it.
    mutate.mockImplementation(() => {});
    openTheDialog();
    expect(screen.queryByRole("button", { name: "Require it" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("button", { name: "Require it" })).toBeNull();
    // And nothing was written on the way out.
    expect(mutate).not.toHaveBeenCalled();
  });
});

/**
 * #594 — and when the server asks who is doing this.
 *
 * This is the fourth surface behind `useActionConfirmation`, and the one with the
 * quietest blast radius. Turning the requirement off drops every person on the
 * workspace back to a password in one silent save, which is the first move somebody
 * makes with a session they stole — so the server refuses it without proof, and this
 * card has to be able to answer that refusal.
 *
 * Every assertion below is about WHERE the six digits go and WHAT the retry carries,
 * never about the wording. Nothing on screen tells the two prompts apart —
 * `HANDOVER_CONFIRM_WHERE.reprove` is word for word the authenticator sentence — so a
 * test pinned to the copy here would have passed throughout #581/#7's lockout.
 *
 * The rules being exercised (`handoverConfirmationKind`, `HANDOVER_CODE_DESTINATION`)
 * live in `@loonext/shared`, which is never mocked. A stub of either would be a second
 * copy of the thing under test.
 */
const FACTOR = "totp-factor-id";

/** The card as an owner sees it when the requirement is already in force. */
const card = () => <RequireTwoFactorCard required graceUntil={past} />;

/**
 * Refuse the first attempt the way the server does, then let the retry through.
 *
 * The retry is the interesting call: what it carries is the difference between a
 * requirement that comes off and a dialog that can never be satisfied.
 */
function refuseOnce(errorCode: ApiErrorCode) {
  let refused = false;
  mutate.mockImplementation((_input: unknown, handlers?: {
    onSuccess?: (data: unknown) => void;
    onError?: (error: unknown) => void;
  }) => {
    if (!refused) {
      refused = true;
      handlers?.onError?.(new ApiError(errorCode, "nope", 403));
      return;
    }
    handlers?.onSuccess?.({ required: false, grace_until: null });
  });
}

/** Refuse every attempt, however many there are. */
function refuseAlways(errorCode: ApiErrorCode) {
  mutate.mockImplementation((_input: unknown, handlers?: {
    onError?: (error: unknown) => void;
  }) => {
    handlers?.onError?.(new ApiError(errorCode, "nope", 403));
  });
}

/** Flip the switch off — the act the server will not take on a role check alone. */
function turnItOff() {
  flipTheSwitch();
}

/** Type six digits into the confirmation dialog and press Confirm. */
async function answer(digits: string) {
  fireEvent.change(screen.getByLabelText(sayEnglish(HANDOVER_CONFIRM_FIELD)), {
    target: { value: digits },
  });
  // Awaited: the `reprove` path talks to Supabase before it retries, and the
  // assertions are all about what happens after that answer comes back.
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: sayEnglish(HANDOVER_CONFIRM_SUBMIT) }),
    );
  });
}

/** The submit, once it has stopped offering to submit. */
function busySubmit(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: HANDOVER_CONFIRM_SUBMITTING,
  }) as HTMLButtonElement;
}

/** The input the save was retried with, or undefined if it never was. */
function retriedWith(): { required?: boolean; code?: string } {
  return mutate.mock.calls[1]?.[0] ?? {};
}

describe("…and when the server asks who is doing this", () => {
  afterEach(tidy);
  beforeEach(() => {
    setSaving(false);
    mutate.mockReset();
    requestCode.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    listFactors
      .mockReset()
      .mockResolvedValue({ data: { totp: [{ id: FACTOR }] }, error: null });
    challengeAndVerify.mockReset().mockResolvedValue({ data: {}, error: null });
  });

  it("gives the digits somewhere to be typed", () => {
    // The visible half. A refusal with no field anywhere on the card is not a
    // missing feature — it makes the setting impossible to turn off from the only
    // screen that offers it.
    refuseOnce("mfa_reprove_required");
    mount(card());
    turnItOff();
    expect(screen.queryByLabelText(sayEnglish(HANDOVER_CONFIRM_FIELD))).not.toBeNull();
  });

  it("spends a stale-proof code on Supabase and retries with NO code", async () => {
    // THE ASSERTION THIS BLOCK EXISTS FOR. `mfa_reprove_required` is not about a
    // code at all — the server is reading how long ago this session proved a factor
    // — so the digits are proved HERE, which refreshes the session, and the save is
    // retried carrying nothing.
    refuseOnce("mfa_reprove_required");
    mount(card());
    turnItOff();

    await answer("123456");

    // Challenged and verified against the account's own factor, in this browser.
    // That is what stamps a new proof time on the session.
    expect(challengeAndVerify).toHaveBeenCalledWith({
      factorId: FACTOR,
      code: "123456",
    });
    // Both halves matter. The retry still asks for the same thing…
    expect(retriedWith().required).toBe(false);
    // …and carries no code. `code: "123456"` here is the infinite loop: the identical
    // refusal comes back to every correct code, forever, because nothing about the
    // session changed.
    expect(retriedWith().code).toBeUndefined();
    // Nothing was emailed either — their app makes these codes.
    expect(requestCode).not.toHaveBeenCalled();
    // And what it says happened is what happened. This save lowers the whole crew's
    // protection; an owner told "now required" here would walk away believing the
    // opposite of the truth about their own workspace.
    expect(toast.success).toHaveBeenCalledWith(
      "Two-factor is no longer required.",
    );
  });

  it("does not tell somebody their correct code was wrong", async () => {
    // What the lockout looked like from the outside: the right six digits, refused,
    // every time. Asserted on the `reprove` path because that is the one where the
    // digits never reach our API at all.
    refuseOnce("mfa_reprove_required");
    mount(card());
    turnItOff();

    await answer("123456");

    expect(screen.queryByText(sayEnglish(HANDOVER_CONFIRM_REJECTED))).toBeNull();
    // And the prompt is gone rather than left standing over a save that has
    // already happened.
    expect(screen.queryByLabelText(sayEnglish(HANDOVER_CONFIRM_FIELD))).toBeNull();
  });

  it("posts an emailed code to OUR API, and asks for one on open", async () => {
    refuseOnce("confirmation_code_required");
    mount(card());
    turnItOff();

    // A dialog whose only working control is "Send it again" has wasted a trip.
    // `relax_mfa` is this card's action: a code minted for a different one is
    // refused by the same server it would be posted back to.
    expect(requestCode).toHaveBeenCalledWith("relax_mfa");

    await answer("123456");

    // Here the digits ARE ours to check, so they ride on the retry…
    expect(retriedWith().code).toBe("123456");
    // …and Supabase is left out of it entirely.
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });

  it("shuts the prompt while the digits are still with Supabase", async () => {
    // `pending` is the only thing that SAYS a submit is in flight. On the `reprove`
    // path the wait is a round trip to Supabase — a second or two of a lit button
    // doing nothing, where the obvious move is to press it again and spend a code
    // the first challenge has already burned.
    refuseOnce("mfa_reprove_required");
    let finish: (answered: { data: unknown; error: null }) => void = () => {};
    challengeAndVerify.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mount(card());
    turnItOff();

    await answer("123456");

    expect(
      screen.queryByRole("button", { name: sayEnglish(HANDOVER_CONFIRM_SUBMIT) }),
    ).toBeNull();
    expect(busySubmit().disabled).toBe(true);

    // And it lets go the moment Supabase answers. A prompt that shuts itself and
    // never reopens is the lockout again, wearing a spinner.
    await act(async () => {
      finish({ data: {}, error: null });
    });
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it("shuts it again while the save carrying the code is in flight", async () => {
    // The other half of the same prop, and the half a constant `isPending: false`
    // hid completely. On the emailed path the digits go to US, so the wait is the
    // save — and a second press posts the same code again, spending another of the
    // five attempts on the one already being checked.
    let attempt = 0;
    mutate.mockImplementation((_input: unknown, handlers?: {
      onError?: (error: unknown) => void;
    }) => {
      attempt += 1;
      if (attempt === 1) {
        handlers?.onError?.(
          new ApiError("confirmation_code_required", "nope", 403),
        );
        return;
      }
      // Away, with nothing answering it yet — which is what React Query reports.
      setSaving(true);
    });
    mount(card());
    turnItOff();

    await answer("123456");

    expect(
      screen.queryByRole("button", { name: sayEnglish(HANDOVER_CONFIRM_SUBMIT) }),
    ).toBeNull();
    expect(busySubmit().disabled).toBe(true);
    // "Send it again" goes with it. A fresh code minted over a save already carrying
    // the old one invalidates the digits in flight — the same lockout, from the
    // other end.
    expect(
      (
        screen.getByRole("button", {
          name: sayEnglish(HANDOVER_CONFIRM_RESEND),
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("says a refused code was refused, once, without minting another behind it", async () => {
    // The defect that was live for months and invisible. The gate decides "first
    // attempt, or a code that came back refused" from a value the CALL SITE can
    // capture a render too early: this card's retry re-runs `apply` from the render
    // that failed first, so the later refusal arrives back inside THAT render's
    // closure, where the dialog still looks closed. When the gate read that off
    // state, a refused code said nothing at all — and on the emailed path it quietly
    // posted a NEW code, invalidating the one the person was reading off their own
    // screen.
    //
    // The gate's own suite pins the same three outcomes, but it drives a captured
    // gate with a hand-written retry. What is only visible from here is that THIS
    // card's retry is one of those stale closures — nothing in the hook's tests says
    // this call site is wired that way, and a call site that re-read the hook between
    // attempts would pass there and be broken here.
    refuseAlways("confirmation_code_required");
    mount(card());
    turnItOff();

    expect(requestCode).toHaveBeenCalledTimes(1);

    // The second attempt, down the card's own retry — which is that same closure.
    await answer("123456");

    expect(screen.queryByLabelText(sayEnglish(HANDOVER_CONFIRM_FIELD))).not.toBeNull();
    expect(screen.getAllByText(sayEnglish(HANDOVER_CONFIRM_REJECTED))).toHaveLength(1);
    expect(requestCode).toHaveBeenCalledTimes(1);
    // And a refused code is never reported as a failed save. The prompt is still up;
    // the next move is another code, not another flip of the switch.
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("still reports a refusal no code could fix", () => {
    // Somebody who is not the owner, or a workspace mid-something-else. A code
    // prompt in front of either hides the real reason behind digits that could not
    // have helped — and the person types six of them to find that out.
    mutate.mockImplementation((_input: unknown, handlers?: {
      onError?: (error: unknown) => void;
    }) => {
      handlers?.onError?.(
        new ApiError("conflict", "Only the owner can change this.", 409),
      );
    });
    mount(card());
    turnItOff();

    expect(screen.queryByLabelText(sayEnglish(HANDOVER_CONFIRM_FIELD))).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Only the owner can change this.");
  });

  it("puts the prompt away when the retry fails for a reason no code can fix", async () => {
    // The same refusal, but arriving AFTER the prompt is already up — which is the
    // only version of it the test above cannot see. There the first attempt failed,
    // so the dialog never opened and it was null either way.
    //
    // `demanded` returns false for a code it does not recognise and leaves what it is
    // holding untouched, so nothing inside the gate closes itself here. The card's own
    // `dismiss` on the error path is the only thing that does. Without it the owner is
    // left typing correct digits into a dialog that cannot ever be satisfied, with the
    // real reason sitting in a toast behind it.
    let attempt = 0;
    mutate.mockImplementation((_input: unknown, handlers?: {
      onError?: (error: unknown) => void;
    }) => {
      attempt += 1;
      handlers?.onError?.(
        attempt === 1
          ? new ApiError("confirmation_code_required", "nope", 403)
          : new ApiError("conflict", "Only the owner can change this.", 409),
      );
    });
    mount(card());
    turnItOff();
    // The prompt really is up, so the assertion after the answer is about it closing.
    expect(screen.queryByLabelText(sayEnglish(HANDOVER_CONFIRM_FIELD))).not.toBeNull();

    await answer("123456");

    expect(screen.queryByLabelText(sayEnglish(HANDOVER_CONFIRM_FIELD))).toBeNull();
    // And the reason is said out loud rather than hidden behind digits that could not
    // have helped.
    expect(toast.error).toHaveBeenCalledWith("Only the owner can change this.");
  });

  it("lets somebody who cannot answer the prompt leave it", async () => {
    // The way out. An owner who has lost the authenticator, or who never gets the
    // email, has to be able to close this — and the only thing that closes it is the
    // card handing the gate's own `dismiss` to it. A Cancel that merely looks like one
    // traps somebody in a modal over a setting they came here to leave alone, on the
    // card whose OFF direction is the one the server guards.
    refuseAlways("confirmation_code_required");
    mount(card());
    turnItOff();
    expect(screen.queryByLabelText(sayEnglish(HANDOVER_CONFIRM_FIELD))).not.toBeNull();

    // Unambiguous: the grace prompt is the other way through this card and is closed
    // here, so this is the confirmation prompt's own Cancel.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    expect(screen.queryByLabelText(sayEnglish(HANDOVER_CONFIRM_FIELD))).toBeNull();
    // And backing out is not a save. The one call is the refused attempt that opened
    // the prompt; leaving does not quietly retry it.
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});

/**
 * …and the second press, before the first one has landed.
 *
 * Both controls on this card write the same workspace-wide row, and neither save is
 * something the owner can take back by pressing again: whichever request the server
 * finishes last is what the whole crew wakes up to. The press that causes that is not
 * a mistake anybody notices making — it is the ordinary response to a control that
 * still looks live a second after it was used.
 *
 * The block above pins both halves of the confirmation prompt's
 * `pending={setMfa.isPending || gate.requesting}`. These two are the other places the
 * same flag is read, and they are the two the person turning this on or off touches
 * first.
 */
describe("…and the second press before the first save lands", () => {
  afterEach(tidy);
  beforeEach(() => {
    setSaving(false);
    mutate.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    // The save leaves and nothing has answered it yet — which is every save, for the
    // second or two in which a second press is possible at all.
    mutate.mockImplementation(() => {
      setSaving(true);
    });
  });

  it("will not let the switch be flipped back on top of its own save", () => {
    // Turning the requirement OFF is one silent save with the widest blast radius on
    // this screen, and the flip most likely to be repeated because nothing visible
    // happens. Two of these racing drop the crew's protection or restore it purely on
    // arrival order — an owner who ends up on the wrong side of that race believes
    // the opposite of the truth about their own workspace.
    mount(<RequireTwoFactorCard required graceUntil={past} />);

    flipTheSwitch();
    expect(mutate).toHaveBeenCalledTimes(1);

    const toggle = () =>
      screen.getByRole("switch", {
        name: "Require two-factor authentication",
      }) as HTMLButtonElement;
    expect(toggle().disabled).toBe(true);

    // And it has to absorb the press, not merely look spent. `disabled` on a Radix
    // switch is a real `disabled` button, which is what stops the second
    // `onCheckedChange` reaching `apply` at all — without it this line sees two
    // workspace-wide saves in flight together.
    flipTheSwitch();
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("will not let Require it fire a second save behind the first", () => {
    // The way ON carries the grace window with it, and the deadline the server
    // settles on is fixed — this card promises in as many words that saving again
    // will not move it. So a duplicate press is not a harmless retry: it is a second
    // attempt to set the one number the owner has already repeated to their crew,
    // against a server that will refuse to change it.
    mount(<RequireTwoFactorCard required={false} graceUntil={null} />);
    flipTheSwitch();

    const requireIt = () =>
      screen.getByRole("button", { name: "Require it" }) as HTMLButtonElement;

    fireEvent.click(requireIt());
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(requireIt().disabled).toBe(true);

    // The dialog stays open until the save answers — it is closed in `onSuccess` —
    // so the button is still under the finger that just pressed it. Without the
    // guard this line sees a second `apply(true)` go out behind the first.
    fireEvent.click(requireIt());
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});

/**
 * …and the second press, after the first one landed.
 *
 * The block above is only half a guard. It holds the way-on prompt open until the
 * save answers — that is deliberate, and it is the whole reason "Require it" is still
 * under somebody's finger — but `setMfa.isPending` drops back to false the instant the
 * response arrives. So the disabled-while-pending guard hands the button back, and a
 * prompt still standing at that moment is a live "Require it" over a workspace-wide
 * setting that has ALREADY been written. The press that follows is not a race the
 * guard above can refuse: it waves it straight through, because by then nothing is in
 * flight.
 *
 * Putting the prompt away in `onSuccess` is the only thing between those two facts.
 * Every sibling call site behind this gate does the same — `ownership-card`,
 * `ownership-view`, `release-number-dialog`, `text-enable-card` and, since the fix,
 * `close-workspace-card` — and nothing compares them, so each one is only as safe as
 * its own test.
 */
describe("…and the second press after the first save landed", () => {
  afterEach(tidy);
  beforeEach(() => {
    setSaving(false);
    mutate.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    // A save that answers, the way every save eventually does.
    mutate.mockImplementation((_input: unknown, handlers?: {
      onSuccess?: (data: unknown) => void;
    }) => {
      handlers?.onSuccess?.({
        required: true,
        grace_until: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      });
    });
  });

  it("puts the way-on prompt away once the save has answered", () => {
    mount(<RequireTwoFactorCard required={false} graceUntil={null} />);
    flipTheSwitch();

    fireEvent.click(screen.getByRole("button", { name: "Require it" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);

    // Gone, not merely spent. The grace window has been set and the server will
    // refuse to move the deadline — a prompt left up here is a dialog asking for a
    // decision that has already been made, on the one screen that promises in as
    // many words that saving again changes nothing.
    expect(screen.queryByRole("button", { name: "Require it" })).toBeNull();

    // And press whatever is left, because that is what a hand does to a button that
    // still looks live. There has to be nothing left to press: the pending guard is
    // no help now, so anything still on screen sends a second workspace-wide
    // `apply(true)` — exactly the duplicate the guard above exists to stop, arriving
    // a second later through the door it does not watch.
    for (const stillThere of screen.queryAllByRole("button", {
      name: "Require it",
    })) {
      fireEvent.click(stillThere);
    }
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
