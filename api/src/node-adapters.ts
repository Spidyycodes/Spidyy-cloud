import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  R2BucketLike,
  R2ObjectLike,
  R2PutOptionsLike,
} from './storage.ts';

class SqlitePreparedStatement implements D1PreparedStatementLike {
  private db: DatabaseSync;
  private sql: string;
  private params: unknown[];

  constructor(db: DatabaseSync, sql: string, params: unknown[] = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...values: unknown[]): D1PreparedStatementLike {
    const normalized = values.map((v) => (v === undefined ? null : v));
    return new SqlitePreparedStatement(this.db, this.sql, normalized);
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...(this.params as Array<string | number | Uint8Array | null>)) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    if (colName) {
      return (row[colName] as T) ?? null;
    }
    return { ...row } as T;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; meta?: { changes?: number } }> {
    const stmt = this.db.prepare(this.sql);
    const rows = stmt.all(...(this.params as Array<string | number | Uint8Array | null>)) as Array<
      Record<string, unknown>
    >;
    return { results: rows.map((r) => ({ ...r } as T)) };
  }

  async run(): Promise<{ success: boolean; meta?: { changes?: number } }> {
    const stmt = this.db.prepare(this.sql);
    const res = stmt.run(...(this.params as Array<string | number | Uint8Array | null>));
    return { success: true, meta: { changes: Number(res.changes ?? 0) } };
  }
}

export class SqliteD1Adapter implements D1DatabaseLike {
  public readonly db: DatabaseSync;

  constructor(dbPath: string, migrationSqlPath?: string) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    if (dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    if (migrationSqlPath && fs.existsSync(migrationSqlPath)) {
      const sql = fs.readFileSync(migrationSqlPath, 'utf8');
      this.db.exec(sql);
    }
  }

  prepare(query: string): D1PreparedStatementLike {
    return new SqlitePreparedStatement(this.db, query);
  }

  async exec(query: string): Promise<unknown> {
    return this.db.exec(query);
  }
}

export class FsR2Adapter implements R2BucketLike {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  private resolveSafePath(key: string): string {
    const cleaned = key.replace(/^\/+/, '');
    const target = path.resolve(this.rootDir, cleaned);
    if (!target.startsWith(this.rootDir + path.sep)) {
      throw new Error('R2 key escapes storage root');
    }
    return target;
  }

  async get(key: string): Promise<R2ObjectLike | null> {
    const target = this.resolveSafePath(key);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return null;
    }
    const metaPath = `${target}.spidyymeta.json`;
    let httpMetadata: R2ObjectLike['httpMetadata'];
    if (fs.existsSync(metaPath)) {
      try {
        httpMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch {
        httpMetadata = undefined;
      }
    }
    const data = fs.readFileSync(target);
    return {
      key,
      size: data.byteLength,
      httpMetadata,
      async arrayBuffer() {
        const ab = new ArrayBuffer(data.byteLength);
        new Uint8Array(ab).set(data);
        return ab;
      },
    };
  }

  async put(key: string, value: ArrayBuffer | Uint8Array | string, options?: R2PutOptionsLike): Promise<void> {
    const target = this.resolveSafePath(key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    let buf: Buffer;
    if (typeof value === 'string') {
      buf = Buffer.from(value, 'utf8');
    } else if (value instanceof ArrayBuffer) {
      buf = Buffer.from(new Uint8Array(value));
    } else {
      buf = Buffer.from(value);
    }
    fs.writeFileSync(target, buf);
    if (options?.httpMetadata) {
      fs.writeFileSync(`${target}.spidyymeta.json`, JSON.stringify(options.httpMetadata));
    }
  }

  async delete(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      try {
        const target = this.resolveSafePath(key);
        if (fs.existsSync(target)) fs.unlinkSync(target);
        if (fs.existsSync(`${target}.spidyymeta.json`)) fs.unlinkSync(`${target}.spidyymeta.json`);
      } catch {
        // Ignore missing or invalid cleanup targets
      }
    }
  }
}
