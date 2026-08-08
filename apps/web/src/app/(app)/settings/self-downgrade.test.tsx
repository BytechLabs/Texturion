/**
 * @vitest-environment happy-dom
 */
/**
 * #538 — giving up your own access, on web.
 *
 * Two seams, deliberately. WHEN the product interrupts somebody is a decision, so
 * it is tested as one rather than by driving a Radix dropdown through a headless
 * DOM — a test that could only reach it through portal pointer events would be a
 * test about Radix. WHAT the interruption says is a component, so it is rendered.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GiveUpAccessDialog,
  roleChangeNeedsConfirming,
} from "@/components/settings/give-up-access-dialog";

afterEach(cleanup);

describe("when a role change stops to ask (#538)", () => {
  it("asks when I take powers off myself", () => {
    // The trap: choosing "member" for your own row loses the ability to change
    // roles, which is the ability that would let you change it back.
    expect(roleChangeNeedsConfirming(true, "admin", "member")).toBe(true);
  });

  it("says nothing when I promote myself", () => {
    expect(roleChangeNeedsConfirming(true, "member", "admin")).toBe(false);
  });

  it("says nothing when I change somebody ELSE, either way", () => {
    // They can be restored by whoever demoted them, and a confirmation that
    // fires on everything is one people learn to dismiss.
    expect(roleChangeNeedsConfirming(false, "admin", "member")).toBe(false);
    expect(roleChangeNeedsConfirming(false, "member", "admin")).toBe(false);
  });

  it("says nothing when the role does not change", () => {
    expect(roleChangeNeedsConfirming(true, "admin", "admin")).toBe(false);
  });
});

describe("GiveUpAccessDialog (#538)", () => {
  function open(to: "admin" | "member" | null) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <GiveUpAccessDialog
        from="admin"
        to={to}
        pending={false}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    return { onConfirm, onCancel };
  }

  it("is closed until something is being given up", () => {
    open(null);
    expect(screen.queryByText(/Give up your own access/)).toBeNull();
  });

  it("names what is lost and who can undo it", () => {
    // "Are you sure?" is the version of this dialog that teaches people to click
    // through. The sentence has to carry the consequence.
    open("member");
    expect(screen.getByText(/You'll lose access to/)).toBeTruthy();
    expect(screen.getByText(/change it back/)).toBeTruthy();
    expect(screen.getByText(/only an owner can/)).toBeTruthy();
  });

  it("says things in what they DO, not in permission names", () => {
    open("member");
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("team.manage");
    expect(body).not.toContain("billing.manage");
  });

  it("names the outcome on the confirm button rather than saying OK", () => {
    // Somebody skimming the buttons still reads the decision.
    open("member");
    expect(screen.getByRole("button", { name: "Make me a member" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep my access" })).toBeTruthy();
  });

  it("confirms and cancels through the right handlers", () => {
    const { onConfirm, onCancel } = open("member");
    fireEvent.click(screen.getByRole("button", { name: "Make me a member" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();

    cleanup();
    const second = open("member");
    fireEvent.click(screen.getByRole("button", { name: "Keep my access" }));
    expect(second.onCancel).toHaveBeenCalledOnce();
    expect(second.onConfirm).not.toHaveBeenCalled();
  });
});
