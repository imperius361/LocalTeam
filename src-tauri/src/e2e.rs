use serde::Serialize;
use serde_json::{json, Value};
use std::env;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

const DEFAULT_WORKSPACE_FALLBACK: &str = "C:\\LocalTeam\\FixtureWorkspace";
const WORKSPACE_SELECTED_EVENT: &str = "localteam://workspace-selected";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeContext {
    pub e2e_mode: bool,
    pub scenario: Option<String>,
    pub workspace: Option<String>,
}

#[derive(Clone, Copy)]
enum Scenario {
    EmptyState,
    SessionReady,
    PendingApproval,
    BridgeRecovery,
}

impl Scenario {
    fn from_env() -> Self {
        match env::var("LOCALTEAM_E2E_SCENARIO")
            .unwrap_or_else(|_| "empty_state".into())
            .trim()
        {
            "session_ready" => Self::SessionReady,
            "pending_approval" => Self::PendingApproval,
            "bridge_recovery" => Self::BridgeRecovery,
            _ => Self::EmptyState,
        }
    }

    fn as_str(&self) -> &'static str {
        match self {
            Self::EmptyState => "empty_state",
            Self::SessionReady => "session_ready",
            Self::PendingApproval => "pending_approval",
            Self::BridgeRecovery => "bridge_recovery",
        }
    }
}

#[derive(Clone)]
struct E2eSessionState {
    id: String,
    status: &'static str,
    created_at: u64,
    updated_at: u64,
}

#[derive(Clone)]
struct E2eApprovalState {
    id: String,
    task_id: String,
    agent_id: String,
    agent_role: String,
    command: String,
    summary: String,
    status: &'static str,
    requested_at: u64,
    updated_at: u64,
    exit_code: Option<i64>,
    stdout: Option<String>,
    stderr: Option<String>,
}

#[derive(Clone)]
struct E2eStateSnapshot {
    project_loaded: bool,
    onboarding_completed: bool,
    gateway_ready: bool,
    sidecar_ready: bool,
    sidecar_error: Option<String>,
    active_team_id: Option<String>,
    session: Option<E2eSessionState>,
    approvals: Vec<E2eApprovalState>,
    approval_history: Vec<E2eApprovalState>,
    messages: Vec<Value>,
}

struct E2eStateInner {
    scenario: Scenario,
    workspace: String,
    clock: u64,
    current: E2eStateSnapshot,
    restore_snapshot: Option<E2eStateSnapshot>,
}

impl E2eStateInner {
    fn new() -> Self {
        let scenario = Scenario::from_env();
        let workspace = env::var("LOCALTEAM_E2E_WORKSPACE")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_WORKSPACE_FALLBACK.into());
        let current = empty_snapshot();

