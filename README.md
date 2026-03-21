# LocalTeam

Open-source desktop application for orchestrating AI agent teams.

## Windows-First Quick Start

### Prerequisites
- [Rust](https://rustup.rs/) stable (1.77.2+)
- [Node.js](https://nodejs.org/) (20+)
- Windows 10/11
- Visual Studio Build Tools (Desktop C++ workload) for native dependencies

### Install and run (PowerShell)
```powershell
git clone <repo-url>
cd LocalTeam
npm install
npm run tauri dev
```

## First-Run Flow (Windows)

1. Launch with `npm run tauri dev`.
2. In **Project Settings**, choose the git workspace you want LocalTeam to open. LocalTeam keeps its own settings and runtime state in app data and runs tasks against the selected repository.
3. In **Agent API Keys**, enter a vault password, click **Unlock Vault**, then add the keys you actually use and click **Sync Stored Keys**.
4. In **Command Approvals**, review shell requests and approve or deny them before execution.
5. Optionally apply a team template from **Team Template** to update the active workspace settings stored by LocalTeam.
6. Create a task in **Task Composer**.
7. Use **Task Guidance** to send interjections to the selected task while it is running.
8. Use the **History Browser** to search loaded tasks and messages.
9. For subtasks, choose a parent task in the composer dropdown before starting.
10. Track execution in:
   - **Conversation Stream**: live messages and long-run history controls
   - **Task Flow**: assignment, parent chain, and subtask visibility
   - **Live Event Feed**: in-progress runtime events
11. If connection drops, use **Connection Recovery** (`Retry Snapshot` or `Restart & Reconnect`).

## Development Commands (PowerShell)

```powershell
# Run frontend + desktop shell
npm run tauri dev

# Build web UI only
npm run build

# Run end-to-end tests
npm run test:e2e

# Cross-build Windows artifacts from a compatible host
npm run build:windows

# Build Windows release artifact on a native Windows machine
npm run release:windows
```

## Windows Release Artifact (PowerShell)

```powershell
.\scripts\release-windows.ps1
```

This script performs a native Windows build and does not require `cargo-xwin`.

Release output lands in `.\dist\release\windows\`.

## Runtime paths

- Git workspace: your selected repository
- LocalTeam settings and runtime state: the app-local data directory for LocalTeam on the current machine

## License

MIT
