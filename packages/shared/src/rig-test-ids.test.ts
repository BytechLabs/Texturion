import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Pins what `scripts/check-rig-test-ids.mjs` reads as an id on each platform,
 * and that the registry and the source cannot disagree in either direction.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type Found = { ids: { id: string; constant?: string }[]; problems: string[] };
type Platform = { platform: string; kind: string; sources: string[]; ids: Record<string, string>[] };
type File = { file: string; text: string };
const guard = (await import(join(REPO, "scripts", "check-rig-test-ids.mjs"))) as {
  REGISTRY_FILE: string;
  KINDS: Record<string, { extract: (text: string) => Found }>;
  judgePlatform: (platform: Platform, files: File[]) => { problems: string[]; declared: number; registered: number };
};

const TAGS_FILE = "apps/android/app/src/main/kotlin/com/loonext/android/features/calls/CallTestTags.kt";
const tags: File = { file: TAGS_FILE, text: readFileSync(join(REPO, TAGS_FILE), "utf8") };
const registry = JSON.parse(readFileSync(join(REPO, guard.REGISTRY_FILE), "utf8")) as { platforms: Platform[] };
const android = () => structuredClone(registry.platforms.find((p) => p.platform === "android") as Platform);
const problems = (platform: Platform, files: File[]) => guard.judgePlatform(platform, files).problems.join("\n");

describe("what counts as an id", () => {
  it("reads a Kotlin const val and its constant, and passes over the tag list", () => {
    const found = guard.KINDS["compose-test-tag"].extract(
      `object T {\n  // const val OLD = "call_old"\n  const val A = "call_a"\n  val ALL: List<String> = listOf(A)\n  const val B = PREFIX + "b"\n}`,
    );
    expect(found.ids).toEqual([{ id: "call_a", constant: "A" }]);
    expect(found.problems.join("\n")).toMatch(/B is not a plain string literal/);
    expect(found.problems).toHaveLength(1);
  });

  it("fails a tag written any way but `const val NAME = \"...\"`, which CallTestTagsTest would not see", () => {
    for (const line of ['const val SPEAKER: String = "call_speaker"', 'val SPEAKER = "call_speaker"', 'val SPEAKER: String = "call_speaker"']) {
      const found = guard.KINDS["compose-test-tag"].extract(`object T {\n  ${line}\n}`);
      expect(found.ids).toEqual([]);
      expect(found.problems.join("\n")).toMatch(/SPEAKER is not written `const val SPEAKER = "\.\.\."`/);
    }
    const lazy = guard.KINDS["compose-test-tag"].extract(`object T {\n  val SPEAKER by lazy { "call_speaker" }\n}`);
    expect(lazy.problems.join("\n")).toMatch(/SPEAKER is a val this check cannot read/);
  });

  it("reads a literal data-testid in any quoting, and refuses a computed one", () => {
    const found = guard.KINDS["data-testid"].extract(
      `<a data-testid="one" /><b data-testid='two' /><c data-testid={"three"} /><d data-testid={\`x-\${id}\`} />`,
    );
    expect(found.ids.map((entry) => entry.id)).toEqual(["one", "two", "three"]);
    expect(found.problems.join("\n")).toMatch(/is computed/);
  });

  it("reads a literal accessibilityIdentifier, and refuses a computed one", () => {
    const found = guard.KINDS["accessibility-identifier"].extract(
      `Button("A").accessibilityIdentifier("call_answer")\nText(x).accessibilityIdentifier(id)`,
    );
    expect(found.ids).toEqual([{ id: "call_answer" }]);
    expect(found.problems.join("\n")).toMatch(/is computed/);
  });
});

describe("the Android contract", () => {
  it("registers every CallTestTags value, and nothing else", () => {
    const result = guard.judgePlatform(android(), [tags]);
    expect(result.problems).toEqual([]);
    expect(result.declared).toBeGreaterThan(0);
    expect(result.registered).toBe(result.declared);
  });

  it("fails a tag added to CallTestTags that the registry does not list", () => {
    const added = { file: TAGS_FILE, text: tags.text.replace("object CallTestTags {", 'object CallTestTags {\n    const val SPEAKER = "call_speaker"') };
    expect(problems(android(), [added])).toMatch(/declares "call_speaker" \(SPEAKER\) and tools\/rig\/test-ids\.json does not list it/);
  });

  it("fails a tag added to CallTestTags with a type annotation, rather than missing it", () => {
    const typed = {
      file: TAGS_FILE,
      text: tags.text.replace("object CallTestTags {", 'object CallTestTags {\n    const val SPEAKER: String = "call_speaker"'),
    };
    expect(problems(android(), [typed])).toMatch(/SPEAKER is not written `const val SPEAKER = "\.\.\."`/);
  });

  it("fails a renamed tag value, from both sides", () => {
    const renamed = { file: TAGS_FILE, text: tags.text.replace('"call_answer"', '"call_pick_up"') };
    const found = problems(android(), [renamed]);
    expect(found).toMatch(/no android source declares "call_answer"/);
    expect(found).toMatch(/declares "call_pick_up" \(ANSWER\)/);
  });

  it("fails an id registered under the wrong constant", () => {
    const platform = android();
    const entry = platform.ids.find((item) => item.id === "call_answer");
    if (entry) entry.constant = "PICK_UP";
    expect(problems(platform, [tags])).toMatch(/"call_answer" is ANSWER in .*CallTestTags\.kt, not PICK_UP/);
  });

  it("fails sources that match no files, since the scan is blind", () => {
    expect(problems(android(), [])).toMatch(/its sources match no files/);
  });
});

it("registers each web and iOS call-surface id, and fails the first unregistered one", () => {
  const web = structuredClone(registry.platforms.find((p) => p.platform === "web") as Platform);
  const surface = { file: "apps/web/src/components/calls/ring.tsx", text: `<button data-testid="call_answer" />` };
  expect(problems(web, [surface])).toMatch(/declares "call_answer" and tools\/rig\/test-ids\.json does not list it/);
});
