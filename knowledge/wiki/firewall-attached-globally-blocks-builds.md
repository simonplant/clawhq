---
title: Egress firewall attached globally to FORWARD blocks docker build and other host workloads
category: Decisions
status: fixed
date: 2026-05-11
tags: [firewall, iptables, docker, build, scope, openclaw, landmine]
---

# Egress firewall attached globally to FORWARD blocks docker build and other host workloads

## What breaks

`clawhq update` (and any other operation that does a `docker build`) fails
during `pnpm install` / `apt-get update` with `ConnectTimeoutError` to
public registries (npm, Cloudflare CDN, Docker Hub, Debian mirrors). The
host itself can reach the same destinations fine.

Symptom from a real failure:

```
#25 [build 12/19] RUN ... pnpm install --frozen-lockfile
#25 10.64 Error when performing the request to
       https://registry.npmjs.org/pnpm/-/pnpm-10.33.2.tgz
#25 10.64   ConnectTimeoutError: attempted addresses:
            104.16.4.34:443, 104.16.1.34:443, ..., timeout: 10000ms
```

Beyond builds: any unrelated container the user runs on the host
(`docker run alpine ...`) is also subject to the agent's egress
allowlist, with no indication why their network is broken.

## How to detect

Inspect the FORWARD chain — a global jump is the bug, a source-scoped
jump is the fix:

```bash
sudo iptables -S FORWARD | grep CLAWHQ_FWD

# Bad (global — affects every container on the host):
-A FORWARD -j CLAWHQ_FWD

# Good (scoped to the agent's compose network subnet):
-A FORWARD -s 172.28.0.0/16 -j CLAWHQ_FWD
```

Quick reproduction without trying to update:

```bash
docker run --rm alpine sh -c 'apk add --no-cache curl && curl -sS https://registry.npmjs.org/'
# Bad: hangs and times out
# Good: returns the npm registry root JSON
```

## Root cause

`applyFirewall` (in `src/build/launcher/firewall.ts`) installed the
forward jump as a global rule:

```
iptables -I FORWARD -j CLAWHQ_FWD
```

`FORWARD` policy is `DROP`, so every Docker-routed packet had to pass
the agent's allowlist — including build containers on `docker0`
(`172.17.0.0/16`) which have nothing to do with the agent's compose
network (`172.28.0.0/16`). The allowlist (`clawhq_egress` ipset) is
populated only from configured agent integrations, so npm, Cloudflare,
Docker Hub, Debian mirrors all fall to the trailing `LOG + DROP`.

The same bug also caused two ClawHQ instances on the same host to
accidentally filter each other through the wrong allowlist.

## Fix

Threaded a `forwardScopeCidr` option through `applyFirewall` →
`reconcileFamily` → `attachToForward`. The deploy launcher resolves the
agent's compose network via `docker network inspect`, reads its IPv4
subnet, and passes it down. Result:

```
iptables -I FORWARD -s 172.28.0.0/16 -j CLAWHQ_FWD
```

Cleanup was rewritten to enumerate live FORWARD jumps via `iptables -S`
and replay each as a `-D`, so the chain is removed regardless of what
shape it was attached with — handles upgrades cleanly.

If `docker network inspect` fails (network not yet up, unusual installs)
the firewall falls back to the legacy global attach — same as before, no
regression.

### Caveats

- **IPv6 attachment remains global.** No v6 subnet is pinned on the
  agent's compose network. If v6 is enabled on the bridge that's the
  next thing to scope.
- **The fix protects host workloads.** `docker0` traffic is no longer
  filtered by the agent's allowlist — that is the correct behavior
  (the agent network has its own attached chain and is still filtered),
  but a security review should confirm the threat model still holds for
  any sidecar containers users were unintentionally relying on this
  for.

## Verification

```bash
# Attachment is source-scoped:
sudo iptables -S FORWARD | grep CLAWHQ_FWD
# -A FORWARD -s 172.28.0.0/16 -j CLAWHQ_FWD

# Agent network is still filtered:
docker exec <agent-container> curl -sS --max-time 5 https://example.com
# Expected: blocked (not in allowlist)

# Other host workloads are unblocked:
docker run --rm alpine sh -c \
  'apk add --no-cache curl && curl -sS --max-time 5 https://registry.npmjs.org/ -o /dev/null -w "%{http_code}\n"'
# Expected: 200
```

## Provenance

Discovered while running `clawhq update --agent clawdius` from
v2026.4.21 → v2026.5.7 on 2026-05-11. The build timed out on `pnpm
install`; host could reach npm fine; FORWARD chain showed a global
jump.

Code change: `src/build/launcher/firewall.ts`,
`src/build/launcher/types.ts`, `src/build/launcher/deploy.ts`, plus new
tests in `src/build/launcher/firewall-attach.test.ts`.

Commits: `69db47a fix(firewall): source-scope CLAWHQ_FWD to agent
subnet`, `312f770 chore(lint): drop redundant init in
removeAllForwardJumps`.

## Related — design doc was stale

Before this fix, [[egress-firewall]] claimed the chain "attaches to the
Docker bridge interface (e.g., `openclaw0`) via a FORWARD rule, so it
governs inter-container traffic routed through the bridge." That was
aspirational — the actual attach was global. The page has been updated
to describe the source-scoped attach.

## See also

- [[egress-firewall]] — design and modes
- [[firewall-not-reapplied-after-network-recreate]] — different
  firewall landmine (lifecycle, not scope)
- [[two-stage-docker-build]] — the build that this bug broke
- [[threat-model]]
