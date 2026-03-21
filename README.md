# LocalTeam

**A desktop operations console for running multi-agent AI teams against a real git repository.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078d4?logo=windows)](https://github.com/imperius361/LocalTeam)
[![Rust](https://img.shields.io/badge/Rust-1.77.2%2B-orange?logo=rust)](https://rustup.rs/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)

---

## The Problem

AI coding assistants are built for one model and one conversation. The moment you want multiple agents — an architect, an implementer, a security reviewer — you're stitching together chat tabs, copy-pasting context, and hoping the agents agree. There is no coordination layer, no consensus tracking, no approval gate before code runs.

LocalTeam fixes that. It gives a structured team of AI agents a shared workspace inside your actual git repository, a protocol for reaching agreement, and a human approval gate before any command touches your files.

---

## Architecture

LocalTeam is a three-layer application. Each layer has a clearly bounded job.

```
┌──────────────────────────────────────────────────────────────┐
│                   React Frontend  (Vite)                      │
│   GlobalView · ProjectView · TeamView · AgentView             │
│   Themes: Obsidian · Pixel Strategy                           │
└─────────────────────────┬────────────────────────────────────┘
                          │  Tauri IPC  (command allowlist)
┌─────────────────────────▼────────────────────────────────────┐
│               Rust Desktop Shell  (Tauri v2)                  │
│   Window chrome · Stronghold vault · Sidecar bootstrap        │
└─────────────────────────┬────────────────────────────────────┘
                          │  stdin / stdout  (line-delimited JSON)
┌─────────────────────────▼────────────────────────────────────┐
│        TypeScript Sidecar  (Node.js Orchestration)            │
│   Orchestrator · Consensus · Task Manager · Message Bus       │
│   Providers: Anthropic · OpenAI · Mock                        │
└──────────────┬───────────────────────────┬───────────────────┘
               │  SDK calls                │  SDK calls
        Claude API                    OpenAI API
               └───────────────┬───────────┘
                               │  file I/O
                      Local git workspace
```

**Frontend** — React 19 + Vite, communicates via Tauri's IPC command allowlist. Renders the discussion stream, task board, agent status, and command approval queue in real time.

**Rust Shell** — Thin Tauri v2 wrapper. Owns the credential vault (Stronghold), window chrome, system tray, and the lifecycle of the sidecar subprocess.

**TypeScript Sidecar** — The real brain. Runs as a Node.js subprocess and implements everything: agent sessions, message routing, consensus evaluation, task decomposition, SQLite persistence, command safety checks, and provider SDK integration.

---

## Features

### Multi-Agent Orchestration

- Spawn a named team of agents, each with its own role, system prompt, model, and tool permissions
- AsyncGenerator-based message streaming delivers tokens to the UI as they arrive
- Round-robin polling keeps all agents in conversation with shared context
- Per-agent path allowlists restrict which parts of the repository each role can read

### Consensus Protocol

- Agents deliberate over a configurable number of rounds (default: 3)
- A required majority threshold (default: 66%) determines when the team has agreed
- If consensus is not reached, the disagreement summary escalates to the human for a tie-breaking decision
- Position tracking makes it easy to see where each agent stands at any point in the discussion

### Task Management

- The lead architect agent decomposes high-level tasks into subtasks
- Subtasks are assigned to agents by role match
- Each task moves through defined state transitions: `pending → in_progress → review → completed`
- All task and message history is persisted to SQLite in app data — nothing lands in your repository

### Security by Default

- **Credential vault** — API keys are stored in an encrypted Stronghold vault, never in `localteam.json` or any file the repository can see
- **Command approval gate** — every shell command an agent wants to run requires explicit human approval before execution
- **File denylist** — `.env*`, `*.key`, `*.pem`, `*.tfstate`, `.git/`, and other sensitive paths are blocked by default from agent file access
- **Worktree sandboxing** — tasks can optionally run in isolated git worktrees, keeping main clean until work is reviewed
- **IPC allowlist** — Tauri's capability model restricts which commands the frontend can invoke on the shell

### Real-Time UI

- Discussion stream updates token by token as agents respond
- Task board reflects state transitions the moment the sidecar emits them
- WebSocket deltas keep all panels in sync without polling
- Command approval panel shows pending, approved, and denied commands with full context

### Provider Flexibility

- Supports **Anthropic** (Claude models) and **OpenAI** (GPT models) out of the box
- A **mock provider** lets you exercise the full UI and orchestration flow without live API keys
- Credentials are loaded from the Stronghold vault at runtime — rotate keys without touching config files
- Each agent in a team can use a different provider and model

---

## Visual Themes

LocalTeam ships two themes. Theme choice is part of the product identity, not a cosmetic option.

**Obsidian** — sharp lines, high contrast, minimal color. Built for developers who want the information density of a terminal with the structure of a purpose-built tool.

**Pixel Strategy** — retro control-room aesthetic, louder palette, deliberate nostalgia. Designed to make the multi-agent workflow feel like commanding a squad rather than filling out a form.

Switch themes from the top bar at any time. The setting persists per workspace.

---

## Getting Started

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| [Rust](https://rustup.rs/) | 1.77.2+ | Install via `rustup` |
| [Node.js](https://nodejs.org/) | 20+ | LTS recommended |
| Windows | 10 or 11 | macOS / Linux support planned |
| [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) | latest | Select the **Desktop development with C++** workload |

### Install & Run

```powershell
git clone https://github.com/imperius361/LocalTeam.git
cd LocalTeam
npm install
npm run tauri dev
```

The Tauri dev shell compiles the Rust layer, starts the sidecar, and opens the desktop window with hot-reload enabled on the frontend.

### First Run Walkthrough

1. **Open a workspace** — point LocalTeam at the git repository you want the agents to work in. LocalTeam's own state (tasks, messages, history) lives in app data, not inside that repo.

2. **Unlock the credential vault** — on first launch, create a vault password. On subsequent launches, unlock with the same password. This vault holds your API keys and is never written to disk in plaintext.

3. **Add provider credentials** — enter your Anthropic and/or OpenAI API keys in the Credentials panel. You only need to add the keys for providers your team configuration actually uses.

4. **Sync credentials to the sidecar** — click "Sync" to push the decrypted keys to the running sidecar process. The sidecar holds them in memory for the session; they are not written to any file.

5. **Create a task** — type a high-level description. The architect agent will decompose it, the implementer will plan execution, and the security reviewer will flag risks. Watch the discussion stream and task board update live.

6. **Review command approvals** — before any agent-requested shell command runs, it appears in the Command Approvals panel. Read it, approve or deny it. Denied commands are logged with a reason.

---

## Team Configuration

Teams are defined in `localteam.json` at the project root (or using the starter template in `templates/default-team.json`). Each entry in `agents` is an independent agent with its own identity and constraints.

```json
{
  "name": "My Team",
  "agents": [
    {
      "id": "architect",
      "role": "Software Architect",
      "model": "claude-opus-4-6",
      "provider": "anthropic",
      "systemPrompt": "You are the lead architect. Drive the plan, decompose work, and keep the team aligned on scope and tradeoffs.",
      "tools": ["read_file", "search_code", "propose_task"],
      "allowedPaths": ["src/", "docs/"],
      "canExecuteCommands": false
    },
    {
      "id": "implementer",
      "role": "Implementation Engineer",
      "model": "gpt-4.1-mini",
      "provider": "openai",
      "systemPrompt": "You implement the agreed change set, call out risks early, and keep the code path practical.",
      "tools": ["read_file", "search_code", "artifact"],
      "allowedPaths": ["src/", "src-sidecar/", "src-tauri/"],
      "canExecuteCommands": false
    },
    {
      "id": "security",
      "role": "Security Engineer",
      "model": "gpt-4.1-mini",
      "provider": "openai",
      "systemPrompt": "You review for auth, secrets, sandboxing, unsafe execution, and least-privilege defaults.",
      "tools": ["read_file", "search_code", "objection"],
      "allowedPaths": ["src/", "src-sidecar/", "src-tauri/", "docs/"],
      "canExecuteCommands": false
    }
  ],
  "consensus": {
    "maxRounds": 3,
    "requiredMajority": 0.66
  },
  "sandbox": {
    "defaultMode": "worktree",
    "useWorktrees": true
  },
  "fileDenylist": [".env*", "*.key", "*.pem", "*.tfstate", ".git/"]
}
```

**Key fields:**

| Field | Description |
|---|---|
| `id` | Unique identifier used in task assignment and logging |
| `role` | Human-readable role label shown in the UI |
| `model` | Model string passed to the provider SDK |
| `provider` | `"anthropic"`, `"openai"`, or `"mock"` |
| `systemPrompt` | The agent's standing instruction — defines personality and responsibility |
| `tools` | Tool names the agent is allowed to invoke |
| `allowedPaths` | Paths within the workspace this agent can read |
| `canExecuteCommands` | Whether this agent can request shell command execution |
| `consensus.maxRounds` | Maximum deliberation rounds before escalating to human |
| `consensus.requiredMajority` | Fraction of agents that must agree (0.66 = two-thirds) |

---

## Commands

| Command | Description |
|---|---|
| `npm run tauri dev` | Full desktop dev shell with hot-reload |
| `npm run build` | Frontend-only Vite build (no Rust compilation) |
| `npm test` | Sidecar unit tests + end-to-end tests |
| `npm run release:windows` | Production Windows build |

Release artifacts land in `dist\release\windows\`.

---

## Repo Structure

```
LocalTeam/
├── src/                        # React frontend (TypeScript + Vite)
│   ├── components/
│   │   ├── layers/             # Main views: GlobalView, ProjectView, TeamView, AgentView
│   │   ├── CommandApprovalsPanel.tsx
│   │   ├── CredentialsSurface.tsx
│   │   ├── HistoryBrowserPanel.tsx
│   │   ├── ProjectSettingsPanel.tsx
│   │   └── Sidebar.tsx / Topbar.tsx
│   ├── store/                  # Zustand state management
│   ├── themes/                 # obsidian.css · pixel.css
│   └── navigation/             # NavContext layer routing
│
├── src-sidecar/                # TypeScript orchestration runtime (Node.js)
│   └── src/
│       ├── orchestrator.ts     # AsyncGenerator agent multiplexer
│       ├── consensus.ts        # Majority-based agreement protocol
│       ├── agent.ts            # Individual agent session wrapper
│       ├── message-bus.ts      # Inter-agent message routing
│       ├── task-manager.ts     # Task state machine + SQLite persistence
│       ├── command-safety.ts   # Approval gate + denylist enforcement
│       └── providers/          # anthropic.ts · openai.ts · mock.ts · factory.ts
│
├── src-tauri/                  # Rust desktop shell (Tauri v2)
│   └── src/
│       ├── credentials.rs      # Stronghold vault integration
│       ├── sidecar.rs          # Sidecar subprocess lifecycle
│       ├── ipc.rs              # Named pipe IPC bridge
│       └── tray.rs / chrome.rs # System tray + window management
│
├── templates/
│   └── default-team.json       # Starter 3-agent team (Architect, Implementer, Security)
├── docs/superpowers/           # Design specs and implementation plans
└── localteam.json              # Project-level team + consensus configuration
```

---

## Roadmap

The orchestration layer, vault flow, command approvals, history, and visual shell are complete. The following is in progress or planned:

- **Native Claude execution** — full claude-agent-sdk integration with streaming tool use
- **Codex CLI integration** — OpenAI Codex as a first-class provider with code-execution support
- **Agent-to-agent delegation** — agents assigning subtasks directly to one another without human routing
- **Automated worktree lifecycle** — auto-branch, run, review, and open PR per task
- **macOS and Linux support** — Rust and Node.js layers are portable; platform packaging is the remaining work
- **Plugin API** — a stable interface for adding custom providers without forking the sidecar

---

## Contributing

LocalTeam is MIT licensed and early-stage. The best way to contribute right now:

1. **Run the mock provider** — use `"provider": "mock"` in your team config to exercise the full flow without API keys
2. **Open issues** — architecture questions, security concerns, and workflow ideas are all welcome
3. **Read the design docs** — `docs/superpowers/specs/` contains the full design specification and explains the intended direction

If you want to add a provider, the `src-sidecar/src/providers/` directory contains `anthropic.ts` and `openai.ts` as reference implementations alongside the `factory.ts` dispatch layer.

---

## Notes

- `localteam.json` is a team definition file. Do not put secrets in it.
- LocalTeam's app data (SQLite databases, vault file, agent state) is stored in the OS app data directory — never in the target repository.
- Generated binaries, `.env*` files, and local agent state are excluded from the repository by `.gitignore`.

---

## License

[MIT](LICENSE)
