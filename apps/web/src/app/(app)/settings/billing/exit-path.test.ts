import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type * as TS from "typescript";
import { describe, expect, it } from "vitest";

import { sourceText } from "@/test/source-tree";

/**
 * #524 — the way out does not consult the pause read. Said once, as a property.
 *
 * # The sentence
 *
 * NOTHING THE EXIT IS NESTED INSIDE OR GATED BY MAY READ THE PAUSE.
 *
 * That is the whole check. Not "the exit is not disabled by it", not "no
 * `pointer-events-none` above it" — those are mechanisms, and a list of
 * mechanisms can always be added to. Eleven escapes were found across the three
 * clients by applying them and watching the suites stay green, and every one of
 * them worked the same way: some node between arriving on the screen and
 * pressing the button was made to consult `GET /v1/billing/pause`. Ban the
 * dependency and the twelfth mechanism is banned before anybody invents it.
 *
 * # Why this is read off the SOURCE rather than off a render
 *
 * A render-level check can only prove the property for the states a fixture can
 * describe. This proves it for all of them, including the ones nobody has
 * written a fixture for yet — and including the CSS-only shapes happy-dom is
 * structurally blind to, since it applies no stylesheets at all and a synthetic
 * click dispatches straight through anything visual.
 *
 * Its own blind spot is the mirror image: a node that COVERS the exit without
 * containing it (an absolutely positioned sibling) is not on the exit's
 * ancestry, so it is invisible here. That half is `billing.test.tsx`'s
 * EXIT-R1/R2/R3, which compare the rendered bytes of everything down to the
 * exit across every state the read can be in. Neither is the whole guarantee;
 * together they are.
 *
 * # How "reads the pause" is decided
 *
 * By NAME, propagated. The seed is what the file imports through a door that
 * names the pause — a module path with "pause" in it, or a binding called
 * something like `usePauseOffer` — plus anything the file itself declares under
 * that name. From there taint flows through declarations to a fixed point, so a
 * rename does not shake it off:
 *
 *     const stillChecking = pause.state === "loading";   // <- tainted too
 *     <Button disabled={portal.isPending || stillChecking}>
 *
 * The proofs at the bottom of this file apply real escapes to a miniature of
 * the card and assert this reports them. A guard nobody has broken is a guard
 * nobody has tested, and four of those were found in one audit of this repo.
 */

/**
 * The compiler, through `createRequire` rather than `import`.
 *
 * `import ts from "typescript"` sends 8MB of CommonJS through vite's transform
 * pipeline — 4.4s of import time and a sourcemap warning on every run, for a
 * parser that node can load in 200ms. Nothing here needs the module graph.
 */
const ts = createRequire(import.meta.url)("typescript") as typeof TS;

/** `apps/web/src`. */
const SRC = fileURLToPath(new URL("../../../../", import.meta.url));

/** The three logical operators whose left side decides whether the right runs. */
const GATING_OPERATORS: ReadonlySet<TS.SyntaxKind> = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

/** Whether a name announces itself as being about the pause. */
function namesThePause(name: string): boolean {
  return /pause/i.test(name);
}

/**
 * Every identifier a node MENTIONS, skipping the places a name is only a key.
 *
 * `pauseQuery.isPending` mentions `pauseQuery`; `isPending` is a member name and
 * belongs to whatever object it was read from. Likewise `{ paused: x }` mentions
 * `x` and `inert={x}` mentions `x` — the key and the attribute name are labels,
 * not references, and counting them would make the taint set meaningless.
 *
 * A JSX tag name IS counted: `<PausedPlanCard />` is a use of the thing.
 */
function mentioned(node: TS.Node): TS.Identifier[] {
  const found: TS.Identifier[] = [];
  const visit = (n: TS.Node): void => {
    if (ts.isPropertyAccessExpression(n)) {
      visit(n.expression);
      return;
    }
    if (ts.isPropertyAssignment(n)) {
      visit(n.initializer);
      return;
    }
    if (ts.isJsxAttribute(n)) {
      if (n.initializer) visit(n.initializer);
      return;
    }
    if (ts.isIdentifier(n)) {
      found.push(n);
      return;
    }
    n.forEachChild(visit);
  };
  visit(node);
  return found;
}

/** The names a declaration binds, destructuring included. */
function boundNames(name: TS.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? boundNames(element.name) : [],
  );
}

/**
 * What this file imports through a door that names the pause.
 *
 * Two ways in, because the pause arrives by both: everything out of
 * `@/components/settings/pause-read` and `.../pause-plan` (the module path says
 * so), and `usePauseOffer` out of `@/lib/api/billing`, which exports thirty
 * other things that have nothing to do with it (the binding says so).
 */