        Self {
            scenario,
            workspace,
            clock: 1_710_000_000_000,
            current,
            restore_snapshot: None,
        }
    }

    fn next_timestamp(&mut self) -> u64 {
        self.clock += 60_000;
        self.clock
    }

    fn load_project(&mut self, root_path: Option<String>) -> Value {
        let onboarding_completed = self.current.onboarding_completed;
        let gateway_ready = self.current.gateway_ready;

        if let Some(root_path) = root_path.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) {
            self.workspace = root_path;
        }

        let mut next = match self.scenario {
            Scenario::EmptyState => empty_loaded_snapshot(self.next_timestamp()),
            Scenario::SessionReady => session_ready_snapshot(self.next_timestamp()),
            Scenario::PendingApproval => pending_approval_snapshot(self.next_timestamp()),
            Scenario::BridgeRecovery => bridge_recovery_snapshot(self.next_timestamp()),
        };
        if onboarding_completed {
            next.onboarding_completed = true;
            next.gateway_ready = gateway_ready;
        }
        self.current = next;
        self.restore_snapshot = Some(self.current.clone());
        self.snapshot_value()
    }

    fn apply_team(&mut self, team_id: Option<String>) -> Value {
        self.current.project_loaded = true;
        self.current.active_team_id = Some(team_id.unwrap_or_else(default_team_id));
        let timestamp = self.next_timestamp();
        self.current.messages.push(message(
            "msg-team-apply",
            "architect",
            "Software Architect",
            "system",
            "Team bindings applied to the managed runtime.",
            timestamp,
        ));
        self.restore_snapshot = Some(self.current.clone());
        self.snapshot_value()
    }

    fn start_session(&mut self, team_id: Option<String>) -> Result<Value, String> {
        if !self.current.project_loaded {
            return Err("No project configuration loaded".into());
        }
        if !self.current.gateway_ready {
            return Err("Runtime onboarding must complete before starting a session.".into());
        }

        let timestamp = self.next_timestamp();
        self.current.active_team_id = Some(team_id.unwrap_or_else(default_team_id));
        self.current.session = Some(E2eSessionState {
            id: "session-ops-001".into(),
            status: "running",
            created_at: timestamp,
            updated_at: timestamp,
        });
        self.current.messages.push(message(
            "msg-session-start",
            "architect",
            "Software Architect",
            "system",
            "Session started for Operations Alpha.",
            timestamp,
        ));
        self.restore_snapshot = Some(self.current.clone());
        Ok(self.snapshot_value())
    }

    fn stop_session(&mut self, session_id: Option<String>) -> Result<Value, String> {
        let active = self
            .current
            .session
            .clone()
            .ok_or_else(|| "No active session to stop".to_string())?;

        if let Some(session_id) = session_id {
            if session_id != active.id {
                return Err(format!("Unknown session: {session_id}"));
            }
        }

        let timestamp = self.next_timestamp();
        self.current.session = Some(E2eSessionState {
            status: "idle",
            updated_at: timestamp,
            ..active
        });
        self.current.messages.push(message(
            "msg-session-stop",
            "security",
            "Security Engineer",
            "system",
            "Session returned to idle.",
            timestamp,
        ));
        self.restore_snapshot = Some(self.current.clone());
        Ok(self.snapshot_value())
    }

    fn resolve_approval(&mut self, approval_id: &str, action: &str) -> Result<Value, String> {
        let target_status = if action == "deny" { "denied" } else { "approved" };
        let timestamp = self.next_timestamp();
        let approval = self
            .current
            .approvals
            .iter_mut()
            .find(|approval| approval.id == approval_id)
            .ok_or_else(|| format!("Unknown approval: {approval_id}"))?;

        approval.status = target_status;
        approval.updated_at = timestamp;
        approval.exit_code = Some(if action == "deny" { 1 } else { 0 });
        approval.stdout = if action == "approve" {
            Some("Workspace inspection completed.".into())
        } else {
            None
        };
        approval.stderr = if action == "deny" {
            Some("Approval denied in E2E mode.".into())
        } else {
            None
        };

        let result = approval_to_command_approval(approval, &self.workspace);
        self.restore_snapshot = Some(self.current.clone());
        Ok(result)
    }

    fn launch_onboarding(&mut self) -> Value {
        self.current.onboarding_completed = true;
        self.current.gateway_ready = true;
        self.current.sidecar_ready = true;
        self.current.sidecar_error = None;
        self.restore_snapshot = Some(self.current.clone());
        nemoclaw_status(
            self.current.onboarding_completed,
            runtime_profiles(self.current.onboarding_completed),
            self.current.sidecar_error.clone(),
        )
    }

    fn restart_bridge(&mut self) {
        if let Some(restore_snapshot) = self.restore_snapshot.clone() {
            self.current = restore_snapshot;
        } else {
            self.current.sidecar_ready = true;
            self.current.sidecar_error = None;
            if self.current.project_loaded {
                self.current.gateway_ready = self.current.onboarding_completed;
            }
        }
    }

    fn terminate_bridge(&mut self, detail: Option<String>) {
        self.restore_snapshot = Some(self.current.clone());
        self.current.sidecar_ready = false;
        self.current.gateway_ready = false;
        self.current.sidecar_error = detail.or_else(|| Some("E2E bridge terminated.".into()));
    }

    fn snapshot_value(&self) -> Value {
        build_snapshot(&self.current, &self.workspace, self.clock)
    }

    fn nemoclaw_status(&self) -> Value {
        nemoclaw_status(
            self.current.onboarding_completed,
            runtime_profiles(self.current.onboarding_completed),
            self.current.sidecar_error.clone(),
        )
    }

    fn runtime_profiles(&self) -> Value {
        Value::Array(runtime_profiles(self.current.onboarding_completed))
    }

    fn gateway_status(&self) -> Value {
        gateway_status(
            self.current.gateway_ready,
            self.current.onboarding_completed,
            if self.current.project_loaded {
                Some(self.workspace.clone())
            } else {
                None
            },
            self.current.sidecar_error.clone(),
        )
    }

    fn sessions_value(&self) -> Value {
        Value::Array(session_summaries(self.current.session.as_ref()))
    }

    fn approvals_value(&self) -> Value {
        Value::Array(
            self.current
                .approvals
                .iter()
                .chain(self.current.approval_history.iter())
                .map(approval_summary)
                .collect(),
        )
    }

    fn command_approvals_value(&self, task_id: Option<&str>) -> Value {
        Value::Array(
            self.current
                .approvals
                .iter()
                .chain(self.current.approval_history.iter())
                .filter(|approval| match task_id {
                    Some(task_id) => approval.task_id == task_id,
                    None => true,
                })
                .map(|approval| approval_to_command_approval(approval, &self.workspace))
                .collect(),
        )
    }
}

