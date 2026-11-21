export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; meta?: { changes?: number } }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  exec?(query: string): Promise<unknown>;
}

export interface R2ObjectLike {
  key: string;
  size: number;
  etag?: string;
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
  };
  arrayBuffer(): Promise<ArrayBuffer>;
  body?: ReadableStream<Uint8Array> | null;
}

export interface R2PutOptionsLike {
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
  };
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>;
  put(key: string, value: ArrayBuffer | Uint8Array | string, options?: R2PutOptionsLike): Promise<void>;
  delete(keys: string | string[]): Promise<void>;
}

export interface SpidyyEnv {
  DB: D1DatabaseLike;
  BUCKET: R2BucketLike;
  APP_ORIGIN?: string;
  HOSTING_ORIGIN?: string;
  SPIDYY_EMAIL_RECOVERY_ENABLED?: string;
}
