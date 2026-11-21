import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createSpidyyHandler } from './api/src/app.ts';
import { FsR2Adapter, SqliteD1Adapter } from './api/src/node-adapters.ts';

export async function createSpidyyServer(options?: {
  dbPath?: string;
  r2Dir?: string;
  withVite?: boolean;
}) {
  const rootDir = process.cwd();
  const dataDir = path.resolve(rootDir, '.spidyy-data');
  const dbPath = options?.dbPath || path.join(dataDir, 'spidyy.sqlite');
  const r2Dir = options?.r2Dir || path.join(dataDir, 'r2');
  const migrationPath = path.resolve(rootDir, 'migrations', '0001_initial.sql');

  const db = new SqliteD1Adapter(dbPath, migrationPath);
  const bucket = new FsR2Adapter(r2Dir);

  const handler = createSpidyyHandler({
    DB: db,
    BUCKET: bucket,
    APP_ORIGIN: process.env.APP_URL || undefined,
    HOSTING_ORIGIN: process.env.SPIDYY_HOSTING_ORIGIN || undefined,
    SPIDYY_EMAIL_RECOVERY_ENABLED: process.env.SPIDYY_EMAIL_RECOVERY_ENABLED || 'false',
  });

  const app = express();
  app.set('trust proxy', 1);

  // Capture raw request body for /api/* and /s/* so we convert directly to Web Request
  app.use(['/api', '/s'], express.raw({ type: '*/*', limit: '25mb' }), async (req, res, next) => {
    try {
      const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
      const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:3000';
      const fullUrl = `${proto}://${host}${req.originalUrl}`;

      const headers = new Headers();
      for (const [key, val] of Object.entries(req.headers)) {
        if (val === undefined) continue;
        if (Array.isArray(val)) {
          for (const v of val) headers.append(key, v);
        } else {
          headers.set(key, val);
        }
      }

      const method = req.method.toUpperCase();
      const hasBody = method !== 'GET' && method !== 'HEAD';
      let bodyInit: ArrayBuffer | undefined;
      if (hasBody && Buffer.isBuffer(req.body) && req.body.length > 0) {
        bodyInit = req.body.buffer.slice(req.body.byteOffset, req.body.byteOffset + req.body.byteLength) as ArrayBuffer;
      }

      const webRequest = new Request(fullUrl, {
        method,
        headers,
        body: bodyInit,
      });

      const webResponse = await handler(webRequest);

      res.status(webResponse.status);
      // Preserve multiple Set-Cookie headers cleanly
      const setCookies =
        typeof (webResponse.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
          ? (webResponse.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
          : [];

      webResponse.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') return;
        res.setHeader(key, value);
      });
      if (setCookies.length > 0) {
        res.setHeader('Set-Cookie', setCookies);
      }

      const buf = Buffer.from(await webResponse.arrayBuffer());
      res.send(buf);
    } catch (err) {
      next(err);
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  const useVite = options?.withVite ?? !isProd;

  if (useVite) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(rootDir, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir, { index: false }));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  return { app, db, bucket };
}

const isDirectEntry =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  path.resolve(process.argv[1]).endsWith('server.ts');

if (isDirectEntry) {
  const port = Number(process.env.PORT || 3000);
  createSpidyyServer().then(({ app }) => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`SPIDYY CLOUD server listening on http://0.0.0.0:${port}`);
    });
  });
}
