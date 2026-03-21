import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import initSqlJs from 'sql.js/dist/sql-asm.js';
import type { Database, SqlJsStatic } from 'sql.js';
import type { ProjectConfig } from './types.js';
import type {
  AgentMessage,
  CommandApproval,
  ConsensusState,
  SessionState,
  Task,
} from './types.js';

let sqlPromise: Promise<SqlJsStatic> | null = null;

const APP_DATA_DIR_ENV = 'LOCALTEAM_APP_DATA_DIR';
const WORKSPACE_STORAGE_DIR = 'workspaces';
const WORKSPACE_CONFIG_FILE = 'project-config.json';
const WORKSPACE_DATABASE_FILE = 'localteam.db';

interface PersistedState {
  session: SessionState | null;
  tasks: Task[];
  messages: AgentMessage[];
  consensus: ConsensusState[];
  commandApprovals: CommandApproval[];
}

interface QueryResult {
  values: unknown[][];
}

async function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs();
  }
  return sqlPromise;
}

export class ProjectDatabase {
  private constructor(
    readonly rootPath: string,
    readonly dbPath: string,
    private db: Database,
  ) {}

  static async open(rootPath: string): Promise<ProjectDatabase> {
    const sql = await getSql();
    const dbPath = resolveWorkspaceDatabasePath(rootPath);

    await mkdir(dirname(dbPath), { recursive: true });
    let buffer: Uint8Array | undefined;
    try {
      buffer = new Uint8Array(await readFile(dbPath));
    } catch {
      buffer = undefined;
    }

    const db = buffer ? new sql.Database(buffer) : new sql.Database();
    const store = new ProjectDatabase(rootPath, dbPath, db);
    store.initialize();
    await store.flush();
    return store;
  }

  private initialize(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_root TEXT NOT NULL,
        project_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        assigned_agents TEXT NOT NULL,
        parent_task_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        token_estimate INTEGER NOT NULL,
        session_id TEXT,
        consensus_state TEXT,
        sandbox_path TEXT,
        sandbox_diff_stat TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        agent_role TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        task_id TEXT,
        round INTEGER,
        token_estimate INTEGER,
        meta_json TEXT
      );

