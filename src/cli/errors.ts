/**
 * CommandError — thrown by CLI command handlers instead of calling process.exit().
 *
 * Carries an exit code so the top-level error handler in index.ts can call
 * process.exit() in a single place. This makes command handlers testable and
 * allows proper cleanup (spinners, defer/finally blocks).
 */

export class CommandError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CommandError";
    this.exitCode = exitCode;
  }
}
