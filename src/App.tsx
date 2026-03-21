import { useEffect, useRef, useState, type FormEvent } from 'react';
import './App.css';
import { StatusIndicator } from './components/StatusIndicator';
import { CredentialOnboardingPrompt } from './components/CredentialOnboardingPrompt';
import { CommandApprovalsPanel } from './components/CommandApprovalsPanel';
import {
  CredentialsSummaryPanel,
  type CredentialSummaryRow,
} from './components/CredentialsSummaryPanel';
import { CredentialsSurface } from './components/CredentialsSurface';
import { HistoryBrowserPanel } from './components/HistoryBrowserPanel';
import { ProjectSettingsPanel } from './components/ProjectSettingsPanel';
import { TaskGuidancePanel } from './components/TaskGuidancePanel';
import {
  clearProviderKey,
  createVault,
  dismissApiKeyPrompt,
  getCredentialStatus,
  getCredentialOnboardingState,
  lockVault,
  saveProviderKeys,
  subscribeToCredentialEvents,
  type CredentialOnboardingStatus,
  type CredentialStatus as VaultCredentialStatus,
  unlockVault,
} from './lib/credentials';
import {
  callSidecar,
  closeCurrentWindow,
  initIpc,
  isSettingsWindow,
  loadProjectSnapshot,
  openSettingsWindow,
  pickProjectFolder,
  resolveCommandApproval,
  restartSidecar,
  sendTaskGuidance,
  subscribeToWorkspaceSelections,
  subscribeToNotifications,
} from './lib/ipc';
import type {
  AgentMessage,
  CommandApproval,
  AgentStatus,
  ConsensusState,
  MessageStreamDelta,
  MessageStreamFinalization,
  ProjectConfig,
  ProjectSnapshot,
  SidecarNotification,
  Task,
} from './lib/contracts';

interface LiveEvent {
  id: string;
  title: string;
  detail: string;
  timestamp: number;
  tone: 'info' | 'warning' | 'error';
  taskId?: string;
}

type CredentialProviderId = ProjectSnapshot['credentials'][number]['provider'];

const DEFAULT_MESSAGE_LIMIT = 80;
const MESSAGE_PAGE_SIZE = 60;
const MAX_LIVE_EVENTS = 40;
const PROVIDER_ORDER: CredentialProviderId[] = ['openai', 'anthropic'];
const RESTART_SUPPRESSION_WINDOW_MS = 5000;
const PROJECT_ROOT_STORAGE_KEY = 'localteam.preferredProjectRoot';

