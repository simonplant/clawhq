/**
 * Activity digest module.
 *
 * Provides `clawhq digest` functionality:
 * human-readable activity summary with privacy mode support.
 */

export type {
  ActivityCategory,
  ActivityEntry,
  ActivityType,
  CategorySummary,
  DigestEgressSummary,
  DigestOptions,
  DigestReport,
  ProblemEntry,
} from "./types.js";

export {
  collectDigestEgress,
  filterByTimeRange,
  parseActivityLog,
} from "./collector.js";

export { generateDigest } from "./generator.js";

export {
  formatDigestJson,
  formatDigestTable,
} from "./format.js";
