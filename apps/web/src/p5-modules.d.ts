/*
 * p5 2.x publishes its core and addons as separate entry points but ships
 * types only for the full build. These give the parts the hero composes
 * (components/marketing/hero/p5-lean.ts) the full build's class type.
 */
declare module "p5/core" {
  import p5 from "p5";
  export default p5;
}

declare module "p5/accessibility" {
  import type p5 from "p5";
  const addon: (core: typeof p5) => void;
  export default addon;
}

declare module "p5/color" {
  import type p5 from "p5";
  const addon: (core: typeof p5) => void;
  export default addon;
}

declare module "p5/math" {
  import type p5 from "p5";
  const addon: (core: typeof p5) => void;
  export default addon;
}

declare module "p5/shape" {
  import type p5 from "p5";
  const addon: (core: typeof p5) => void;
  export default addon;
}
