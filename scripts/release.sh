#!/usr/bin/env bash
set -euo pipefail

# Usage: scripts/release.sh <major|minor|patch>
# Bumps version in package.json, commits, tags, and pushes.

if [ $# -ne 1 ]; then
  echo "Usage: $0 <major|minor|patch>" >&2
  exit 1
fi

BUMP="$1"

if [[ "$BUMP" != "major" && "$BUMP" != "minor" && "$BUMP" != "patch" ]]; then
  echo "Error: argument must be major, minor, or patch" >&2
  exit 1
fi

# Ensure working tree is clean
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: working tree is not clean. Commit or stash changes first." >&2
  exit 1
fi

# Bump version (npm version updates package.json, creates commit and tag)
VERSION=$(npm version "$BUMP" --no-git-tag-version)

git add package.json package-lock.json
git commit -m "release: ${VERSION}"
git tag "$VERSION"
git push --follow-tags
echo "Released ${VERSION}"
