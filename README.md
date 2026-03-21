# LocalTeam

LocalTeam is a Windows-first desktop workspace for running multi-agent software work against a real git repository without turning that repository into a junk drawer.

The app wraps a Tauri shell around a TypeScript sidecar that keeps project state, routes tasks across agents, tracks consensus, stores command approvals, and holds provider credentials in a local Stronghold vault. The goal is simple: give Claude-style, Codex-style, OpenAI, and local agents a place to work together that feels more like an operations console than a chat tab.

This repository is still moving. The orchestration layer, vault flow, approvals, history, and visual shell are already here. Native Claude and Codex SDK-driven execution is the direction of the project, but parts of that provider layer are still in progress. The current build ships with OpenAI and Anthropic credential plumbing plus a mock fallback so the rest of the app can be exercised without live keys.

## What The App Already Does

- Opens a git workspace and keeps LocalTeam's own state out of that repo.
- Stores API keys in a local Stronghold vault instead of plaintext config.
- Creates tasks, decomposes work, and tracks agent discussion and consensus.
- Keeps command execution behind explicit policy checks and human approval.
- Persists task/message history per workspace in app data.
- Gives you a visual control surface instead of a raw terminal transcript.

## Visual Direction

LocalTeam is intentionally not styled like a generic SaaS dashboard.

- `Obsidian` is the sharper developer-focused theme.
- `Pixel Strategy` leans into a retro control-room aesthetic and is intentionally louder.

If visuals matter to you, start there. Theme choice is part of the product, not an afterthought.

## Security Posture

For public release, the repo is set up so that:

- workspace state lives in app data, not in the target repository
- credentials are stored in Stronghold, not in `localteam.json`
- shell execution is human-gated and defaults to worktree isolation
- sensitive repo-local files like `.env*`, key material, and Terraform state are denied by default for agent command access

This is still a local desktop tool that can execute model-generated work, so the trust boundary matters: keep reviewing prompts, command approvals, and provider configuration like you would any other local automation surface.

## Repo Shape

`src/` is the React interface.

`src-sidecar/` is the orchestration runtime, persistence layer, provider wiring, and command approval logic.

`src-tauri/` is the desktop shell, menu/window chrome, credential vault integration, and sidecar bootstrap.

`templates/` carries starter team definitions.

`docs/superpowers/` contains design notes and implementation plans that explain where the project is headed.

## Windows-First Setup

### Prerequisites

- [Rust](https://rustup.rs/) stable `1.77.2+`
- [Node.js](https://nodejs.org/) `20+`
- Windows 10/11
- Visual Studio Build Tools with the Desktop C++ workload

### Run In Development

```powershell
git clone <repo-url>
cd LocalTeam
npm install
npm run tauri dev
```

### First Run

1. Pick the git workspace you want LocalTeam to manage.
2. Create or unlock the local credential vault.
3. Add only the provider keys you actually use, then sync them to the sidecar.
4. Review command approvals before letting an agent touch the workspace.
5. Create a task and watch the team view, discussion stream, and history panels update together.

## Commands

```powershell
# Desktop dev shell
npm run tauri dev

# Frontend build
npm run build

# Sidecar + e2e tests
npm test

# Native Windows release build
npm run release:windows
```

Release artifacts land under `dist\release\windows\`.

## Notes Before Publishing

- `localteam.json` is a project definition, not a secret store.
- Generated binaries, app data, local agent state, and `.env*` files are ignored on purpose.
- The current README does not pretend the project is finished. It documents the product as it actually exists today.

## License

MIT