pub struct E2eState {
    inner: Mutex<E2eStateInner>,
}

impl E2eState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(E2eStateInner::new()),
        }
    }

    pub fn runtime_context(&self) -> RuntimeContext {
        if !is_e2e_mode() {
            return RuntimeContext {
                e2e_mode: false,
                scenario: None,
                workspace: None,
            };
        }

        let inner = self.inner.lock().unwrap();
        RuntimeContext {
            e2e_mode: true,
            scenario: Some(inner.scenario.as_str().into()),
            workspace: Some(inner.workspace.clone()),
        }
    }

    pub fn pick_project_folder(&self, starting_directory: Option<String>) -> Option<String> {
        let mut inner = self.inner.lock().unwrap();
        if let Some(directory) = starting_directory
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            inner.workspace = directory;
        }
        Some(inner.workspace.clone())
    }

    pub fn nemoclaw_get_status(&self) -> Value {
        self.inner.lock().unwrap().nemoclaw_status()
    }

    pub fn nemoclaw_launch_onboarding(&self, app: &AppHandle) -> Result<Value, String> {
        let status = {
            let mut inner = self.inner.lock().unwrap();
            inner.launch_onboarding()
        };
        emit_snapshot(app, &self.inner.lock().unwrap().snapshot_value())?;
        Ok(status)
    }

    pub fn restart_sidecar(&self, app: &AppHandle) -> Result<(), String> {
        {
            let mut inner = self.inner.lock().unwrap();
            inner.restart_bridge();
        }
        app.emit("sidecar-started", "E2E bridge started")
            .map_err(|error| error.to_string())
    }

    pub fn trigger_sidecar_termination(
        &self,
        app: &AppHandle,
        detail: Option<String>,
    ) -> Result<(), String> {
        let payload = detail.unwrap_or_else(|| "E2E bridge terminated.".into());
        {
            let mut inner = self.inner.lock().unwrap();
            inner.terminate_bridge(Some(payload.clone()));
        }
        app.emit("sidecar-terminated", payload)
            .map_err(|error| error.to_string())
    }

    pub fn emit_workspace_selected(
        &self,
        app: &AppHandle,
        root_path: Option<String>,
    ) -> Result<(), String> {
        let selected = {
            let mut inner = self.inner.lock().unwrap();
            if let Some(root_path) = root_path
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
            {
                inner.workspace = root_path;
            }
            inner.workspace.clone()
        };
        app.emit(
            WORKSPACE_SELECTED_EVENT,
            serde_json::json!({ "rootPath": selected }),
        )
        .map_err(|error| error.to_string())
    }

    pub fn handle_sidecar_message(&self, app: &AppHandle, message: &str) -> Result<(), String> {
        let parsed: Value =
            serde_json::from_str(message).map_err(|error| format!("Invalid IPC message: {error}"))?;
        let id = parsed
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing IPC request id".to_string())?;
        let method = parsed
            .get("method")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing IPC request method".to_string())?;
        let params = parsed.get("params").cloned().unwrap_or_else(|| json!({}));

        let mut inner = self.inner.lock().unwrap();
        if !inner.current.sidecar_ready {
            return Err("Sidecar not running".into());
        }

        let mut notifications: Vec<Value> = Vec::new();
        let result = match method {
            "v1.status" => inner.snapshot_value(),
            "v1.project.load" => {
                let root_path = params
                    .get("rootPath")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let snapshot = inner.load_project(root_path);
                notifications.push(snapshot_notification(snapshot.clone()));
                snapshot
            }
            "v1.project.save" => {
                let snapshot = inner.snapshot_value();
                notifications.push(snapshot_notification(snapshot.clone()));
                snapshot
            }
            "v1.nemoclaw.status" => {
                json!({
                    "gateway": inner.gateway_status(),
                    "activeTeamId": inner.current.active_team_id.clone(),
                    "runtimeProfiles": inner.runtime_profiles(),
                    "sessions": inner.sessions_value(),
                    "approvals": inner.approvals_value()
                })
            }
            "v1.nemoclaw.profiles.list" => inner.runtime_profiles(),
            "v1.nemoclaw.team.apply" => {
                let team_id = params
                    .get("teamId")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let snapshot = inner.apply_team(team_id);
                notifications.push(snapshot_notification(snapshot.clone()));
                snapshot
            }
            "v1.session.start" | "v1.nemoclaw.session.start" => {
                let team_id = params
                    .get("teamId")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let snapshot = inner.start_session(team_id)?;
                notifications.push(snapshot_notification(snapshot.clone()));
                snapshot
            }
            "v1.session.stop" | "v1.nemoclaw.session.stop" => {
                let session_id = params
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let snapshot = inner.stop_session(session_id)?;
                notifications.push(snapshot_notification(snapshot.clone()));
                snapshot
            }
            "v1.nemoclaw.sessions.list" => inner.sessions_value(),
            "v1.nemoclaw.approvals.list" => inner.approvals_value(),
            "v1.command.approval.list" => {
                let task_id = params.get("taskId").and_then(Value::as_str);
                inner.command_approvals_value(task_id)
            }
            "v1.command.approval.resolve" => {
                let approval_id = params
                    .get("approvalId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Missing approval id".to_string())?;
                let action = params
                    .get("action")
                    .and_then(Value::as_str)
                    .unwrap_or("approve");
                let approval = inner.resolve_approval(approval_id, action)?;
                notifications.push(snapshot_notification(inner.snapshot_value()));
                approval
            }
            unknown => {
                let response = json!({
                    "id": id,
                    "error": { "code": -1, "message": format!("Unknown method: {unknown}") }
                });
                app.emit("sidecar-stdout", response.to_string())
                    .map_err(|error| error.to_string())?;
                return Ok(());
            }
        };

        let response = json!({ "id": id, "result": result });
        app.emit("sidecar-stdout", response.to_string())
            .map_err(|error| error.to_string())?;
        for notification in notifications {
            app.emit("sidecar-stdout", notification.to_string())
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }
}

