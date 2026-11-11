/**
 * @vitest-environment happy-dom
 *
 * #749: a setting that can lose a customer says who chose its value, and when,
 * once it is off the default.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SettingChoice } from "@/lib/api/companies";

const { choices, role, enabledSeen } = vi.hoisted(() => ({
  choices: { current: [] as SettingChoice[] },
  role: { current: "owner" },
  enabledSeen: { current: [] as boolean[] },
}));

vi.mock("@/lib/api/companies", () => ({
  useSettingChoices: (enabled: boolean) => {
    enabledSeen.current.push(enabled);
    return { data: enabled ? { data: choices.current } : undefined };
  },
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: role.current }),
}));

import { SettingChoiceNote } from "./setting-choice-note";

afterEach(cleanup);
beforeEach(() => {
  choices.current = [];
  role.current = "owner";
  enabledSeen.current = [];
});

describe("#749 SettingChoiceNote", () => {
  it("names who moved the setting off its default, when, and what the default is", () => {
    choices.current = [
      {
        key: "after_hours_calls",
        value: "voicemail",
        default_value: "ring_everyone",
        chosen_by: "Dana Whitcomb",
        chosen_at: "2026-08-08T18:00:00.000Z",
      },
    ];
    render(<SettingChoiceNote settingKey="after_hours_calls" defaultLabel="Ring everyone" />);
    expect(
      screen.getByText("Dana Whitcomb chose this on Aug 8, 2026. The default is Ring everyone."),
    ).toBeTruthy();
  });

  it("still says it is not the default when no change on record names anyone", () => {
    choices.current = [
      { key: "away_enabled", value: true, default_value: false, chosen_by: null, chosen_at: null },
    ];
    render(<SettingChoiceNote settingKey="away_enabled" defaultLabel="off" />);
    expect(screen.getByText("Changed from the default, which is off.")).toBeTruthy();
  });

  it("is silent for a setting at its default", () => {
    choices.current = [
      {
        key: "after_hours_calls",
        value: "voicemail",
        default_value: "ring_everyone",
        chosen_by: "Dana Whitcomb",
        chosen_at: "2026-08-08T18:00:00.000Z",
      },
    ];
    const { container } = render(
      <SettingChoiceNote settingKey="ring_strategy" defaultLabel="All at once" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("never asks on behalf of someone who cannot change settings", () => {
    role.current = "member";
    const { container } = render(
      <SettingChoiceNote settingKey="after_hours_calls" defaultLabel="Ring everyone" />,
    );
    expect(enabledSeen.current.every((enabled) => !enabled)).toBe(true);
    expect(container.innerHTML).toBe("");
  });
});