      CREATE TABLE IF NOT EXISTS consensus (
        task_id TEXT PRIMARY KEY,
        round INTEGER NOT NULL,
        status TEXT NOT NULL,
        supporters_json TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS command_approvals (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        agent_role TEXT NOT NULL,
        command TEXT NOT NULL,
        requested_cwd TEXT,
        effective_cwd TEXT NOT NULL,
        status TEXT NOT NULL,
        requires_approval INTEGER NOT NULL,
        pre_approved INTEGER NOT NULL,
        reason TEXT,
        requested_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        decided_at INTEGER,
        completed_at INTEGER,
        exit_code INTEGER,
        stdout TEXT,
        stderr TEXT,
        policy_json TEXT NOT NULL
      );
    `);
  }

  async loadState(): Promise<PersistedState> {
    const sessionResult = this.db.exec(`
      SELECT id, project_root, project_name, created_at, updated_at, status
      FROM sessions
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    const sessionRow = sessionResult[0]?.values[0];
    const session = sessionRow
      ? {
          id: String(sessionRow[0]),
          projectRoot: String(sessionRow[1]),
          projectName: String(sessionRow[2]),
          createdAt: Number(sessionRow[3]),
          updatedAt: Number(sessionRow[4]),
          status: String(sessionRow[5]) as SessionState['status'],
        }
      : null;

    const tasks = this.db
      .exec(`
        SELECT id, title, description, status, assigned_agents, parent_task_id,
               created_at, updated_at, token_estimate, session_id, consensus_state,
               sandbox_path, sandbox_diff_stat
        FROM tasks
        ORDER BY created_at ASC
      `)
      .flatMap((result: QueryResult) =>
        result.values.map((row: unknown[]) => ({
          id: String(row[0]),
          title: String(row[1]),
          description: String(row[2]),
          status: String(row[3]) as Task['status'],
          assignedAgents: JSON.parse(String(row[4])) as string[],
          parentTaskId: row[5] ? String(row[5]) : undefined,
          createdAt: Number(row[6]),
          updatedAt: Number(row[7]),
          tokenEstimate: Number(row[8]),
          sessionId: row[9] ? String(row[9]) : undefined,
          consensusState: row[10]
            ? (String(row[10]) as Task['consensusState'])
            : undefined,
          sandboxPath: row[11] ? String(row[11]) : undefined,
          sandboxDiffStat: row[12] ? String(row[12]) : undefined,
        }))
      );

    const messages = this.db
      .exec(`
        SELECT id, agent_id, agent_role, type, content, timestamp, task_id,
               round, token_estimate, meta_json
        FROM messages
        ORDER BY timestamp ASC
      `)
      .flatMap((result: QueryResult) =>
        result.values.map((row: unknown[]) => ({
          id: String(row[0]),
          agentId: String(row[1]),
          agentRole: String(row[2]),
          type: String(row[3]) as AgentMessage['type'],
          content: String(row[4]),
          timestamp: Number(row[5]),
          taskId: row[6] ? String(row[6]) : undefined,
          round: row[7] !== null ? Number(row[7]) : undefined,
          tokenEstimate: row[8] !== null ? Number(row[8]) : undefined,
          meta: row[9]
            ? (JSON.parse(String(row[9])) as Record<string, unknown>)
            : undefined,
        }))
      );

    const consensus = this.db
      .exec(`
        SELECT task_id, round, status, supporters_json, summary_json, updated_at
        FROM consensus
      `)
      .flatMap((result: QueryResult) =>
        result.values.map((row: unknown[]) => ({
          taskId: String(row[0]),
          round: Number(row[1]),
          status: String(row[2]) as ConsensusState['status'],
          supporters: JSON.parse(String(row[3])) as string[],
          summary: JSON.parse(String(row[4])) as ConsensusState['summary'],
          updatedAt: Number(row[5]),
        }))
      );

    const commandApprovals = this.db
      .exec(`
        SELECT id, task_id, agent_id, agent_role, command, requested_cwd,
               effective_cwd, status, requires_approval, pre_approved, reason,
               requested_at, updated_at, decided_at, completed_at, exit_code,
               stdout, stderr, policy_json
        FROM command_approvals
        ORDER BY requested_at ASC
      `)
      .flatMap((result: QueryResult) =>
        result.values.map((row: unknown[]) => ({
          id: String(row[0]),
          taskId: String(row[1]),
          agentId: String(row[2]),
          agentRole: String(row[3]),
          command: String(row[4]),
          requestedCwd: row[5] ? String(row[5]) : undefined,
          effectiveCwd: String(row[6]),
          status: String(row[7]) as CommandApproval['status'],
          requiresApproval: Number(row[8]) === 1,
          preApproved: Number(row[9]) === 1,
          reason: row[10] ? String(row[10]) : undefined,
          requestedAt: Number(row[11]),
          updatedAt: Number(row[12]),
          decidedAt: row[13] !== null ? Number(row[13]) : undefined,
          completedAt: row[14] !== null ? Number(row[14]) : undefined,
          exitCode: row[15] !== null ? Number(row[15]) : undefined,
          stdout: row[16] ? String(row[16]) : undefined,
          stderr: row[17] ? String(row[17]) : undefined,
          policy: JSON.parse(String(row[18])) as CommandApproval['policy'],
        }))
      );

    return { session, tasks, messages, consensus, commandApprovals };
  }

  async saveSession(session: SessionState | null): Promise<void> {
    this.db.run('DELETE FROM sessions');
    if (session) {
      this.db.run(
        `
          INSERT INTO sessions (id, project_root, project_name, created_at, updated_at, status)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          session.id,
          session.projectRoot,
          session.projectName,
          session.createdAt,
          session.updatedAt,
          session.status,
        ],
      );
    }
    await this.flush();
  }

  async saveTask(task: Task): Promise<void> {
    this.db.run(
      `
        INSERT OR REPLACE INTO tasks
        (id, title, description, status, assigned_agents, parent_task_id, created_at,
         updated_at, token_estimate, session_id, consensus_state, sandbox_path, sandbox_diff_stat)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        task.id,
        task.title,
        task.description,
        task.status,
        JSON.stringify(task.assignedAgents),
        task.parentTaskId ?? null,
        task.createdAt,
        task.updatedAt,
        task.tokenEstimate,
        task.sessionId ?? null,
        task.consensusState ?? null,
        task.sandboxPath ?? null,
        task.sandboxDiffStat ?? null,
      ],
    );
    await this.flush();
  }

