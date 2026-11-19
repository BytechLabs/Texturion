import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import vector from "../vectors/mms-photo.json";
import { MMS_PHOTO_LONG_EDGE, MMS_PHOTO_QUALITIES, MMS_PHOTO_RESIZE_ROUNDS } from "./mms";

const ROOT = join(import.meta.dirname, "..", "..", "..");

it("keeps the native resize ladders aligned with the shared limits", () => {
  const kotlin = readFileSync(join(ROOT, "apps/android/app/src/main/kotlin/com/loonext/android/features/compose/Media.kt"), "utf8");
  const swift = readFileSync(join(ROOT, "apps/ios/Loonext/Features/Compose/Media.swift"), "utf8");
  expect(MMS_PHOTO_LONG_EDGE).toBe(vector.longEdge);
  expect(MMS_PHOTO_RESIZE_ROUNDS).toBe(vector.rounds);
  expect(MMS_PHOTO_QUALITIES.map((quality) => Math.round(quality * 100))).toEqual(vector.qualities);

  expect(kotlin).toContain(`PHOTO_LONG_EDGE = ${vector.longEdge}`);
  expect(kotlin).toContain(`PHOTO_RESIZE_ROUNDS = ${vector.rounds}`);
  expect(kotlin).toContain(`PHOTO_QUALITIES = intArrayOf(${vector.qualities.join(", ")})`);
  expect(swift).toContain(`photoLongEdge: CGFloat = ${vector.longEdge}`);
  expect(swift).toContain(`photoResizeRounds = ${vector.rounds}`);
  expect(swift).toContain(`photoQualities: [CGFloat] = [${vector.qualities.map((quality) => (quality / 100).toFixed(2)).join(", ")}]`);
});
