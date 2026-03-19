/**
 * Types for fleet management — multi-agent discovery, health aggregation,
 * and fleet-wide doctor.
 *
 * Fleet Operator persona: manages agents for multiple people. Single pane
 * of glass for health, one check to confirm all agents are configured correctly.
 */

import type { DoctorReport } from "../../operate/doctor/types.js";
import type { HealthReport } from "../types.js";

// ── Fleet Registry ──────────────────────────────────────────────────────────

/** A registered agent in the fleet. */
export interface FleetAgent {
  /** Human-readable label for this agent. */
  readonly name: string;
  /** Absolute path to the agent's deployment directory. */
  readonly deployDir: string;
  /** ISO 8601 timestamp when the agent was registered. */
  readonly addedAt: string;
}

/** Persisted fleet registry at ~/.clawhq/cloud/fleet.json. */
export interface FleetRegistry {
  readonly version: 1;
  readonly agents: readonly FleetAgent[];
}

// ── Fleet Discovery ─────────────────────────────────────────────────────────

/** Status of a discovered agent. */
export interface DiscoveredAgent {
  /** Agent label from registry. */
  readonly name: string;
  /** Deployment directory path. */
  readonly deployDir: string;
  /** Whether the deployment directory exists. */
  readonly exists: boolean;
  /** Whether the agent has a valid engine config. */
  readonly configured: boolean;
  /** Health report (if agent is configured). */
  readonly health?: HealthReport;
}

/** Result of fleet discovery. */
export interface FleetDiscoveryResult {
  /** All discovered agents. */
  readonly agents: readonly DiscoveredAgent[];
  /** Number of agents that exist and are configured. */
  readonly activeCount: number;
  /** Total registered agents. */
  readonly totalCount: number;
  /** ISO 8601 timestamp. */
  readonly timestamp: string;
}

// ── Fleet Health ────────────────────────────────────────────────────────────

/** Aggregated fleet health view. */
export interface FleetHealthStatus {
  /** Per-agent health. */
  readonly agents: readonly DiscoveredAgent[];
  /** Number of healthy agents (container running). */
  readonly healthyCount: number;
  /** Number of unhealthy agents. */
  readonly unhealthyCount: number;
  /** Number of unconfigured/missing agents. */
  readonly unavailableCount: number;
  /** True when all configured agents are healthy. */
  readonly allHealthy: boolean;
  /** ISO 8601 timestamp. */
  readonly timestamp: string;
}

// ── Fleet Doctor ────────────────────────────────────────────────────────────

/** Doctor result for a single agent in the fleet. */
export interface FleetAgentDoctorResult {
  /** Agent label. */
  readonly name: string;
  /** Deployment directory path. */
  readonly deployDir: string;
  /** Doctor report (undefined if agent directory doesn't exist). */
  readonly report?: DoctorReport;
  /** Error message if doctor couldn't run. */
  readonly error?: string;
}

/** Aggregate fleet-wide doctor result. */
export interface FleetDoctorReport {
  /** Per-agent doctor results. */
  readonly agents: readonly FleetAgentDoctorResult[];
  /** Number of healthy agents (zero doctor errors). */
  readonly healthyCount: number;
  /** Number of agents with doctor errors. */
  readonly unhealthyCount: number;
  /** Number of agents that couldn't be checked. */
  readonly unreachableCount: number;
  /** True when all reachable agents are healthy. */
  readonly allHealthy: boolean;
  /** ISO 8601 timestamp. */
  readonly timestamp: string;
}
