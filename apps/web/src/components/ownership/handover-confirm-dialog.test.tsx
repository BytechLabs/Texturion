/**
 * @vitest-environment happy-dom
 *
 * #537/#581/#7 — the one dialog every confirmable act collects its six digits in.
 *
 * It had no test at all, on any of the three clients, which is how it kept a comment
 * saying it cleared refused digits while it only ever cleared them on a change of KIND —
 * a thing that cannot happen inside one prompt. Six web surfaces mount this component,
 * so what it does with a refusal is what all six do.
 *
 * These are about the MECHANICS of the field, not the copy: the wording lives in
 * `packages/shared` and is asserted there, against all three clients at once.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HANDOVER_CONFIRM_FIELD,
  HANDOVER_CONFIRM_REJECTED,
  HANDOVER_CONFIRM_RESEND,
} from "@loonext/shared";

import { HandoverConfirmDialog } from "./handover-confirm-dialog";

afterEach(cleanup);

function open(
  overrides: Partial<React.ComponentProps<typeof HandoverConfirmDialog>> = {},
) {
  const props = {
    kind: "reprove" as const,
    pending: false,
    rejected: false,
    onConfirm: vi.fn(),
    onResend: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  const view = render(<HandoverConfirmDialog {...props} />);
  return { ...props, rerender: view.rerender };
}

const field = () => screen.getByLabelText(HANDOVER_CONFIRM_FIELD) as HTMLInputElement;
/** Radix renders the real attribute, and this project has no jest-dom matchers. */
const confirmButton = () =>
  screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement;

describe("answering the demand", () => {
  it("keeps Confirm quiet until there is something worth sending", () => {
    open();
    expect(confirmButton().disabled).toBe(true);
    fireEvent.change(field(), { target: { value: "12345" } });
    expect(confirmButton().disabled).toBe(true);
    fireEvent.change(field(), { target: { value: "123456" } });
    expect(confirmButton().disabled).toBe(false);
  });

  it("accepts a code pasted with the whitespace an email carries", () => {
    // Nobody should have to tidy up a copy-paste to confirm a handover, and the
    // whitespace is stripped before the digits go anywhere — on every path, which was
    // not true when only one branch of the hook trimmed.
    const { onConfirm } = open();
    fireEvent.change(field(), { target: { value: "  123456 " } });
    expect(confirmButton().disabled).toBe(false);
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith("  123456 ");
  });

  it("submits on Enter, and not while a submit is already in flight", () => {
    const { onConfirm, rerender } = open();
    fireEvent.change(field(), { target: { value: "123456" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);

    rerender(
      <HandoverConfirmDialog
        kind="reprove"
        pending
        rejected={false}
        onConfirm={onConfirm}
        onResend={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("when the code came back refused", () => {
  it("says so, and empties the field so the next code is a new one", () => {
    /**
     * THE CASE THE OLD COMMENT CLAIMED AND THE OLD CODE MISSED.
     *
     * Clearing was keyed on the KIND, and a refusal does not change the kind — so the
     * rejected digits stayed in the box with Confirm still lit. An authenticator code
     * has rotated by then, so pressing it again could only fail; on the emailed path it
     * also spent another of the five attempts saying so.
     */
    const { onConfirm, onResend, onCancel, rerender } = open();
    fireEvent.change(field(), { target: { value: "111111" } });
    expect(field().value).toBe("111111");

    rerender(
      <HandoverConfirmDialog
        kind="reprove"
        pending={false}
        rejected
        onConfirm={onConfirm}
        onResend={onResend}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText(HANDOVER_CONFIRM_REJECTED)).toBeTruthy();
    expect(field().value).toBe("");
    expect(confirmButton().disabled).toBe(true);
  });
});

describe("what can be resent", () => {
  it("offers to send another one only for the code we emailed", () => {
    // There is nothing to resend to somebody whose app generates the codes, and the
    // button would imply we could send them one. Same for the stale-factor demand,
    // which reads identically on screen and is answered the same way.
    open({ kind: "email" });
    expect(screen.getByRole("button", { name: HANDOVER_CONFIRM_RESEND })).toBeTruthy();
    cleanup();

    for (const kind of ["authenticator", "reprove"] as const) {
      open({ kind });
      expect(
        screen.queryByRole("button", { name: HANDOVER_CONFIRM_RESEND }),
        kind,
      ).toBeNull();
      cleanup();
    }
  });
});