pub fn is_e2e_mode() -> bool {
    env::var("LOCALTEAM_E2E_MODE")
        .ok()
        .is_some_and(|value| matches!(value.trim(), "1" | "true" | "TRUE"))
}

#[tauri::command]
pub async fn get_runtime_context(state: State<'_, E2eState>) -> Result<RuntimeContext, String> {
    Ok(state.runtime_context())
}

#[tauri::command]
pub async fn emit_test_workspace_selected(
    app: AppHandle,
    state: State<'_, E2eState>,
    root_path: Option<String>,
) -> Result<(), String> {
    if !is_e2e_mode() {
        return Err("Test workspace events are only available in E2E mode.".into());
    }

    state.emit_workspace_selected(&app, root_path)
}

#[tauri::command]
pub async fn trigger_test_sidecar_termination(
    app: AppHandle,
    state: State<'_, E2eState>,
    detail: Option<String>,
) -> Result<(), String> {
    if !is_e2e_mode() {
        return Err("Test sidecar termination is only available in E2E mode.".into());
    }

    state.trigger_sidecar_termination(&app, detail)
}

#[tauri::command]
pub async fn shutdown_test_app(app: AppHandle) -> Result<(), String> {
    if !is_e2e_mode() {
        return Err("Test app shutdown is only available in E2E mode.".into());
    }

    app.exit(0);
    Ok(())
}

