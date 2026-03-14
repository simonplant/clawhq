/**
 * Docker CLI wrapper — executes docker/docker-compose commands via subprocess.
 *
 * Never uses the Docker SDK directly. All interaction is through the CLI,
 * which keeps the dependency tree minimal and matches how operators debug.
 */

import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

// --- Typed errors ---

export class DockerError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "DockerError";
  }
}

export class DaemonNotRunning extends DockerError {
  constructor(stderr: string) {
    super("Docker daemon is not running", stderr, 1);
    this.name = "DaemonNotRunning";
  }
}

export class ImageNotFound extends DockerError {
  constructor(image: string, stderr: string) {
    super(`Image not found: ${image}`, stderr, 1);
    this.name = "ImageNotFound";
  }
}

export class PortConflict extends DockerError {
  constructor(port: string, stderr: string) {
    super(`Port already in use: ${port}`, stderr, 1);
    this.name = "PortConflict";
  }
}

export class HealthPollTimeout extends Error {
  constructor(
    public readonly containerId: string,
    public readonly lastStatus: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `Health poll timed out after ${timeoutMs}ms for container ${containerId} (last status: ${lastStatus})`,
    );
    this.name = "HealthPollTimeout";
  }
}

// --- Result types ---

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface ContainerInfo {
  id: string;
  name: string;
  state: string;
  status: string;
  image: string;
  ports: string;
}

export interface ImageInfo {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export interface ImageInspectResult {
  id: string;
  layers: string[];
  size: number;
  created: string;
  config: Record<string, unknown>;
}

export interface NetworkInfo {
  id: string;
  name: string;
  driver: string;
  scope: string;
}

export type HealthStatus = "healthy" | "unhealthy" | "starting" | "none";

export interface HealthPollResult {
  containerId: string;
  status: HealthStatus;
  elapsedMs: number;
}

export interface HealthPollOptions {
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
}

export interface DockerClientOptions {
  dockerBin?: string;
  composeBin?: string;
  cwd?: string;
}

// --- Error classification ---

function classifyError(stderr: string, exitCode: number | null): DockerError {
  const lower = stderr.toLowerCase();

  if (
    lower.includes("cannot connect to the docker daemon") ||
    lower.includes("is the docker daemon running") ||
    lower.includes("connection refused")
  ) {
    return new DaemonNotRunning(stderr);
  }

  if (lower.includes("no such image") || lower.includes("image not found") ||
      lower.includes("manifest unknown")) {
    const match = stderr.match(/(?:no such image|image not found)[:\s]*(\S+)/i);
    return new ImageNotFound(match?.[1] ?? "unknown", stderr);
  }

  if (lower.includes("port is already allocated") || lower.includes("address already in use")) {
    const match = stderr.match(/(?:port|address)\s+[\w.]*:?(\d+)/i);
    return new PortConflict(match?.[1] ?? "unknown", stderr);
  }

  return new DockerError(`Docker command failed (exit ${exitCode})`, stderr, exitCode);
}

// --- Client ---

export class DockerClient {
  private readonly dockerBin: string;
  private readonly composeBin: string;
  private readonly cwd: string | undefined;

  constructor(options: DockerClientOptions = {}) {
    this.dockerBin = options.dockerBin ?? "docker";
    this.composeBin = options.composeBin ?? "docker";
    this.cwd = options.cwd;
  }

