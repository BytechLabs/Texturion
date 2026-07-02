/**
 * Reusable visual frame primitives (VISUALS §1B/§1D/§4). Device chrome +
 * texture/depth for framing screenshots AND live-DOM product renders.
 *
 * - <BrowserFrame> / <PhoneFrame>: device chrome (server components).
 * - <GlowFrame>: glow + gentle settle-tilt wrapper (the one client island).
 * - <Texture> / <GradientMesh>: faint background depth (server components).
 *
 * All themeable (light/dark), reduced-motion safe, zero-CLS.
 */
export { BrowserFrame } from "./browser-frame";
export type { BrowserFrameProps } from "./browser-frame";
export { PhoneFrame } from "./phone-frame";
export type { PhoneFrameProps } from "./phone-frame";
export { GlowFrame } from "./glow-frame";
export type { GlowFrameProps } from "./glow-frame";
export { Texture } from "./texture";
export type { TextureProps } from "./texture";
export { GradientMesh } from "./gradient-mesh";
export type { GradientMeshProps } from "./gradient-mesh";
