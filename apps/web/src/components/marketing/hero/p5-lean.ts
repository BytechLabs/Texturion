/**
 * p5 assembled from the parts the Arrival Field draws with. `import("p5")` is
 * the whole browser build (WebGL, the shader compiler, friendly errors, type,
 * DOM, image, IO), about 1 MB, for a sketch that only uses the 2D canvas,
 * shapes, colour and noise().
 *
 * `accessibility` is needed although the canvas is aria-hidden: the core's
 * setup and resizeCanvas() call into it unconditionally.
 *
 * A new p5 call in the sketch needs its addon (a folder under
 * node_modules/p5/dist) registered here, or it is undefined at runtime.
 */
import p5 from "p5/core";
import accessibility from "p5/accessibility";
import color from "p5/color";
import math from "p5/math";
import shape from "p5/shape";

shape(p5);
accessibility(p5);
color(p5);
math(p5);

// The core calls `p5._friendlyError` on some error paths, and only the
// friendly-errors addon defines it: without this those paths throw instead of
// logging. p5's own no-op addon (core/noop.js) does the same but is not exported.
const withErrors = p5 as unknown as { _friendlyError?: (...args: unknown[]) => void };
withErrors._friendlyError ??= () => {};

export default p5;