function App() {
  const isSettingsRoute = isSettingsWindow();
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [vaultPassword, setVaultPassword] = useState('');
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [credentialStatus, setCredentialStatus] = useState<VaultCredentialStatus | null>(null);
  const [showCredentialOnboarding, setShowCredentialOnboarding] = useState(false);
  const [, setCredentialOnboardingStatus] =
    useState<CredentialOnboardingStatus | null>(null);
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [streamingMessageIds, setStreamingMessageIds] = useState<string[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskGuidance, setTaskGuidance] = useState('');
  const [parentTaskId, setParentTaskId] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [conversationScope, setConversationScope] = useState<'selected' | 'all'>('selected');
  const [messageLimit, setMessageLimit] = useState(DEFAULT_MESSAGE_LIMIT);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [activityNote, setActivityNote] = useState<string | null>(null);
  const [projectSettingsError, setProjectSettingsError] = useState<string | null>(null);
  const [projectSettingsBusy, setProjectSettingsBusy] = useState(false);
  const [taskGuidanceBusy, setTaskGuidanceBusy] = useState(false);
  const [taskGuidanceError, setTaskGuidanceError] = useState<string | null>(null);
  const [commandApprovalError, setCommandApprovalError] = useState<string | null>(null);
  const [busyApprovalId, setBusyApprovalId] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [recoveringConnection, setRecoveringConnection] = useState(false);
  const [restartingSidecar, setRestartingSidecar] = useState(false);
  const [overrideText, setOverrideText] = useState('');
  const suppressUnexpectedTerminationUntilRef = useRef(0);

  function appendLiveEvent(event: Omit<LiveEvent, 'id' | 'timestamp'>): void {
    setLiveEvents((current) => [
      ...current.slice(-(MAX_LIVE_EVENTS - 1)),
      {
        ...event,
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        timestamp: Date.now(),
      },
    ]);
  }

  useEffect(() => {
    let unsubscribe = () => {};
    let unlistenWorkspaceSelection = () => {};

    void (async () => {
      try {
        await initIpc();
        unsubscribe = subscribeToNotifications(handleNotification);
        unlistenWorkspaceSelection = await subscribeToWorkspaceSelections((rootPath) => {
          void handleWorkspaceSelected(rootPath);
        });
        const initialCredentialStatus = await getCredentialStatus();
        const initialOnboardingStatus = await getCredentialOnboardingState();
        setCredentialStatus(initialCredentialStatus);
        setCredentialOnboardingStatus(initialOnboardingStatus);
        setVaultUnlocked(initialCredentialStatus.unlocked);

        if (
          !isSettingsRoute &&
          initialOnboardingStatus.shouldPromptForApiKeys
        ) {
          setShowCredentialOnboarding(true);
        }

        if (isSettingsRoute) {
          try {
            const statusSnapshot = await callSidecar<ProjectSnapshot>('v1.status');
            setSnapshot(statusSnapshot);
          } catch {
            // Settings still works without a loaded project snapshot.
          }
          setLoading(false);
          return;
        }

        const initial = await initializeProjectSnapshot();
        setSnapshot(initial);
        setSelectedTemplateId(initial.templates[0]?.id ?? '');
        rememberProjectRoot(initial.projectRoot);
        if (initial.projectRoot && initial.config && !initial.session) {
          const started = await callSidecar<ProjectSnapshot>('v1.session.start');
          setSnapshot(started);
        }
        setLoading(false);
      } catch (error) {
        setConnectionError(
          error instanceof Error ? error.message : 'Failed to initialize LocalTeam',
        );
        setLoading(false);
      }
    })();

    return () => {
      unsubscribe();
      unlistenWorkspaceSelection();
    };
  }, []);

  useEffect(() => {
    setMessageLimit(DEFAULT_MESSAGE_LIMIT);
  }, [conversationScope, selectedTaskId]);

  useEffect(() => {
    let unlisten = () => {};

    void (async () => {
      unlisten = await subscribeToCredentialEvents((event) => {
        if (event.type === 'status') {
          setCredentialStatus(event.status);
          setVaultUnlocked(event.status.unlocked);
          return;
        }

        setCredentialOnboardingStatus(event.onboarding);
        if (!event.onboarding.shouldPromptForApiKeys) {
          setShowCredentialOnboarding(false);
        }
      });
    })();

    return () => {
      unlisten();
    };
  }, []);

  useEffect(() => {
    if (!selectedTemplateId && snapshot?.templates.length) {
      setSelectedTemplateId(snapshot.templates[0].id);
    }
  }, [selectedTemplateId, snapshot?.templates]);

  function handleNotification(notification: SidecarNotification): void {
    if (notification.method === 'v1.sidecar.terminated') {
      if (Date.now() < suppressUnexpectedTerminationUntilRef.current) {
        return;
      }

      setRestartingSidecar(false);
      setConnectionError('Sidecar terminated');
      appendLiveEvent({
        title: 'Sidecar stopped',
        detail: 'The orchestration sidecar terminated unexpectedly.',
        tone: 'error',
      });
      return;
    }

    if (notification.method === 'v1.sidecar.started') {
      suppressUnexpectedTerminationUntilRef.current = 0;
      setRestartingSidecar(false);
      setConnectionError(null);
      appendLiveEvent({
        title: 'Sidecar started',
        detail: 'Realtime orchestration is back online.',
        tone: 'info',
      });
      return;
    }

    if (notification.method === 'v1.task.updated') {
      const task = notification.params.task as Task;
      setSnapshot((current) =>
        current
          ? {
              ...current,
              tasks: upsertById(current.tasks, task),
            }
          : current,
      );
      setSelectedTaskId((current) => current ?? task.id);
      appendLiveEvent({
        title: `Task ${formatStatusLabel(task.status)}`,
        detail: task.title,
        tone: task.status === 'review' ? 'warning' : 'info',
        taskId: task.id,
      });
      return;
    }

    if (notification.method === 'v1.command.approval.updated') {
      const approval = notification.params.approval as CommandApproval;
      setCommandApprovalError(null);
      setSnapshot((current) =>
        current
          ? {
              ...current,
              commandApprovals: upsertCommandApproval(current.commandApprovals, approval),
            }
          : current,
      );
      appendLiveEvent({
        title: `Command ${approval.status}`,
        detail: `${approval.agentRole} • ${summarizeMessage(approval.command)}`,
        tone: approval.status === 'denied' || approval.status === 'failed' ? 'warning' : 'info',
        taskId: approval.taskId,
      });
      return;
    }

    if (notification.method === 'v1.command.approval.required') {
      const approval = notification.params.approval as CommandApproval;
      setCommandApprovalError(null);
      setSnapshot((current) =>
        current
          ? {
              ...current,
              commandApprovals: upsertCommandApproval(current.commandApprovals, approval),
            }
          : current,
      );
      appendLiveEvent({
        title: 'Command approval required',
        detail: `${approval.agentRole} • ${summarizeMessage(approval.command)}`,
        tone: 'warning',
        taskId: approval.taskId,
      });
      return;
    }

    if (notification.method === 'v1.command.execution.completed') {
      const approval = notification.params.approval as CommandApproval;
      setCommandApprovalError(null);
      setSnapshot((current) =>
        current
          ? {
              ...current,
              commandApprovals: upsertCommandApproval(current.commandApprovals, approval),
            }
          : current,
      );
      return;
    }

    if (notification.method === 'v1.task.interjected') {
      const taskId = String(notification.params.taskId ?? '');
      const guidance = String(notification.params.guidance ?? '');
      appendLiveEvent({
        title: 'Task guidance queued',
        detail: summarizeMessage(guidance),
        tone: 'info',
        taskId: taskId || undefined,
      });
      return;
    }

    if (notification.method === 'v1.session.message') {
      const message = notification.params.message as AgentMessage;
      setSnapshot((current) =>
        current
          ? {
              ...current,
              messages: upsertMessage(current.messages, message),
            }
          : current,
      );
      setStreamingMessageIds((current) => current.filter((id) => id !== message.id));
      if (message.taskId) {
        setSelectedTaskId((current) => current ?? message.taskId ?? current);
      }
      appendLiveEvent({
        title: `${message.agentRole} posted`,
        detail: summarizeMessage(message.content),
        tone: message.type === 'objection' ? 'warning' : 'info',
        taskId: message.taskId,
      });
      return;
    }

    if (notification.method === 'v1.session.message.delta') {
      const delta = notification.params.delta as MessageStreamDelta;
      const streamingMessage: AgentMessage = {
        id: delta.messageId,
        agentId: delta.agentId,
        agentRole: delta.agentRole,
        type: 'discussion',
        content: delta.content,
        timestamp: delta.timestamp,
        taskId: delta.taskId,
        round: delta.round,
        tokenEstimate: estimateTokenCount(delta.content),
      };

      setSnapshot((current) =>
        current
          ? {
              ...current,
              messages: upsertMessage(current.messages, streamingMessage),
            }
          : current,
      );
      setStreamingMessageIds((current) =>
        current.includes(delta.messageId) ? current : [...current, delta.messageId],
      );
      setSelectedTaskId((current) => current ?? delta.taskId);
      return;
    }

    if (notification.method === 'v1.session.message.finalized') {
      const finalization = notification.params.finalization as MessageStreamFinalization;
      setStreamingMessageIds((current) =>
        current.filter((id) => id !== finalization.messageId),
      );
      return;
    }

    if (notification.method === 'v1.consensus.updated') {
      const consensus = notification.params.consensus as ConsensusState;
      setSnapshot((current) =>
        current
          ? {
              ...current,
              consensus: upsertByTaskId(current.consensus, consensus),
            }
          : current,
      );
      appendLiveEvent({
        title: `Consensus ${consensus.status}`,
        detail: `Task ${truncateId(consensus.taskId)} • round ${consensus.round}`,
        tone: consensus.status === 'escalated' ? 'warning' : 'info',
        taskId: consensus.taskId,
      });
      return;
    }

    if (notification.method === 'v1.agent.updated') {
      const agent = notification.params.agent as AgentStatus;
      setSnapshot((current) =>
        current
          ? {
              ...current,
              agentStatuses: upsertByAgentId(current.agentStatuses, agent),
            }
          : current,
      );
      if (
        agent.status === 'thinking' ||
        agent.status === 'writing' ||
        agent.status === 'waiting_for_consensus' ||
        agent.status === 'unavailable'
      ) {
        appendLiveEvent({
          title: `${agent.role}`,
          detail: `Status: ${formatAgentStatus(agent.status)}`,
          tone: agent.status === 'unavailable' ? 'error' : 'info',
        });
      }
      return;
    }

    if (notification.method === 'v1.credentials.updated') {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              credentials: notification.params.credentials as ProjectSnapshot['credentials'],
            }
          : current,
      );
      return;
    }

    if (notification.method === 'v1.session.updated') {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              session: notification.params.session as ProjectSnapshot['session'],
            }
          : current,
      );
      const session = notification.params.session as ProjectSnapshot['session'];
      if (session) {
        appendLiveEvent({
          title: 'Session updated',
          detail: `${session.projectName} • ${session.status}`,
          tone: session.status === 'awaiting_user' ? 'warning' : 'info',
        });
      }
      return;
    }

    if (notification.method === 'v1.project.external_change') {
      const relativePath = String(notification.params.relativePath ?? 'unknown');
      setActivityNote(`External file change detected: ${relativePath}`);
      appendLiveEvent({
        title: 'External change detected',
        detail: relativePath,
        tone: 'warning',
      });
      return;
    }

    if (notification.method === 'v1.shell.notification') {
      const title = String(notification.params.title ?? 'LocalTeam');
      const body = String(notification.params.body ?? '');
      setActivityNote(`${title}: ${body}`);
      const level = String(notification.params.level ?? 'info');
      appendLiveEvent({
        title,
        detail: body || 'No details',
        tone: level === 'warning' ? 'warning' : level === 'error' ? 'error' : 'info',
      });
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    }
  }

  async function handleUnlockVault(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!vaultPassword.trim()) {
      setConnectionError('Vault password is required');
      return;
    }
    try {
      const creatingVault = !credentialStatus?.vaultExists;
      const status = credentialStatus?.vaultExists
        ? await unlockVault(vaultPassword)
        : await createVault(vaultPassword);
      setCredentialStatus(status);
      setVaultUnlocked(status.unlocked);
      setVaultPassword('');
      setConnectionError(null);
      if (!isSettingsRoute) {
        const latest = await callSidecar<ProjectSnapshot>('v1.status');
        setSnapshot(latest);
      }
      setActivityNote(
        creatingVault
          ? 'Vault created. Add provider keys to store them securely for this device.'
          : status.providers.some((provider) => provider.hasKey)
            ? 'Vault unlocked. Saved keys synced into the runtime.'
            : 'Vault unlocked. No saved keys were found.',
      );
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        void Notification.requestPermission();
      }
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Failed to unlock credential vault',
      );
    }
  }

  async function handleSaveCredentials(event: FormEvent): Promise<void> {
    event.preventDefault();
    await persistCredentials();
  }

  async function handleSkipOnboarding(): Promise<void> {
    try {
      const onboarding = await dismissApiKeyPrompt();
      setCredentialOnboardingStatus(onboarding);
      setShowCredentialOnboarding(false);
      setActivityNote('API key prompt dismissed for this device. You can reopen Settings any time.');
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Failed to update onboarding preference',
      );
    }
  }

  async function handleOpenCredentialSettings(): Promise<void> {
    setShowCredentialOnboarding(false);
    try {
      await openSettingsWindow();
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Failed to open settings window',
      );
    }
  }

  async function handleCloseCredentialSettings(): Promise<void> {
    if (isSettingsRoute) {
      await closeCurrentWindow();
    }
  }

  async function handleLockVault(): Promise<void> {
    try {
      const status = await lockVault();
      setCredentialStatus(status);
      setVaultUnlocked(status.unlocked);
      setVaultPassword('');
      setOpenaiKey('');
      setAnthropicKey('');
      setConnectionError(null);
      if (!isSettingsRoute) {
        const latest = await callSidecar<ProjectSnapshot>('v1.status');
        setSnapshot(latest);
      }
      setActivityNote('Vault locked. Stored keys remain saved in app data.');
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Failed to lock credential vault',
      );
    }
  }

  async function handleClearCredential(provider: CredentialProviderId): Promise<void> {
    try {
      const status = await clearProviderKey(provider);
      setCredentialStatus(status);
      setVaultUnlocked(status.unlocked);
      const latestSnapshot = isSettingsRoute
        ? snapshot
        : await callSidecar<ProjectSnapshot>('v1.status');
      if (latestSnapshot) {
        setSnapshot(latestSnapshot);
      }
      setActivityNote(`${formatProviderLabel(provider)} key cleared from the vault.`);
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Failed to clear provider credential',
      );
    }
  }

  async function persistCredentials(): Promise<void> {
    const providerInputs: Record<CredentialProviderId, string> = {
      openai: openaiKey,
      anthropic: anthropicKey,
    };
    const savedProviders = getEnteredProviders(providerInputs);

    try {
      const status = await saveProviderKeys({
        openai: openaiKey,
        anthropic: anthropicKey,
      });
      setCredentialStatus(status);
      setVaultUnlocked(status.unlocked);
      setVaultPassword('');
      setOpenaiKey('');
      setAnthropicKey('');
      const latestSnapshot = isSettingsRoute
        ? snapshot
        : await callSidecar<ProjectSnapshot>('v1.status');
      if (latestSnapshot) {
        setSnapshot(latestSnapshot);
      }
      const missingRequiredProviders = latestSnapshot
        ? getMissingRequiredProviders(latestSnapshot)
        : [];
      const syncSummary =
        savedProviders.length === 0
          ? 'Stored credentials synced to the sidecar.'
          : `${formatProviderList(savedProviders)} ${
            savedProviders.length === 1 ? 'key' : 'keys'
            } synced to the sidecar.`;
      setActivityNote(
        missingRequiredProviders.length === 0
          ? syncSummary
          : `${syncSummary} Missing required: ${formatProviderList(
              missingRequiredProviders,
            )}.`,
      );
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Failed to save provider credentials',
      );
    }
  }

  async function handleWorkspaceSelected(rootPath: string): Promise<void> {
    if (isSettingsRoute) {
      return;
    }

    try {
      setProjectSettingsError(null);
      setProjectSettingsBusy(true);
      const latest = await loadProjectSnapshot(rootPath);
      syncLoadedWorkspace(latest, `Loaded git workspace: ${latest.projectRoot ?? rootPath}`, rootPath);
    } catch (error) {
      setProjectSettingsError(
        error instanceof Error ? error.message : 'Failed to load selected git workspace',
      );
    } finally {
      setProjectSettingsBusy(false);
    }
  }

  async function handleApplyTemplate(): Promise<void> {
    if (!selectedTemplateId || !snapshot?.projectRoot) {
      return;
    }

    try {
      const config = await callSidecar<ProjectConfig>('v1.templates.get', {
        id: selectedTemplateId,
      });
      const latest = await callSidecar<ProjectSnapshot>('v1.project.save', { config });
      setSnapshot(latest);
      setActivityNote(`Applied template: ${latest.config?.team.name ?? selectedTemplateId}`);
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Failed to apply team template',
      );
    }
  }

  function syncLoadedWorkspace(latest: ProjectSnapshot, note: string, fallbackRoot?: string | null): void {
    setSnapshot(latest);
    setSelectedTaskId(
      latest.tasks.length > 0 ? latest.tasks[latest.tasks.length - 1].id : null,
    );
    rememberProjectRoot(latest.projectRoot ?? fallbackRoot ?? null);
    setActivityNote(note);
  }

  async function handleChooseWorkspace(): Promise<void> {
    try {
      setProjectSettingsError(null);
      const selectedRoot = await pickProjectFolder(
        snapshot?.projectRoot || getStoredProjectRoot() || undefined,
      );
      if (!selectedRoot) {
        return;
      }

      setProjectSettingsBusy(true);
      const latest = await loadProjectSnapshot(selectedRoot);
      syncLoadedWorkspace(latest, `Loaded git workspace: ${latest.projectRoot ?? selectedRoot}`, selectedRoot);
    } catch (error) {
      setProjectSettingsError(
        error instanceof Error ? error.message : 'Failed to open project folder picker',
      );
    } finally {
      setProjectSettingsBusy(false);
    }
  }

  async function handleReloadWorkspace(): Promise<void> {
    const currentRoot = snapshot?.projectRoot;
    if (!currentRoot) {
      return;
    }

    setProjectSettingsBusy(true);
    setProjectSettingsError(null);
    try {
      const latest = await loadProjectSnapshot(currentRoot);
      syncLoadedWorkspace(latest, `Reloaded git workspace: ${latest.projectRoot ?? currentRoot}`, currentRoot);
    } catch (error) {
      setProjectSettingsError(
        error instanceof Error ? error.message : 'Failed to reload git workspace',
      );
    } finally {
      setProjectSettingsBusy(false);
    }
  }

  async function handleSendTaskGuidance(): Promise<void> {
    if (!selectedTask || !taskGuidance.trim()) {
      return;
    }

    setTaskGuidanceBusy(true);
    try {
      setTaskGuidanceError(null);
      const latest = await sendTaskGuidance(selectedTask.id, taskGuidance.trim());
      setSnapshot(latest);
      setTaskGuidance('');
      setActivityNote(`Guidance sent to ${selectedTask.title}.`);
    } catch (error) {
      setTaskGuidanceError(
        error instanceof Error ? error.message : 'Failed to send task guidance',
      );
    } finally {
      setTaskGuidanceBusy(false);
    }
  }

  async function handleResolveCommandApproval(
    approvalId: string,
    action: 'approve' | 'deny',
  ): Promise<void> {
    setBusyApprovalId(approvalId);
    setCommandApprovalError(null);
    try {
      const updated = await resolveCommandApproval(approvalId, action);
      setSnapshot((current) =>
        current
          ? {
              ...current,
              commandApprovals: upsertCommandApproval(current.commandApprovals, updated),
            }
          : current,
      );
      setActivityNote(
        action === 'approve'
          ? `Approved command for ${updated.agentRole}.`
          : `Denied command for ${updated.agentRole}.`,
      );
    } catch (error) {
      setCommandApprovalError(
        error instanceof Error ? error.message : 'Failed to resolve command approval',
      );
    } finally {
      setBusyApprovalId(null);
    }
  }

  async function handleCreateTask(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!taskTitle.trim() || !taskDescription.trim()) {
      return;
    }

    try {
      const latest = await callSidecar<ProjectSnapshot>('v1.task.create', {
        title: taskTitle.trim(),
        description: taskDescription.trim(),
        parentTaskId: parentTaskId || undefined,
      });
      setSnapshot(latest);
      setTaskTitle('');
      setTaskDescription('');
      setParentTaskId('');
      setOverrideText('');
      const newestTask = latest.tasks[latest.tasks.length - 1];
      if (newestTask) {
        setSelectedTaskId(newestTask.id);
      }
      setActivityNote('Task submitted to the panel. Watch live status updates below.');
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Failed to create task',
      );
    }
  }

  async function handleConsensusAction(
    taskId: string,
    action: 'continue' | 'override' | 'approve_majority',
  ): Promise<void> {
    try {
      const latest = await callSidecar<ProjectSnapshot>('v1.consensus.resolve', {
        taskId,
        action,
        overrideMessage: overrideText.trim() || undefined,
      });
      setSnapshot(latest);
      setOverrideText('');
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Failed to resolve consensus',
      );
    }
  }

  async function handleRestartSidecar(): Promise<void> {
    try {
      suppressUnexpectedTerminationUntilRef.current =
        Date.now() + RESTART_SUPPRESSION_WINDOW_MS;
      setRestartingSidecar(true);
      setActivityNote('Restarting sidecar...');
      await restartSidecar();
      const nextRoot = snapshot?.projectRoot ?? getStoredProjectRoot() ?? undefined;
      const latest = await loadProjectSnapshot(nextRoot);
      setSnapshot(latest);
      rememberProjectRoot(latest.projectRoot ?? nextRoot ?? null);
      suppressUnexpectedTerminationUntilRef.current = 0;
      setRestartingSidecar(false);
      setConnectionError(null);
      setActivityNote('Sidecar restarted and snapshot refreshed.');
    } catch (error) {
      setRestartingSidecar(false);
      setConnectionError(
        error instanceof Error ? error.message : 'Failed to restart sidecar',
      );
    }
  }

  async function handleRefreshSnapshot(): Promise<void> {
    setRecoveringConnection(true);
    try {
      const nextRoot = snapshot?.projectRoot ?? getStoredProjectRoot() ?? undefined;
      const latest = await loadProjectSnapshot(nextRoot);
      setSnapshot(latest);
      rememberProjectRoot(latest.projectRoot ?? nextRoot ?? null);
      setConnectionError(null);
      setActivityNote('Connection restored. Snapshot refreshed.');
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Failed to refresh sidecar snapshot',
      );
    } finally {
      setRecoveringConnection(false);
    }
  }

  const tasks = snapshot?.tasks ?? [];
  const taskLookup = new Map(tasks.map((task) => [task.id, task]));
  const agentLookup = new Map(
    (snapshot?.agentStatuses ?? []).map((agent) => [agent.agentId, agent]),
  );
  const selectedTask =
    tasks.find((task) => task.id === selectedTaskId) ??
    tasks[tasks.length - 1] ??
    null;
  const parentTask =
    selectedTask?.parentTaskId ? taskLookup.get(selectedTask.parentTaskId) ?? null : null;
  const selectedTaskSubtasks = selectedTask
    ? tasks
        .filter((task) => task.parentTaskId === selectedTask.id)
        .sort((left, right) => right.updatedAt - left.updatedAt)
    : [];
  const selectedTaskSiblings =
    selectedTask?.parentTaskId
      ? tasks
          .filter(
            (task) =>
              task.parentTaskId === selectedTask.parentTaskId && task.id !== selectedTask.id,
          )
          .sort((left, right) => right.updatedAt - left.updatedAt)
      : [];
  const selectedTaskAncestors = selectedTask
    ? collectTaskAncestors(selectedTask, taskLookup)
    : [];
  const scopedMessages =
    snapshot?.messages
      .filter((message) => {
        if (conversationScope === 'all') {
          return true;
        }
        return selectedTask ? message.taskId === selectedTask.id : true;
      })
      .sort((left, right) => left.timestamp - right.timestamp) ?? [];
  const hiddenMessageCount = Math.max(0, scopedMessages.length - messageLimit);
  const visibleMessages = scopedMessages.slice(-messageLimit);
  const activeAgents =
    snapshot?.agentStatuses.filter((agent) =>
      ['thinking', 'writing', 'waiting_for_consensus'].includes(agent.status),
    ) ?? [];
  const streamingAgents = selectedTask
    ? activeAgents.filter((agent) => selectedTask.assignedAgents.includes(agent.agentId))
    : activeAgents;
  const latestMessageByAgent = new Map<string, AgentMessage>();
  for (const message of snapshot?.messages ?? []) {
    latestMessageByAgent.set(message.agentId, message);
  }
  const activeTasks = tasks.filter((task) => task.status === 'in_progress').length;
  const streamingMessageIdSet = new Set(streamingMessageIds);
  const selectedConsensus = snapshot?.consensus.find(
    (entry) => entry.taskId === selectedTask?.id,
  );
  const requiredProviders = getRequiredProviders(snapshot?.config);
  const projectReady = Boolean(snapshot?.config);
  const requiredProviderSet = new Set(requiredProviders);
  const runtimeCredentialLookup = new Map(
    (snapshot?.credentials ?? []).map((item) => [item.provider, item.hasKey]),
  );
  const storedCredentialLookup = new Map(
    (credentialStatus?.providers ?? []).map((item) => [item.provider, item.hasKey]),
  );
  const credentialRows: CredentialSummaryRow[] = PROVIDER_ORDER.map((provider) => ({
    provider,
    hasStoredKey: storedCredentialLookup.get(provider) ?? false,
    hasRuntimeKey: runtimeCredentialLookup.get(provider) ?? false,
    required: requiredProviderSet.has(provider),
  }));
  const missingRequiredProviders = credentialRows.filter(
    (credential) => credential.required && !credential.hasStoredKey,
  );
  const unsyncedRequiredProviders = credentialRows.filter(
    (credential) =>
      credential.required && credential.hasStoredKey && !credential.hasRuntimeKey,
  );
  const providerInputs: Record<CredentialProviderId, string> = {
    openai: openaiKey,
    anthropic: anthropicKey,
  };
  const enteredProviders = getEnteredProviders(providerInputs);
  const hasStoredKeys = credentialRows.some((credential) => credential.hasStoredKey);
  const saveCredentialButtonLabel =
    enteredProviders.length === 0
      ? hasStoredKeys
        ? 'Sync Stored Keys'
        : 'Save Keys'
      : enteredProviders.length === 1
        ? `Save & Sync ${formatProviderLabel(enteredProviders[0])} Key`
        : 'Save & Sync Keys';
  const vaultExists = credentialStatus?.vaultExists ?? false;
  const credentialPanelStatus = vaultUnlocked
    ? snapshot?.config
      ? missingRequiredProviders.length > 0 || unsyncedRequiredProviders.length > 0
        ? `${missingRequiredProviders.length + unsyncedRequiredProviders.length} action needed`
        : requiredProviders.length > 0
          ? 'Ready'
          : 'Optional'
      : 'Unlocked'
    : !vaultExists
      ? 'Not set up'
    : credentialRows.some((credential) => credential.hasStoredKey)
      ? 'Locked • keys saved'
      : 'Locked';
  const unlockButtonLabel = vaultUnlocked
    ? 'Vault Unlocked'
    : !vaultExists
      ? 'Create Vault'
    : hasStoredKeys
      ? 'Unlock & Sync Saved Keys'
      : 'Unlock Vault';

  if (isSettingsRoute) {
    return (
      <div className="app-shell settings-app-shell">
        <header className="hero settings-hero">
          <div>
            <p className="eyebrow">Settings window</p>
            <h1>Agent API Keys</h1>
            <p className="hero-copy">
              Manage vault access and provider keys in a dedicated surface instead of the main
              workspace dashboard.
            </p>
          </div>
        <div className="hero-actions">
          <StatusIndicator snapshot={snapshot} connectionError={connectionError} />
          <button
            className="secondary-button"
            type="button"
            onClick={() => void handleCloseCredentialSettings()}
          >
              Return to Workspace
          </button>
        </div>
        </header>

        {activityNote && <div className="activity-banner">{activityNote}</div>}

        <main className="settings-page">
          <CredentialsSurface
            title="Agent API Keys"
            description="Unlock the vault, update stored provider keys, and keep the dashboard focused on active work."
            statusLabel={credentialPanelStatus}
            credentialRows={credentialRows}
            vaultUnlocked={vaultUnlocked}
            vaultExists={vaultExists}
            loading={loading}
            error={connectionError}
            vaultPassword={vaultPassword}
            openaiKey={openaiKey}
            anthropicKey={anthropicKey}
            canSave={enteredProviders.length > 0 || hasStoredKeys}
            onVaultPasswordChange={setVaultPassword}
            onOpenaiKeyChange={setOpenaiKey}
            onAnthropicKeyChange={setAnthropicKey}
            onUnlockVault={handleUnlockVault}
            onSaveCredentials={handleSaveCredentials}
            onClearProvider={(provider) => void handleClearCredential(provider)}
            onLockVault={handleLockVault}
            onClose={() => void handleCloseCredentialSettings()}
            unlockButtonLabel={unlockButtonLabel}
            saveButtonLabel={saveCredentialButtonLabel}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Windows-first agent workstation</p>
          <h1>LocalTeam</h1>
          <p className="hero-copy">
            Choose a git workspace, manage agent keys from Settings, and watch the panel debate
            tasks in real time.
          </p>
        </div>
        <div className="hero-actions">
          <StatusIndicator snapshot={snapshot} connectionError={connectionError} />
          <button
            className="secondary-button"
            type="button"
            onClick={() => void handleOpenCredentialSettings()}
          >
            Settings
          </button>
          <button
            className="secondary-button"
            onClick={handleRestartSidecar}
            disabled={restartingSidecar}
          >
            {restartingSidecar ? 'Restarting Sidecar...' : 'Restart Sidecar'}
          </button>
        </div>
      </header>

      {activityNote && <div className="activity-banner">{activityNote}</div>}
      {connectionError && (
        <div className="panel recovery-panel" role="alert">
          <div className="panel-header">
            <h2>Connection Recovery</h2>
            <span>
              {restartingSidecar
                ? 'Restarting'
                : recoveringConnection
                  ? 'Recovering'
                  : 'Action required'}
            </span>
          </div>
          <p className="recovery-copy">{connectionError}</p>
          <div className="recovery-actions">
            <button
              className="secondary-button"
              onClick={handleRefreshSnapshot}
              disabled={recoveringConnection || restartingSidecar}
            >
              Retry Snapshot
            </button>
            <button
              className="primary-button"
              onClick={handleRestartSidecar}
              disabled={recoveringConnection || restartingSidecar}
            >
              {restartingSidecar ? 'Restarting...' : 'Restart & Reconnect'}
            </button>
          </div>
        </div>
      )}

      <main className="workspace">
        <section className="left-column">
          <div className="panel composer-panel">
            <div className="panel-header">
              <h2>Task Composer</h2>
              <span>
                {snapshot?.config?.team.name ?? 'No workspace selected'}
              </span>
            </div>
            <form className="task-form" onSubmit={handleCreateTask}>
              <input
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                placeholder="Task title"
              />
              <textarea
                value={taskDescription}
                onChange={(event) => setTaskDescription(event.target.value)}
                placeholder="Describe the work and decision pressure."
                rows={4}
              />
              <select
                value={parentTaskId}
                onChange={(event) => setParentTaskId(event.target.value)}
              >
                <option value="">Top-level task (no parent)</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
              <div className="inline-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!selectedTask}
                  onClick={() => setParentTaskId(selectedTask?.id ?? '')}
                >
                  Use Selected Task As Parent
                </button>
              </div>
              {!projectReady && (
                <p className="recovery-copy">
                  Choose a git workspace before starting a discussion. LocalTeam keeps its
                  settings in app data and runs tasks against the selected repository.
                </p>
              )}
              <button className="primary-button" type="submit" disabled={!projectReady || loading}>
                Start Discussion
              </button>
            </form>
          </div>

          <div className="panel conversation-panel">
            <div className="panel-header">
              <h2>Conversation Stream</h2>
              <span>{selectedTask?.title ?? 'All activity'}</span>
            </div>
            <div className="conversation-toolbar">
              <div className="scope-toggle" role="group" aria-label="Conversation scope">
                <button
                  className={`secondary-button ${conversationScope === 'selected' ? 'active' : ''}`}
                  onClick={() => setConversationScope('selected')}
                >
                  Selected Task
                </button>
                <button
                  className={`secondary-button ${conversationScope === 'all' ? 'active' : ''}`}
                  onClick={() => setConversationScope('all')}
                >
                  All Tasks
                </button>
              </div>
              <span>{scopedMessages.length} messages</span>
            </div>
            {(streamingAgents.length > 0 || activeTasks > 0) && (
              <div className="live-stream-banner" data-testid="streaming-indicator">
                <strong>
                  {streamingAgents.length > 0
                    ? `Live stream active: ${streamingAgents.length} agent${
                        streamingAgents.length === 1 ? '' : 's'
                      }`
                    : `Task execution in progress (${activeTasks})`}
                </strong>
                <div className="live-agent-list">
                  {streamingAgents.map((agent) => (
                    <div key={agent.agentId} className="live-agent-row">
                      <span>{agent.role}</span>
                      <span>{formatAgentStatus(agent.status)}</span>
                      <span>{summarizeMessage(latestMessageByAgent.get(agent.agentId)?.content)}</span>
                    </div>
                  ))}
                  {streamingAgents.length === 0 && (
                    <div className="live-agent-row">
                      <span>Waiting for agent output…</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            {hiddenMessageCount > 0 && (
              <button
                className="secondary-button show-older-button"
                onClick={() =>
                  setMessageLimit((current) => Math.min(current + MESSAGE_PAGE_SIZE, scopedMessages.length))
                }
              >
                Show {Math.min(MESSAGE_PAGE_SIZE, hiddenMessageCount)} older messages
              </button>
            )}
            <div className="message-list">
              {loading && <div className="empty-state">Loading project state…</div>}
              {!loading && visibleMessages.length === 0 && (
                <div className="empty-state">No messages yet. Start a task to begin.</div>
              )}
              {visibleMessages.map((message) => (
                <article
                  key={message.id}
                  className={`message-card type-${message.type} ${
                    streamingMessageIdSet.has(message.id) ? 'streaming' : ''
                  }`}
                >
                  <header className="message-header">
                    <div className="message-author">
                      <span className="message-monogram">
                        {getRoleMonogram(message.agentRole)}
                      </span>
                      <div className="message-author-copy">
                        <strong>{message.agentRole}</strong>
                        <div className="message-badge-row">
                          <span className={`message-type-badge badge-${message.type}`}>
                            {message.type}
                          </span>
                          <span className="message-thread-chip">
                            {message.taskId
                              ? taskLookup.get(message.taskId)?.title ?? truncateId(message.taskId)
                              : 'No task'}
                          </span>
                          <span className="message-thread-chip">Round {message.round ?? 1}</span>
                        </div>
                      </div>
                    </div>
                    <span>{formatTimestamp(message.timestamp)}</span>
                  </header>
                  <p>{message.content}</p>
                  <footer>
                    {streamingMessageIdSet.has(message.id) && <span>streaming</span>}
                    <span>{message.tokenEstimate ?? 0} tok est.</span>
                  </footer>
                </article>
              ))}
            </div>

            {selectedConsensus?.status === 'escalated' && selectedTask && (
              <div className="consensus-panel">
                <div className="panel-header">
                  <h3>Consensus Escalation</h3>
                  <span>Round {selectedConsensus.round}</span>
                </div>
                <div className="consensus-summary">
                  {selectedConsensus.summary.map((position) => (
                    <div key={position.agentId} className="consensus-item">
                      <strong>{position.agentId}</strong>
                      <p>{position.position}</p>
                    </div>
                  ))}
                </div>
                <textarea
                  value={overrideText}
                  onChange={(event) => setOverrideText(event.target.value)}
                  placeholder="Optional user guidance or override note"
                  rows={3}
                />
                <div className="consensus-actions">
                  <button
                    className="secondary-button"
                    onClick={() => handleConsensusAction(selectedTask.id, 'continue')}
                  >
                    Run Another Round
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => handleConsensusAction(selectedTask.id, 'override')}
                  >
                    Approve Override
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="right-column">
          <ProjectSettingsPanel
            currentRoot={snapshot?.projectRoot ?? null}
            onChooseWorkspace={() => void handleChooseWorkspace()}
            onReloadWorkspace={() => void handleReloadWorkspace()}
            loading={loading}
            busy={projectSettingsBusy}
            error={projectSettingsError}
            config={snapshot?.config ?? null}
          />

          <CommandApprovalsPanel
            approvals={snapshot?.commandApprovals ?? []}
            tasks={tasks}
            selectedTaskId={selectedTask?.id ?? null}
            busyApprovalId={busyApprovalId}
            error={commandApprovalError}
            onApprove={(approvalId) => void handleResolveCommandApproval(approvalId, 'approve')}
            onDeny={(approvalId) => void handleResolveCommandApproval(approvalId, 'deny')}
          />

          <CredentialsSummaryPanel
            credentialRows={credentialRows}
            statusLabel={credentialPanelStatus}
            vaultUnlocked={vaultUnlocked}
            onOpenSettings={() => void handleOpenCredentialSettings()}
            onLockVault={handleLockVault}
          />

          <div className="panel">
            <div className="panel-header">
              <h2>Team Template</h2>
              <span>{snapshot?.templates.length ?? 0} available</span>
            </div>
            <select
              value={selectedTemplateId}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
            >
              {(snapshot?.templates ?? []).map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <button
              className="secondary-button"
              type="button"
              onClick={handleApplyTemplate}
              disabled={!projectReady || !selectedTemplateId}
            >
              {projectReady ? 'Apply Template' : 'Select Workspace First'}
            </button>
            {!projectReady && (
              <p className="recovery-copy">
                Choose a git workspace before applying a team template.
              </p>
            )}
            <div className="template-meta">
              <p>
                {snapshot?.templates.find((template) => template.id === selectedTemplateId)
                  ?.description ?? 'Select a template to update the active workspace settings stored in app data.'}
              </p>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Agent Panel</h2>
              <span>{snapshot?.agentStatuses.length ?? 0} agents</span>
            </div>
            <div className="agent-list">
              {(snapshot?.agentStatuses ?? []).map((agent) => (
                <button
                  key={agent.agentId}
                  className={`agent-card status-${agent.status}`}
                  onClick={() => {
                    const matchingTask = tasks.find((task) =>
                      task.assignedAgents.includes(agent.agentId),
                    );
                    if (matchingTask) {
                      setSelectedTaskId(matchingTask.id);
                    }
                  }}
                >
                  <strong>{agent.role}</strong>
                  <span>{agent.model}</span>
                  <span>{agent.provider}</span>
                  <span>{formatAgentStatus(agent.status)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Task Flow</h2>
              <span>{selectedTask ? truncateId(selectedTask.id) : 'No task selected'}</span>
            </div>
            {!selectedTask && (
              <div className="empty-state">
                Select a task to inspect assignment, parent chain, and subtasks.
              </div>
            )}
            {selectedTask && (
              <div className="task-flow">
                <div className="task-flow-section">
                  <strong>Assigned agents</strong>
                  <div className="task-chip-list">
                    {selectedTask.assignedAgents.map((agentId) => {
                      const agent = agentLookup.get(agentId);
                      return (
                        <span key={agentId} className="task-chip">
                          {agent?.role ?? agentId} • {formatAgentStatus(agent?.status ?? 'idle')}
                        </span>
                      );
                    })}
                  </div>
                </div>
                {selectedTaskAncestors.length > 0 && (
                  <div className="task-flow-section">
                    <strong>Parent chain</strong>
                    <div className="task-link-list">
                      {selectedTaskAncestors.map((task) => (
                        <button
                          key={task.id}
                          className="task-link"
                          type="button"
                          onClick={() => setSelectedTaskId(task.id)}
                        >
                          {task.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {parentTask && (
                  <div className="task-flow-section">
                    <strong>Parent task</strong>
                    <button
                      className="task-link"
                      type="button"
                      onClick={() => setSelectedTaskId(parentTask.id)}
                    >
                      {parentTask.title}
                    </button>
                  </div>
                )}
                <div className="task-flow-section">
                  <strong>Subtasks ({selectedTaskSubtasks.length})</strong>
                  {selectedTaskSubtasks.length === 0 && (
                    <span className="task-flow-empty">No subtasks linked yet.</span>
                  )}
                  <div className="task-link-list">
                    {selectedTaskSubtasks.map((task) => (
                      <button
                        key={task.id}
                        className="task-link"
                        type="button"
                        onClick={() => setSelectedTaskId(task.id)}
                      >
                        {task.title}
                      </button>
                    ))}
                  </div>
                </div>
                {selectedTaskSiblings.length > 0 && (
                  <div className="task-flow-section">
                    <strong>Sibling subtasks</strong>
                    <div className="task-link-list">
                      {selectedTaskSiblings.map((task) => (
                        <button
                          key={task.id}
                          className="task-link"
                          type="button"
                          onClick={() => setSelectedTaskId(task.id)}
                        >
                          {task.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <TaskGuidancePanel
            selectedTask={selectedTask}
            guidance={taskGuidance}
            onGuidanceChange={(value) => {
              setTaskGuidance(value);
              setTaskGuidanceError(null);
            }}
            busy={taskGuidanceBusy}
            error={taskGuidanceError}
            onSendGuidance={() => void handleSendTaskGuidance()}
          />

          <HistoryBrowserPanel
            tasks={tasks}
            messages={snapshot?.messages ?? []}
            selectedTaskId={selectedTask?.id ?? null}
            onSelectTask={(taskId) => setSelectedTaskId(taskId)}
          />

          <div className="panel">
            <div className="panel-header">
              <h2>Live Event Feed</h2>
              <span>{liveEvents.length} recent</span>
            </div>
            <div className="event-list">
              {liveEvents.length === 0 && (
                <div className="empty-state">Runtime events will appear here as work streams in.</div>
              )}
              {[...liveEvents].reverse().map((event) => (
                <div key={event.id} className={`event-card tone-${event.tone}`}>
                  <header>
                    <strong>{event.title}</strong>
                    <span>{formatTimestamp(event.timestamp)}</span>
                  </header>
                  <p>{event.detail}</p>
                  {event.taskId && <span>{truncateId(event.taskId)}</span>}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </main>

      <section className="board-shell">
        <div className="board-header">
          <h2>Task Board</h2>
          <span>
            {snapshot?.projectRoot ?? 'No git workspace selected'}
          </span>
        </div>
        <div className="board-grid">
          {(['pending', 'in_progress', 'review', 'completed'] as const).map((status) => (
            <div key={status} className="board-column">
              <header>{formatStatusLabel(status)}</header>
              <div className="board-cards">
                {tasks
                  .filter((task) => task.status === status)
                  .map((task) => (
                    <button
                      key={task.id}
                      className={`task-card ${task.id === selectedTask?.id ? 'selected' : ''}`}
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      <strong>{task.title}</strong>
                      <p>{task.description}</p>
                      <div className="task-card-meta">
                        {task.parentTaskId && (
                          <span>
                            Subtask of {taskLookup.get(task.parentTaskId)?.title ?? truncateId(task.parentTaskId)}
                          </span>
                        )}
                        {tasks.some((entry) => entry.parentTaskId === task.id) && (
                          <span>
                            {tasks.filter((entry) => entry.parentTaskId === task.id).length} subtasks
                          </span>
                        )}
                        {task.sandboxDiffStat && <span>Sandbox: {task.sandboxDiffStat}</span>}
                        {task.sessionId && <span>Session {truncateId(task.sessionId)}</span>}
                      </div>
                      <footer>
                        <span>{task.assignedAgents.length} agents</span>
                        <span>{task.tokenEstimate} tok est.</span>
                        <span>{task.consensusState ?? 'pending'}</span>
                      </footer>
                    </button>
                  ))}
                {tasks.filter((task) => task.status === status).length === 0 && (
                  <div className="empty-column">No tasks</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {showCredentialOnboarding && (
        <div className="modal-backdrop">
          <CredentialOnboardingPrompt
            onOpenSettings={() => void handleOpenCredentialSettings()}
            onSkip={() => void handleSkipOnboarding()}
          />
        </div>
      )}
    </div>
  );
}

function upsertById<T extends { id: string }>(items: T[], next: T): T[] {
  return [...items.filter((item) => item.id !== next.id), next].sort(
    (left, right) => {
      const leftUpdated = 'updatedAt' in left ? Number(left.updatedAt) : 0;
      const rightUpdated = 'updatedAt' in right ? Number(right.updatedAt) : 0;
      return leftUpdated - rightUpdated;
    },
  );
}

function upsertCommandApproval(
  items: CommandApproval[],
  next: CommandApproval,
): CommandApproval[] {
  return [...items.filter((item) => item.id !== next.id), next].sort(
    (left, right) => left.requestedAt - right.requestedAt,
  );
}

function upsertByTaskId(items: ConsensusState[], next: ConsensusState): ConsensusState[] {
  return [...items.filter((item) => item.taskId !== next.taskId), next].sort(
    (left, right) => left.updatedAt - right.updatedAt,
  );
}

function upsertByAgentId(items: AgentStatus[], next: AgentStatus): AgentStatus[] {
  return [...items.filter((item) => item.agentId !== next.agentId), next].sort(
    (left, right) => left.role.localeCompare(right.role),
  );
}

function upsertMessage(items: AgentMessage[], next: AgentMessage): AgentMessage[] {
  return [...items.filter((item) => item.id !== next.id), next].sort(
    (left, right) =>
      left.timestamp - right.timestamp || left.id.localeCompare(right.id),
  );
}

function collectTaskAncestors(
  task: Task,
  taskLookup: Map<string, Task>,
): Task[] {
  const chain: Task[] = [];
  let pointer = task.parentTaskId ? taskLookup.get(task.parentTaskId) : undefined;
  while (pointer) {
    chain.unshift(pointer);
    pointer = pointer.parentTaskId ? taskLookup.get(pointer.parentTaskId) : undefined;
  }
  return chain;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncateId(value: string): string {
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 8)}…`;
}

function summarizeMessage(content: string | undefined): string {
  if (!content) {
    return 'Streaming in progress…';
  }
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'Streaming in progress…';
  }
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 77)}...`;
}

function getRoleMonogram(role: string): string {
  const parts = role
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return 'LT';
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

async function initializeProjectSnapshot(): Promise<ProjectSnapshot> {
  const storedRoot = getStoredProjectRoot();
  if (!storedRoot) {
    return callSidecar<ProjectSnapshot>('v1.status');
  }

  try {
    return await loadProjectSnapshot(storedRoot);
  } catch {
    clearStoredProjectRoot();
    return callSidecar<ProjectSnapshot>('v1.status');
  }
}

function rememberProjectRoot(rootPath: string | null | undefined): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (rootPath && rootPath.trim()) {
    window.localStorage.setItem(PROJECT_ROOT_STORAGE_KEY, rootPath);
    return;
  }

  window.localStorage.removeItem(PROJECT_ROOT_STORAGE_KEY);
}

function getStoredProjectRoot(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage.getItem(PROJECT_ROOT_STORAGE_KEY);
}

function clearStoredProjectRoot(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(PROJECT_ROOT_STORAGE_KEY);
}

function formatAgentStatus(status: AgentStatus['status']): string {
  return status.replace(/_/g, ' ');
}

function estimateTokenCount(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}

function getRequiredProviders(
  config: ProjectConfig | null | undefined,
): CredentialProviderId[] {
  const providers = new Set<CredentialProviderId>();
  for (const agent of config?.team.agents ?? []) {
    if (agent.provider === 'mock') {
      continue;
    }
    providers.add(agent.provider);
  }
  return PROVIDER_ORDER.filter((provider) => providers.has(provider));
}

function getMissingRequiredProviders(
  snapshot: Pick<ProjectSnapshot, 'config' | 'credentials'>,
): CredentialProviderId[] {
  const requiredProviders = getRequiredProviders(snapshot.config);
  const readyProviders = new Set(
    snapshot.credentials.filter((credential) => credential.hasKey).map((credential) => credential.provider),
  );
  return requiredProviders.filter((provider) => !readyProviders.has(provider));
}

function getEnteredProviders(
  inputs: Record<CredentialProviderId, string>,
): CredentialProviderId[] {
  return PROVIDER_ORDER.filter((provider) => inputs[provider].trim().length > 0);
}

function formatProviderLabel(provider: CredentialProviderId): string {
  switch (provider) {
    case 'openai':
      return 'OpenAI';
    case 'anthropic':
      return 'Anthropic';
  }
}

function formatProviderList(providers: CredentialProviderId[]): string {
  const labels = providers.map(formatProviderLabel);
  if (labels.length <= 1) {
    return labels[0] ?? '';
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

function formatStatusLabel(status: Task['status']): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'in_progress':
      return 'In Progress';
    case 'review':
      return 'Review';
    case 'completed':
      return 'Completed';
  }
}

export default App;