fn emit_snapshot(app: &AppHandle, snapshot: &Value) -> Result<(), String> {
    app.emit("sidecar-stdout", snapshot_notification(snapshot.clone()).to_string())
        .map_err(|error| error.to_string())
}

fn snapshot_notification(snapshot: Value) -> Value {
    json!({
        "method": "v1.snapshot",
        "params": { "snapshot": snapshot }
    })
}

fn empty_snapshot() -> E2eStateSnapshot {
    E2eStateSnapshot {
        project_loaded: false,
        onboarding_completed: false,
        gateway_ready: false,
        sidecar_ready: true,
        sidecar_error: None,
        active_team_id: None,
        session: None,
        approvals: Vec::new(),
        approval_history: Vec::new(),
        messages: Vec::new(),
    }
}

fn empty_loaded_snapshot(timestamp: u64) -> E2eStateSnapshot {
    E2eStateSnapshot {
        project_loaded: true,
        onboarding_completed: false,
        gateway_ready: false,
        sidecar_ready: true,
        sidecar_error: None,
        active_team_id: Some(default_team_id()),
        session: None,
        approvals: Vec::new(),
        approval_history: Vec::new(),
        messages: vec![
            message(
                "msg-empty-load",
                "architect",
                "Software Architect",
                "system",
                "Workspace loaded. Runtime onboarding is still pending.",
                timestamp,
            ),
        ],
    }
}

fn session_ready_snapshot(timestamp: u64) -> E2eStateSnapshot {
    E2eStateSnapshot {
        project_loaded: true,
        onboarding_completed: true,
        gateway_ready: true,
        sidecar_ready: true,
        sidecar_error: None,
        active_team_id: Some(default_team_id()),
        session: None,
        approvals: Vec::new(),
        approval_history: Vec::new(),
        messages: vec![
            message(
                "msg-ready-1",
                "architect",
                "Software Architect",
                "discussion",
                "Runtime bindings are connected and the team is ready to start.",
                timestamp,
            ),
        ],
    }
}

