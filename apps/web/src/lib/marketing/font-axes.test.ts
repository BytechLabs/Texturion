import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { brotliDecompressSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { sourceFiles, sourceText } from "@/test/source-tree";

/**
 * The marketing woff2 files keep only the variation-axis values the CSS
 * renders (scripts/instance-marketing-fonts.mjs, #640): Bricolage Grotesque
 * varies on opsz only, at wght 800 and wdth 100, and Hanken Grotesk and Spline
 * Sans Mono start at wght 400. A rule that asks for any other value draws the
 * nearest one the file kept, which is a different typeface from the source's,
 * and nothing reports it. These fail first, so the script runs again with a
 * wider range.
 */

const SRC = join(process.cwd(), "src");
const FONTS = join(SRC, "app", "fonts");
const FONT_SOURCES = join(process.cwd(), "scripts", "fonts-src", "marketing");

const files = sourceFiles(SRC, [".ts", ".tsx", ".css"]).filter(
  (file) => !/\.test\.tsx?$/.test(file) && !file.endsWith(join("marketing", "fonts.ts")),
);

/** The marketing faces render only under these trees. CSS is filtered by rule instead. */
const MARKETING_DIRS = [
  ["app", "(marketing)"],
  ["app", "(marketing-fr)"],
  ["components", "marketing"],
  ["lib", "marketing"],
].map((parts) => join(SRC, ...parts) + sep);
const marketingFiles = files.filter(
  (file) => file.endsWith(".css") || MARKETING_DIRS.some((dir) => file.startsWith(dir)),
);

interface Axis {
  tag: string;
  min: number;
  max: number;
}

/** The 63 table tags a woff2 table directory can name by index, in the WOFF2 spec's order. */
// prettier-ignore
const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm",
  "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern",
  "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC",
  "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
  "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty",
  "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
  "Gloc", "Feat", "Sill",
];

/** The variation axes in a woff2 file's fvar table, or none for a static face. */
function woff2Axes(file: string): Axis[] {
  const bytes = readFileSync(file);
  expect(bytes.toString("latin1", 0, 4), file).toBe("wOF2");
  const numTables = bytes.readUInt16BE(12);
  const compressedSize = bytes.readUInt32BE(20);
  let at = 48;
  const base128 = () => {
    let value = 0;
    for (;;) {
      const byte = bytes[at++]!;
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
  };
  const tables: { tag: string; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = bytes[at++]!;
    let tag = KNOWN_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 0x3f) {
      tag = bytes.toString("latin1", at, at + 4);
      at += 4;
    }
    const version = flags >> 6;
    const origLength = base128();
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    tables.push({ tag: tag!, length: transformed ? base128() : origLength });
  }
  const data = brotliDecompressSync(bytes.subarray(at, at + compressedSize));
  let offset = 0;
  for (const table of tables) {
    if (table.tag === "fvar") {
      const fvar = data.subarray(offset, offset + table.length);
      const axesOffset = fvar.readUInt16BE(4);
      const axisCount = fvar.readUInt16BE(8);
      const axisSize = fvar.readUInt16BE(10);
      return Array.from({ length: axisCount }, (_, n) => {
        const record = axesOffset + n * axisSize;
        return {
          tag: fvar.toString("latin1", record, record + 4),
          min: fvar.readInt32BE(record + 4) / 65536,
          max: fvar.readInt32BE(record + 12) / 65536,
        };
      });
    }
    offset += table.length;
  }
  return [];
}

/** A weight below 400, a width, or a variation axis other than opsz. */
function asksForDroppedAxisValue(text: string): string[] {
  const hits: string[] = [];
  const rules = [
    /\bfont-(?:thin|extralight|light)\b/g,
    /font-weight:\s*(?:[123]00|lighter)\b/g,
    /fontWeight:\s*["']?(?:[123]00|lighter)\b/g,
    /\bfont-\[\d+\]/g,
    /font-stretch/g,
    /fontStretch/g,
  ];
  for (const rule of rules) hits.push(...(text.match(rule) ?? []));
  for (const [, value] of text.matchAll(/font-variation-settings:\s*([^;}]+)/g)) {
    if (!/^(?:normal|"opsz"\s+[\d.]+)\s*$/.test(value!.trim())) {
      hits.push(`font-variation-settings: ${value!.trim()}`);
    }
  }
  return hits;
}

