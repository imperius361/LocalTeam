import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import initSqlJs from 'sql.js/dist/sql-asm.js';
import type { Database, SqlJsStatic } from 'sql.js';
import type {
  AgentMessage,
  ConsensusState,
  SessionState,
  Task,
} from './types.js';

let sqlPromise: Promise<SqlJsStatic> | null = null;

interface PersistedState {
  session: SessionState | null;
  tasks: Task[];
  messages: AgentMessage[];
  consensus: ConsensusState[];
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
    const dbPath = join(rootPath, '.localteam', 'localteam.db');

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

    return { session, tasks, messages, consensus };
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

  private async flush(): Promise<void> {
    const data = this.db.export();
    await writeFile(this.dbPath, Buffer.from(data));
  }
}
