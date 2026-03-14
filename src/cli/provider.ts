/**
 * `clawhq provider` subcommand — add, list, remove, and test API providers.
 *
 * Manages provider credentials in .env, tracks provider configuration
 * in providers.json, and provides connectivity testing.
 */

import { createInterface } from "node:readline";

import { Command } from "commander";

import {
  addProvider,
  formatProviderTable,
  formatTestResult,
  KNOWN_PROVIDERS,
  listProviders,
  ProviderError,
  removeProvider,
  testProvider,
} from "../provider/index.js";

/**
 * Prompt for a secret value with masked input (no echo).
 */
async function promptMaskedInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    process.stdout.write(prompt);

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    let value = "";

    const onData = (key: Buffer): void => {
      const ch = key.toString("utf-8");

      if (ch === "\r" || ch === "\n") {
        if (stdin.isTTY) {
          stdin.setRawMode(wasRaw ?? false);
        }
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        rl.close();
        resolve(value);
        return;
      }

      if (ch === "\u0003") {
        if (stdin.isTTY) {
          stdin.setRawMode(wasRaw ?? false);
        }
        stdin.removeListener("data", onData);
        rl.close();
        process.exit(130);
        return;
      }

      if (ch === "\u007f" || ch === "\b") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.write("\b \b");
        }
        return;
      }

      value += ch;
      process.stdout.write("*");
    };

    stdin.on("data", onData);
  });
}

/**
 * Create the `provider` command group.
 */
export function createProviderCommand(): Command {
  const providerCmd = new Command("provider")
    .description("Manage API providers — add, list, remove, and test")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw");

  providerCmd
    .command("add <id>")
    .description("Add an API provider (prompts for API key, stores in .env, registers domains)")
    .option("--test", "Run connectivity test after adding")
    .action(async (id: string, opts: { test?: boolean }) => {
      const parentOpts = providerCmd.opts() as { home: string };
      const homeDir = parentOpts.home.replace(/^~/, process.env.HOME ?? "~");

      try {
        // Validate provider is known
        const known = KNOWN_PROVIDERS.find((p) => p.id === id);
        if (!known) {
          console.error(
            `Unknown provider "${id}". Known providers: ${KNOWN_PROVIDERS.map((p) => p.id).join(", ")}`,
          );
          process.exitCode = 1;
          return;
        }

        // Prompt for API key (skip for local providers like ollama)
        let apiKey = "";
        if (known.category === "local") {
          apiKey = known.envVar === "OLLAMA_HOST"
            ? "http://localhost:11434"
            : "";
        } else {
          apiKey = await promptMaskedInput(`Enter API key for ${known.label} (${known.envVar}): `);
          if (!apiKey) {
            console.error("No API key provided. Aborting.");
            process.exitCode = 1;
            return;
          }
        }

        const result = await addProvider(homeDir, id, apiKey);
        console.log(`Provider ${result.provider.label} added successfully`);
        console.log(`  Credential: ${result.provider.envVar} stored in .env`);

        if (result.domainsAdded.length > 0) {
          console.log(`  Firewall domains: ${result.domainsAdded.join(", ")}`);
          console.log(
            "\n  Tip: Run \"clawhq up\" to reapply the egress firewall with updated allowlist.",
          );
        }

        // Optional connectivity test
        if (opts.test) {
          console.log(`\nTesting ${known.label} connectivity...`);
          const testResult = await testProvider(homeDir, id);
          console.log(formatTestResult(testResult));
          if (testResult.status !== "valid") {
            process.exitCode = 1;
          }
        }
      } catch (err: unknown) {
        if (err instanceof ProviderError) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(
            `Failed to add provider: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        process.exitCode = 1;
      }
    });

  providerCmd
    .command("list", { isDefault: true })
    .description("List configured providers with status and domains")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const parentOpts = providerCmd.opts() as { home: string };
      const homeDir = parentOpts.home.replace(/^~/, process.env.HOME ?? "~");

      try {
        const providers = await listProviders(homeDir);

        if (opts.json) {
          console.log(JSON.stringify(providers, null, 2));
        } else {
          console.log(formatProviderTable(providers));
        }
      } catch (err: unknown) {
        console.error(
          `Failed to list providers: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  providerCmd
    .command("remove <id>")
    .description("Remove a provider — removes credential from .env and deregisters")
    .action(async (id: string) => {
      const parentOpts = providerCmd.opts() as { home: string };
      const homeDir = parentOpts.home.replace(/^~/, process.env.HOME ?? "~");

      try {
        const result = await removeProvider(homeDir, id);

        console.log(`Provider "${id}" removed`);
        if (result.credentialRemoved) {
          console.log("  Credential removed from .env");
        }
        if (result.domainsRemoved.length > 0) {
          console.log(`  Firewall domains to remove: ${result.domainsRemoved.join(", ")}`);
          console.log(
            "\n  Tip: Run \"clawhq up\" to reapply the egress firewall with tightened allowlist.",
          );
        }
      } catch (err: unknown) {
        if (err instanceof ProviderError) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(
            `Failed to remove provider: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        process.exitCode = 1;
      }
    });

  providerCmd
    .command("test [id]")
    .description("Test provider connectivity — verifies credential and network access")
    .option("--all", "Test all configured providers")
    .action(async (id: string | undefined, opts: { all?: boolean }) => {
      const parentOpts = providerCmd.opts() as { home: string };
      const homeDir = parentOpts.home.replace(/^~/, process.env.HOME ?? "~");

      try {
        if (opts.all || !id) {
          // Test all configured providers
          const providers = await listProviders(homeDir);
          if (providers.length === 0) {
            console.log("No providers configured. Use \"clawhq provider add <id>\" to add one.");
            return;
          }

          let hasFailure = false;
          for (const p of providers) {
            const result = await testProvider(homeDir, p.id);
            console.log(formatTestResult(result));
            if (result.status !== "valid") {
              hasFailure = true;
            }
          }

          if (hasFailure) {
            process.exitCode = 1;
          }
        } else {
          // Test a specific provider
          const result = await testProvider(homeDir, id);
          console.log(formatTestResult(result));
          if (result.status !== "valid") {
            process.exitCode = 1;
          }
        }
      } catch (err: unknown) {
        if (err instanceof ProviderError) {
          console.error(`Error: ${err.message}`);
        } else {
          console.error(
            `Failed to test provider: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        process.exitCode = 1;
      }
    });

  return providerCmd;
}
