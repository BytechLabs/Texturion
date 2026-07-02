/**
 * Shared marketing UI primitives (BLUEPRINT §1.4, §1.5). Clean API surface for
 * Track A (chrome) and Track B (home). Container/Section/GlowBackdrop/JsonLd are
 * server components; Reveal/RevealGroup are the only client islands.
 */
export { Container } from "./container";
export { Section } from "./section";
export { Reveal, RevealGroup } from "./reveal";
export { GlowBackdrop } from "./glow-backdrop";
export { JsonLd } from "./json-ld";
