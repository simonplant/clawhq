/**
 * CLI command: clawhq role — manage agent personality and role presets.
 *
 * Subcommands:
 * - role list:      Show available role presets
 * - role set:       Apply a preset to IDENTITY.md (shows diff before applying)
 * - role customize: Interactive editing of IDENTITY.md role section
 * - role show:      Show current role configuration from IDENTITY.md
 */

import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import chalk from "chalk";
import { Command } from "commander";

import { createReadlineIO } from "../init/index.js";
import {
  applyRoleToIdentity,
  generateRoleSection,
  parseRoleSection,
  PRESET_IDS,
  ROLE_PRESETS,
} from "../role/presets.js";

import { status } from "./ui.js";

function resolveHome(home: string): string {
  return home.replace(/^~/, process.env.HOME ?? "~");
}

function identityPath(home: string): string {
  return join(resolveHome(home), "workspace", "IDENTITY.md");
}

/**
 * Verify that IDENTITY.md is mounted read-only in docker-compose.yml.
 */
async function verifyReadOnlyMount(home: string): Promise<{ ok: boolean; message: string }> {
  const composePath = join(resolveHome(home), "docker-compose.yml");

  try {
    const content = await readFile(composePath, "utf-8");

    // Check for identity file volume mounts with :ro flag
    const hasIdentityVolume = content.includes("workspace") && content.includes("IDENTITY.md");
    const hasReadOnlyWorkspace = content.includes("workspace") && content.includes(":ro");

    // The workspace itself or identity files should be read-only mounted
    if (hasIdentityVolume) {
      if (content.includes("IDENTITY.md:ro") || content.includes("IDENTITY.md\":ro")) {
        return { ok: true, message: "IDENTITY.md mount is read-only" };
      }
      return {
        ok: false,
        message: "IDENTITY.md is mounted but not read-only. Add ':ro' to the volume mount in docker-compose.yml",
      };
    }

    // If workspace is mounted read-only, identity files are implicitly protected
    if (hasReadOnlyWorkspace) {
      return { ok: true, message: "Workspace mount is read-only — identity files are protected" };
    }

    // Workspace mount exists but not read-only — warn
    if (content.includes("workspace")) {
      return {
        ok: false,
        message: "Workspace is mounted read-write. Identity files can be modified by the agent at runtime. Consider adding ':ro' to workspace volume mount or mounting identity files separately with ':ro'",
      };
    }

    return { ok: true, message: "No workspace volume mount found (standalone mode)" };
  } catch {
    return { ok: true, message: "No docker-compose.yml found (not yet deployed)" };
  }
}

/**
 * Generate a unified diff between two strings.
 */
function generateDiff(oldContent: string, newContent: string, filename: string): string {
  const lines: string[] = [];

  lines.push(chalk.bold(`--- a/${filename}`));
  lines.push(chalk.bold(`+++ b/${filename}`));

  // Show the role section diff specifically
  const oldRole = parseRoleSection(oldContent);
  const newRole = parseRoleSection(newContent);

  if (oldRole || newRole) {
    const oldRoleLines = oldRole ? oldRole.section.split("\n") : [];
    const newRoleLines = newRole ? newRole.section.split("\n") : [];

    lines.push(chalk.cyan("@@ Role Section @@"));

    for (const line of oldRoleLines) {
      if (!newRoleLines.includes(line)) {
        lines.push(chalk.red(`- ${line}`));
      }
    }
    for (const line of newRoleLines) {
      if (!oldRoleLines.includes(line)) {
        lines.push(chalk.green(`+ ${line}`));
      } else {
        lines.push(`  ${line}`);
      }
    }
  }

  return lines.join("\n");
}

