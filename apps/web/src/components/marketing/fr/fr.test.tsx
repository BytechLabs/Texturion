import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ConvergedField,
  CtaButton,
  Dateline,
  Eyebrow,
  FrCard,
  FrSection,
  MonoFigure,
  PanelFrame,
} from "./index";

/** The v4 laws the primitives must encode (DESIGN-DIRECTION v4). */

describe("fr primitives — the FIRST RESPONSE component kit", () => {
  it("Dateline is the dark chip (paper mono text) with a frost tone for legal summary chips", () => {
    const ink = renderToStaticMarkup(<Dateline>9:04 PM · TUESDAY</Dateline>);
    expect(ink).toContain("9:04 PM · TUESDAY");
    // #362 phase 8: the chip is one of the two deliberately-dark surfaces, so
    // it rides --fr-inverse and takes its label from --fr-on-inverse.
    expect(ink).toContain("--fr-inverse");
    expect(ink).toContain("--fr-on-inverse");
    expect(ink).toContain("fr-eyebrow");
    const frost = renderToStaticMarkup(
      <Dateline tone="frost">Plain English summary</Dateline>,
    );
    expect(frost).toContain("--fr-frost");
  });

  it("Eyebrow is the frost chip with ink text", () => {
    const html = renderToStaticMarkup(<Eyebrow>See it work</Eyebrow>);
    expect(html).toContain("--fr-frost");
    expect(html).toContain("See it work");
  });

  it("CtaButton: lime primary pill, ink-ghost secondary, inverted on-cobalt (§4 Buttons)", () => {
    const primary = renderToStaticMarkup(
      <CtaButton href="/signup">Get your number</CtaButton>,
    );
    // #494: the primary CTA is the ONE lime moment on a marketing page — the
    // brand fill, not the ink accent that carries links and focus rings. The
    // two are separate tokens because a colour is a fill OR a label (D100), and
    // lime can only ever be the former.
    expect(primary).toContain("--fr-brand");
    expect(primary).toContain("--fr-on-brand");
    expect(primary).not.toContain("--fr-olive)");
    expect(primary).toContain("rounded-full");
    expect(primary).toContain('href="/signup"');
    expect(primary).toContain("Get your number");

    const secondary = renderToStaticMarkup(
      <CtaButton href="/pricing" variant="secondary">
        See pricing
      </CtaButton>,
    );
    expect(secondary).toContain("border-[1.5px]");
    expect(secondary).toContain("--fr-ink");

    const inverted = renderToStaticMarkup(
      <CtaButton href="/signup" variant="on-cobalt">
        Get your number
      </CtaButton>,
    );
    // On the accent band the button INVERTS: fill = the band's label colour,
    // label = the band. The swap is automatic in both modes, where a literal
    // `bg-white` would have stayed white on a lime band.
    expect(inverted).toContain("bg-[color:var(--fr-on-olive)]");
    expect(inverted).toContain("text-[color:var(--fr-olive)]");
  });

  it("FrSection renders the four sanctioned grounds and the §4 container", () => {
    const frost = renderToStaticMarkup(
      <FrSection ground="frost" id="pattern">
        x
      </FrSection>,
    );
    expect(frost).toContain("--fr-frost");
    expect(frost).toContain('id="pattern"');
    expect(frost).toContain("max-w-[72rem]");
    const cobalt = renderToStaticMarkup(
      <FrSection ground="cobalt">x</FrSection>,
    );
    expect(cobalt).toContain("--fr-olive");
    expect(cobalt).toContain("--fr-on-olive");
    const ink = renderToStaticMarkup(<FrSection ground="ink">x</FrSection>);
    expect(ink).toContain("--fr-inverse");
    expect(ink).toContain("--fr-on-inverse");
  });

  it("FrCard is white + the one shadow via fr-card; well variant is the frost wash", () => {
    expect(renderToStaticMarkup(<FrCard>x</FrCard>)).toContain("fr-card");
    expect(renderToStaticMarkup(<FrCard well>x</FrCard>)).toContain(
      "--fr-frost",
    );
  });

  it("MonoFigure: mono value + quiet body suffix; flare tone forces display scale and bold (§3.4.3)", () => {
    const fig = renderToStaticMarkup(
      <MonoFigure value="$29" suffix="/mo · the whole crew" size="display" />,
    );
    expect(fig).toContain("fr-figure");
    expect(fig).toContain("$29");
    expect(fig).toContain("/mo · the whole crew");

    const flare = renderToStaticMarkup(
      <MonoFigure value="$1,742" tone="flare" size="data" />,
    );
    // Flare never below 24px bold: tone=flare overrides the size down-request.
    expect(flare).toContain("fr-figure");
    expect(flare).toContain("font-bold");
    expect(flare).toContain("--fr-flare");
  });

  it("PanelFrame wraps the product embed in .app-scope so it keeps APP tokens (Law 2)", () => {
    const html = renderToStaticMarkup(
      <PanelFrame
        caption="A Reyes Plumbing conversation."
        ariaLabel="A Reyes Plumbing conversation in the Loonext inbox"
      >
        <div data-embed>inbox</div>
      </PanelFrame>,
    );
    expect(html).toContain("app-scope");
    // #84: no faux-browser chrome — no three-dot "Mac shell", no URL chip.
    expect(html).not.toContain("loonext.com/inbox");
    expect(html).not.toContain("fr-mono-data");
    // No demo-labeling chip is ever attached (owner amendment 2026-07-08).
    expect(html).not.toContain("SCRIPTED DEMO");
    expect(html).not.toContain("EXAMPLE CONVERSATION");
    expect(html).toContain("A Reyes Plumbing conversation.");
    // Marketing never paints cobalt INSIDE the frame: the embed region adds
    // no marketing color, only the scope class.
    const embedRegion = html.slice(html.indexOf("app-scope"));
    expect(embedRegion.slice(0, 200)).not.toContain("--fr-olive");
  });

  it("PanelFrame phone variant can stage the app's own dark mode via a local .dark region", () => {
    const html = renderToStaticMarkup(
      <PanelFrame phone phoneDark>
        <div>thread</div>
      </PanelFrame>,
    );
    expect(html).toContain('class="dark');
    expect(html).toContain("app-scope");
  });

  it("ConvergedField: full still tells the story (4 green docked + 1 flare waiting), variants are decorative-only", () => {
    const full = renderToStaticMarkup(<ConvergedField variant="full" />);
    expect(full).toContain('aria-hidden="true"');
    expect((full.match(/var\(--fr-green\)/g) ?? []).length).toBe(4);
    expect((full.match(/var\(--fr-flare\)/g) ?? []).length).toBe(1);
    // The P5-SPEC scripted timestamps, mono.
    for (const t of ["9:04 PM", "6:48 AM", "12:15 PM", "5:31 PM", "8:47 AM"]) {
      expect(full).toContain(t);
    }

    const mark = renderToStaticMarkup(<ConvergedField variant="mark" />);
    expect(mark).toContain('aria-hidden="true"');
    expect((mark.match(/var\(--fr-flare\)/g) ?? []).length).toBe(1);

    const backdrop = renderToStaticMarkup(
      <ConvergedField
        variant="backdrop"
        className="text-[color:var(--fr-on-olive)]"
      />,
    );
    // Backdrop is currentColor only, so it works on the accent band.
    expect(backdrop).toContain("currentColor");
    expect(backdrop).not.toContain("--fr-flare");
    expect(backdrop).not.toContain("<text");
  });

  it("no primitive ships an em-dash or artifact talk in its rendered output (Laws 1 and 6)", () => {
    const everything = [
      renderToStaticMarkup(<Dateline>9:04 PM · TUESDAY</Dateline>),
      renderToStaticMarkup(<Eyebrow>Do the math</Eyebrow>),
      renderToStaticMarkup(<CtaButton href="/signup">Get your number</CtaButton>),
      renderToStaticMarkup(
        <PanelFrame caption="Tap any message to mark it done.">
          <div>x</div>
        </PanelFrame>,
      ),
      renderToStaticMarkup(<ConvergedField variant="full" />),
      renderToStaticMarkup(<MonoFigure value="3 to 7" suffix="business days" />),
    ].join("");
    expect(everything).not.toContain("—"); // em-dash
    expect(everything).not.toMatch(
      /real interface|stock photo|built with next|set in /i,
    );
  });
});
