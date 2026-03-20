declare module 'sql.js' {
  export interface QueryExecResult {
    values: unknown[][];
  }

  export interface Database {
    run(sql: string, params?: unknown[]): void;
    exec(sql: string): QueryExecResult[];
    export(): Uint8Array;
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }
}

declare module 'sql.js/dist/sql-asm.js' {
  import type { SqlJsStatic } from 'sql.js';

  export default function initSqlJs(
    config?: Record<string, unknown>,
  ): Promise<SqlJsStatic>;
}
