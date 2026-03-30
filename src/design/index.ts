/**
 * Design module — the blueprint engine.
 *
 * This is THE PRODUCT. Everything else is infrastructure.
 */

export * from "./blueprints/index.js";
export * from "./configure/index.js";
// Identity module — export only what isn't already re-exported by configure.
export { generateSoul, generateAgents, generateTools, generateUser } from "./identity/index.js";
// Tools module — export the tool wrapper generator.
export { generateToolWrappers } from "./tools/index.js";