fn pending_approval_snapshot(timestamp: u64) -> E2eStateSnapshot {
    let approval = E2eApprovalState {
        id: "approval-implementer-status".into(),
        task_id: "task-review-001".into(),
        agent_id: "implementer".into(),
        agent_role: "Implementation Engineer".into(),
        command: "git status --short".into(),
        summary: "Inspect the current workspace before applying changes.".into(),
        status: "pending",
        requested_at: timestamp,
        updated_at: timestamp,
        exit_code: None,
        stdout: None,
        stderr: None,
    };

    E2eStateSnapshot {
        project_loaded: true,
        onboarding_completed: true,
        gateway_ready: true,
        sidecar_ready: true,
        sidecar_error: None,
        active_team_id: Some(default_team_id()),
        session: Some(E2eSessionState {
            id: "session-ops-001".into(),
            status: "running",
            created_at: timestamp,
            updated_at: timestamp,
        }),
        approvals: vec![approval],
        approval_history: Vec::new(),
        messages: vec![
            message(
                "msg-approval-1",
                "implementer",
                "Implementation Engineer",
                "discussion",
                "I need a quick workspace inspection before changing the plan.",
                timestamp + 1_000,
            ),
            message(
                "msg-approval-2",
                "security",
                "Security Engineer",
                "discussion",
                "Waiting for command approval before proceeding.",
                timestamp + 2_000,
            ),
        ],
    }
}

fn bridge_recovery_snapshot(timestamp: u64) -> E2eStateSnapshot {
    E2eStateSnapshot {
        project_loaded: true,
        onboarding_completed: true,
        gateway_ready: true,
        sidecar_ready: true,
        sidecar_error: None,
        active_team_id: Some(default_team_id()),
        session: Some(E2eSessionState {
            id: "session-ops-001".into(),
            status: "running",
            created_at: timestamp,
            updated_at: timestamp,
        }),
        approvals: Vec::new(),
        approval_history: Vec::new(),
        messages: vec![
            message(
                "msg-bridge-1",
                "architect",
                "Software Architect",
                "discussion",
                "Bridge is healthy and streaming activity.",
                timestamp + 1_000,
            ),
            message(
                "msg-bridge-2",
                "implementer",
                "Implementation Engineer",
                "discussion",
                "Ready to resume work after a restart if required.",
                timestamp + 2_000,
            ),
        ],
    }
}

fn build_snapshot(state: &E2eStateSnapshot, workspace: &str, timestamp: u64) -> Value {
    let config = if state.project_loaded {
        Some(project_config())
    } else {
        None
    };
    let runtime_profiles = runtime_profiles(state.onboarding_completed);
    let command_approvals: Vec<Value> = state
        .approvals
        .iter()
        .chain(state.approval_history.iter())
        .map(|approval| approval_to_command_approval(approval, workspace))
        .collect();
    let approvals: Vec<Value> = state
        .approvals
        .iter()
        .chain(state.approval_history.iter())
        .map(approval_summary)
        .collect();

    json!({
        "version": "v1",
        "projectRoot": if state.project_loaded { Some(workspace) } else { None::<&str> },
        "config": config,
        "session": session_value(state.session.as_ref(), workspace),
        "tasks": tasks_value(state.approvals.as_slice()),
        "messages": state.messages,
        "consensus": [],
        "agentStatuses": agent_statuses(
            state.project_loaded,
            state.sidecar_ready,
            state.gateway_ready,
            state.session.as_ref(),
        ),
        "credentials": [],
        "templates": [],
        "commandApprovals": command_approvals,
        "gateway": gateway_status(
            state.gateway_ready,
            state.onboarding_completed,
            if state.project_loaded {
                Some(workspace.to_string())
            } else {
                None
            },
            state.sidecar_error.clone(),
        ),
        "runtimeProfiles": runtime_profiles,
        "sessions": session_summaries(state.session.as_ref()),
        "approvals": approvals,
        "activeTeamId": state.active_team_id.clone(),
        "sidecar": {
            "ready": state.sidecar_ready,
            "version": "0.3.0-e2e",
            "uptime": timestamp,
            "lastError": state.sidecar_error.clone(),
        }
    })
}

fn default_team_id() -> String {
    "ops-alpha".into()
}