  /** Execute a raw docker command. */
  async exec(
    args: string[],
    options: { signal?: AbortSignal } = {},
  ): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execFile(this.dockerBin, args, {
        cwd: this.cwd,
        signal: options.signal,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout, stderr };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw err;
      }
      const execErr = err as { stderr?: string; code?: number };
      throw classifyError(execErr.stderr ?? String(err), execErr.code ?? null);
    }
  }

  /** Execute a docker compose command. */
  async composeExec(
    args: string[],
    options: { signal?: AbortSignal } = {},
  ): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execFile(
        this.composeBin,
        ["compose", ...args],
        {
          cwd: this.cwd,
          signal: options.signal,
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      return { stdout, stderr };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw err;
      }
      const execErr = err as { stderr?: string; code?: number };
      throw classifyError(execErr.stderr ?? String(err), execErr.code ?? null);
    }
  }

  /** Build a Docker image. */
  async build(
    context: string,
    options: {
      tag?: string;
      file?: string;
      target?: string;
      buildArgs?: Record<string, string>;
      signal?: AbortSignal;
    } = {},
  ): Promise<ExecResult> {
    const args = ["build"];
    if (options.tag) args.push("-t", options.tag);
    if (options.file) args.push("-f", options.file);
    if (options.target) args.push("--target", options.target);
    if (options.buildArgs) {
      for (const [key, val] of Object.entries(options.buildArgs)) {
        args.push("--build-arg", `${key}=${val}`);
      }
    }
    args.push(context);
    return this.exec(args, { signal: options.signal });
  }

  /** Start services via docker compose up. */
  async up(options: { detach?: boolean; signal?: AbortSignal } = {}): Promise<ExecResult> {
    const args = ["up"];
    if (options.detach !== false) args.push("-d");
    return this.composeExec(args, { signal: options.signal });
  }

  /** Stop services via docker compose down. */
  async down(options: { signal?: AbortSignal } = {}): Promise<ExecResult> {
    return this.composeExec(["down"], { signal: options.signal });
  }

  /** Restart services via docker compose restart. */
  async restart(options: { signal?: AbortSignal } = {}): Promise<ExecResult> {
    return this.composeExec(["restart"], { signal: options.signal });
  }

  /** List containers via docker compose ps. */
  async ps(options: { signal?: AbortSignal } = {}): Promise<ContainerInfo[]> {
    const { stdout } = await this.composeExec(
      ["ps", "--format", "json"],
      { signal: options.signal },
    );
    if (!stdout.trim()) return [];

    // docker compose ps --format json outputs one JSON object per line
    return stdout
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const obj = JSON.parse(line) as Record<string, unknown>;
        return {
          id: String(obj.ID ?? ""),
          name: String(obj.Name ?? ""),
          state: String(obj.State ?? ""),
          status: String(obj.Status ?? ""),
          image: String(obj.Image ?? ""),
          ports: String(obj.Ports ?? ""),
        };
      });
  }

  /** Fetch container logs (buffered). */
  async logs(
    options: {
      tail?: number;
      since?: string;
      service?: string;
      timestamps?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<ExecResult> {
    const args = ["logs"];
    if (options.tail !== undefined) args.push("--tail", String(options.tail));
    if (options.since) args.push("--since", options.since);
    if (options.timestamps) args.push("--timestamps");
    if (options.service) args.push(options.service);
    return this.composeExec(args, { signal: options.signal });
  }

  /**
   * Stream container logs in real-time (follow mode).
   * Pipes stdout/stderr directly to the provided writable streams.
   * Returns a promise that resolves when the stream ends or is aborted.
   */
  streamLogs(options: {
    tail?: number;
    since?: string;
    service?: string;
    timestamps?: boolean;
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
    signal?: AbortSignal;
  }): Promise<void> {
    const args = ["compose", "logs", "--follow"];
    if (options.tail !== undefined) args.push("--tail", String(options.tail));
    if (options.since) args.push("--since", options.since);
    if (options.timestamps) args.push("--timestamps");
    if (options.service) args.push(options.service);

    return new Promise<void>((resolve, reject) => {
      const child = spawn(this.composeBin, args, {
        cwd: this.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout.pipe(options.stdout, { end: false });
      child.stderr.pipe(options.stderr, { end: false });

      const onAbort = () => {
        child.kill("SIGTERM");
      };

      if (options.signal) {
        if (options.signal.aborted) {
          child.kill("SIGTERM");
          resolve();
          return;
        }
        options.signal.addEventListener("abort", onAbort, { once: true });
      }

      child.on("close", () => {
        options.signal?.removeEventListener("abort", onAbort);
        resolve();
      });

      child.on("error", (err) => {
        options.signal?.removeEventListener("abort", onAbort);
        reject(err);
      });
    });
  }

  /** Inspect a Docker object (container, image, etc.). */
  async inspect(
    target: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<Record<string, unknown>[]> {
    const { stdout } = await this.exec(["inspect", target], { signal: options.signal });
    return JSON.parse(stdout) as Record<string, unknown>[];
  }

  /** List Docker networks. */
  async networkLs(options: { signal?: AbortSignal } = {}): Promise<NetworkInfo[]> {
    const { stdout } = await this.exec(
      ["network", "ls", "--format", "{{json .}}"],
      { signal: options.signal },
    );
    if (!stdout.trim()) return [];

    return stdout
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const obj = JSON.parse(line) as Record<string, unknown>;
        return {
          id: String(obj.ID ?? ""),
          name: String(obj.Name ?? ""),
          driver: String(obj.Driver ?? ""),
          scope: String(obj.Scope ?? ""),
        };
      });
  }

  /** Check if a Docker image exists locally. */
  async imageExists(
    image: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<boolean> {
    try {
      await this.exec(["image", "inspect", image], { signal: options.signal });
      return true;
    } catch (err: unknown) {
      if (err instanceof ImageNotFound) return false;
      throw err;
    }
  }

  /** Inspect a Docker image — returns layer info for build verification. */
  async imageInspect(
    image: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ImageInspectResult> {
    const results = await this.inspect(image, { signal: options.signal });
    if (results.length === 0) {
      throw new ImageNotFound(image, "No inspection data returned");
    }

    const data = results[0];
    const rootFs = data.RootFS as { Layers?: string[] } | undefined;
    const config = data.Config as Record<string, unknown> | undefined;

    return {
      id: String(data.Id ?? ""),
      layers: rootFs?.Layers ?? [],
      size: Number(data.Size ?? 0),
      created: String(data.Created ?? ""),
      config: config ?? {},
    };
  }

  /**
   * Poll container health status until healthy or timeout.
   * Resolves with the final health status, or throws HealthPollTimeout.
   */
  async pollHealth(
    containerId: string,
    options: HealthPollOptions = {},
  ): Promise<HealthPollResult> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    const intervalMs = options.intervalMs ?? 2_000;
    const signal = options.signal;

    const start = Date.now();
    let lastStatus: HealthStatus = "none";

    while (Date.now() - start < timeoutMs) {
      signal?.throwIfAborted();

      try {
        const { stdout } = await this.exec(
          ["inspect", "--format", "{{.State.Health.Status}}", containerId],
          { signal },
        );
        const status = stdout.trim() as HealthStatus;
        lastStatus = status || "none";

        if (status === "healthy") {
          return {
            containerId,
            status: "healthy",
            elapsedMs: Date.now() - start,
          };
        }

        if (status === "unhealthy") {
          return {
            containerId,
            status: "unhealthy",
            elapsedMs: Date.now() - start,
          };
        }
      } catch {
        // Container might not exist yet or have no healthcheck — keep polling
        lastStatus = "none";
      }

      // Wait before next poll
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, intervalMs);
        if (signal) {
          const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
          };
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }

    throw new HealthPollTimeout(containerId, lastStatus, timeoutMs);
  }
}