function importedPauseNames(file: TS.SourceFile): Set<string> {
  const seeded = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    const specifier = statement.moduleSpecifier;
    const fromPauseModule =
      ts.isStringLiteral(specifier) && namesThePause(specifier.text);
    const take = (local: string, imported: string): void => {
      if (fromPauseModule || namesThePause(imported) || namesThePause(local)) {
        seeded.add(local);
      }
    };
    if (clause.name) take(clause.name.text, clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      take(bindings.name.text, bindings.name.text);
    }
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        take(element.name.text, (element.propertyName ?? element.name).text);
      }
    }
  }
  return seeded;
}

/**
 * Every name in this file that carries the pause read, to a fixed point.
 *
 * The fixed point is the part that matters. A guard that looked for the literal
 * `pauseQuery` would be one `const checking = pauseQuery.isPending` away from
 * blind, and that rename is the natural shape of the next escape rather than a
 * contrived one — it reads like tidying.
 */
function pauseDerivedNames(file: TS.SourceFile): Set<string> {
  const derived = importedPauseNames(file);
  let changed = true;
  while (changed) {
    changed = false;
    const add = (name: string): void => {
      if (derived.has(name)) return;
      derived.add(name);
      changed = true;
    };
    const carries = (node: TS.Node): boolean =>
      mentioned(node).some((identifier) => derived.has(identifier.text));
    const visit = (n: TS.Node): void => {
      if (ts.isVariableDeclaration(n)) {
        const names = boundNames(n.name);
        if (
          names.some(namesThePause) ||
          (n.initializer !== undefined && carries(n.initializer))
        ) {
          for (const name of names) add(name);
        }
      }
      if (ts.isFunctionDeclaration(n) && n.name && n.body) {
        if (namesThePause(n.name.text) || carries(n.body)) add(n.name.text);
      }
      n.forEachChild(visit);
    };
    visit(file);
  }
  return derived;
}

/** A JSX element, either shape. */
type JsxNode = TS.JsxElement | TS.JsxSelfClosingElement;

function isJsxNode(node: TS.Node): node is JsxNode {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
}

function tagNameOf(node: JsxNode): string {
  return (
    ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName
  ).getText();
}

function attributesOf(node: JsxNode): TS.JsxAttributes {
  return ts.isJsxElement(node)
    ? node.openingElement.attributes
    : node.attributes;
}

/**
 * The element that puts the way out on screen.
 *
 * Found as the INNERMOST JSX element mentioning the marker, which is one rule
 * for both surfaces: in the card the marker is `CANCEL_ACTION`, the label, and
 * the innermost element carrying it is the button; on the page the marker is
 * `CancelSubscriptionCard`, and the innermost element carrying it is the card
 * itself. Throws rather than returning null, so a rename upstream fails loudly
 * instead of quietly leaving nothing to check.
 */
function exitElement(file: TS.SourceFile, marker: string): JsxNode {
  const matches: JsxNode[] = [];
  const visit = (n: TS.Node): void => {
    if (isJsxNode(n) && mentioned(n).some((id) => id.text === marker)) {
      matches.push(n);
    }
    n.forEachChild(visit);
  };
  visit(file);
  const innermost = matches.filter(
    (candidate) =>
      !matches.some(
        (other) =>
          other !== candidate &&
          other.getStart() >= candidate.getStart() &&
          other.getEnd() <= candidate.getEnd(),
      ),
  );
  // A LOCATOR MISS IS A FAILED ASSERTION, NOT A THROWN ERROR.
  //
  // Throwing here took both tests down with a stack trace pointing at this
  // file, so a reader saw the guard crash rather than the reason. And the
  // reason is usually legitimate: an edit that gives the exit a second
  // rendering (a dialog trigger beside the button) is a real change to review,
  // not a broken test. `expect` says which, and says it about their code.
  expect(
    innermost.length,
    `#524: the exit carrying "${marker}" in ${file.fileName} is no longer a ` +
      "single element, so this guard cannot follow the path to it. If that is " +
      "deliberate, teach the locator the new shape rather than deleting it - " +
      "the walk below is what proves nothing on the way to the exit reads the " +
      "pause.",
  ).toBe(1);
  return innermost[0];
}

/** One place on the way to the exit, and what it is. */
interface Gate {
  readonly why: string;
  readonly node: TS.Node;
}