fn project_config() -> Value {
    json!({
        "version": 2,
        "defaultTeamId": default_team_id(),
        "teams": [
            {
                "id": "ops-alpha",
                "name": "Operations Alpha",
                "workspaceMode": "shared_project",
                "members": [
                    {
                        "id": "architect",
                        "role": "Software Architect",
                        "systemPrompt": "Drive the plan, keep the team aligned, and summarize tradeoffs before execution.",
                        "runtimeProfileRef": "nemoclaw/local-architect",
                        "runtimeHint": { "provider": "nemoclaw", "model": "openclaw-local" },
                        "tools": ["read_file", "search_code", "propose_task"],
                        "allowedPaths": ["src/", "src-sidecar/", "src-tauri/", "docs/"],
                        "canExecuteCommands": false
                    },
                    {
                        "id": "implementer",
                        "role": "Implementation Engineer",
                        "systemPrompt": "Implement the approved change set and surface blockers quickly.",
                        "runtimeProfileRef": "nemoclaw/hosted-implementer",
                        "runtimeHint": { "provider": "nemoclaw", "model": "openclaw-hosted" },
                        "tools": ["read_file", "search_code", "artifact"],
                        "allowedPaths": ["src/", "src-sidecar/", "src-tauri/"],
                        "canExecuteCommands": true,
                        "preApprovedCommands": ["npm test"]
                    },
                    {
                        "id": "security",
                        "role": "Security Engineer",
                        "systemPrompt": "Review auth, secrets, and sandbox boundaries before merge.",
                        "runtimeProfileRef": "nemoclaw/local-security",
                        "runtimeHint": { "provider": "nemoclaw", "model": "openclaw-local" },
                        "tools": ["read_file", "search_code", "objection"],
                        "allowedPaths": ["src/", "src-sidecar/", "src-tauri/", "docs/"],
                        "canExecuteCommands": false
                    }
                ]
            }
        ],
        "sandbox": {
            "defaultMode": "worktree",
            "useWorktrees": true
        },
        "fileAccess": {
            "denyList": [".env", ".env.*", ".git", ".git/", ".ssh", ".ssh/"]
        }
    })
}

fn runtime_profiles(ready: bool) -> Vec<Value> {
    if !ready {
        return Vec::new();
    }

    vec![
        json!({
            "id": "nemoclaw/local-architect",
            "label": "Architect Local",
            "provider": "nemoclaw",
            "model": "openclaw-local",
            "availability": "ready"
        }),
        json!({
            "id": "nemoclaw/hosted-implementer",
            "label": "Implementer Hosted",
            "provider": "nemoclaw",
            "model": "openclaw-hosted",
            "availability": "ready"
        }),
        json!({
            "id": "nemoclaw/local-security",
            "label": "Security Local",
            "provider": "nemoclaw",
            "model": "openclaw-local",
            "availability": "ready"
        }),
    ]
}

fn gateway_status(
    ready: bool,
    onboarding_completed: bool,
    workspace_root: Option<String>,
    last_error: Option<String>,
) -> Value {
    json!({
        "ready": ready,
        "onboardingCompleted": onboarding_completed,
        "profileCount": if ready { 3 } else { 0 },
        "workspaceRoot": workspace_root,
        "lastError": last_error,
    })
}

fn approval_summary(approval: &E2eApprovalState) -> Value {
    json!({
        "id": approval.id,
        "sessionId": "session-ops-001",
        "summary": approval.summary,
        "status": approval.status,
        "requestedAt": approval.requested_at,
        "updatedAt": approval.updated_at,
        "agentId": approval.agent_id,
        "agentRole": approval.agent_role,
        "command": approval.command,
    })
}

