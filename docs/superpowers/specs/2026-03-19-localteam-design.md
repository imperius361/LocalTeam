# LocalTeam — Design Specification

**Date:** 2026-03-19
**Status:** Approved
**Author:** Team collaboration (UX, Architect, Engineer, Security, QA)

## Overview

LocalTeam is an open-source desktop application for orchestrating AI agent teams. It allows users to define teams of AI agents with distinct roles and personas, submit tasks, observe agents collaborating and debating in real-time, and coordinate their output — all from a native Windows desktop application.

### Goals

- Provide a sleek, modern UI with full team observability
- Natively support Claude Agent SDK and OpenAI SDK
- Enable agent-to-agent collaboration with structured consensus protocols
- Ship as a lightweight desktop app (Windows-first, cross-platform later)
- Be open-source with a low barrier to contribution

### Non-Goals

- Web-based deployment
- Mobile support
- Running as a hosted/cloud service
- Supporting AI providers beyond Anthropic and OpenAI at launch

## Architecture

### Technology Stack

- **Desktop Shell:** Tauri v2 (Rust) — native webview, small binary, strong security model
- **Agent Core:** TypeScript sidecar process managed by Tauri — direct SDK integration
- **Frontend:** React + TypeScript in the Tauri webview
- **Database:** SQLite for session history and task persistence
- **Credential Storage:** Tauri Stronghold (encrypted vault)

### Three-Layer Architecture

```
Frontend (React) <-> Tauri IPC <-> Rust Shell <-> Sidecar (Node.js)
                                                      |
                                                Claude SDK / OpenAI SDK
                                                      |
                                                Local filesystem
```

#### Layer 1: Tauri Shell (Rust)

A thin Rust layer responsible for:

- Window management, system tray, native menus, OS notifications
- Credential storage via Tauri Stronghold (encrypted vault)
- File system access with permission controls
- Sidecar lifecycle management (start/stop/restart the TypeScript process)
- IPC bridge between sidecar and webview

The Rust layer is intentionally minimal. Contributors do not need Rust expertise — the shell uses standard Tauri plugins and configuration.

#### Layer 2: Agent Core (TypeScript Sidecar)

The brain of LocalTeam. Runs as a separate Node.js process managed by Tauri's sidecar system:

- Agent orchestration engine (spawn agents, route messages, manage consensus)
- Direct SDK integration (Claude Agent SDK, OpenAI SDK)
- Team and role configuration management
- Task decomposition and assignment
- Inter-agent communication bus (message routing between agents)
- File access coordination (advisory locking, optional git worktree sandboxing)
- Exposes a WebSocket + JSON-RPC API consumed by the frontend for real-time streaming
- Communicates with the Rust shell via local named pipe for secure IPC (credential requests, file system operations)

#### Layer 3: Frontend (React + TypeScript)

The user-facing interface rendered in Tauri's native webview:

- Conversation-centric observability dashboard
- Real-time streaming of agent discussions
- Task board view (secondary, switchable)
- Team configuration UI
- Project settings and agent customization

## Agent Orchestration Engine

### Agent Lifecycle

- Each agent is an SDK session (Claude Agent SDK or OpenAI SDK) with a system prompt defining its role, personality, and constraints
- Agents are spawned on-demand when a task is created or a discussion is initiated
- Each agent runs as an independent async stream — the orchestrator multiplexes their outputs

### Inter-Agent Communication

- Central **message bus** — agents do not communicate directly. All messages route through the orchestrator
- Message types:
  - `discussion` — debate, opinion, analysis
  - `proposal` — actionable suggestion
  - `objection` — blocking concern
  - `consensus` — agreement signal
  - `artifact` — code, file output, or other deliverable
- The orchestrator maintains a shared **conversation context** that all agents in a team can see (group chat model)
- Agents are prompted one at a time in round-robin or priority-based order to avoid token waste from parallel identical requests

### Consensus Protocol

1. When a task requires a decision, agents enter a **discussion round**
2. Each agent gets a turn to state their position (max N rounds, configurable, default 3)
3. After each round, the orchestrator checks for convergence:
   - All agents agree → consensus reached
   - Supermajority aligns → consensus reached
   - No convergence after max rounds → escalate to user
4. On escalation, the user sees a summary of each agent's position and reasoning
5. The user can: pick a side, override with their own decision, or send agents back with additional guidance

### Task Decomposition

1. User submits a high-level task (e.g., "Add authentication to the API")
2. A designated **lead agent** (configurable, defaults to "Architect" role) breaks it into subtasks
3. Subtasks are assigned to agents based on role matching (e.g., security review → Security Engineer)
4. Agents can propose additional subtasks during execution
5. Task states: `pending` → `in_progress` → `review` → `completed`

## Observability & UI

### Primary View: Conversation Stream

- Real-time feed of agent messages, styled per agent (avatar, role color, name)
- Messages show type badges: `discussion`, `proposal`, `objection`, `consensus`
- Streaming text appears token-by-token as agents respond
- Collapsible tool-use blocks — when an agent reads a file or runs a command, the action is shown inline but collapsed by default
- User can interject at any point — their message enters the shared context and agents respond to it
- Thread branching — conversations can fork when subtasks spin off, with a visual indicator to follow each thread