/** Statements that only bring a name into scope; they cannot stop a render. */
function isDeclarationOnly(statement: TS.Statement): boolean {
  return (
    ts.isVariableStatement(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isImportDeclaration(statement) ||
    ts.isExportDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  );
}

/**
 * Everything between arriving on the screen and pressing the exit.
 *
 * Walked UPWARD from the button, so it is the exit's own ancestry rather than a
 * region somebody has to keep in step with the file:
 *
 *   - the exit's own attributes.
 *   - the attributes of every element it is nested inside.
 *   - every condition that decides whether any of those render — a ternary's
 *     test, the left side of an `&&`/`||`/`??` it sits on the right of, an
 *     enclosing `if`.
 *   - every statement that runs BEFORE it in the same block and is not merely a
 *     declaration. This is the Android escape said in TypeScript: `if (pause is
 *     Loading) return` placed above the role gate slices its window out of every
 *     check that starts lower down. A declaration is exempt because a name
 *     brought into scope cannot stop anything — only a USE of it can, and uses
 *     are what the rest of this list collects.
 *
 * Deliberately NOT the exit's siblings. A sibling that renders more content is
 * ordinary (the paused card sits above the plan card on this page, and the
 * per-reason answer sits below the exit inside the card), and a sibling that
 * COVERS the exit is a rendered-bytes question — see the header.
 */
function gatesAbove(exit: JsxNode): Gate[] {
  const gates: Gate[] = [
    { why: "an attribute on the exit itself", node: attributesOf(exit) },
  ];
  let child: TS.Node = exit;
  for (
    let node: TS.Node = exit.parent;
    node && !ts.isSourceFile(node);
    child = node, node = node.parent
  ) {
    if (isJsxNode(node)) {
      gates.push({
        why: `an attribute on <${tagNameOf(node)}>, which the exit is inside`,
        node: attributesOf(node),
      });
    } else if (ts.isConditionalExpression(node)) {
      gates.push({ why: "a condition the exit renders under", node: node.condition });
    } else if (
      ts.isBinaryExpression(node) &&
      GATING_OPERATORS.has(node.operatorToken.kind) &&
      child === node.right
    ) {
      gates.push({ why: "a condition the exit renders under", node: node.left });
    } else if (ts.isIfStatement(node)) {
      gates.push({ why: "a condition the exit renders under", node: node.expression });
    } else if (ts.isBlock(node) || ts.isCaseClause(node)) {
      for (const statement of node.statements) {
        if (statement === child) break;
        if (isDeclarationOnly(statement)) continue;
        gates.push({ why: "a statement that runs before the exit", node: statement });
      }
    }
  }
  return gates;
}

/** `path:line` for a node, the way an editor wants it. */
function whereIs(file: TS.SourceFile, node: TS.Node): string {
  const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
  return `${file.fileName}:${line + 1}`;
}

/**
 * Every way the exit consults the pause read, as sentences.
 *
 * Empty is the passing answer. Exported shape rather than a bare boolean so a
 * failure names the identifier and the line, which is the difference between a
 * guard somebody can act on and one they have to re-derive.
 */
function pauseDependenciesOnTheWayToTheExit(
  fileName: string,
  source: string,
  marker: string,
): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const derived = pauseDerivedNames(file);
  return gatesAbove(exitElement(file, marker)).flatMap((gate) =>
    mentioned(gate.node)
      .filter((identifier) => derived.has(identifier.text))
      .map(
        (identifier) =>
          `${whereIs(file, identifier)} — ${gate.why} reads \`${identifier.text}\`, which carries the pause read`,
      ),
  );
}

/**
 * The two files that put the exit in front of somebody.
 *
 * The marker is what identifies the exit in each: the label the button carries,
 * and the card the page mounts.
 */
const SURFACES: {
  label: string;
  path: string;
  marker: string;
  tag: string;
}[] = [
  {
    label: "the cancel card",
    path: join(SRC, "components/settings/cancel-subscription-card.tsx"),
    marker: "CANCEL_ACTION",
    tag: "Button",
  },
  {
    label: "the billing page",
    path: join(SRC, "app/(app)/settings/billing/page.tsx"),
    marker: "CancelSubscriptionCard",
    tag: "CancelSubscriptionCard",
  },
];

describe("#524 nothing on the way to the exit reads the pause", () => {
  it.each(SURFACES)(
    "EXIT-S1: $label gates the exit on nothing the pause read decides",
    ({ path, marker }) => {
      const findings = pauseDependenciesOnTheWayToTheExit(
        path,
        sourceText(path),
        marker,
      );
      expect(
        findings,
        `\n\nThe way out now depends on GET /v1/billing/pause:\n\n  ` +
          `${findings.join("\n  ")}\n\n` +
          `Cancelling may never take more steps or more time than subscribing did,\n` +
          `and a Stripe round trip that has nothing to do with leaving must not be\n` +
          `able to stand in the doorway. Whatever the pause read decides, decide it\n` +
          `BELOW the exit — that is where the per-reason answer already lives.\n`,
      ).toEqual([]);
    },
  );

  it.each(SURFACES)(
    "EXIT-S2: $label is actually being read — the exit, and a pause to find",
    ({ path, marker, tag }) => {
      // A guard that located nothing would report nothing and pass. Both halves
      // are pinned: the element it walked up from, and the fact that this file
      // really does carry a pause read for the walk to run into.
      const source = sourceText(path);
      const file = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const exit = exitElement(file, marker);
      expect(tagNameOf(exit)).toBe(tag);
      // The walk reached PAST the exit's own attributes.
      //
      // This asserted a count over three, which is a proxy for "it found
      // something" and fails on correct code: extracting the exit block into a
      // component with no pause dependency at all shortens the chain and trips
      // it. A guard that is wrong about a harmless refactor is a guard somebody
      // deletes, which costs more than the escape it was watching for.
      //
      // What actually has to hold is that the walk sees more than the element
      // itself - at least one enclosing thing, whatever the shape above it.
      // gatesAbove seeds with the exit's own attributes, so anything past one
      // is the path above it.
      expect(
        gatesAbove(exit).length - 1,
        "the walk found nothing above the exit, so it is reading one element " +
          "rather than the path to it",
      ).toBeGreaterThan(0);

      const derived = pauseDerivedNames(file);
      expect(derived.has("usePauseOffer")).toBe(true);
      expect(derived.has("pause")).toBe(true);
    },
  );
});