export function createRoleCommand(): Command {
  const roleCmd = new Command("role")
    .description("Manage agent personality — set role presets, customize identity")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw");

  // --- role list ---
  roleCmd
    .command("list", { isDefault: true })
    .description("List available role presets")
    .action(() => {
      console.log(chalk.bold("\nAvailable Role Presets\n"));

      for (const id of PRESET_IDS) {
        const preset = ROLE_PRESETS[id];
        console.log(`  ${chalk.cyan(id)}`);
        console.log(`    ${preset.description}`);
        console.log(`    Tone: ${preset.tone} | Formality: ${preset.formality} | Proactivity: ${preset.proactivity}`);
        console.log("");
      }

      console.log(`Use ${chalk.yellow("clawhq role set <preset>")} to apply a preset.`);
      console.log(`Use ${chalk.yellow("clawhq role customize")} for interactive editing.`);
      console.log("");
    });

  // --- role set <preset> ---
  roleCmd
    .command("set <preset>")
    .description("Apply a role preset to IDENTITY.md")
    .option("--force", "Skip confirmation prompt")
    .action(async (presetId: string, opts: { force?: boolean }) => {
      const parentOpts = roleCmd.opts() as { home: string };

      const preset = ROLE_PRESETS[presetId];
      if (!preset) {
        console.error(`${status.fail} Unknown preset: "${presetId}"`);
        console.error(`Available presets: ${PRESET_IDS.join(", ")}`);
        process.exitCode = 1;
        return;
      }

      const filePath = identityPath(parentOpts.home);

      let currentContent: string;
      try {
        currentContent = await readFile(filePath, "utf-8");
      } catch {
        console.error(`${status.fail} IDENTITY.md not found at ${filePath}`);
        console.error("Run `clawhq init` first to generate identity files.");
        process.exitCode = 1;
        return;
      }

      const newContent = applyRoleToIdentity(currentContent, preset);

      if (currentContent === newContent) {
        console.log(`${status.pass} IDENTITY.md already has the "${preset.name}" role applied.`);
        return;
      }

      // Show diff
      console.log(chalk.bold(`\nApplying role preset: ${preset.name}\n`));
      console.log(generateDiff(currentContent, newContent, "IDENTITY.md"));
      console.log("");

      // Confirmation gate
      if (!opts.force) {
        const { io, close } = createReadlineIO();
        try {
          const answer = await io.prompt("Apply this role? (yes/no): ");
          if (answer.toLowerCase() !== "yes" && answer.toLowerCase() !== "y") {
            console.log("Cancelled.");
            return;
          }
        } finally {
          close();
        }
      }

      await writeFile(filePath, newContent, "utf-8");
      console.log(`${status.pass} Role "${preset.name}" applied to IDENTITY.md`);

      // Verify read-only mount
      const mountCheck = await verifyReadOnlyMount(parentOpts.home);
      if (!mountCheck.ok) {
        console.log(`${status.warn} ${mountCheck.message}`);
      } else {
        console.log(`${status.pass} ${mountCheck.message}`);
      }
    });

  // --- role customize ---
  roleCmd
    .command("customize")
    .description("Interactively customize the role section of IDENTITY.md")
    .action(async () => {
      const parentOpts = roleCmd.opts() as { home: string };
      const filePath = identityPath(parentOpts.home);

      let currentContent: string;
      try {
        currentContent = await readFile(filePath, "utf-8");
      } catch {
        console.error(`${status.fail} IDENTITY.md not found at ${filePath}`);
        console.error("Run `clawhq init` first to generate identity files.");
        process.exitCode = 1;
        return;
      }

      // Extract or create role section for editing
      const existingRole = parseRoleSection(currentContent);
      const editContent = existingRole
        ? existingRole.section
        : generateRoleSection(ROLE_PRESETS["companion"]);

      // Write role section to temp file for editing
      const tmpFile = join(tmpdir(), `clawhq-role-${Date.now()}.md`);
      await writeFile(tmpFile, editContent, "utf-8");

      const editor = process.env.EDITOR ?? process.env.VISUAL ?? "vi";

      console.log(chalk.bold("\nOpening role section in editor...\n"));
      console.log(`Editor: ${editor}`);
      console.log(`File: ${tmpFile}`);
      console.log("");

      try {
        execSync(`${editor} "${tmpFile}"`, { stdio: "inherit" });
      } catch {
        console.error(`${status.fail} Editor exited with an error.`);
        process.exitCode = 1;
        return;
      }

      // Read edited content
      const editedSection = await readFile(tmpFile, "utf-8");

      // Clean up temp file
      try {
        const { unlink } = await import("node:fs/promises");
        await unlink(tmpFile);
      } catch {
        // ignore cleanup errors
      }

      if (editedSection.trim() === editContent.trim()) {
        console.log("No changes made.");
        return;
      }

      // Build new IDENTITY.md with edited role section
      let newContent: string;
      if (existingRole) {
        const before = currentContent.slice(0, existingRole.start);
        const after = currentContent.slice(existingRole.end);
        newContent = before + editedSection.trimEnd() + "\n" + after;
      } else {
        newContent = currentContent.trimEnd() + "\n\n" + editedSection;
      }

      // Ensure manual customizations marker exists for preservation
      if (!newContent.includes("## Manual Customizations")) {
        newContent = newContent.trimEnd() + "\n\n## Manual Customizations\n\n<!-- Add your manual tweaks below this line. They will be preserved when role presets are re-applied. -->\n";
      }

      // Show diff
      console.log(chalk.bold("\nChanges to apply:\n"));
      console.log(generateDiff(currentContent, newContent, "IDENTITY.md"));
      console.log("");

      const { io, close } = createReadlineIO();
      try {
        const answer = await io.prompt("Apply these changes? (yes/no): ");
        if (answer.toLowerCase() !== "yes" && answer.toLowerCase() !== "y") {
          console.log("Cancelled.");
          return;
        }
      } finally {
        close();
      }

      await writeFile(filePath, newContent, "utf-8");
      console.log(`${status.pass} IDENTITY.md updated with custom role configuration.`);

      // Verify read-only mount
      const mountCheck = await verifyReadOnlyMount(parentOpts.home);
      if (!mountCheck.ok) {
        console.log(`${status.warn} ${mountCheck.message}`);
      } else {
        console.log(`${status.pass} ${mountCheck.message}`);
      }
    });

  // --- role show ---
  roleCmd
    .command("show")
    .description("Show current role configuration from IDENTITY.md")
    .action(async () => {
      const parentOpts = roleCmd.opts() as { home: string };
      const filePath = identityPath(parentOpts.home);

      let content: string;
      try {
        content = await readFile(filePath, "utf-8");
      } catch {
        console.error(`${status.fail} IDENTITY.md not found at ${filePath}`);
        console.error("Run `clawhq init` first to generate identity files.");
        process.exitCode = 1;
        return;
      }

      const role = parseRoleSection(content);
      if (!role) {
        console.log("No role section found in IDENTITY.md.");
        console.log(`Use ${chalk.yellow("clawhq role set <preset>")} to apply a preset.`);
        return;
      }

      console.log("");
      console.log(role.section);

      // Verify read-only mount
      const mountCheck = await verifyReadOnlyMount(parentOpts.home);
      if (!mountCheck.ok) {
        console.log(`${status.warn} ${mountCheck.message}`);
      }
    });

  return roleCmd;
}
