/**
 * OpenClaw workspace management.
 *
 * Re-exports workspace generators from their new module locations.
 */

export { generateWorkspaceTools, getEnabledToolNames, TOOL_BINARY_DEPS } from "./tools/registry.js";
export { generateSkills } from "../evolve/skills-construct/index.js";
export { generateAgentsMd } from "./identity/agents.js";
export { generateHeartbeatMd } from "./identity/heartbeat.js";
export { generateIdentityMd } from "./identity/identity.js";
export { generateMemoryMd } from "./identity/memory.js";
export { generateToolsMd } from "./identity/tools-doc.js";