  async saveMessage(message: AgentMessage): Promise<void> {
    this.db.run(
      `
        INSERT OR REPLACE INTO messages
        (id, agent_id, agent_role, type, content, timestamp, task_id, round, token_estimate, meta_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        message.id,
        message.agentId,
        message.agentRole,
        message.type,
        message.content,
        message.timestamp,
        message.taskId ?? null,
        message.round ?? null,
        message.tokenEstimate ?? null,
        message.meta ? JSON.stringify(message.meta) : null,
      ],
    );
    await this.flush();
  }

  async saveConsensus(consensus: ConsensusState): Promise<void> {
    this.db.run(
      `
        INSERT OR REPLACE INTO consensus
        (task_id, round, status, supporters_json, summary_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        consensus.taskId,
        consensus.round,
        consensus.status,
        JSON.stringify(consensus.supporters),
        JSON.stringify(consensus.summary),
        consensus.updatedAt,
      ],
    );
    await this.flush();
  }

  async saveCommandApproval(approval: CommandApproval): Promise<void> {
    this.db.run(
      `
        INSERT OR REPLACE INTO command_approvals
        (id, task_id, agent_id, agent_role, command, requested_cwd, effective_cwd,
         status, requires_approval, pre_approved, reason, requested_at, updated_at,
         decided_at, completed_at, exit_code, stdout, stderr, policy_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        approval.id,
        approval.taskId,
        approval.agentId,
        approval.agentRole,
        approval.command,
        approval.requestedCwd ?? null,
        approval.effectiveCwd,
        approval.status,
        approval.requiresApproval ? 1 : 0,
        approval.preApproved ? 1 : 0,
        approval.reason ?? null,
        approval.requestedAt,
        approval.updatedAt,
        approval.decidedAt ?? null,
        approval.completedAt ?? null,
        approval.exitCode ?? null,
        approval.stdout ?? null,
        approval.stderr ?? null,
        JSON.stringify(approval.policy),
      ],
    );
    await this.flush();
  }

  private async flush(): Promise<void> {
    const data = this.db.export();
    await writeFile(this.dbPath, Buffer.from(data));
  }
}

export function resolveWorkspaceStorageRoot(workspaceRoot: string): string {
  return join(resolveAppDataDirectory(), WORKSPACE_STORAGE_DIR, hashWorkspaceRoot(workspaceRoot));
}

export function resolveWorkspaceConfigPath(workspaceRoot: string): string {
  return join(resolveWorkspaceStorageRoot(workspaceRoot), WORKSPACE_CONFIG_FILE);
}

export function resolveWorkspaceDatabasePath(workspaceRoot: string): string {
  return join(resolveWorkspaceStorageRoot(workspaceRoot), WORKSPACE_DATABASE_FILE);
}

export async function readWorkspaceConfig(
  workspaceRoot: string,
): Promise<ProjectConfig | null> {
  const configPath = resolveWorkspaceConfigPath(workspaceRoot);
  try {
    const raw = await readFile(configPath, 'utf8');
    return JSON.parse(raw) as ProjectConfig;
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

export async function writeWorkspaceConfig(
  workspaceRoot: string,
  config: ProjectConfig,
): Promise<void> {
  const configPath = resolveWorkspaceConfigPath(workspaceRoot);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function resolveAppDataDirectory(): string {
  const configured = process.env[APP_DATA_DIR_ENV]?.trim();
  if (configured) {
    return resolve(configured);
  }

  return join(tmpdir(), 'localteam');
}

function hashWorkspaceRoot(workspaceRoot: string): string {
  const normalized = process.platform === 'win32'
    ? workspaceRoot.replace(/\\/g, '/').toLowerCase()
    : workspaceRoot.replace(/\\/g, '/');
  return createHash('sha256').update(normalized).digest('hex');
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
