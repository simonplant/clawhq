/**
 * `clawhq build` command — Build phase.
 */

import { resolve } from "node:path";

import chalk from "chalk";
import { Command } from "commander";

import {
  detectStage1Changes,
  formatDuration,
  formatSize,
  generateManifest,
  readManifest as readBuildManifest,
  readStage1Hash,
  twoStageBuild,
  verifyAgainstManifest,
  writeManifest as writeBuildManifest,
  writeStage1Hash,
} from "../build/docker/build.js";
import { DockerClient } from "../build/docker/client.js";

import { spinner, status } from "./ui.js";

/**
 * Create the `build` command.
 */
export function createBuildCommand(): Command {
  return new Command("build")
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
        const manifest = await readBuildManifest(manifestDir);
        if (!manifest) {
          console.error("No build manifest found. Run `clawhq build` first.");
          process.exitCode = 1;
          return;
        }
        const verifySpinner = spinner(`${chalk.blue("Build")} Verifying images against build manifest...`);
        verifySpinner.start();
        const result = await verifyAgainstManifest(client, manifest);
        if (result.match) {
          verifySpinner.succeed(`${chalk.blue("Build")} ${status.pass} All images match the build manifest`);
        } else {
          verifySpinner.fail(`${chalk.blue("Build")} ${status.fail} Drift detected (${result.drifts.length} difference${result.drifts.length > 1 ? "s" : ""})`);
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
      const buildSpinner = spinner(`${chalk.blue("Build")} Building container image...`);
      buildSpinner.start();

      const result = await twoStageBuild(client, {
        context: contextPath,
        baseTag: opts.baseTag,
        finalTag: opts.tag,
        dockerfile: opts.dockerfile,
        skipStage1,
      });

      buildSpinner.succeed(`${chalk.blue("Build")} ${status.pass} Container image built in ${formatDuration(result.totalDurationMs)}`);

      // Display results per stage
      if (result.stage1) {
        console.log(`  Stage 1: ${result.stage1.imageTag} built in ${formatDuration(result.stage1.durationMs)}`);
      }
      console.log(`  Stage 2: ${result.stage2.imageTag} built in ${formatDuration(result.stage2.durationMs)}`);

      // Generate and write build manifest
      const manifest = await generateManifest(client, {
        context: contextPath,
        baseTag: opts.baseTag,
        finalTag: opts.tag,
        dockerfile: opts.dockerfile,
        stage1Built: result.stage1 !== null,
      });
      const manifestPath = await writeBuildManifest(manifest, manifestDir);
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
}
