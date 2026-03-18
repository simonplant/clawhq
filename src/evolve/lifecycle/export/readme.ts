/**
 * README generator for export bundles.
 *
 * Creates a human-readable README explaining the bundle structure
 * and how to use it with raw OpenClaw (no ClawHQ dependency).
 */

import type { ExportManifest } from "./types.js";

/**
 * Generate README content for the export bundle.
 */
export function generateBundleReadme(manifest: ExportManifest): string {
  const fileList = manifest.files
    .map((f) => `- \`${f.path}\` (${formatBytes(f.size)})`)
    .join("\n");

  const flags: string[] = [];
  if (manifest.flags.maskPii) flags.push("PII masking applied");
  if (manifest.flags.noMemory) flags.push("Memory excluded (identity + config only)");
  const flagsNote = flags.length > 0
    ? `\n**Export flags:** ${flags.join(", ")}\n`
    : "";

  return `# ClawHQ Export Bundle

**Export ID:** ${manifest.exportId}
**Created:** ${manifest.timestamp}
**Files:** ${manifest.files.length}
**Total size:** ${formatBytes(manifest.totalSize)}
${flagsNote}
## Bundle Structure

${fileList}

## How to Use Without ClawHQ

This bundle is a portable snapshot of your OpenClaw agent. You can restore it
to a raw OpenClaw installation without needing ClawHQ.

### 1. Extract the bundle

\`\`\`bash
tar xzf ${manifest.exportId}.tar.gz
cd ${manifest.exportId}
\`\`\`

### 2. Copy config to OpenClaw home

\`\`\`bash
OPENCLAW_HOME=~/.openclaw

# Copy the main config
cp openclaw.json "$OPENCLAW_HOME/openclaw.json"

# Copy identity files
cp -r workspace/identity/ "$OPENCLAW_HOME/workspace/identity/"
${manifest.flags.noMemory ? "" : `
# Copy memory archive
cp -r workspace/memory/ "$OPENCLAW_HOME/workspace/memory/"
`}
# Copy cron definitions (if present)
[ -d cron ] && cp -r cron/ "$OPENCLAW_HOME/cron/"
\`\`\`

### 3. Restore your secrets

This export does **not** include secrets (.env file). You must recreate your
\`.env\` file with your API keys and credentials:

\`\`\`bash
cat > "$OPENCLAW_HOME/.env" << 'EOF'
# Add your API keys here
ANTHROPIC_API_KEY=your-key
OPENAI_API_KEY=your-key
# ... other credentials
EOF
chmod 600 "$OPENCLAW_HOME/.env"
\`\`\`

### 4. Start OpenClaw

\`\`\`bash
docker compose up -d
\`\`\`

## Integrity Verification

Each file in this bundle has a SHA-256 hash recorded in \`manifest.json\`.
To verify integrity:

\`\`\`bash
# Check a specific file
sha256sum workspace/identity/SYSTEM.md
# Compare with the hash in manifest.json
\`\`\`

## Notes

- **Secrets are redacted** from \`openclaw.json\`. Any fields containing API keys,
  tokens, or passwords show \`[REDACTED]\` and must be reconfigured via \`.env\`.
${manifest.flags.maskPii ? "- **PII has been masked** throughout the exported files.\n" : ""}- This bundle was created by ClawHQ but does not require ClawHQ to use.
  OpenClaw is the only dependency.
`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
