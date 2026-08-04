/**
 * @vitest-environment happy-dom
 *
 * #307 — "How this line answers".
 *
 * NI-4 is the one that decides whether this dialog is safe to open. A field
 * left alone must not be SENT: posting the resolved value back would turn an
 * inherited field into an override just by opening the dialog, and the line
 * would silently stop following the workspace without anybody choosing that.
 * Nothing about the screen would look wrong, and the owner would find out when
 * they changed the workspace greeting and one line ignored it.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { save, greetingRows, toastSuccess, toastError, identity } = vi.hoisted(
  () => ({
    save: vi.fn(),
    greetingRows: { current: [] as { id: string; name: string }[] },
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    identity: {
      current: {
        label: { value: "Reed Roofing", inherited: true },
        voicemail_greeting: {
          value: "You have reached Reed Roofing.",
          inherited: true,
        },
        away_message: { value: "We are closed.", inherited: true },
        mctb_enabled: { value: true, inherited: true },
        mctb_message: { value: "Sorry we missed you.", inherited: true },
        voicemail_greeting_id: { value: null, inherited: true },
        after_hours_calls: { value: "ring_everyone", inherited: true },
        after_hours_greeting_id: { value: null, inherited: true },
        ring_strategy: { value: "all", inherited: true },
        ring_seconds: { value: 45, inherited: true },
      } as Record<
        string,
        // #278 widened this: ring_seconds is a NUMBER, and pinning the union
        // to the three types that happened to exist made the fixture reject
        // the next field rather than describe it.
        { value: string | number | boolean | null; inherited: boolean }
      >,
    },
  }),
);

vi.mock("@/lib/api/numbers", () => ({
  useNumberIdentity: () => ({ isPending: false, data: identity.current }),
  useSetNumberIdentity: () => ({ isPending: false, mutateAsync: save }),
}));
// #309: the dialog puts NAMES on the ids the identity carries. An empty
// list is every workspace until somebody records something, and it hides
// the picker — which is what these tests are about.
vi.mock("@/lib/api/voicemail-greetings", () => ({
  useVoicemailGreetings: () => ({ data: { data: greetingRows.current } }),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { NumberIdentityDialog, patchFrom } from "./number-identity-dialog";
import { ApiError } from "@/lib/api/error";

afterEach(cleanup);

beforeEach(() => {
  save.mockReset();
  save.mockResolvedValue(identity.current);
  toastSuccess.mockReset();
  toastError.mockReset();
  identity.current = {
    label: { value: "Reed Roofing", inherited: true },
    voicemail_greeting: {
      value: "You have reached Reed Roofing.",
      inherited: true,
    },
    away_message: { value: "We are closed.", inherited: true },
    mctb_enabled: { value: true, inherited: true },
    mctb_message: { value: "Sorry we missed you.", inherited: true },
    voicemail_greeting_id: { value: null, inherited: true },
    after_hours_calls: { value: "ring_everyone", inherited: true },
    after_hours_greeting_id: { value: null, inherited: true },
    ring_strategy: { value: "all", inherited: true },
    ring_seconds: { value: 45, inherited: true },
  };
});

function open() {
  render(<NumberIdentityDialog numberId="n1" open onOpenChange={() => {}} />);
}

describe("#307 how this line answers", () => {
  it("NI-1: every box starts at what a caller actually gets", () => {
    // Never blank. An empty field cannot tell an owner what the line does
    // today, and showing that before it changes is this screen's whole job.
    open();
    expect(
      (screen.getByLabelText("Name for this line") as HTMLInputElement).value,
    ).toBe("Reed Roofing");
    expect(
      (screen.getByLabelText("Voicemail greeting") as HTMLTextAreaElement)
        .value,
    ).toBe("You have reached Reed Roofing.");
  });

  it("NI-2: an inherited field says so", () => {
    // The distinction the whole model exists to make visible.
    //
    // Counted as "at least one, and nothing offering the way back", not as an
    // exact total. A pinned number is a ceiling on how many fields this dialog
    // may ever hold, so the next correctly-inherited field added fails the
    // guard that exists to demand it — which is a test that has stopped
    // catching drift and started blocking the work. #278 added two and this
    // is what it cost to notice.
    open();
    expect(
      screen.getAllByText("Same as your workspace").length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Use the workspace's" }),
    ).toBeNull();
  });

  it("NI-3: an overridden field offers the way back, worded as the outcome", () => {
    // "Clear" implies empty, and empty is the one thing this cannot mean — a
    // cleared greeting restores the workspace's rather than silencing the line.
    identity.current = {
      ...identity.current,
      voicemail_greeting: { value: "Sales line.", inherited: false },
    };
    open();

    // Exactly ONE field was overridden, so exactly one way back is offered —
    // which is the actual rule, and unlike a total it stays true as the dialog
    // grows.
    expect(
      screen.getAllByRole("button", { name: "Use the workspace's" }),
    ).toHaveLength(1);
    expect(
      screen.getAllByText("Same as your workspace").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^clear$/i })).toBeNull();
  });

  it("NI-4: a field left alone is never sent", () => {
    // THE ONE THAT MATTERS. Sending the resolved value back would turn an
    // inherited field into an override just by opening the dialog — the line
    // stops following the workspace and nothing looks wrong until somebody
    // edits the workspace greeting and one line ignores it.
    expect(
      patchFrom(identity.current as never, {
        label: "Reed Roofing",
        voicemail_greeting: "You have reached Reed Roofing.",
        away_message: "We are closed.",
        mctb_message: "Sorry we missed you.",
        mctb_enabled: true,
      }),
    ).toEqual({});

    // And a field that DID change is sent, alone.
    expect(
      patchFrom(identity.current as never, {
        label: "Reed Roofing Sales",
        voicemail_greeting: "You have reached Reed Roofing.",
        away_message: "We are closed.",
        mctb_message: "Sorry we missed you.",
        mctb_enabled: true,
      }),
    ).toEqual({ label: "Reed Roofing Sales" });
  });

  it("NI-5: saving sends only the edited field", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Name for this line"), {
      target: { value: "Reed Roofing Sales" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({ label: "Reed Roofing Sales" });
  });

  it("NI-6: 'use the workspace's' sends null for that field only", async () => {
    // Null is the clear, and it is per field — restoring the greeting must
    // not disturb a name the owner set separately.
    identity.current = {
      label: { value: "Reed Roofing Sales", inherited: false },
      voicemail_greeting: { value: "Sales line.", inherited: false },
      away_message: { value: "We are closed.", inherited: true },
      mctb_enabled: { value: true, inherited: true },
      mctb_message: { value: "Sorry we missed you.", inherited: true },
      voicemail_greeting_id: { value: null, inherited: true },
      after_hours_calls: { value: "ring_everyone", inherited: true },
      after_hours_greeting_id: { value: null, inherited: true },
      ring_strategy: { value: "all", inherited: true },
      ring_seconds: { value: 45, inherited: true },
    };
    open();

    const backButtons = screen.getAllByRole("button", {
      name: "Use the workspace's",
    });
    fireEvent.click(backButtons[1]);

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({ voicemail_greeting: null });
  });

  it("NI-7: says the change is live, because a caller hears it immediately", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Name for this line"), {
      target: { value: "Reed Roofing Sales" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(toastSuccess.mock.calls[0][0]).toMatch(/straight away/i);
  });

  it("NI-9: the switch starts at what a missed caller gets today", () => {
    // Never off by default. A switch showing "off" for a line that does text
    // back would be the same lie as an empty greeting box, and this one is
    // worse: an owner would flip it ON, changing nothing, and the number would
    // silently stop following the workspace from then on.
    open();
    expect(
      (
        screen.getByLabelText("Text back a missed caller") as HTMLInputElement
      ).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("NI-10: an untouched switch is never sent", () => {
    // Same rule as the boxes, and the same failure if it is broken: opening
    // the dialog would turn an inherited toggle into an override, and the line
    // would stop following the workspace with nothing looking wrong.
    expect(
      patchFrom(identity.current as never, {
        label: "Reed Roofing",
        voicemail_greeting: "You have reached Reed Roofing.",
        away_message: "We are closed.",
        mctb_message: "Sorry we missed you.",
        mctb_enabled: true,
      }),
    ).toEqual({});

    // Switching it OFF is a real change, and false must survive the send —
    // this is the value an owner sets on purpose for a tracked number.
    expect(
      patchFrom(identity.current as never, {
        label: "Reed Roofing",
        voicemail_greeting: "You have reached Reed Roofing.",
        away_message: "We are closed.",
        mctb_message: "Sorry we missed you.",
        mctb_enabled: false,
      }),
    ).toEqual({ mctb_enabled: false });
  });

  it("NI-11: an overridden switch offers the way back", () => {
    identity.current = {
      ...identity.current,
      mctb_enabled: { value: false, inherited: false },
    };
    open();
    expect(
      screen.getAllByRole("button", { name: "Use the workspace's" }).length,
    ).toBeGreaterThan(0);
  });

  it("NI-12: no recordings means no picker at all", () => {
    // #309. A select whose only option is "the written greeting" is a control
    // that cannot do anything, in a dialog that already has five. Every
    // workspace is in this state until somebody records something.
    open();
    expect(screen.queryByLabelText("Voicemail voice")).toBeNull();
  });

  it("NI-13: the picker appears once there is something to pick, and offers the way out", () => {
    greetingRows.current = [{ id: "g1", name: "After hours" }];
    open();
    expect(screen.getByLabelText("Voicemail voice")).toBeTruthy();
    // The written words are always an option, because they are the one thing
    // guaranteed to exist and the fallback the runtime uses anyway.
    expect(screen.getByText("The written greeting, read aloud")).toBeTruthy();
  });

  it("NI-8: shows the server's reason when it refuses", async () => {
    save.mockRejectedValue(
      new ApiError("validation_failed", "That greeting is too long.", 422),
    );
    open();
    fireEvent.change(screen.getByLabelText("Voicemail greeting"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0][0]).toContain("too long");
  });
});
