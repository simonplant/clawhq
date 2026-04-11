# Compilation Path Unification Analysis

## Current State: Two Paths

### Composition Path (`src/design/catalog/compiler.ts`)
- Used by: `clawhq init --config <composition-file>`, `clawhq apply`
- Input: profile + personality + providers (from `clawhq.yaml`)
- Output: flat `CompiledFile[]` (path + content + mode)
- **Strengths**: Produces everything including docker-compose, proxy, static tool assets, ClawWall
- **Weaknesses**: No delegation rules, no blueprint validation

### Blueprint Path (`src/design/configure/generate.ts`)
- Used by: `clawhq init --guided`, `clawhq init --smart`, `clawhq init --config <blueprint-file>`
- Input: Blueprint YAML + WizardAnswers
- Output: structured `DeploymentBundle` (typed objects) → needs `bundleToFiles()` to flatten
- **Strengths**: Blueprint validation (70+ checks), delegation rules, personality tensions
- **Weaknesses**: No docker-compose, no static tool assets, no ClawWall in output

## Recommendation

**Make the composition path the primary path. Blueprints compile down to compositions.**

### Step 1: `clawhq init --guided` produces a `clawhq.yaml`
The wizard collects: profile, personality, providers, user context.
Output: writes `clawhq.yaml` with composition config.
Then calls: `clawhq apply` to generate all files.

### Step 2: Blueprints become composition presets
A blueprint YAML maps to: profile + personality + providers + customization.
`clawhq init --blueprint email-manager` → resolves to profile=life-ops, personality=digital-assistant, providers={email: gmail, ...} → writes clawhq.yaml → apply.

### Step 3: Remove `bundleToFiles()` and `generateBundle()`
Once all paths go through composition → apply, the blueprint path's bundle generation is unused.
Keep blueprint YAML validation (70+ checks) as a separate validation step.

## Migration Risk
- Blueprint users who rely on the guided wizard need migration
- Delegation rules need to be added to the composition compiler
- Personality tensions need to be supported (or dropped per user feedback)

## Decision Needed
This is an architectural change that affects how users interact with ClawHQ. The user should decide whether to prioritize this or continue building features on both paths.
