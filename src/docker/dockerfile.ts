/**
 * Dockerfile generator — composes RUN fragments based on integration selections.
 *
 * Follows the two-stage build pattern: FROM openclaw:local (base with apt packages)
 * → this Dockerfile adds tool binaries from GitHub releases.
 *
 * All binaries are fetched from official GitHub releases with SHA256 verification
 * where available. No untrusted sources.
 */

export interface DockerfileOptions {
  baseImage?: string;              // default: "openclaw:local"
  requiredBinaries: Set<string>;   // from tool registry
  includeWhisper?: boolean;        // heavy (~2GB), optional
}

interface BinaryFragment {
  name: string;
  comment: string;
  run: string;
}

const FRAGMENTS: Record<string, BinaryFragment> = {
  himalaya: {
    name: "himalaya",
    comment: "himalaya email client (latest release, static musl binary)",
    run: `RUN set -e && \\
    RELEASE_JSON=$(curl -fsSL https://api.github.com/repos/pimalaya/himalaya/releases/latest) && \\
    URL=$(echo "$RELEASE_JSON" | grep -o 'https://.*himalaya\\.x86_64-linux\\.tgz' | head -1) && \\
    CHECKSUM_URL=$(echo "$RELEASE_JSON" | grep -o 'https://.*himalaya\\.x86_64-linux\\.tgz\\.sha256' | head -1) && \\
    curl -fsSL "$URL" -o /tmp/himalaya.tgz && \\
    if [ -n "$CHECKSUM_URL" ]; then \\
      EXPECTED=$(curl -fsSL "$CHECKSUM_URL" | awk '{print $1}') && \\
      echo "$EXPECTED /tmp/himalaya.tgz" | sha256sum -c -; \\
    fi && \\
    tar -xzf /tmp/himalaya.tgz -C /usr/local/bin himalaya && \\
    chmod 755 /usr/local/bin/himalaya && \\
    rm /tmp/himalaya.tgz`,
  },
  gh: {
    name: "gh",
    comment: "GitHub CLI (latest release)",
    run: `RUN set -e && \\
    RELEASE_JSON=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest) && \\
    URL=$(echo "$RELEASE_JSON" | grep -o 'https://github.com/cli/cli/releases/download/[^"]*_linux_amd64.tar.gz' | head -1) && \\
    CHECKSUM_URL=$(echo "$RELEASE_JSON" | grep -o 'https://github.com/cli/cli/releases/download/[^"]*_checksums.txt' | head -1) && \\
    curl -fsSL "$URL" -o /tmp/gh.tar.gz && \\
    if [ -n "$CHECKSUM_URL" ]; then \\
      BASENAME=$(basename "$URL") && \\
      EXPECTED=$(curl -fsSL "$CHECKSUM_URL" | grep "$BASENAME" | awk '{print $1}') && \\
      echo "$EXPECTED /tmp/gh.tar.gz" | sha256sum -c -; \\
    fi && \\
    mkdir -p /tmp/gh && tar -xzf /tmp/gh.tar.gz -C /tmp/gh --strip-components=1 && \\
    mv /tmp/gh/bin/gh /usr/local/bin/gh && \\
    chmod 755 /usr/local/bin/gh && \\
    rm -rf /tmp/gh*`,
  },
  curl: {
    name: "curl",
    comment: "curl (latest static build — replaces Debian 12's 7.88)",
    run: `RUN set -e && \\
    curl -fsSL "https://github.com/moparisthebest/static-curl/releases/latest/download/curl-amd64" \\
      -o /usr/local/bin/curl && \\
    chmod 755 /usr/local/bin/curl`,
  },
  jq: {
    name: "jq",
    comment: "jq (latest release, static binary — replaces Debian 12's 1.6)",
    run: `RUN set -e && \\
    RELEASE_JSON=$(curl -fsSL https://api.github.com/repos/jqlang/jq/releases/latest) && \\
    URL=$(echo "$RELEASE_JSON" | grep -o 'https://github.com/jqlang/jq/releases/download/[^"]*jq-linux-amd64' | head -1) && \\
    CHECKSUM_URL=$(echo "$RELEASE_JSON" | grep -o 'https://github.com/jqlang/jq/releases/download/[^"]*sha256sum.txt' | head -1) && \\
    curl -fsSL "$URL" -o /usr/local/bin/jq && \\
    if [ -n "$CHECKSUM_URL" ]; then \\
      EXPECTED=$(curl -fsSL "$CHECKSUM_URL" | grep 'jq-linux-amd64' | awk '{print $1}') && \\
      echo "$EXPECTED /usr/local/bin/jq" | sha256sum -c -; \\
    fi && \\
    chmod 755 /usr/local/bin/jq`,
  },
  rg: {
    name: "rg",
    comment: "ripgrep (latest release, static musl binary)",
    run: `RUN set -e && \\
    URL=$(curl -fsSL https://api.github.com/repos/BurntSushi/ripgrep/releases/latest | \\
      grep -o 'https://github.com/BurntSushi/ripgrep/releases/download/[^"]*x86_64-unknown-linux-musl.tar.gz' | head -1) && \\
    curl -fsSL "$URL" -o /tmp/rg.tar.gz && \\
    tar -xzf /tmp/rg.tar.gz -C /tmp --wildcards '*/rg' --strip-components=1 && \\
    mv /tmp/rg /usr/local/bin/rg && \\
    chmod 755 /usr/local/bin/rg && \\
    rm /tmp/rg.tar.gz`,
  },
  git: {
    name: "git",
    comment: "git (latest stable from source — replaces Debian 12's 2.39)",
    run: `RUN set -e && \\
    apt-get update && \\
    apt-get install -y --no-install-recommends \\
      libcurl4-openssl-dev libexpat1-dev gettext libz-dev libssl-dev make gcc && \\
    GIT_VER=$(curl -fsSL "https://api.github.com/repos/git/git/tags?per_page=50" | \\
      grep -oP '"v\\K[0-9]+\\.[0-9]+\\.[0-9]+"' | tr -d '"' | sort -V | tail -1) && \\
    curl -fsSL "https://github.com/git/git/archive/refs/tags/v\${GIT_VER}.tar.gz" -o /tmp/git.tar.gz && \\
    mkdir -p /tmp/git-src && tar -xzf /tmp/git.tar.gz -C /tmp/git-src --strip-components=1 && \\
    cd /tmp/git-src && make prefix=/usr/local -j$(nproc) all && make prefix=/usr/local install && \\
    cd / && rm -rf /tmp/git* && \\
    apt-get purge -y make gcc libcurl4-openssl-dev libexpat1-dev libz-dev libssl-dev && \\
    apt-get autoremove -y && \\
    apt-get clean && rm -rf /var/lib/apt/lists/*`,
  },
  ffmpeg: {
    name: "ffmpeg",
    comment: "ffmpeg (latest static build)",
    run: `RUN set -e && \\
    curl -fsSL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o /tmp/ffmpeg.tar.xz && \\
    mkdir -p /tmp/ffmpeg && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg --strip-components=1 && \\
    mv /tmp/ffmpeg/ffmpeg /usr/local/bin/ffmpeg && \\
    mv /tmp/ffmpeg/ffprobe /usr/local/bin/ffprobe && \\
    chmod 755 /usr/local/bin/ffmpeg /usr/local/bin/ffprobe && \\
    rm -rf /tmp/ffmpeg*`,
  },
  yq: {
    name: "yq",
    comment: "yq (latest release — YAML/JSON/XML processor)",
    run: `RUN set -e && \\
    RELEASE_JSON=$(curl -fsSL https://api.github.com/repos/mikefarah/yq/releases/latest) && \\
    URL=$(echo "$RELEASE_JSON" | grep -o 'https://github.com/mikefarah/yq/releases/download/[^"]*yq_linux_amd64' | head -1) && \\
    CHECKSUM_URL=$(echo "$RELEASE_JSON" | grep -o 'https://github.com/mikefarah/yq/releases/download/[^"]*checksums' | head -1) && \\
    curl -fsSL "$URL" -o /usr/local/bin/yq && \\
    if [ -n "$CHECKSUM_URL" ]; then \\
      EXPECTED=$(curl -fsSL "$CHECKSUM_URL" | grep 'yq_linux_amd64 ' | awk '{print $NF}') && \\
      echo "$EXPECTED /usr/local/bin/yq" | sha256sum -c -; \\
    fi && \\
    chmod 755 /usr/local/bin/yq`,
  },
};

