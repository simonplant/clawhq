# configs/vendor/

Vendored third-party artifacts shipped into the Docker build context.

## Why vendored

These artifacts either (a) live in private repos and can't be fetched from
inside the Docker build, (b) need byte-for-byte reproducibility that floating
version specifiers don't guarantee, or (c) are small enough that the
convenience of a single `npm install` beats the ceremony of a release channel.

## llm-wiki

| Field | Value |
|---|---|
| Upstream | `simonplant/llm-wiki` (private) |
| File | `llm-wiki-0.1.0.tgz` |
| Pinned commit | `c90ecf8a9071ead3acabf759da6d0df927e07a43` |
| Built from | `/home/simon/dev/llm-wiki` |
| Regenerate | `cd /home/simon/dev/llm-wiki && git checkout <sha> && npm run build && npm pack --pack-destination=/home/simon/dev/clawhq/configs/vendor/` |

The tarball is installed globally inside the Stage 2 Docker image via
`npm install -g /opt/vendor/llm-wiki-*.tgz`. The CLI is then invokable
as `llm-wiki` on `PATH` inside the container.

### Upgrade procedure

1. `cd /home/simon/dev/llm-wiki && git pull && git rev-parse HEAD`
2. `npm run build && npm pack --pack-destination=/home/simon/dev/clawhq/configs/vendor/`
3. Delete the previous tarball if the version bumped.
4. Update `LLM_WIKI_COMMIT` in `src/build/docker/dockerfile.ts` to the new SHA.
5. Update the pinned-commit row above.
6. `clawhq build` to rebuild the image. `llm-wiki --version` inside the
   resulting container proves the install.

Don't edit the tarball by hand. If something's wrong, fix it upstream and
re-pack.
