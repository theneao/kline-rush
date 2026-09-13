---
version: 0.12.0
name: higgsfield-game-generation
description: |
  Game ART and AUDIO with the Higgsfield CLI: sprites, spritesheets, tileable
  textures and PBR maps, animated 3D characters, procedural rigs, music, SFX
  and voice — plus the design system that keeps one visual language across all
  of them.
  Use when: "create game assets", "make a spritesheet", "generate a tileable
  texture", "animate a 3D game character", "make music/SFX for my game", or
  "design the look of my game".
  BUILDING the game — the code, the deploy, the public URL — is
  higgsfield-websites (`higgsfield website create --type game`); this skill
  makes what goes IN it and is normally chained with it.
  NOT for: ordinary image/video generation (higgsfield-generate), game
  trailers, or native mobile/desktop builds.
argument-hint: "[asset or design request] [reference files]"
allowed-tools: Bash
---

# Higgsfield Game Generation — art, audio, and the design system

Produce the assets a game is made of, in ONE coherent visual language: sprites,
spritesheets, textures, animated 3D models, procedural rigs, music, SFX and
voice.

**This skill does not build or deploy the game.** Games are built on the
websites pipeline — `higgsfield website create --type game`, then
`higgsfield website deploy` — and that flow is owned by the
**higgsfield-websites** skill, under its game flow. The game's own
scaffold ships `app/AGENTS.md`, which is the authoritative contract for the
code.

The two chain naturally: design and generate the assets here, drop them into
the game's `app/public/`, and build there.

## Bootstrap

Before work begins:

1. If `higgsfield` is unavailable, install it:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/higgsfield-ai/cli/main/install.sh | sh
   ```
2. If `higgsfield account status` reports an expired or missing session, ask the user to run `higgsfield auth login`, then continue after confirmation.
3. Locate this installed skill directory and set it explicitly:
   ```bash
   export GAME_SKILL="/absolute/path/to/higgsfield-game-generation"
   test -f "$GAME_SKILL/scripts/pipeline.py"
   python3 "$GAME_SKILL/scripts/pipeline.py" --help
   ```
   Never recreate bundled scripts from memory.

## Route the request

- **Full playable game** — the BUILD belongs to higgsfield-websites
  (`higgsfield website create --type game`). Do the design + asset work
  below, then hand the assets to that flow. Do not try to deploy from here.
- **Assets only** — read `references/stylization.md`, then the matching asset reference. Do not deploy a game.
- **Design only** — read `references/game-design-system.md`; return the requested design artifact and asset manifest.
- **Existing game iteration** — regenerate only the assets that change, keeping
  the established STYLE FORMULA so new art matches what is already there. The
  rebuild and redeploy happen in the game's own repo (`higgsfield website
  deploy`).
- **Trailer or promotional video** — use `higgsfield-generate`, not this skill.
- **Native mobile/desktop/console runtime** — explain that this skill ships browser games; offer a web build unless the user supplied another toolchain.

## Asset workflow

### 1. Plan

Read `references/game-design-system.md` first and in full. Resolve the game profile, delivery context, core loop, win/lose/restart behavior, performance budgets, input methods, and language handling.

Create `design/assets.csv` with one row per visual or audio asset:

```csv
id,role,type,description,size/ratio,style line ref,source
```

Read `references/stylization.md` before producing any visual, including procedural canvas art. Derive one STYLE FORMULA and insert it byte-for-byte into every visual prompt. If the brief already fixes the style, state the formula and continue. If several materially different styles fit, show concise options and wait for selection.

No game code or generated visual should exist before the manifest and STYLE FORMULA.

### 2. Generate the assets

Start independent generation jobs together, then write the game while those jobs run. Inspect every model contract before first use:

```bash
higgsfield model list --json
higgsfield model get <job_type>
higgsfield generate create <job_type> ... --wait --json
```

Media flags accept local paths or prior upload/job IDs. Keep job JSON in project files when chaining; do not dump IDs into the user-facing reply.

Read the reference matching each manifest row:

| Asset | Required reference |
|---|---|
| Static sprites, backgrounds, UI | `references/stylization.md` |
| Spritesheets / 2D animation | `references/2d-animation.md` |
| Repeating ground, walls, tiles, PBR maps | `references/textures.md` |
| Any 3D model or animation | `references/3d-animation.md` |
| Music, SFX, voice | `references/audio.md` |

For 3D animation selection:

```bash
higgsfield preset list animation-action --query walk --json
higgsfield preset list animation-action --group Fighting --category Punching --json
```

When multiple actions fit, show their preview URLs and let the user choose. Pass the chosen integer as `--animation_action_id` only after checking the target model schema.

Generation failures get at most two retries. After that, use the best valid result and compensate in code, or amend the manifest honestly.

### 3. Hand off

Put the finished assets in the game repo's `app/public/` and keep
`design/assets.csv` alongside them, so the manifest travels with the game.

Building, running and deploying happen there, per the higgsfield-websites
game flow:

```bash
cd app && bun run build            # runs check:logic + tsc
higgsfield website deploy <website_id>
```

There is no ZIP, no upload, and no `higgsfield game` command — that engine is
retired. Check art in the running game, not in isolation: a sprite that reads
well at full size can be unreadable at play scale.

## Reference order

1. `references/game-design-system.md`
2. `references/stylization.md`
3. The asset reference matching each manifest row

Read each selected reference completely. Do not load unrelated references.

Supporting references opened only when their owning route requires them:

- `references/meshy-api.md` — raw Meshy fallback only.
- `references/meshy-input-rules.md` — mandatory before any image-to-3D submit.
- `references/procedural-animation.md` — non-humanoid procedural rigs.

## UX rules

- Mirror the user's language; keep generation prompts in English.
- User updates are short and describe the game, not internal gates, phase numbers, job IDs, or tool mechanics.
- Ask only when the answer materially changes the game. Do not batch unrelated questions.
- Preserve one visual system across generated and procedural assets.
- Do not request secrets in chat. Raw Meshy fallback may use a user-configured environment key only when the native Higgsfield 3D model is unavailable.

## Output

- Design-only: requested design artifact plus `design/assets.csv`.
- Assets-only: usable files/result URLs and their manifest roles.
- Assets for a game being built: the files in place under `app/public/`, their
  manifest roles, and the STYLE FORMULA used — the build flow needs it to keep
  later additions consistent.
