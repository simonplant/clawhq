/**
 * `clawhq agent` command — manage agents in the deployment.
 */

import { Command } from "commander";

/**
 * Create the `agent` command group.
 */
export function createAgentCommand(): Command {
  const agentCmd = new Command("agent")
    .description("Manage agents in the deployment");

  agentCmd
    .command("add <id>")
    .description("Add a new agent to an existing deployment")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--config <path>", "Path to openclaw.json", "~/.openclaw/openclaw.json")
    .option("--channel <type>", "Channel type for binding (e.g. telegram)", "telegram")
    .option("--peer-id <id>", "Channel peer ID for routing")
    .action(async (
      agentId: string,
      opts: {
        home: string;
        config: string;
        channel: string;
        peerId?: string;
      },
    ) => {
      const { readFile, writeFile: writeFileFs, mkdir: mkdirFs } = await import("node:fs/promises");
      const { join } = await import("node:path");

      const homePath = opts.home.replace(/^~/, process.env.HOME ?? "~");
      const configPath = opts.config.replace(/^~/, process.env.HOME ?? "~");

      // Read existing openclaw.json
      let config: Record<string, unknown>;
      try {
        const raw = await readFile(configPath, "utf-8");
        config = JSON.parse(raw) as Record<string, unknown>;
      } catch (err: unknown) {
        console.error(`Cannot read ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
      }

      // Initialize agents section if not present
      const agents = (config["agents"] ?? {}) as Record<string, unknown>;
      const list = (agents["list"] ?? []) as Array<Record<string, unknown>>;
      const bindings = (agents["bindings"] ?? []) as Array<Record<string, unknown>>;

      // Check for duplicate
      if (list.some((a) => a["id"] === agentId)) {
        console.error(`Agent "${agentId}" already exists.`);
        process.exitCode = 1;
        return;
      }

      // If no default agent exists, make the first one default
      if (list.length === 0) {
        list.push({
          id: "default",
          default: true,
          workspace: "/home/node/.openclaw/workspace",
        });
      }

      // Create workspace for new agent
      const agentWorkspace = join(homePath, "agents", agentId, "agent", "workspace");
      await mkdirFs(agentWorkspace, { recursive: true });

      // Add new agent to list
      const containerWorkspace = `/home/node/.openclaw/agents/${agentId}/agent/workspace`;
      list.push({
        id: agentId,
        workspace: containerWorkspace,
      });

      // Add channel binding if peer ID provided
      if (opts.peerId) {
        bindings.push({
          agentId,
          match: {
            channel: opts.channel,
            peer: { kind: "direct", id: opts.peerId },
          },
        });
      }

      // Update config
      agents["list"] = list;
      agents["bindings"] = bindings;
      config["agents"] = agents;

      // Write updated config
      await writeFileFs(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

      // Generate basic identity files for the new agent
      const identityFiles: Record<string, string> = {
        "SOUL.md": `# SOUL.md — ${agentId}\n\n<!-- Define this agent's identity and values -->\n`,
        "USER.md": "# User Context\n\n<!-- Add details about yourself -->\n",
        "IDENTITY.md": `# IDENTITY.md\n\n**${agentId}** — an OpenClaw agent.\n`,
        "MEMORY.md": "# MEMORY.md\n\n## Active Situations\n\n## Lessons Learned\n\n## Patterns\n",
      };

      for (const [filename, content] of Object.entries(identityFiles)) {
        await writeFileFs(join(agentWorkspace, filename), content, "utf-8");
      }

      // Create memory directories
      for (const tier of ["memory/hot", "memory/warm", "memory/cold"]) {
        await mkdirFs(join(agentWorkspace, tier), { recursive: true });
      }

      console.log(`Agent "${agentId}" added.`);
      console.log(`  Workspace: ${agentWorkspace}`);
      console.log(`  Container path: ${containerWorkspace}`);
      if (opts.peerId) {
        console.log(`  Binding: ${opts.channel} peer ${opts.peerId}`);
      }
      console.log("");
      console.log("Next steps:");
      console.log(`  1. Edit ${join(agentWorkspace, "SOUL.md")} to define the agent's identity`);
      console.log("  2. Add a volume mount for the agent workspace to docker-compose.yml");
      if (!opts.peerId) {
        console.log("  3. Add a channel binding with --peer-id or edit openclaw.json");
      }
      console.log(`  ${opts.peerId ? "3" : "4"}. Run \`clawhq restart\` to apply changes`);
    });

  agentCmd
    .command("list")
    .description("List configured agents")
    .option("--config <path>", "Path to openclaw.json", "~/.openclaw/openclaw.json")
    .action(async (opts: { config: string }) => {
      const { readFile } = await import("node:fs/promises");
      const configPath = opts.config.replace(/^~/, process.env.HOME ?? "~");

      try {
        const raw = await readFile(configPath, "utf-8");
        const config = JSON.parse(raw) as Record<string, unknown>;
        const agents = (config["agents"] ?? {}) as Record<string, unknown>;
        const list = (agents["list"] ?? []) as Array<Record<string, unknown>>;
        const bindings = (agents["bindings"] ?? []) as Array<Record<string, unknown>>;

        if (list.length === 0) {
          console.log("Single-agent deployment (no agents.list configured).");
          return;
        }

        console.log("Agents:");
        for (const agent of list) {
          const isDefault = agent["default"] ? " (default)" : "";
          const binding = bindings.find((b) => b["agentId"] === agent["id"]);
          const bindingStr = binding
            ? ` -> ${(binding["match"] as Record<string, unknown>)["channel"]}`
            : "";
          console.log(`  ${agent["id"]}${isDefault}${bindingStr}`);
          console.log(`    workspace: ${agent["workspace"]}`);
        }
      } catch (err: unknown) {
        console.error(`Cannot read config: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    });

  return agentCmd;
}
