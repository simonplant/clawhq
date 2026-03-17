/**
 * Friendly CLI error handler.
 *
 * Wraps program.parseAsync() to translate common failure modes into
 * styled hints via formatError() instead of raw stack traces.
 */

import { formatError } from "./ui.js";

/**
 * Map a caught error to a user-friendly message printed to stderr.
 * Covers the 6 most common operational failures.
 */
export function handleCliError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack ?? "" : "";

  let output: string;

  if (
    message.includes("ENOENT") &&
    (message.includes("docker") || stack.includes("docker"))
  ) {
    output = formatError(
      "DOCKER_NOT_FOUND",
      "Docker is not installed or not in PATH",
      "Install Docker Desktop from docker.com and ensure it is running",
    );
  } else if (
    message.includes("ECONNREFUSED") ||
    message.includes("Cannot connect to Docker")
  ) {
    output = formatError(
      "DOCKER_NOT_RUNNING",
      "Docker daemon is not running",
      "Start Docker Desktop or run: sudo systemctl start docker",
    );
  } else if (
    message.includes("openclaw.json") &&
    (message.includes("ENOENT") || message.includes("not found"))
  ) {
    output = formatError(
      "NO_CONFIG",
      "No agent config found",
      "Run: clawhq init to set up your agent",
    );
  } else if (message.includes("EADDRINUSE")) {
    output = formatError(
      "PORT_IN_USE",
      "Port is already in use",
      "Check what is using the port: lsof -i :<port>",
    );
  } else if (
    message.includes("Dockerfile") &&
    (message.includes("not found") || message.includes("ENOENT"))
  ) {
    output = formatError(
      "NO_DOCKERFILE",
      "Dockerfile not found — run clawhq build first",
      "Run: clawhq build to generate the Dockerfile",
    );
  } else if (message.includes("EACCES") && message.includes(".env")) {
    output = formatError(
      "PERMISSION_DENIED",
      "Permission denied reading .env file",
      "Fix permissions: chmod 600 .env",
    );
  } else {
    output = formatError(
      "UNKNOWN_ERROR",
      message || "An unexpected error occurred",
      "Run with DEBUG=1 for full details",
    );
  }

  console.error(output);
}