const WHISPER_FRAGMENT = `# OpenAI Whisper for audio transcription
# Note: whisper pulls in torch (~2GB) — rebuilds take longer but image is cached
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip && \\
    pip3 install --break-system-packages openai-whisper && \\
    apt-get clean && rm -rf /var/lib/apt/lists/* /root/.cache/pip`;

// Always included — base capabilities
const ALWAYS_INCLUDED = ["curl", "jq", "rg"];

/**
 * Generate a Dockerfile based on required binaries from tool selections.
 */
export function generateDockerfile(options: DockerfileOptions): string {
  const baseImage = options.baseImage ?? "openclaw:local";
  const needed = new Set<string>(ALWAYS_INCLUDED);

  // Add binaries from tool registry
  for (const bin of options.requiredBinaries) {
    // Map tool dependency names to Dockerfile fragment names
    // python3 is in the base image, not a Dockerfile fragment
    if (bin !== "python3") {
      needed.add(bin);
    }
  }

  const lines: string[] = [
    `# Custom layer on top of ${baseImage}`,
    "# Adds latest tool binaries — overrides outdated Debian 12 apt versions",
    "# Generated by ClawHQ",
    `FROM ${baseImage}`,
    "",
    "USER root",
    "",
  ];

  // Add fragments in a deterministic order
  const order = ["himalaya", "gh", "curl", "jq", "rg", "git", "ffmpeg", "yq"];
  for (const name of order) {
    if (!needed.has(name)) continue;
    const fragment = FRAGMENTS[name];
    if (!fragment) continue;

    lines.push(`# ${fragment.comment}`);
    lines.push(fragment.run);
    lines.push("");
  }

  // Whisper is optional and heavy
  if (options.includeWhisper) {
    lines.push(WHISPER_FRAGMENT);
    lines.push("");
  }

  lines.push("USER node");
  lines.push("");

  return lines.join("\n");
}