fn approval_to_command_approval(approval: &E2eApprovalState, workspace: &str) -> Value {
    json!({
        "id": approval.id,
        "taskId": approval.task_id,
        "agentId": approval.agent_id,
        "agentRole": approval.agent_role,
        "command": approval.command,
        "effectiveCwd": workspace,
        "status": approval.status,
        "requiresApproval": true,
        "preApproved": false,
        "reason": approval.summary,
        "requestedAt": approval.requested_at,
        "updatedAt": approval.updated_at,
        "exitCode": approval.exit_code,
        "stdout": approval.stdout,
        "stderr": approval.stderr,
        "policy": {
            "sandboxMode": "worktree",
            "checkedPaths": ["src/"],
            "allowedPaths": ["src/", "src-sidecar/", "src-tauri/", "docs/"],
        }
    })
}

fn tasks_value(approvals: &[E2eApprovalState]) -> Vec<Value> {
    approvals
        .iter()
        .map(|approval| {
            json!({
                "id": approval.task_id,
                "title": "Review workspace state",
                "description": "Validate the workspace before implementation changes.",
                "status": "review",
                "assignedAgents": [approval.agent_id],
                "createdAt": approval.requested_at.saturating_sub(30_000),
                "updatedAt": approval.updated_at,
                "tokenEstimate": 64,
                "origin": "user_request",
                "consensusState": "pending",
            })
        })
        .collect()
}

fn session_value(session: Option<&E2eSessionState>, workspace: &str) -> Option<Value> {
    session.map(|session| {
        json!({
            "id": session.id,
            "projectRoot": workspace,
            "projectName": "Operations Alpha",
            "teamId": default_team_id(),
            "createdAt": session.created_at,
            "updatedAt": session.updated_at,
            "status": session.status,
        })
    })
}

fn session_summaries(session: Option<&E2eSessionState>) -> Vec<Value> {
    match session {
        Some(session) => vec![json!({
            "id": session.id,
            "teamId": default_team_id(),
            "title": "Operations Alpha Session",
            "status": if session.status == "running" { "running" } else { "stopped" },
            "createdAt": session.created_at,
            "updatedAt": session.updated_at,
        })],
        None => Vec::new(),
    }
}

fn agent_statuses(
    project_loaded: bool,
    sidecar_ready: bool,
    gateway_ready: bool,
    session: Option<&E2eSessionState>,
) -> Vec<Value> {
    if !project_loaded {
        return Vec::new();
    }

    let running = session.is_some_and(|session| session.status == "running");
    let base_status = if !sidecar_ready || !gateway_ready {
        "unavailable"
    } else if running {
        "idle"
    } else {
        "idle"
    };

    let members = [
        ("architect", "Software Architect", "openclaw-local", "nemoclaw"),
        (
            "implementer",
            "Implementation Engineer",
            "openclaw-hosted",
            "nemoclaw",
        ),
        ("security", "Security Engineer", "openclaw-local", "nemoclaw"),
    ];

    members
        .into_iter()
        .map(|(id, role, model, provider)| {
            let status = if !sidecar_ready || !gateway_ready {
                "unavailable"
            } else if running && id == "architect" {
                "thinking"
            } else if running && id == "implementer" {
                "writing"
            } else {
                base_status
            };

            json!({
                "agentId": id,
                "role": role,
                "model": model,
                "provider": provider,
                "backend": "nemoclaw",
                "status": status,
                "hasCredentials": gateway_ready,
                "lastError": if !sidecar_ready {
                    Some("Bridge is offline.")
                } else if !gateway_ready {
                    Some("Runtime onboarding is still pending.")
                } else {
                    None::<&str>
                },
            })
        })
        .collect()
}

fn message(
    id: &str,
    agent_id: &str,
    agent_role: &str,
    message_type: &str,
    content: &str,
    timestamp: u64,
) -> Value {
    json!({
        "id": id,
        "agentId": agent_id,
        "agentRole": agent_role,
        "type": message_type,
        "content": content,
        "timestamp": timestamp,
    })
}

fn nemoclaw_status(
    onboarding_completed: bool,
    profiles: Vec<Value>,
    last_error: Option<String>,
) -> Value {
    json!({
        "onboardingCompleted": onboarding_completed,
        "profiles": profiles,
        "lastError": last_error,
    })
}
