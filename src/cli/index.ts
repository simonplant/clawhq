#!/usr/bin/env node

import { createRequire } from "node:module";
import { resolve } from "node:path";

import { Command } from "commander";

import {
  detectStage1Changes,
  formatDuration,
  formatSize,
  generateManifest,
  readManifest,
  readStage1Hash,
  twoStageBuild,
  verifyAgainstManifest,
  writeManifest,
  writeStage1Hash,
} from "../docker/build.js";
import { DockerClient } from "../docker/client.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string; description: string };

const program = new Command();

program
  .name("clawhq")
  .description(pkg.description)
  .version(pkg.version, "-v, --version", "Print version");

// Version subcommand
program
  .command("version")
  .description("Print version info")
  .action(() => {
    console.log(`clawhq v${pkg.version}`);
  });

// Plan phase
program.command("init").description("Initialize a new agent deployment");
program.command("template").description("Manage agent templates");

// Build phase
program
  .command("build")
  .description("Build agent container image (two-stage Docker build)")
  .option("--context <path>", "OpenClaw source directory", ".")
  .option("--dockerfile <path>", "Dockerfile path (relative to context)")
  .option("--base-tag <tag>", "Stage 1 base image tag", "openclaw:local")
  .option("--tag <tag>", "Stage 2 final image tag", "openclaw:custom")
  .option("--stage2-only", "Skip Stage 1 base image rebuild")
  .option("--verify", "Compare current images against build manifest")
  .option("--manifest-dir <path>", "Directory for build manifest", ".")
  .action(async (opts: {
    context: string;
    dockerfile?: string;
    baseTag: string;
    tag: string;
    stage2Only?: boolean;
    verify?: boolean;
    manifestDir: string;
  }) => {
    const client = new DockerClient();
    const contextPath = resolve(opts.context);
    const manifestDir = resolve(opts.manifestDir);

    // --verify mode: compare images against manifest and exit
    if (opts.verify) {
      const manifest = await readManifest(manifestDir);
      if (!manifest) {
        console.error("No build manifest found. Run `clawhq build` first.");
        process.exitCode = 1;
        return;
      }
      console.log("Verifying images against build manifest...");
      const result = await verifyAgainstManifest(client, manifest);
      if (result.match) {
        console.log("All images match the build manifest.");
      } else {
        console.log(`Drift detected (${result.drifts.length} difference${result.drifts.length > 1 ? "s" : ""}):`);
        for (const drift of result.drifts) {
          console.log(`  Stage ${drift.stage} ${drift.field}: expected ${drift.expected}, got ${drift.actual}`);
        }
        process.exitCode = 1;
      }
      return;
    }

    // Detect Stage 1 changes for smart skipping
    let skipStage1 = opts.stage2Only ?? false;
    if (!skipStage1) {
      const lastHash = await readStage1Hash(manifestDir);
      const detection = await detectStage1Changes(contextPath, {
        dockerfile: opts.dockerfile,
        lastInputHash: lastHash ?? undefined,
      });
      if (!detection.changed && (await client.imageExists(opts.baseTag))) {
        console.log("Stage 1: No changes detected, skipping base image rebuild.");
        skipStage1 = true;
      }
    }

    if (opts.stage2Only) {
      console.log("Stage 1: Skipped (--stage2-only)");
    }

    // Run the build
    console.log(`Building from ${contextPath}...`);
    const result = await twoStageBuild(client, {
      context: contextPath,
      baseTag: opts.baseTag,
      finalTag: opts.tag,
      dockerfile: opts.dockerfile,
      skipStage1,
    });

    // Display results per stage
    if (result.stage1) {
      console.log(`Stage 1: ${result.stage1.imageTag} built in ${formatDuration(result.stage1.durationMs)}`);
    }
    console.log(`Stage 2: ${result.stage2.imageTag} built in ${formatDuration(result.stage2.durationMs)}`);
    console.log(`Total build time: ${formatDuration(result.totalDurationMs)}`);

    // Generate and write build manifest
    const manifest = await generateManifest(client, {
      context: contextPath,
      baseTag: opts.baseTag,
      finalTag: opts.tag,
      dockerfile: opts.dockerfile,
      stage1Built: result.stage1 !== null,
    });
    const manifestPath = await writeManifest(manifest, manifestDir);
    console.log(`Build manifest: ${manifestPath}`);

    // Print image sizes from manifest
    if (manifest.stage1) {
      console.log(`  Stage 1: ${formatSize(manifest.stage1.size)} (${manifest.stage1.layers.length} layers)`);
    }
    console.log(`  Stage 2: ${formatSize(manifest.stage2.size)} (${manifest.stage2.layers.length} layers)`);

    // Save Stage 1 input hash for change detection
    const detection = await detectStage1Changes(contextPath, { dockerfile: opts.dockerfile });
    await writeStage1Hash(manifestDir, detection.inputHash);
  });

// Secure phase
program.command("scan").description("Scan for PII and leaked secrets");
program.command("creds").description("Check credential health");
program.command("audit").description("View audit logs");

// Deploy phase
program.command("up").description("Deploy agent container");
program.command("down").description("Stop agent container");
program.command("restart").description("Restart agent container");
program.command("connect").description("Connect messaging channel");

// Operate phase
program.command("doctor").description("Run preventive diagnostics");
program.command("status").description("Show agent status dashboard");
program.command("backup").description("Create encrypted backup");
program.command("update").description("Update OpenClaw upstream");
program.command("logs").description("Stream agent logs");

// Evolve phase
program.command("evolve").description("Manage agent capabilities");

// Decommission phase
program.command("export").description("Export portable agent bundle");
program.command("destroy").description("Verified agent destruction");

program.parse();

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