### Secondary View: Task Board

- Kanban-style columns: `Pending` → `In Progress` → `Review` → `Done`
- Each card shows: task title, assigned agent(s), current status, token usage
- Click a card to jump to the relevant conversation thread
- Drag to reprioritize

### Status Bar / Sidebar

- Per-agent status: `idle`, `thinking`, `writing`, `waiting for consensus`
- Token usage per agent and total for the session
- Cost estimate (based on model pricing)
- Active file locks / sandbox status
- Elapsed time per task

### System Tray

- Minimize to tray, background operation
- Notifications when: consensus reached, user escalation needed, task completed, agent error

## Security Model

### Credential Management

- API keys (Anthropic, OpenAI) stored in Tauri Stronghold — an encrypted vault on disk, never plaintext
- Keys are only accessible to the Rust shell layer, which proxies authenticated requests to the sidecar
- No credentials ever touch the webview/frontend process
- Support for multiple API key profiles (personal, work, different orgs)

### Agent Sandboxing

- **Direct mode (default):** Agents read/write the real project directory. File coordination via advisory locks to prevent concurrent writes to the same file
- **Sandbox mode (per-task):** Tauri shell creates a git worktree or temp copy. Agent works in isolation. Changes surface in the UI for review before merging back
- Agents have a configurable **allowlist** of directories they can access — prevents accidental reads of `~/.ssh`, `.env` files, etc.
- Tool execution (shell commands) requires explicit user approval unless pre-approved in the team config

### IPC Security

- Tauri's command allowlist — only explicitly defined commands are callable from the frontend
- Sidecar communicates with the Rust shell over a local named pipe (not HTTP) — not exposed to the network
- No remote access by default. Remote access is an explicit opt-in with authentication

### Dependency & Supply Chain

- Minimal dependency footprint — audit all transitive dependencies
- Lock files committed, reproducible builds
- Tauri's built-in updater with code signing for releases

## Data Model & Persistence

### Project Configuration (`localteam.json`)

Located in the project root. Defines the team and settings for that project:

```json
{
  "team": {
    "name": "Default Team",
    "agents": [
      {
        "id": "architect",
        "role": "Software Architect",
        "model": "claude-opus-4-6",
        "provider": "anthropic",
        "systemPrompt": "You are a senior software architect...",
        "tools": ["read_file", "search_code", "propose_task"],
        "allowedPaths": ["src/", "docs/"],
        "canExecuteCommands": false
      }
    ]
  },
  "consensus": {
    "maxRounds": 3,
    "requiredMajority": 0.66
  },
  "sandbox": {
    "defaultMode": "direct",
    "useWorktrees": true
  },
  "fileAccess": {
    "denyList": [".env", ".ssh/", "credentials*"]
  }
}
```

This file is portable — it can be checked into the repository so collaborators share the same team setup.

### Team Templates

Stored in the application data directory:

- Reusable team configurations shipped with LocalTeam and user-created ones
- Each template: name, description, list of agent roles with default prompts and tool permissions
- Export/import as JSON for community sharing

### Session History (`.localteam/` directory)

Stored within the project directory:

- Conversation logs per task — full message history with metadata (agent, timestamp, token count, message type)
- Task state and transitions
- Consensus records — what was decided, who agreed/disagreed, user overrides
- Artifacts produced (file diffs, code outputs)
- Sessions are browsable and searchable from the UI
- Backed by SQLite — lightweight, single-file, no external database dependency

### Frontend State Management

- Zustand for client-side state — lightweight, TypeScript-native
- WebSocket connection to sidecar for real-time streaming updates
- Optimistic UI updates with reconciliation from the sidecar's authoritative state

### Sidecar State

- In-memory agent sessions (active SDK instances)
- SQLite database for persistent session history and task tracking
- File system watcher for detecting external changes to project files during agent work

## Distribution & Packaging

### Build & Release

- Tauri v2's built-in bundler produces `.msi` / `.exe` installer for Windows
- The TypeScript sidecar is bundled as a compiled Node.js Single Executable Application (SEA) — no separate Node.js install required for end users
- Total bundle size target: ~30-50MB (Tauri shell + bundled sidecar + frontend assets)
- GitHub Releases for distribution, with Tauri's built-in auto-updater and code signing

### First Run Experience

1. Prompt for API keys (Anthropic and/or OpenAI), stored immediately in Stronghold
2. Offer to create a team from a template or start from scratch
3. Quick tutorial showing the conversation view, how to submit a task, how to intervene

### Open Source

- License: MIT or Apache 2.0 (to be decided)
- Monorepo structure:

```
localteam/
├── src-tauri/        # Rust shell (Tauri)
├── src-sidecar/      # TypeScript agent core
├── src/              # React frontend
├── templates/        # Built-in team templates
├── docs/             # Documentation
└── tests/            # E2E and integration tests
```

- Contributing guide with clear setup instructions for Windows
- GitHub Actions CI: build, test, and produce installers on every PR

### Platform Roadmap

- **Launch:** Windows only (officially supported)
- **Future:** macOS and Linux — Tauri and Node.js are cross-platform, so expansion is straightforward once Windows is stable