/** The innermost CSS blocks, as selector and body. */
function cssBlocks(css: string): { selector: string; body: string }[] {
  return Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g), ([, selector, body]) => ({
    selector: selector!.replace(/\/\*[\s\S]*?\*\//g, "").trim(),
    body: body!,
  }));
}

/** The CSS that styles marketing text: rules on the marketing faces or utilities. */
function marketingCss(css: string): string {
  return cssBlocks(css)
    .filter(
      ({ selector, body }) =>
        /var\(--font-(?:display|body|mono)\)/.test(body) || /\bfr-|-mkt\b/.test(selector),
    )
    .map(({ selector, body }) => `${selector} {${body}}`)
    .join("\n");
}

/** Where a class string ends up: the whole className value or cn()-style call. */
function classScopes(text: string): [number, number][] {
  const scopes: [number, number][] = [];
  const balanced = (start: number, open: string, close: string): number => {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close && --depth === 0) return i + 1;
    }
    return text.length;
  };
  for (const match of text.matchAll(/className=(["'{])|\b(?:cn|clsx|cx|cva|twMerge)\(/g)) {
    const start = match.index! + match[0].length - 1;
    const quote = match[1];
    if (quote === '"' || quote === "'") {
      scopes.push([start, text.indexOf(quote, start + 1) + 1]);
    } else if (quote === "{") {
      scopes.push([start, balanced(start, "{", "}")]);
    } else {
      scopes.push([start, balanced(start, "(", ")")]);
    }
  }
  return scopes;
}

const DISPLAY_CLASS = /(?<![\w-])(?:font-display|fr-h1|fr-h2)(?![\w-])/;
const OTHER_WEIGHT =
  /(?<![\w-])font-(?:thin|extralight|light|normal|medium|semibold|bold|black|\[\d+\])(?![\w-])/;
const AT_800 = /(?<![\w-])(?:font-extrabold|fr-h1|fr-h2)(?![\w-])/;

/** The display face at a weight other than 800, or with no weight of its own. */
function displayAtOtherWeight(text: string): string[] {
  const hits: string[] = [];
  const scopes = classScopes(text);
  for (const literal of text.matchAll(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g)) {
    if (!DISPLAY_CLASS.test(literal[0])) continue;
    const start = literal.index!;
    const enclosing = scopes
      .filter(([from, to]) => from <= start && start < to)
      .sort((a, b) => a[1] - a[0] - (b[1] - b[0]))[0];
    const scope = enclosing ? text.slice(...enclosing) : literal[0];
    if (OTHER_WEIGHT.test(scope) || !AT_800.test(scope)) hits.push(scope);
  }
  for (const { selector, body } of cssBlocks(text)) {
    if (!body.includes("var(--font-display)") || selector === "@utility font-display") continue;
    const weight = body.match(/font-weight:\s*([^;]+);/);
    if (weight?.[1]!.trim() !== "800") hits.push(selector);
  }
  return hits;
}

describe("the marketing fonts keep every axis value the CSS asks for (#640)", () => {
  it("scans the source tree", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(marketingFiles.length).toBeGreaterThan(150);
    expect(marketingFiles.some((f) => f.endsWith("globals.css"))).toBe(true);
    expect(marketingCss(sourceText(join(SRC, "app", "globals.css")))).toContain("fr-h1");
  });

  it("ships the axes the script makes, and the sources still carry the rest", () => {
    expect(woff2Axes(join(FONTS, "BricolageGrotesque.woff2"))).toEqual([
      { tag: "opsz", min: 12, max: 96 },
    ]);
    expect(woff2Axes(join(FONTS, "HankenGrotesk.woff2"))).toEqual([
      { tag: "wght", min: 400, max: 900 },
    ]);
    expect(woff2Axes(join(FONTS, "SplineSansMono.woff2"))).toEqual([
      { tag: "wght", min: 400, max: 700 },
    ]);
    // The reader itself, on the untouched Google files.
    expect(woff2Axes(join(FONT_SOURCES, "BricolageGrotesque-latin.woff2"))).toEqual([
      { tag: "opsz", min: 12, max: 96 },
      { tag: "wght", min: 200, max: 800 },
      { tag: "wdth", min: 75, max: 100 },
    ]);
    expect(woff2Axes(join(FONT_SOURCES, "SplineSansMono-latin.woff2"))).toEqual([
      { tag: "wght", min: 300, max: 700 },
    ]);
  });

  it("asks for no weight below 400, no width and no axis but opsz", () => {
    const offenders = marketingFiles.flatMap((file) => {
      const text = sourceText(file);
      const scanned = file.endsWith(".css") ? marketingCss(text) : text;
      return asksForDroppedAxisValue(scanned).map((hit) => `${file}: ${hit}`);
    });
    expect(
      offenders,
      "The marketing woff2 files start at wght 400 and carry no wdth axis. " +
        "Widen the range in scripts/instance-marketing-fonts.mjs and run it.",
    ).toEqual([]);
  });

  it("draws the display face at 800 only, and says so wherever it is used", () => {
    const offenders = files.flatMap((file) =>
      displayAtOtherWeight(sourceText(file)).map((hit) => `${file}: ${hit}`),
    );
    expect(
      offenders,
      "BricolageGrotesque.woff2 is pinned at wght 800, and font-display sets " +
        "only the family. Give the element font-extrabold, or widen the range " +
        "in scripts/instance-marketing-fonts.mjs and run it.",
    ).toEqual([]);
  });

  it("would report each of those", () => {
    for (const code of [
      'className="font-light"',
      "font-weight: 300;",
      "style={{ fontWeight: 200 }}",
      'className="font-[350]"',
      "font-stretch: 87.5%;",
      'font-variation-settings: "wdth" 80;',
      'font-variation-settings: "opsz" 32, "wght" 650;',
    ]) {
      expect(asksForDroppedAxisValue(code), code).not.toEqual([]);
    }
    expect(asksForDroppedAxisValue('font-variation-settings: "opsz" 96;')).toEqual([]);
    expect(asksForDroppedAxisValue('className="font-medium font-bold"')).toEqual([]);
    expect(marketingCss(".x { font-weight: 300; }")).toBe("");
    expect(marketingCss(".x { font-family: var(--font-body); font-weight: 300; }")).not.toBe("");

    for (const code of [
      '<h2 className="fr-h2 font-bold">',
      '<h1 className="font-display text-2xl font-semibold">',
      '<h3 className="font-display text-2xl">',
      "<h3 className='font-display text-2xl'>",
      '<h3 className={cn("font-display", big && "text-4xl")}>',
      '<h3 className={cn(\n  "font-display text-2xl",\n  "font-bold",\n)}>',
      "<h3 className={`font-display ${size}`}>",
      'const title = "font-display text-2xl";',
      "@utility fr-x {\n  font-family: var(--font-display);\n  font-weight: 700;\n}",
      ".wordmark {\n  font-family: var(--font-display);\n}",
    ]) {
      expect(displayAtOtherWeight(code), code).not.toEqual([]);
    }
    for (const code of [
      '<h1 className="font-display font-extrabold">',
      '<h3 className={cn("font-display", "font-extrabold", big && "text-4xl")}>',
      '<h1 className="fr-h1">',
      '<p className="font-body-mkt font-semibold">',
      "@utility font-display {\n  font-family: var(--font-display);\n}",
      "@utility fr-h1 {\n  font-family: var(--font-display);\n  font-weight: 800;\n}",
    ]) {
      expect(displayAtOtherWeight(code), code).toEqual([]);
    }
  });
});
