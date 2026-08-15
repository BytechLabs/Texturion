import { describe, expect, it } from "vitest";

import {
  WORK_PHASES,
  WORK_PHASE_LABELS,
  WORK_PHASE_UNSET_LABEL,
  groupJobPhotos,
  isWorkPhase,
  jobPhaseSummary,
  type JobPhotoLike,
} from "./work-phase";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/** #228 — the module names keys now, so the copy assertions resolve them. */
function look(table: unknown, key: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[
    name
  ];
  if (typeof value !== "string") throw new Error(`no entry for ${key}`);
  return value;
}

function photo(over: Partial<JobPhotoLike> & { id: string }): JobPhotoLike {
  return { created_at: "2026-08-08T10:00:00Z", ...over };
}

describe("the two labels (#294)", () => {
  it("is before and after, and nothing else", () => {
    // The one classification the trade uses. "During" is a category somebody
    // invented in a meeting; a tech takes a handful when they arrive and a handful
    // when they finish.
    // The ids, which are wire values a photo carries and did not move.
    expect([...WORK_PHASES]).toEqual(["before", "after"]);
    // The words, where the words live since #228.
    expect(look(WEB_EN, WORK_PHASE_LABELS.before)).toBe("Before");
    expect(look(WEB_EN, WORK_PHASE_LABELS.after)).toBe("After");
    expect(look(WEB_FR, WORK_PHASE_LABELS.before)).toBe("Avant");
    expect(look(WEB_FR, WORK_PHASE_LABELS.after)).toBe("Après");
  });

  it("#228: does not offer 'None' for the third choice, in either language", () => {
    // The unset label is named rather than "None" on purpose: most notes are
    // neither a before nor an after, and "None" invites a tech to think they
    // have failed to fill something in. "Aucun" is the French version of that
    // same mistake.
    expect(look(WEB_EN, WORK_PHASE_UNSET_LABEL).toLowerCase()).not.toBe("none");
    const fr = look(WEB_FR, WORK_PHASE_UNSET_LABEL).toLowerCase();
    expect(fr).not.toBe("aucun");
    expect(fr).not.toBe("aucune");
    // It says what it IS instead — neither one nor the other.
    expect(fr).toContain("avant");
    expect(fr).toContain("après");
  });

  it("refuses anything that is not one of them", () => {
    expect(isWorkPhase("before")).toBe(true);
    expect(isWorkPhase("after")).toBe(true);
    for (const bad of ["during", "BEFORE", "", null, undefined, 1, {}]) {
      expect(isWorkPhase(bad), String(bad)).toBe(false);
    }
  });
});

describe("grouping a job's photos into visits (#294)", () => {
  it("puts each note's files together", () => {
    const groups = groupJobPhotos([
      photo({ id: "a", note_id: "n1", created_at: "2026-08-08T09:00:00Z" }),
      photo({ id: "b", note_id: "n2", created_at: "2026-08-08T15:00:00Z" }),
      photo({ id: "c", note_id: "n1", created_at: "2026-08-08T09:00:05Z" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "c"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["b"]);
  });

  it("keeps two notes written in the same second apart", () => {
    // THE CASE THAT MATTERS for keying on the note rather than on the time: two
    // visits' worth of photos merged into one is a job record that says something
    // untrue about the day.
    const same = "2026-08-08T09:00:00Z";
    const groups = groupJobPhotos([
      photo({ id: "a", note_id: "n1", created_at: same }),
      photo({ id: "b", note_id: "n2", created_at: same }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("collects everything the customer texted into one group", () => {
    // It did not arrive in visits, and splitting it into per-file groups would
    // invent structure that is not there.
    const groups = groupJobPhotos([
      photo({ id: "a", note_id: null, created_at: "2026-08-08T08:00:00Z" }),
      photo({ id: "b", note_id: null, created_at: "2026-08-08T08:00:01Z" }),
      photo({ id: "c", note_id: "n1", created_at: "2026-08-08T09:00:00Z" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].note_id).toBeNull();
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("orders visits by when they started, not by when the last file landed", () => {
    // A slow second upload must not move a visit later in the day than it
    // happened. The group's time is its EARLIEST file.
    const groups = groupJobPhotos([
      photo({ id: "late-of-early", note_id: "n1", created_at: "2026-08-08T18:00:00Z" }),
      photo({ id: "early-of-early", note_id: "n1", created_at: "2026-08-08T08:00:00Z" }),
      photo({ id: "midday", note_id: "n2", created_at: "2026-08-08T12:00:00Z" }),
    ]);
    expect(groups.map((g) => g.note_id)).toEqual(["n1", "n2"]);
    expect(groups[0].at).toBe("2026-08-08T08:00:00Z");
  });

  it("carries the label and the author from the note", () => {
    const groups = groupJobPhotos([
      photo({
        id: "a",
        note_id: "n1",
        work_phase: "after",
        added_by_user_id: "u1",
      }),
    ]);
    expect(groups[0].work_phase).toBe("after");
    expect(groups[0].added_by_user_id).toBe("u1");
  });

  it("is stable, so nothing shuffles between two renders", () => {
    const items = [
      photo({ id: "a", note_id: "n1", created_at: "2026-08-08T09:00:00Z" }),
      photo({ id: "b", note_id: "n2", created_at: "2026-08-08T09:00:00Z" }),
      photo({ id: "c", note_id: "n1", created_at: "2026-08-08T09:00:00Z" }),
    ];
    const once = groupJobPhotos(items).map((g) => g.note_id);
    const twice = groupJobPhotos([...items].reverse()).map((g) => g.note_id);
    expect(once).toEqual(twice);
  });

  it("returns nothing for nothing", () => {
    expect(groupJobPhotos([])).toEqual([]);
  });
});

describe("the one-line summary (#294)", () => {
  it("counts each label", () => {
    expect(
      jobPhaseSummary([
        photo({ id: "a", work_phase: "before" }),
        photo({ id: "b", work_phase: "before" }),
        photo({ id: "c", work_phase: "after" }),
      ]),
    ).toBe("2 before, 1 after");
  });

  it("names only the label that is there", () => {
    expect(jobPhaseSummary([photo({ id: "a", work_phase: "before" })])).toBe(
      "1 before",
    );
  });

  it("says nothing at all when nothing is labelled", () => {
    // Not "0 before, 0 after", which reads as a broken count rather than as a job
    // whose photos nobody classified — and most jobs will be that.
    expect(jobPhaseSummary([photo({ id: "a" }), photo({ id: "b" })])).toBeNull();
    expect(jobPhaseSummary([])).toBeNull();
  });
});
