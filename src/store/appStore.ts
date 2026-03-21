import { create } from 'zustand';
import type {
  ProjectSnapshot, AgentStatus, Task, AgentMessage,
  RecentProject
} from './types';

const RECENTS_KEY = 'localteam.recents';
const MAX_RECENTS = 10;

interface AppStore {
  // Multi-project
  recentProjects: RecentProject[];
  activeProjectPath: string | null;

  // Current loaded project snapshot
  snapshot: ProjectSnapshot | null;

  // Derived lookup maps (rebuilt on each snapshot/upsert)
  agentStatusMap: Record<string, AgentStatus>;   // agentId → status
  taskMap: Record<string, Task>;                  // taskId → task
  messagesByTask: Record<string, AgentMessage[]>; // taskId → messages[]

  // Actions
  setSnapshot: (s: ProjectSnapshot) => void;
  upsertAgentStatus: (s: AgentStatus) => void;
  upsertTask: (t: Task) => void;
  appendMessage: (m: AgentMessage) => void;
  addRecentProject: (p: RecentProject) => void;
  loadRecents: () => void;
  setActiveProjectPath: (path: string | null) => void;
}

export const useAppStore = create<AppStore>()((set, get) => ({
  recentProjects: [],
  activeProjectPath: null,
  snapshot: null,
  agentStatusMap: {},
  taskMap: {},
  messagesByTask: {},

  setSnapshot: (s: ProjectSnapshot) => {
    const agentStatusMap: Record<string, AgentStatus> = {};
    for (const status of s.agentStatuses) {
      agentStatusMap[status.agentId] = status;
    }

    const taskMap: Record<string, Task> = {};
    for (const task of s.tasks) {
      taskMap[task.id] = task;
    }

    const messagesByTask: Record<string, AgentMessage[]> = {};
    for (const msg of s.messages) {
      const key = msg.taskId ?? '';
      if (!messagesByTask[key]) {
        messagesByTask[key] = [];
      }
      messagesByTask[key].push(msg);
    }

    set({ snapshot: s, agentStatusMap, taskMap, messagesByTask });
  },

  upsertAgentStatus: (s: AgentStatus) => {
    const { snapshot, agentStatusMap } = get();

    const newAgentStatusMap = { ...agentStatusMap, [s.agentId]: s };

    let newSnapshot = snapshot;
    if (snapshot) {
      const idx = snapshot.agentStatuses.findIndex(a => a.agentId === s.agentId);
      const newStatuses = [...snapshot.agentStatuses];
      if (idx >= 0) {
        newStatuses[idx] = s;
      } else {
        newStatuses.push(s);
      }
      newSnapshot = { ...snapshot, agentStatuses: newStatuses };
    }

    set({ agentStatusMap: newAgentStatusMap, snapshot: newSnapshot });
  },

  upsertTask: (t: Task) => {
    const { snapshot, taskMap } = get();

    const newTaskMap = { ...taskMap, [t.id]: t };

    let newSnapshot = snapshot;
    if (snapshot) {
      const idx = snapshot.tasks.findIndex(task => task.id === t.id);
      const newTasks = [...snapshot.tasks];
      if (idx >= 0) {
        newTasks[idx] = t;
      } else {
        newTasks.push(t);
      }
      newSnapshot = { ...snapshot, tasks: newTasks };
    }

    set({ taskMap: newTaskMap, snapshot: newSnapshot });
  },

  appendMessage: (m: AgentMessage) => {
    const { snapshot, messagesByTask } = get();

    const key = m.taskId ?? '';
    const existing = messagesByTask[key] ?? [];
    const newMessagesByTask = { ...messagesByTask, [key]: [...existing, m] };

    let newSnapshot = snapshot;
    if (snapshot) {
      newSnapshot = { ...snapshot, messages: [...snapshot.messages, m] };
    }

    set({ messagesByTask: newMessagesByTask, snapshot: newSnapshot });
  },

  addRecentProject: (p: RecentProject) => {
    const { recentProjects } = get();

    // Prepend new entry, deduplicate by path (keep newest), trim to max
    const deduped = [p, ...recentProjects.filter(r => r.path !== p.path)];
    const trimmed = deduped.slice(0, MAX_RECENTS);

    localStorage.setItem(RECENTS_KEY, JSON.stringify(trimmed));
    set({ recentProjects: trimmed });
  },

  loadRecents: () => {
    try {
      const raw = localStorage.getItem(RECENTS_KEY);
      const parsed = raw ? (JSON.parse(raw) as RecentProject[]) : [];
      set({ recentProjects: parsed });
    } catch {
      set({ recentProjects: [] });
    }
  },

  setActiveProjectPath: (path: string | null) => {
    set({ activeProjectPath: path });
  },
}));
