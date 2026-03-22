# Functional Test Suite

Playwright end-to-end tests that launch the full LocalTeam Tauri application via WebView2 CDP and exercise real user journeys. All tests require Windows and are skipped on other platforms.

## Running

```bash
# Run all tests (headless)
npm run test:functional

# Run with visible browser window
npm run test:functional:headed
```

Test output, traces, and screenshots are written to `output/playwright/`.

---

## Test Files

### `approvals.spec.ts`

#### Approve a pending command

```mermaid
journey
    title Approve a pending command
    section Setup
      Launch app (pending_approval): 5: App
      Select Obsidian theme: 5: User
      Open workspace: 5: User
    section Global view
      Click breadcrumb-global-0: 5: User
      See "command approval" in global alerts: 5: App
    section Team view
      Click Operations Alpha button: 5: User
      Navigate to team: 5: User
      See "git status --short" in approvals panel: 5: App
    section Agent view
      Navigate to agent (implementer): 5: User
      See "git status --short" command: 5: App
      Click Approve button: 5: User
    section Result
      "No pending approvals" appears: 5: App
      "approved • exit 0" appears in history: 5: App
```

#### Deny a pending command

```mermaid
journey
    title Deny a pending command
    section Setup
      Launch app (pending_approval): 5: App
      Select Obsidian theme: 5: User
      Open workspace: 5: User
    section Agent view
      Navigate to team: 5: User
      Navigate to agent (implementer): 5: User
      Click Deny button: 5: User
    section Result
      "No pending approvals" appears: 5: App
      "denied" appears in history: 5: App
      "git status --short" visible in history: 5: App
```

---

### `navigation-settings.spec.ts`

#### Navigate project → team → agent and back

```mermaid
journey
    title Navigate project → team → agent → back
    section Setup
      Launch app (session_ready): 5: App
      Select Obsidian theme: 5: User
      Open workspace: 5: User
    section Team
      Click project-team-ops-alpha: 5: User
      Team view visible: 5: App
      sidebar-team-ops-alpha has aria-current=page: 5: App
    section Agent
      Click team-member-implementer: 5: User
      See "Implementation Engineer": 5: App
      See "Member Policy" panel: 5: App
      See "Session Activity" panel: 5: App
      sidebar-agent-implementer has aria-current=page: 5: App
    section Back navigation
      Click breadcrumb-team-2: 5: User
      Team view visible: 5: App
      Click breadcrumb-project-1: 5: User
      Project view visible: 5: App
```

#### Settings window — runtime onboarding and workspace selection

```mermaid
journey
    title Settings window — onboarding and workspace
    section Setup
      Launch app (empty_state): 5: App
      Select Obsidian theme: 5: User
    section Open settings
      Click topbar-settings: 5: User
      Settings window opens: 5: App
      See "LocalTeam Runtime Settings": 5: App
      See "Project Settings": 5: App
      Action button shows "Initialize Runtime": 5: App
    section Onboarding
      Click Initialize Runtime: 5: User
      See "Gateway online": 5: App
    section Workspace
      Click settings-choose-workspace: 5: User
      Workspace path visible: 5: App
      Click settings-reload-workspace: 5: User
      See "Operations Alpha": 5: App
      See "3 members": 5: App
```

---

### `recovery.spec.ts`

#### Bridge termination surfaces and recovers

```mermaid
journey
    title Bridge termination and recovery
    section Setup
      Launch app (bridge_recovery): 5: App
      Select Obsidian theme: 5: User
      Open workspace: 5: User
      Navigate to team: 5: User
      Navigate to agent: 5: User
    section Termination
      Trigger sidecar termination via E2E bridge: 5: User
      agent-sidecar-error shows "E2E bridge terminated.": 5: App
    section Dashboard check
      Click breadcrumb-project-1: 5: User
      Error message visible in project view: 5: App
    section Recovery
      Click sidebar-agent-implementer: 5: User
      agent-restart-bridge button visible: 5: App
      Click Restart Bridge: 5: User
      agent-sidecar-error disappears: 5: App
      "Bridge is healthy and streaming activity." visible: 5: App
```

