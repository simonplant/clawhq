import { resolve } from "node:path";

import { Command } from "commander";

import { createReadlineIO } from "../init/index.js";
import {
  addIntegration,
  checkCronDependencies,
  cleanIdentityReferences,
  findCategory,
  formatIntegrationList,
  INTEGRATION_CATEGORIES,
  IntegrateError,
  listIntegrations,
  removeIntegration,
  swapIntegration,
  updateFirewallAllowlist,
} from "../integrate/index.js";
import type { IntegrateContext } from "../integrate/index.js";
import { recordChange } from "../workspace/evolve-history.js";
import type { DoctorContext } from "../doctor/types.js";

function makeIntegrateCtx(opts: { home: string; clawhqDir: string }): IntegrateContext {
  return {
    openclawHome: opts.home.replace(/^~/, process.env.HOME ?? "~"),
    clawhqDir: opts.clawhqDir.replace(/^~/, process.env.HOME ?? "~"),
  };
}

export function createIntegrateCommand(): Command {
  const integrateCmd = new Command("integrate")
    .description("Manage integrations — add, remove, swap, list")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--clawhq-dir <path>", "ClawHQ data directory", "~/.clawhq");

  integrateCmd
    .command("list", { isDefault: true })
    .description("List all integrations with provider, status, credential health")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const parentOpts = integrateCmd.opts() as { home: string; clawhqDir: string };
      const ctx = makeIntegrateCtx(parentOpts);

      try {
        const entries = await listIntegrations(ctx);

        if (opts.json) {
          console.log(JSON.stringify(entries, null, 2));
        } else {
          console.log(formatIntegrationList(entries));
        }
      } catch (err: unknown) {
        console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });

  integrateCmd
    .command("add <category>")
    .description("Add integration: walk through provider selection, credential setup, config generation")
    .option("--provider <name>", "Provider name (skip selection prompt)")
    .action(async (category: string, opts: { provider?: string }) => {
      const parentOpts = integrateCmd.opts() as { home: string; clawhqDir: string };
      const ctx = makeIntegrateCtx(parentOpts);

      try {
        const catDef = findCategory(category);
        if (!catDef) {
          const available = INTEGRATION_CATEGORIES.map((c) => c.category).join(", ");
          console.error(`Unknown category "${category}". Available: ${available}`);
          process.exitCode = 1;
          return;
        }

        // Provider selection
        let providerName = opts.provider;
        if (!providerName) {
          if (catDef.providers.length === 1) {
            providerName = catDef.providers[0].provider;
          } else {
            console.log(`Available providers for ${catDef.label}:`);
            for (let i = 0; i < catDef.providers.length; i++) {
              console.log(`  ${i + 1}. ${catDef.providers[i].label}`);
            }

            const { io, close } = createReadlineIO();
            try {
              const answer = await io.prompt(`Select provider (1-${catDef.providers.length})`, "1");
              const idx = parseInt(answer, 10) - 1;
              if (idx < 0 || idx >= catDef.providers.length) {
                console.error("Invalid selection.");
                process.exitCode = 1;
                return;
              }
              providerName = catDef.providers[idx].provider;
            } finally {
              close();
            }
          }
        }

        const provDef = catDef.providers.find((p) => p.provider === providerName);
        if (!provDef) {
          console.error(`Unknown provider "${providerName}" for category "${category}".`);
          process.exitCode = 1;
          return;
        }

        // Credential prompt
        const { io, close } = createReadlineIO();
        let credential: string;
        try {
          credential = await io.prompt(`${provDef.promptLabel}: `, "");
        } finally {
          close();
        }

        if (!credential) {
          console.error("Credential is required.");
          process.exitCode = 1;
          return;
        }

        // Validate credential live before completing setup
        let validated = false;
        console.log("Validating credential...");
        try {
          // Write credential to a temp env to validate it
          const { parseEnv, setEnvValue: setTmpEnvValue } = await import(
            "../security/secrets/env.js"
          );
          const envPath = resolve(ctx.openclawHome, ".env");
          let existingContent = "";
          try {
            const { readFile: rf } = await import("node:fs/promises");
            existingContent = await rf(envPath, "utf-8");
          } catch { /* no existing .env */ }
          const tmpEnv = parseEnv(existingContent);
          setTmpEnvValue(tmpEnv, provDef.envVar, credential);

          const { runProbes, DEFAULT_PROBES } = await import(
            "../security/credentials/index.js"
          );
          const report = await runProbes(tmpEnv, DEFAULT_PROBES);
          const selectedProvider = providerName ?? "";
          const probe = report.results.find(
            (r) => r.provider.toLowerCase() === selectedProvider.toLowerCase(),
          );
          if (probe && probe.status === "valid") {
            validated = true;
            console.log(`  Credential valid (${probe.message})`);
          } else if (probe && probe.status !== "missing") {
            console.log(`  Credential check: ${probe.status} — ${probe.message}`);
            console.log("  Proceeding with setup (credential may need additional configuration).");
          } else {
            console.log("  No built-in probe for this provider — skipping live validation.");
          }
        } catch {
          console.log("  Credential validation not available — proceeding.");
        }

        console.log(`Adding ${catDef.label} integration (${provDef.label})...`);
        const result = await addIntegration(ctx, category, providerName, credential, validated);

        // Record evolve change
        await recordChange(ctx, {
          changeType: "integration_add",
          target: category,
          previousState: "not configured",
          newState: `${category}/${providerName}`,
          rollbackSnapshotId: JSON.stringify({ action: "add", integration: result.integration }),
          requiresRebuild: result.requiresRebuild,
        });

        console.log(`Integration "${category}" added (provider: ${provDef.label}).`);
        if (result.toolsInstalled.length > 0) {
          console.log(`  Tools: ${result.toolsInstalled.join(", ")}`);
        }
        if (result.egressDomainsAdded.length > 0) {
          console.log(`  Egress domains: ${result.egressDomainsAdded.join(", ")}`);
        }

        // Update egress firewall allowlist atomically
        if (result.egressDomainsAdded.length > 0) {
          const fwResult = await updateFirewallAllowlist(ctx);
          if (fwResult) {
            if (fwResult.success) {
              console.log(`  Firewall updated: ${fwResult.message}`);
            } else {
              console.log(`  Firewall update skipped: ${fwResult.message}`);
            }
          }
        }

        // Check cron dependencies
        const cronDeps = await checkCronDependencies(ctx, category);
        if (cronDeps.dependentJobs.length > 0) {
          console.log(`  Cron jobs using ${category}:`);
          for (const job of cronDeps.dependentJobs) {
            console.log(`    - ${job.id}`);
          }
        }

        // Run targeted doctor health check
        try {
          const doctorCtx: DoctorContext = {
            openclawHome: ctx.openclawHome,
            configPath: resolve(ctx.openclawHome, "openclaw.json"),
            envPath: resolve(ctx.openclawHome, ".env"),
          };
          const { runChecks: runDoctorChecks } = await import("../doctor/runner.js");
          const { firewallCheck } = await import("../doctor/checks/firewall.js");
          const report = await runDoctorChecks(doctorCtx, [firewallCheck]);
          for (const check of report.checks) {
            const icon = check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "✗";
            console.log(`  Doctor [${icon}] ${check.name}: ${check.message}`);
          }
        } catch {
          // Doctor check not critical — skip silently
        }

        if (result.requiresRebuild) {
          console.log("");
          console.log("This integration requires container-level dependencies.");
          console.log("Run `clawhq build --stage2-only` to rebuild the agent image.");
        }
      } catch (err: unknown) {
        if (err instanceof IntegrateError) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(`Add failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
      }
    });

  integrateCmd
    .command("remove <category>")
    .description("Remove integration: clean credential, uninstall tool, update config")
    .action(async (category: string) => {
      const parentOpts = integrateCmd.opts() as { home: string; clawhqDir: string };
      const ctx = makeIntegrateCtx(parentOpts);

      try {
        // Flag orphaned cron dependencies before removing
        const cronDeps = await checkCronDependencies(ctx, category);
        if (cronDeps.hasActiveDependencies) {
          console.log(`Warning: active cron jobs depend on "${category}" tools:`);
          for (const job of cronDeps.dependentJobs) {
            console.log(`  - ${job.id}: ${job.task.slice(0, 80)}`);
          }
          console.log("  These jobs may fail after removal. Consider disabling them.");
        }

        // Capture previous state for rollback before removing
        const { loadRegistry: loadIntRegistry } = await import("../integrate/lifecycle.js");
        const intRegistry = await loadIntRegistry(ctx);
        const previousIntegration = intRegistry.integrations.find((i) => i.category === category);

        const result = await removeIntegration(ctx, category);

        // Record evolve change
        await recordChange(ctx, {
          changeType: "integration_remove",
          target: category,
          previousState: `${category}/${result.provider}`,
          newState: "removed",
          rollbackSnapshotId: previousIntegration
            ? JSON.stringify({ action: "remove", integration: previousIntegration })
            : null,
          requiresRebuild: false,
        });

        console.log(`Integration "${category}" removed (was: ${result.provider}).`);
        if (result.envVarsCleaned.length > 0) {
          console.log(`  Credentials cleaned: ${result.envVarsCleaned.join(", ")}`);
        }
        if (result.toolsRemoved.length > 0) {
          console.log(`  Tools removed: ${result.toolsRemoved.join(", ")}`);
        }

        // Clean identity file references
        const updatedIdentityFiles = await cleanIdentityReferences(ctx, category);
        if (updatedIdentityFiles.length > 0) {
          console.log(`  Identity files updated: ${updatedIdentityFiles.join(", ")}`);
        }

        // Tighten egress firewall allowlist
        if (result.egressDomainsRemoved.length > 0) {
          console.log(`  Egress domains removed: ${result.egressDomainsRemoved.join(", ")}`);
          const fwResult = await updateFirewallAllowlist(ctx);
          if (fwResult) {
            if (fwResult.success) {
              console.log(`  Firewall tightened: ${fwResult.message}`);
            } else {
              console.log(`  Firewall update skipped: ${fwResult.message}`);
            }
          }
        }

        console.log("");
        console.log("TOOLS.md updated.");
      } catch (err: unknown) {
        if (err instanceof IntegrateError) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(`Remove failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
      }
    });

  integrateCmd
    .command("swap <category> <new-provider>")
    .description("Change backend provider while preserving agent behavior (same category interface)")
    .action(async (category: string, newProvider: string) => {
      const parentOpts = integrateCmd.opts() as { home: string; clawhqDir: string };
      const ctx = makeIntegrateCtx(parentOpts);

      try {
        const provDef = findCategory(category)?.providers.find((p) => p.provider === newProvider);
        if (!provDef) {
          const catDef = findCategory(category);
          if (!catDef) {
            const available = INTEGRATION_CATEGORIES.map((c) => c.category).join(", ");
            console.error(`Unknown category "${category}". Available: ${available}`);
          } else {
            const available = catDef.providers.map((p) => p.provider).join(", ");
            console.error(`Unknown provider "${newProvider}" for "${category}". Available: ${available}`);
          }
          process.exitCode = 1;
          return;
        }

        // Credential prompt
        const { io, close } = createReadlineIO();
        let credential: string;
        try {
          credential = await io.prompt(`${provDef.promptLabel}: `, "");
        } finally {
          close();
        }

        if (!credential) {
          console.error("Credential is required.");
          process.exitCode = 1;
          return;
        }

        // Capture previous state for rollback before swapping
        const { loadRegistry: loadIntRegSwap } = await import("../integrate/lifecycle.js");
        const intRegSwap = await loadIntRegSwap(ctx);
        const previousSwapIntegration = intRegSwap.integrations.find((i) => i.category === category);

        console.log(`Swapping ${category} provider to ${provDef.label}...`);
        const result = await swapIntegration(ctx, category, newProvider, credential, false);

        // Record evolve change
        await recordChange(ctx, {
          changeType: "integration_swap",
          target: category,
          previousState: `${category}/${result.oldProvider}`,
          newState: `${category}/${result.newProvider}`,
          rollbackSnapshotId: previousSwapIntegration
            ? JSON.stringify({ action: "swap", integration: previousSwapIntegration })
            : null,
          requiresRebuild: false,
        });

        console.log(`Integration "${category}" swapped: ${result.oldProvider} → ${result.newProvider}`);
        if (result.envVarsCleaned.length > 0) {
          console.log(`  Old credentials cleaned: ${result.envVarsCleaned.join(", ")}`);
        }
        if (result.egressDomainsRemoved.length > 0 || result.egressDomainsAdded.length > 0) {
          console.log(`  Egress domains removed: ${result.egressDomainsRemoved.join(", ") || "none"}`);
          console.log(`  Egress domains added: ${result.egressDomainsAdded.join(", ") || "none"}`);

          // Update egress firewall allowlist atomically
          const fwResult = await updateFirewallAllowlist(ctx);
          if (fwResult) {
            if (fwResult.success) {
              console.log(`  Firewall updated: ${fwResult.message}`);
            } else {
              console.log(`  Firewall update skipped: ${fwResult.message}`);
            }
          }
        }
        console.log("");
        console.log("TOOLS.md updated. Agent behavior unchanged — same category interface, new backend.");
      } catch (err: unknown) {
        if (err instanceof IntegrateError) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(`Swap failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
      }
    });

  return integrateCmd;
}
