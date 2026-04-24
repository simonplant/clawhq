/**
 * Instance-scoped Docker container naming.
 *
 * The openclaw service's container name is derived deterministically from
 * the unified-registry instance-id so two deployments on one host never
 * collide. The name must be a valid Docker object name
 * (`[a-zA-Z0-9][a-zA-Z0-9_.-]+`), so we strip dashes from the uuid and take
 * the leading 8 hex characters — enough for collision resistance across
 * any realistic fleet size on one host.
 */

/** Take the leading 8 hex chars of a uuid (dashes stripped). Stable per id. */
export function shortInstanceId(instanceId: string): string {
  return instanceId.replace(/-/g, "").slice(0, 8);
}

/** Canonical container name for the openclaw service in a given deployment. */
export function openclawContainerName(instanceId: string): string {
  return `openclaw-${shortInstanceId(instanceId)}`;
}