#### Workspace loaded via native workspace-selected event

```mermaid
journey
    title Load workspace from native event path
    section Setup
      Launch app (empty_state): 5: App
      Select Obsidian theme: 5: User
    section Event
      Emit workspace-selected event via E2E bridge: 5: User
    section Result
      Project view visible: 5: App
      Workspace path shown: 5: App
```

---

### `session-lifecycle.spec.ts`

#### Team apply and session start/stop

```mermaid
journey
    title Team apply → start session → stop session
    section Setup
      Launch app (session_ready): 5: App
      Select Obsidian theme: 5: User
      Open workspace: 5: User
      Navigate to team: 5: User
    section Apply team
      Click team-apply button: 5: User
      See "Team bindings applied to the managed runtime.": 5: App
    section Start session
      Click team-session-action: 5: User
      Button changes to "Stop Session": 5: App
      See "Session status: running": 5: App
    section Stop session
      Click team-session-action: 5: User
      Button changes to "Start Session": 5: App
      See "Session status: Not started": 5: App
      See "Session returned to idle.": 5: App
```

---

### `theme-workspace.spec.ts`

#### Theme persists across relaunches

```mermaid
journey
    title Theme selection persists across app relaunches
    section First launch
      Launch app (empty_state): 5: App
      Theme selector visible: 5: App
      Click theme-card-obsidian: 5: User
      Global view shown: 5: App
      html data-theme=obsidian set: 5: App
    section Close and relaunch
      Close app: 5: User
      Launch app again (empty_state, same runtimeRoot): 5: App
    section Second launch
      Theme selector not shown: 5: App
      Global view shown immediately: 5: App
      html data-theme=obsidian still set: 5: App
      localStorage has localteam.theme=obsidian: 5: App
```

#### Open workspace and record recent project

```mermaid
journey
    title Open workspace and record as recent project
    section Setup
      Launch app (empty_state): 5: App
      Select Obsidian theme: 5: User
    section Open workspace
      Click global-open-workspace: 5: User
      Project view visible: 5: App
      Workspace path shown: 5: App
    section Global view check
      Click breadcrumb-global-0: 5: User
      "Operations Alpha" button visible: 5: App
    section Storage
      localStorage localteam.recents contains "Operations Alpha": 5: App
```

---

## Test Infrastructure

### `support/tauriHarness.ts`

Launches a full Tauri dev build per test via `npm run tauri -- dev --config src-tauri/tauri.e2e.conf.json --no-watch` with WebView2 CDP enabled on a free port. Each test gets an isolated `runtimeRoot` directory for `appdata` and WebView2 profile data.

| Export | Purpose |
|---|---|
| `createRuntimeRoot()` | Creates a temp directory scoped to the test |
| `launchLocalTeam(options)` | Spawns the app and returns a `LocalTeamApp` handle |
| `cleanupRuntimeRoot(path)` | Removes the temp directory after the test |

### `support/helpers.ts`

Shared step helpers used across spec files.

| Helper | What it does |
|---|---|
| `selectObsidianTheme(page)` | Clicks the Obsidian theme card and waits for the global view |
| `openWorkspace(page)` | Clicks `global-open-workspace` and waits for the project view |
| `goToTeam(page)` | Clicks `project-team-ops-alpha` and waits for the team view |
| `goToAgent(page)` | Clicks `team-member-implementer` and waits for the agent view |
| `emitWorkspaceSelected(page, path?)` | Fires the `workspace-selected` native event via the E2E bridge |
| `triggerSidecarTermination(page, detail?)` | Triggers a simulated sidecar crash via the E2E bridge |

### E2E Scenarios

Tests pass a `scenario` option to `launchLocalTeam` which controls the simulated backend state:

| Scenario | Description |
|---|---|
| `empty_state` | App launched with no workspace loaded and runtime not onboarded |
| `session_ready` | Workspace loaded, runtime onboarded, no active session |
| `pending_approval` | Like `session_ready` with one pending command approval for the implementer agent |
| `bridge_recovery` | Like `session_ready` with an active session, used for bridge termination tests |
