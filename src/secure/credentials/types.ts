/**
 * Types for the .env secrets store.
 *
 * The store preserves file format (comments, blank lines, ordering) across
 * read/write cycles. Every write is atomic (temp + rename) and 0600-permissioned.
 */

/** A parsed line from a .env file. Discriminated union preserves structure. */
export type EnvLine =
  | { readonly kind: "comment"; readonly raw: string }
  | { readonly kind: "blank"; readonly raw: string }
  | { readonly kind: "entry"; readonly key: string; readonly value: string; readonly raw: string };

/** Result of parsing a .env file. */
export interface EnvFile {
  /** Ordered lines preserving comments, blanks, and entries. */
  readonly lines: readonly EnvLine[];
}

/** Options for reading a .env file. */
export interface ReadEnvOptions {
  /** Path to the .env file. */
  readonly filePath: string;
}

/** Options for writing a .env file. */
export interface WriteEnvOptions {
  /** Path to the .env file. */
  readonly filePath: string;
}