/**
 * A miniature of the cancel card, so the escapes can be applied for real.
 *
 * Real imports, a real pause read, a real exit at the bottom of two wrappers.
 * Every proof below splices its escape into exactly the place the corresponding
 * one was found in the shipped tree, and asserts the named identifier comes back
 * — not merely that "something" was caught.
 */
function miniature(
  parts: {
    statements?: string;
    gate?: string;
    wrapper?: string;
    exitAttributes?: string;
  } = {},
): string {
  const exit = `<Button disabled={portal.isPending} onClick={leave}${parts.exitAttributes ?? ""}>
            {portal.isPending ? "Opening…" : CANCEL_ACTION}
          </Button>`;
  return `
import { pauseQueryEnabled } from "@/components/settings/pause-plan";
import { pauseReadOf } from "@/components/settings/pause-read";
import { usePauseOffer } from "@/lib/api/billing";

export function CancelSubscriptionCard({ isOwner, company }) {
  const portal = useBillingPortal();
  const pauseAsked = pauseQueryEnabled(isOwner, company);
  const pauseQuery = usePauseOffer(pauseAsked);
  const pause = pauseReadOf(pauseAsked, pauseQuery);
  ${parts.statements ?? ""}
  if (!isOwner) return <SettingsCard title="Cancel" />;
  return (
    <SettingsCard title="Cancel">
      <div className="space-y-6">
        <div className="space-y-2"${parts.wrapper ?? ""}>
          ${parts.gate ? `{${parts.gate} && (${exit})}` : exit}
        </div>
      </div>
    </SettingsCard>
  );
}
`;
}

function findingsFor(source: string): string[] {
  return pauseDependenciesOnTheWayToTheExit(
    "miniature.tsx",
    source,
    "CANCEL_ACTION",
  );
}

/**
 * #524 — the guard, broken on purpose.
 *
 * Each of these is one of the escapes an adversarial verifier applied to the
 * shipped tree and watched every one of 1180 tests stay green. They are here as
 * PROOF rather than as the specification: the specification is the sentence at
 * the top of this file, and the last two below are mechanisms nobody used, which
 * is the point — the check never learns a mechanism, so it catches the ones
 * nobody has thought of.
 */
describe("#524 the guard, proven by applying the escapes it exists to catch", () => {
  it("EXIT-S3: says nothing about a card that keeps the rule", () => {
    // Without this the four below prove only that the analyser fails loudly.
    expect(findingsFor(miniature())).toEqual([]);
  });

  it.each([
    [
      "an inline style that kills the click (the CSS happy-dom never loads)",
      miniature({
        exitAttributes: ` style={pauseQuery.isPending ? { pointerEvents: "none" } : undefined}`,
      }),
      "pauseQuery",
    ],
    [
      "inert on a wrapper (React 19 renders it, happy-dom ignores it)",
      miniature({ wrapper: " inert={pauseQuery.isPending}" }),
      "pauseQuery",
    ],
    [
      "an early return above everything, the way Android's did",
      miniature({ statements: `if (pause.state === "loading") return null;` }),
      "pause",
    ],
    [
      "a condition the exit renders under",
      miniature({ gate: "!pauseQuery.isPending" }),
      "pauseQuery",
    ],
    [
      "the same dependency wearing a name nobody would grep for",
      miniature({
        statements: `const stillChecking = pause.state === "loading";`,
        exitAttributes: " disabled={portal.isPending || stillChecking}",
      }),
      "stillChecking",
    ],
    [
      "a mechanism nobody has used yet: aria-disabled",
      miniature({ exitAttributes: " aria-disabled={pauseQuery.isPending}" }),
      "pauseQuery",
    ],
  ])("EXIT-S4: catches %s", (_escape, source, culprit) => {
    const findings = findingsFor(source);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.join("\n")).toContain(`\`${culprit}\``);
  });
});
