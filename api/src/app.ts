import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  SPIDYY_LIMITS,
  SUPPORTED_FRAMEWORKS,
} from '../../packages/shared/constants.ts';
import {
  formatBytes,
  isValidGitHubRepoUrl,
  isValidHostname,
  isValidSlug,
  lookupMimeType,
  normalizeSlug,
  redactSecrets,
  sanitizeDeployPath,
} from '../../packages/shared/security.ts';
import type {
  AccountUsageDTO,
  AuditLogDTO,
  DeploymentDTO,
  DeploymentFileDTO,
  DeploymentLogEntry,
  DeploymentTokenDTO,
  DomainDTO,
  EnvVarDTO,
  ProjectDTO,
  UserDTO,
} from '../../packages/shared/types.ts';
import {
  constantTimeEqual,
  generateId,
  generateSecureToken,
  hashPassword,
  parseCookies,
  sha256Hex,
  verifyPassword,
} from './crypto.ts';
import type { SpidyyEnv } from './storage.ts';

interface AuthContext {
  kind: 'session' | 'deploy_token';
  user: UserDTO;
  sessionId?: string;
  csrfToken?: string;
  scopedProjectId?: string;
  tokenId?: string;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const RATE_LIMIT_BUCKETS = new Map<string, RateLimitBucket>();

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = RATE_LIMIT_BUCKETS.get(key);
  if (!bucket || bucket.resetAt <= now) {
    RATE_LIMIT_BUCKETS.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= maxRequests) {
    return false;
  }
  bucket.count += 1;
  return true;
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayPeriodKey(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function getClientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '127.0.0.1'
  );
}

function getPublicOrigin(request: Request, env: SpidyyEnv): string {
  if (env.HOSTING_ORIGIN) return env.HOSTING_ORIGIN.replace(/\/$/, '');
  const proto = request.headers.get('x-forwarded-proto') || new URL(request.url).protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).host;
  return `${proto}://${host}`;
}

function getApiOrigin(request: Request, env: SpidyyEnv): string {
  if (env.APP_ORIGIN) return env.APP_ORIGIN.replace(/\/$/, '');
  const proto = request.headers.get('x-forwarded-proto') || new URL(request.url).protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).host;
  return `${proto}://${host}`;
}

function isHttpsRequest(request: Request): boolean {
  const xfProto = request.headers.get('x-forwarded-proto');
  if (xfProto) return xfProto.split(',')[0].trim() === 'https';
  return new URL(request.url).protocol === 'https:';
}

function buildSessionCookie(token: string, maxAgeSeconds: number, request: Request): string {
  const secure = isHttpsRequest(request);
  if (secure) {
    return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=None; Partitioned`;
  }
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax`;
}

function resolveCorsHeaders(request: Request, env: SpidyyEnv): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  const allowedOrigins = new Set<string>();
  const reqUrl = new URL(request.url);
  allowedOrigins.add(reqUrl.origin);
  const xfHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const xfProto = request.headers.get('x-forwarded-proto') || reqUrl.protocol.replace(':', '');
  if (xfHost) {
    allowedOrigins.add(`${xfProto}://${xfHost}`);
    allowedOrigins.add(`https://${xfHost}`);
    allowedOrigins.add(`http://${xfHost}`);
  }
  if (env.APP_ORIGIN) {
    allowedOrigins.add(env.APP_ORIGIN.replace(/\/$/, ''));
  }
  if (allowedOrigins.has(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-File-Path, X-Requested-With',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      Vary: 'Origin',
    };
  }
  return { Vary: 'Origin' };
}

function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function errorResponse(
  message: string,
  status = 400,
  code = 'BAD_REQUEST',
  extraHeaders: Record<string, string> = {},
): Response {
  return jsonResponse({ error: message, code }, status, extraHeaders);
}

async function readJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function validateOriginMatchesHost(request: Request, env: SpidyyEnv): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // Non-browser clients / same-origin CLI
  try {
    const originUrl = new URL(origin);
    const expectedHosts = new Set<string>();
    const reqUrl = new URL(request.url);
    expectedHosts.add(reqUrl.host);
    const xfHost = request.headers.get('x-forwarded-host');
    if (xfHost) expectedHosts.add(xfHost);
    const host = request.headers.get('host');
    if (host) expectedHosts.add(host);
    if (env.APP_ORIGIN) {
      expectedHosts.add(new URL(env.APP_ORIGIN).host);
    }
    return expectedHosts.has(originUrl.host);
  } catch {
    return false;
  }
}

export function createSpidyyHandler(env: SpidyyEnv) {
  const db = env.DB;
  const bucket = env.BUCKET;

  async function recordUsage(
    userId: string,
    projectId: string | null,
    metricType:
      | 'worker_requests'
      | 'd1_reads'
      | 'd1_writes'
      | 'r2_ops'
      | 'site_requests'
      | 'site_bandwidth_bytes'
      | 'github_deployments',
    amount: number,
  ): Promise<void> {
    if (amount <= 0) return;
    try {
      await db
        .prepare(
          `INSERT INTO usage_records (id, user_id, project_id, metric_type, amount, period_key, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(generateId('usg'), userId, projectId, metricType, amount, todayPeriodKey(), nowIso())
        .run();
    } catch {
      // Usage recording must never break primary flows
    }
  }

  async function writeAuditLog(
    userId: string,
    projectId: string | null,
    action: string,
    resourceType: string,
    resourceId: string | null,
    details: Record<string, unknown>,
    ipAddress: string,
  ): Promise<void> {
    try {
      await db
        .prepare(
          `INSERT INTO audit_logs (id, user_id, project_id, action, resource_type, resource_id, details_json, ip_address, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          generateId('aud'),
          userId,
          projectId,
          action,
          resourceType,
          resourceId,
          redactSecrets(JSON.stringify(details)),
          ipAddress,
          nowIso(),
        )
        .run();
    } catch {
      // Best-effort audit logging
    }
  }

  async function getAccountStorageBytes(userId: string): Promise<{ bytes: number; files: number }> {
    const row = await db
      .prepare(
        `SELECT COALESCE(SUM(total_bytes), 0) AS bytes, COALESCE(SUM(file_count), 0) AS files
         FROM deployments
         WHERE owner_id = ? AND status IN ('ready', 'uploading', 'deploying', 'pending')`,
      )
      .bind(userId)
      .first<{ bytes: number; files: number }>();
    return {
      bytes: Number(row?.bytes ?? 0),
      files: Number(row?.files ?? 0),
    };
  }

  async function authenticate(request: Request): Promise<AuthContext | null> {
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const rawToken = authHeader.slice(7).trim();
      if (!rawToken.startsWith('spdy_gh_')) return null;
      const tokenHash = await sha256Hex(rawToken);
      const tokenRow = await db
        .prepare(
          `SELECT dt.id AS token_id, dt.project_id, dt.owner_id, dt.revoked_at,
                  u.id AS user_id, u.email, u.name, u.role, u.created_at
           FROM deployment_tokens dt
           JOIN users u ON u.id = dt.owner_id
           WHERE dt.token_hash = ? AND dt.revoked_at IS NULL`,
        )
        .bind(tokenHash)
        .first<{
          token_id: string;
          project_id: string;
          owner_id: string;
          revoked_at: string | null;
          user_id: string;
          email: string;
          name: string;
          role: string;
          created_at: string;
        }>();
      if (!tokenRow) return null;
      await db
        .prepare('UPDATE deployment_tokens SET last_used_at = ? WHERE id = ?')
        .bind(nowIso(), tokenRow.token_id)
        .run();
      return {
        kind: 'deploy_token',
        user: {
          id: tokenRow.user_id,
          email: tokenRow.email,
          name: tokenRow.name,
          role: tokenRow.role,
          createdAt: tokenRow.created_at,
        },
        scopedProjectId: tokenRow.project_id,
        tokenId: tokenRow.token_id,
      };
    }

    const cookies = parseCookies(request.headers.get('cookie'));
    const rawSessionToken = cookies[SESSION_COOKIE_NAME];
    if (!rawSessionToken) return null;
    const sessionHash = await sha256Hex(rawSessionToken);
    const row = await db
      .prepare(
        `SELECT s.id AS session_id, s.csrf_token, s.expires_at,
                u.id AS user_id, u.email, u.name, u.role, u.created_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
      )
      .bind(sessionHash)
      .first<{
        session_id: string;
        csrf_token: string;
        expires_at: string;
        user_id: string;
        email: string;
        name: string;
        role: string;
        created_at: string;
      }>();

    if (!row) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await db.prepare('DELETE FROM sessions WHERE id = ?').bind(row.session_id).run();
      return null;
    }

    return {
      kind: 'session',
      user: {
        id: row.user_id,
        email: row.email,
        name: row.name,
        role: row.role,
        createdAt: row.created_at,
      },
      sessionId: row.session_id,
      csrfToken: row.csrf_token,
    };
  }

  function requireCsrfIfCookieAuth(request: Request, auth: AuthContext): Response | null {
    if (auth.kind !== 'session') return null;
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return null;
    if (!validateOriginMatchesHost(request, env)) {
      return errorResponse('Cross-origin mutation rejected', 403, 'ORIGIN_FORBIDDEN');
    }
    const headerToken = request.headers.get('x-csrf-token') || '';
    if (!auth.csrfToken || !constantTimeEqual(headerToken, auth.csrfToken)) {
      return errorResponse('Invalid or missing CSRF token', 403, 'CSRF_INVALID');
    }
    return null;
  }

  function mapProjectRow(
    row: Record<string, unknown>,
    request: Request,
  ): ProjectDTO {
    const origin = getPublicOrigin(request, env);
    const slug = String(row.slug);
    return {
      id: String(row.id),
      ownerId: String(row.owner_id),
      name: String(row.name),
      slug,
      framework: String(row.framework),
      repoUrl: row.repo_url ? String(row.repo_url) : null,
      repoBranch: String(row.repo_branch || 'main'),
      buildCommand: row.build_command ? String(row.build_command) : null,
      outputDir: String(row.output_dir || 'dist'),
      productionDeploymentId: row.production_deployment_id ? String(row.production_deployment_id) : null,
      status: String(row.status),
      spaFallback: Number(row.spa_fallback ?? 1) === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      lastDeployedAt: row.last_deployed_at ? String(row.last_deployed_at) : null,
      liveUrl: `${origin}/s/${slug}/`,
      deploymentCount: row.deployment_count !== undefined ? Number(row.deployment_count) : undefined,
      storageBytes: row.storage_bytes !== undefined ? Number(row.storage_bytes) : undefined,
    };
  }

  function mapDeploymentRow(
    row: Record<string, unknown>,
    productionDeploymentId: string | null,
    request: Request,
    projectSlug?: string,
    projectName?: string,
  ): DeploymentDTO {
    let logs: DeploymentLogEntry[] = [];
    try {
      logs = JSON.parse(String(row.logs_json || '[]')) as DeploymentLogEntry[];
    } catch {
      logs = [];
    }
    const slug = projectSlug || (row.project_slug ? String(row.project_slug) : undefined);
    const origin = getPublicOrigin(request, env);
    const id = String(row.id);
    return {
      id,
      projectId: String(row.project_id),
      projectName: projectName || (row.project_name ? String(row.project_name) : undefined),
      projectSlug: slug,
      ownerId: String(row.owner_id),
      source: String(row.source) as DeploymentDTO['source'],
      status: String(row.status) as DeploymentDTO['status'],
      commitSha: row.commit_sha ? String(row.commit_sha) : null,
      commitMessage: row.commit_message ? String(row.commit_message) : null,
      branch: row.branch ? String(row.branch) : null,
      fileCount: Number(row.file_count ?? 0),
      totalBytes: Number(row.total_bytes ?? 0),
      durationMs: Number(row.duration_ms ?? 0),
      logs,
      errorMessage: row.error_message ? String(row.error_message) : null,
      createdAt: String(row.created_at),
      completedAt: row.completed_at ? String(row.completed_at) : null,
      isProduction: productionDeploymentId === id,
      liveUrl: slug ? `${origin}/s/${slug}/` : undefined,
    };
  }

  async function appendDeploymentLog(
    deploymentId: string,
    level: DeploymentLogEntry['level'],
    message: string,
  ): Promise<void> {
    const row = await db
      .prepare('SELECT logs_json FROM deployments WHERE id = ?')
      .bind(deploymentId)
      .first<{ logs_json: string }>();
    let logs: DeploymentLogEntry[] = [];
    if (row) {
      try {
        logs = JSON.parse(row.logs_json || '[]') as DeploymentLogEntry[];
      } catch {
        logs = [];
      }
    }
    logs.push({
      timestamp: nowIso(),
      level,
      message: redactSecrets(message),
    });
    await db
      .prepare('UPDATE deployments SET logs_json = ? WHERE id = ?')
      .bind(JSON.stringify(logs.slice(-200)), deploymentId)
      .run();
  }

  async function cleanupDeploymentR2Files(deploymentId: string): Promise<void> {
    const files = await db
      .prepare('SELECT r2_key FROM deployment_files WHERE deployment_id = ?')
      .bind(deploymentId)
      .all<{ r2_key: string }>();
    if (files.results.length > 0) {
      await bucket.delete(files.results.map((f) => f.r2_key));
    }
  }

  async function pruneExcessDeployments(projectId: string, productionDeploymentId: string | null): Promise<void> {
    const rows = await db
      .prepare(
        `SELECT id FROM deployments
         WHERE project_id = ?
         ORDER BY created_at DESC`,
      )
      .bind(projectId)
      .all<{ id: string }>();
    if (rows.results.length <= SPIDYY_LIMITS.MAX_ACTIVE_DEPLOYMENTS_PER_PROJECT) return;

    const toKeep = new Set<string>();
    if (productionDeploymentId) toKeep.add(productionDeploymentId);
    for (const r of rows.results) {
      if (toKeep.size >= SPIDYY_LIMITS.MAX_ACTIVE_DEPLOYMENTS_PER_PROJECT) break;
      toKeep.add(r.id);
    }

    for (const r of rows.results) {
      if (!toKeep.has(r.id)) {
        await cleanupDeploymentR2Files(r.id);
        await db.prepare('DELETE FROM deployment_files WHERE deployment_id = ?').bind(r.id).run();
        await db.prepare('DELETE FROM deployments WHERE id = ?').bind(r.id).run();
      }
    }
  }

  async function serveStaticSite(request: Request, pathname: string): Promise<Response> {
    // Match /s/:slug or /s/:slug/*
    const match = pathname.match(/^\/s\/([a-zA-Z0-9-]+)(\/.*)?$/);
    if (!match) {
      return new Response(renderNotFoundHtml('Invalid project URL'), {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const slug = match[1].toLowerCase();
    const rest = match[2];

    // Redirect /s/my-site -> /s/my-site/ so relative asset URLs resolve cleanly
    if (rest === undefined) {
      const url = new URL(request.url);
      url.pathname = `/s/${slug}/`;
      return Response.redirect(url.toString(), 302);
    }

    const project = await db
      .prepare(
        `SELECT id, owner_id, name, slug, production_deployment_id, spa_fallback, status
         FROM projects WHERE slug = ?`,
      )
      .bind(slug)
      .first<{
        id: string;
        owner_id: string;
        name: string;
        slug: string;
        production_deployment_id: string | null;
        spa_fallback: number;
        status: string;
      }>();

    if (!project || !project.production_deployment_id) {
      return new Response(
        renderNotFoundHtml(
          project
            ? `Project "${project.name}" does not have an active production deployment yet.`
            : `No SPIDYY CLOUD site exists at /s/${slug}/.`,
        ),
        {
          status: 404,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
          },
        },
      );
    }

    let decodedRest = rest;
    try {
      decodedRest = decodeURIComponent(rest);
    } catch {
      return new Response(renderNotFoundHtml('Malformed URL encoding'), {
        status: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Reject path traversal
    if (
      decodedRest.includes('..') ||
      decodedRest.includes('\\') ||
      decodedRest.includes('\u0000')
    ) {
      return new Response(renderNotFoundHtml('Forbidden path'), {
        status: 403,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    let relPath = decodedRest.replace(/^\/+/, '');
    if (relPath === '' || relPath.endsWith('/')) {
      relPath = `${relPath}index.html`;
    }

    const deploymentId = project.production_deployment_id;
    let r2Key = `sites/${project.id}/${deploymentId}/${relPath}`;
    let fileMeta = await db
      .prepare('SELECT content_type, size_bytes FROM deployment_files WHERE deployment_id = ? AND file_path = ?')
      .bind(deploymentId, relPath)
      .first<{ content_type: string; size_bytes: number }>();

    let obj = fileMeta ? await bucket.get(r2Key) : null;

    // Try nested directory index.html (e.g. /s/site/about -> about/index.html)
    if (!obj && !relPath.endsWith('.html') && !relPath.split('/').pop()?.includes('.')) {
      const nestedIndex = `${relPath}/index.html`;
      const nestedMeta = await db
        .prepare('SELECT content_type, size_bytes FROM deployment_files WHERE deployment_id = ? AND file_path = ?')
        .bind(deploymentId, nestedIndex)
        .first<{ content_type: string; size_bytes: number }>();
      if (nestedMeta) {
        const nestedObj = await bucket.get(`sites/${project.id}/${deploymentId}/${nestedIndex}`);
        if (nestedObj) {
          obj = nestedObj;
          fileMeta = nestedMeta;
          relPath = nestedIndex;
        }
      }
    }

    // SPA fallback to root index.html when enabled and path has no file extension
    const hasExtension = (relPath.split('/').pop() || '').includes('.');
    if (!obj && project.spa_fallback === 1 && !hasExtension) {
      const fallbackMeta = await db
        .prepare('SELECT content_type, size_bytes FROM deployment_files WHERE deployment_id = ? AND file_path = ?')
        .bind(deploymentId, 'index.html')
        .first<{ content_type: string; size_bytes: number }>();
      if (fallbackMeta) {
        const fallbackObj = await bucket.get(`sites/${project.id}/${deploymentId}/index.html`);
        if (fallbackObj) {
          obj = fallbackObj;
          fileMeta = fallbackMeta;
          relPath = 'index.html';
        }
      }
    }

    if (!obj) {
      // Check for custom 404.html inside the deployment
      const custom404 = await bucket.get(`sites/${project.id}/${deploymentId}/404.html`);
      if (custom404) {
        const body = await custom404.arrayBuffer();
        await recordUsage(project.owner_id, project.id, 'site_requests', 1);
        await recordUsage(project.owner_id, project.id, 'site_bandwidth_bytes', body.byteLength);
        return new Response(body, {
          status: 404,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-cache',
          },
        });
      }
      return new Response(renderNotFoundHtml(`File "${relPath}" not found in deployment.`), {
        status: 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    const bytes = await obj.arrayBuffer();
    const contentType = fileMeta?.content_type || obj.httpMetadata?.contentType || lookupMimeType(relPath);
    const isHtml = contentType.includes('text/html');
    const isImmutableAsset = relPath.startsWith('assets/') || /\.[a-f0-9]{8,}\./i.test(relPath);

    await recordUsage(project.owner_id, project.id, 'site_requests', 1);
    await recordUsage(project.owner_id, project.id, 'site_bandwidth_bytes', bytes.byteLength);
    await recordUsage(project.owner_id, project.id, 'r2_ops', 1);

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': isHtml
          ? 'no-cache, must-revalidate'
          : isImmutableAsset
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Spidyy-Project': project.slug,
        'X-Spidyy-Deployment': deploymentId,
      },
    });
  }

  return async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();
    const corsHeaders = resolveCorsHeaders(request, env);

    // Handle preflight
    if (method === 'OPTIONS' && pathname.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Multi-tenant static hosting engine
    if (pathname === '/s' || pathname.startsWith('/s/')) {
      if (method !== 'GET' && method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      return serveStaticSite(request, pathname);
    }

    if (!pathname.startsWith('/api/')) {
      return errorResponse('Not found', 404, 'NOT_FOUND', corsHeaders);
    }

    const clientIp = getClientIp(request);

    // Public health & capabilities
    if (method === 'GET' && pathname === '/api/health') {
      return jsonResponse(
        {
          ok: true,
          service: 'spidyy-cloud-api',
          emailRecoveryEnabled: env.SPIDYY_EMAIL_RECOVERY_ENABLED === 'true',
          limits: SPIDYY_LIMITS,
          frameworks: SUPPORTED_FRAMEWORKS,
        },
        200,
        corsHeaders,
      );
    }

    if (method === 'GET' && pathname === '/api/auth/recovery-status') {
      return jsonResponse(
        {
          enabled: env.SPIDYY_EMAIL_RECOVERY_ENABLED === 'true',
          reason:
            env.SPIDYY_EMAIL_RECOVERY_ENABLED === 'true'
              ? null
              : 'Email delivery service is not configured on this zero-budget deployment. Change your password from Account Settings while signed in, or reset via D1 admin migration.',
        },
        200,
        corsHeaders,
      );
    }

    // Auth: Register
    if (method === 'POST' && pathname === '/api/auth/register') {
      if (!validateOriginMatchesHost(request, env)) {
        return errorResponse('Cross-origin registration blocked', 403, 'ORIGIN_FORBIDDEN', corsHeaders);
      }
      if (!checkRateLimit(`reg:${clientIp}`, 15, 15 * 60 * 1000)) {
        return errorResponse('Too many registration attempts. Try again in 15 minutes.', 429, 'RATE_LIMITED', corsHeaders);
      }

      const body = await readJsonBody<{ email?: string; password?: string; name?: string }>(request);
      const email = body?.email?.trim().toLowerCase() || '';
      const password = body?.password || '';
      const name = body?.name?.trim() || '';

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return errorResponse('Enter a valid email address.', 400, 'INVALID_EMAIL', corsHeaders);
      }
      if (name.length < 2 || name.length > 80) {
        return errorResponse('Display name must be between 2 and 80 characters.', 400, 'INVALID_NAME', corsHeaders);
      }
      if (password.length < 8 || password.length > 128) {
        return errorResponse('Password must be between 8 and 128 characters.', 400, 'WEAK_PASSWORD', corsHeaders);
      }

      const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
      if (existing) {
        return errorResponse('An account with this email already exists.', 409, 'EMAIL_EXISTS', corsHeaders);
      }

      const userId = generateId('usr');
      const now = nowIso();
      const { hash, salt } = await hashPassword(password);

      await db
        .prepare(
          `INSERT INTO users (id, email, name, password_hash, password_salt, role, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'developer', ?, ?)`,
        )
        .bind(userId, email, name, hash, salt, now, now)
        .run();

      const rawSession = generateSecureToken('spdy_sess');
      const sessionHash = await sha256Hex(rawSession);
      const csrfToken = generateSecureToken('csrf');
      const sessionId = generateId('ses');
      const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

      await db
        .prepare(
          `INSERT INTO sessions (id, user_id, token_hash, csrf_token, user_agent, ip_address, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          sessionId,
          userId,
          sessionHash,
          csrfToken,
          request.headers.get('user-agent') || '',
          clientIp,
          expiresAt,
          now,
        )
        .run();

      await writeAuditLog(userId, null, 'auth.register', 'user', userId, { email }, clientIp);
      await recordUsage(userId, null, 'd1_writes', 3);

      return jsonResponse(
        {
          user: { id: userId, email, name, role: 'developer', createdAt: now },
          csrfToken,
        },
        201,
        {
          ...corsHeaders,
          'Set-Cookie': buildSessionCookie(rawSession, SESSION_TTL_SECONDS, request),
        },
      );
    }

    // Auth: Login
    if (method === 'POST' && pathname === '/api/auth/login') {
      if (!validateOriginMatchesHost(request, env)) {
        return errorResponse('Cross-origin login blocked', 403, 'ORIGIN_FORBIDDEN', corsHeaders);
      }
      if (!checkRateLimit(`login:${clientIp}`, 15, 15 * 60 * 1000)) {
        return errorResponse('Too many login attempts. Please wait 15 minutes.', 429, 'RATE_LIMITED', corsHeaders);
      }

      const body = await readJsonBody<{ email?: string; password?: string }>(request);
      const email = body?.email?.trim().toLowerCase() || '';
      const password = body?.password || '';

      if (!email || !password) {
        return errorResponse('Email and password are required.', 400, 'MISSING_CREDENTIALS', corsHeaders);
      }

      const userRow = await db
        .prepare('SELECT id, email, name, password_hash, password_salt, role, created_at FROM users WHERE email = ?')
        .bind(email)
        .first<{
          id: string;
          email: string;
          name: string;
          password_hash: string;
          password_salt: string;
          role: string;
          created_at: string;
        }>();

      if (!userRow || !(await verifyPassword(password, userRow.password_hash, userRow.password_salt))) {
        return errorResponse('Invalid email or password.', 401, 'INVALID_CREDENTIALS', corsHeaders);
      }

      const rawSession = generateSecureToken('spdy_sess');
      const sessionHash = await sha256Hex(rawSession);
      const csrfToken = generateSecureToken('csrf');
      const sessionId = generateId('ses');
      const now = nowIso();
      const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

      await db
        .prepare(
          `INSERT INTO sessions (id, user_id, token_hash, csrf_token, user_agent, ip_address, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          sessionId,
          userRow.id,
          sessionHash,
          csrfToken,
          request.headers.get('user-agent') || '',
          clientIp,
          expiresAt,
          now,
        )
        .run();

      await writeAuditLog(userRow.id, null, 'auth.login', 'session', sessionId, {}, clientIp);

      return jsonResponse(
        {
          user: {
            id: userRow.id,
            email: userRow.email,
            name: userRow.name,
            role: userRow.role,
            createdAt: userRow.created_at,
          },
          csrfToken,
        },
        200,
        {
          ...corsHeaders,
          'Set-Cookie': buildSessionCookie(rawSession, SESSION_TTL_SECONDS, request),
        },
      );
    }

    // Auth: Logout (allows even if session invalid)
    if (method === 'POST' && pathname === '/api/auth/logout') {
      const auth = await authenticate(request);
      if (auth?.kind === 'session' && auth.sessionId) {
        const csrfErr = requireCsrfIfCookieAuth(request, auth);
        if (csrfErr) return csrfErr;
        await db.prepare('DELETE FROM sessions WHERE id = ?').bind(auth.sessionId).run();
        await writeAuditLog(auth.user.id, null, 'auth.logout', 'session', auth.sessionId, {}, clientIp);
      }
      return jsonResponse(
        { ok: true },
        200,
        {
          ...corsHeaders,
          'Set-Cookie': buildSessionCookie('', 0, request),
        },
      );
    }

    // Authenticate all remaining /api/* routes
    const auth = await authenticate(request);
    if (!auth) {
      return errorResponse('Authentication required.', 401, 'UNAUTHORIZED', corsHeaders);
    }

    const csrfErr = requireCsrfIfCookieAuth(request, auth);
    if (csrfErr) {
      return new Response(csrfErr.body, {
        status: csrfErr.status,
        headers: { ...Object.fromEntries(csrfErr.headers.entries()), ...corsHeaders },
      });
    }

    await recordUsage(auth.user.id, auth.scopedProjectId || null, 'worker_requests', 1);

    // Restrict deploy tokens strictly to CI deployment routes
    if (auth.kind === 'deploy_token') {
      const allowedCiRoute =
        (method === 'POST' && pathname === '/api/deployments') ||
        (method === 'PUT' && /^\/api\/deployments\/[^/]+\/files$/.test(pathname)) ||
        (method === 'POST' && /^\/api\/deployments\/[^/]+\/(complete|fail)$/.test(pathname)) ||
        (method === 'GET' && /^\/api\/deployments\/[^/]+$/.test(pathname));
      if (!allowedCiRoute) {
        return errorResponse('Deployment tokens are scoped exclusively to deployment CI endpoints.', 403, 'TOKEN_SCOPE_FORBIDDEN', corsHeaders);
      }
    }

    // GET /api/auth/me
    if (method === 'GET' && pathname === '/api/auth/me') {
      return jsonResponse({ user: auth.user, csrfToken: auth.csrfToken }, 200, corsHeaders);
    }

    // PATCH /api/auth/profile
    if (method === 'PATCH' && pathname === '/api/auth/profile') {
      const body = await readJsonBody<{ name?: string }>(request);
      const name = body?.name?.trim() || '';
      if (name.length < 2 || name.length > 80) {
        return errorResponse('Display name must be between 2 and 80 characters.', 400, 'INVALID_NAME', corsHeaders);
      }
      const now = nowIso();
      await db.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').bind(name, now, auth.user.id).run();
      await writeAuditLog(auth.user.id, null, 'account.update_profile', 'user', auth.user.id, { name }, clientIp);
      return jsonResponse({ user: { ...auth.user, name } }, 200, corsHeaders);
    }

    // POST /api/auth/password
    if (method === 'POST' && pathname === '/api/auth/password') {
      if (!checkRateLimit(`pw:${auth.user.id}`, 10, 15 * 60 * 1000)) {
        return errorResponse('Too many password update attempts.', 429, 'RATE_LIMITED', corsHeaders);
      }
      const body = await readJsonBody<{ currentPassword?: string; newPassword?: string }>(request);
      const currentPassword = body?.currentPassword || '';
      const newPassword = body?.newPassword || '';
      if (newPassword.length < 8 || newPassword.length > 128) {
        return errorResponse('New password must be between 8 and 128 characters.', 400, 'WEAK_PASSWORD', corsHeaders);
      }
      const userRow = await db
        .prepare('SELECT password_hash, password_salt FROM users WHERE id = ?')
        .bind(auth.user.id)
        .first<{ password_hash: string; password_salt: string }>();
      if (!userRow || !(await verifyPassword(currentPassword, userRow.password_hash, userRow.password_salt))) {
        return errorResponse('Current password is incorrect.', 401, 'INVALID_PASSWORD', corsHeaders);
      }
      const { hash, salt } = await hashPassword(newPassword);
      await db
        .prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?')
        .bind(hash, salt, nowIso(), auth.user.id)
        .run();
      // Invalidate all other sessions
      if (auth.sessionId) {
        await db
          .prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
          .bind(auth.user.id, auth.sessionId)
          .run();
      }
      await writeAuditLog(auth.user.id, null, 'account.change_password', 'user', auth.user.id, {}, clientIp);
      return jsonResponse({ ok: true }, 200, corsHeaders);
    }

    // POST /api/auth/sessions/invalidate-all
    if (method === 'POST' && pathname === '/api/auth/sessions/invalidate-all') {
      if (auth.sessionId) {
        await db
          .prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
          .bind(auth.user.id, auth.sessionId)
          .run();
      }
      await writeAuditLog(auth.user.id, null, 'auth.invalidate_other_sessions', 'user', auth.user.id, {}, clientIp);
      return jsonResponse({ ok: true }, 200, corsHeaders);
    }

    // GET /api/projects
    if (method === 'GET' && pathname === '/api/projects') {
      const rows = await db
        .prepare(
          `SELECT p.*,
                  (SELECT COUNT(*) FROM deployments d WHERE d.project_id = p.id) AS deployment_count,
                  (SELECT COALESCE(SUM(d.total_bytes), 0) FROM deployments d WHERE d.project_id = p.id AND d.status = 'ready') AS storage_bytes
           FROM projects p
           WHERE p.owner_id = ?
           ORDER BY COALESCE(p.last_deployed_at, p.created_at) DESC`,
        )
        .bind(auth.user.id)
        .all();
      await recordUsage(auth.user.id, null, 'd1_reads', 1);
      return jsonResponse(
        { projects: rows.results.map((r) => mapProjectRow(r, request)) },
        200,
        corsHeaders,
      );
    }

    // POST /api/projects
    if (method === 'POST' && pathname === '/api/projects') {
      const body = await readJsonBody<{
        name?: string;
        slug?: string;
        framework?: string;
        repoUrl?: string;
        repoBranch?: string;
        buildCommand?: string;
        outputDir?: string;
        spaFallback?: boolean;
      }>(request);

      const countRow = await db
        .prepare('SELECT COUNT(*) AS cnt FROM projects WHERE owner_id = ?')
        .bind(auth.user.id)
        .first<{ cnt: number }>();
      if (Number(countRow?.cnt ?? 0) >= SPIDYY_LIMITS.MAX_PROJECTS_PER_USER) {
        return errorResponse(
          `Free-tier limit reached: maximum ${SPIDYY_LIMITS.MAX_PROJECTS_PER_USER} projects per account.`,
          403,
          'QUOTA_EXCEEDED',
          corsHeaders,
        );
      }

      const name = body?.name?.trim() || '';
      if (name.length < 2 || name.length > 64) {
        return errorResponse('Project name must be between 2 and 64 characters.', 400, 'INVALID_NAME', corsHeaders);
      }

      let slug = body?.slug ? normalizeSlug(body.slug) : normalizeSlug(name);
      if (!isValidSlug(slug)) {
        return errorResponse(
          'Project slug must be 3-48 characters using lowercase letters, numbers, and hyphens.',
          400,
          'INVALID_SLUG',
          corsHeaders,
        );
      }

      const slugExists = await db.prepare('SELECT id FROM projects WHERE slug = ?').bind(slug).first();
      if (slugExists) {
        if (body?.slug) {
          return errorResponse(`Slug "${slug}" is already taken.`, 409, 'SLUG_EXISTS', corsHeaders);
        }
        slug = `${slug.slice(0, 39)}-${generateId().slice(0, 6)}`;
      }

      const framework = SUPPORTED_FRAMEWORKS.some((f) => f.id === body?.framework)
        ? String(body?.framework)
        : 'static';

      const repoUrl = body?.repoUrl?.trim() || null;
      if (repoUrl && !isValidGitHubRepoUrl(repoUrl)) {
        return errorResponse('Repository URL must be a valid https://github.com/... URL.', 400, 'INVALID_REPO_URL', corsHeaders);
      }

      const repoBranch = (body?.repoBranch?.trim() || 'main').slice(0, 64);
      const fwDef = SUPPORTED_FRAMEWORKS.find((f) => f.id === framework)!;
      const buildCommand = body?.buildCommand !== undefined ? body.buildCommand.trim() : fwDef.defaultBuildCommand;
      const outputDir = (body?.outputDir?.trim() || fwDef.defaultOutputDir).replace(/^\/+|\/+$/g, '') || '.';
      const spaFallback = body?.spaFallback === false ? 0 : 1;

      const projectId = generateId('prj');
      const now = nowIso();

      await db
        .prepare(
          `INSERT INTO projects (
            id, owner_id, name, slug, framework, repo_url, repo_branch,
            build_command, output_dir, production_deployment_id, status,
            spa_fallback, created_at, updated_at, last_deployed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'created', ?, ?, ?, NULL)`,
        )
        .bind(
          projectId,
          auth.user.id,
          name,
          slug,
          framework,
          repoUrl,
          repoBranch,
          buildCommand || null,
          outputDir,
          spaFallback,
          now,
          now,
        )
        .run();

      // Create platform domain record automatically
      const platformHost = `${new URL(getPublicOrigin(request, env)).host}/s/${slug}`;
      await db
        .prepare(
          `INSERT INTO domains (id, project_id, owner_id, hostname, type, status, verification_txt, created_at)
           VALUES (?, ?, ?, ?, 'platform', 'active', NULL, ?)`,
        )
        .bind(generateId('dom'), projectId, auth.user.id, platformHost, now)
        .run();

      await writeAuditLog(auth.user.id, projectId, 'project.create', 'project', projectId, { name, slug, framework }, clientIp);
      await recordUsage(auth.user.id, projectId, 'd1_writes', 2);

      const created = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first();
      return jsonResponse({ project: mapProjectRow(created!, request) }, 201, corsHeaders);
    }

    // Project-specific routes: /api/projects/:id...
    const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)(\/.*)?$/);
    if (projectMatch) {
      const projectId = projectMatch[1];
      const subPath = projectMatch[2] || '';

      const project = await db
        .prepare('SELECT * FROM projects WHERE id = ?')
        .bind(projectId)
        .first<Record<string, unknown>>();

      if (!project) {
        return errorResponse('Project not found.', 404, 'PROJECT_NOT_FOUND', corsHeaders);
      }
      if (String(project.owner_id) !== auth.user.id) {
        return errorResponse('Access denied: you do not own this project.', 403, 'FORBIDDEN', corsHeaders);
      }

      // GET /api/projects/:id
      if (method === 'GET' && subPath === '') {
        const stats = await db
          .prepare(
            `SELECT COUNT(*) AS deployment_count,
                    COALESCE(SUM(CASE WHEN status = 'ready' THEN total_bytes ELSE 0 END), 0) AS storage_bytes
             FROM deployments WHERE project_id = ?`,
          )
          .bind(projectId)
          .first<{ deployment_count: number; storage_bytes: number }>();
        const dto = mapProjectRow({ ...project, ...stats }, request);
        return jsonResponse({ project: dto }, 200, corsHeaders);
      }

      // PATCH /api/projects/:id
      if (method === 'PATCH' && subPath === '') {
        const body = await readJsonBody<{
          name?: string;
          framework?: string;
          repoUrl?: string | null;
          repoBranch?: string;
          buildCommand?: string | null;
          outputDir?: string;
          spaFallback?: boolean;
        }>(request);

        const name = body?.name !== undefined ? body.name.trim() : String(project.name);
        if (name.length < 2 || name.length > 64) {
          return errorResponse('Project name must be between 2 and 64 characters.', 400, 'INVALID_NAME', corsHeaders);
        }

        const framework =
          body?.framework && SUPPORTED_FRAMEWORKS.some((f) => f.id === body.framework)
            ? body.framework
            : String(project.framework);

        const repoUrl = body?.repoUrl !== undefined ? (body.repoUrl?.trim() || null) : (project.repo_url as string | null);
        if (repoUrl && !isValidGitHubRepoUrl(repoUrl)) {
          return errorResponse('Repository URL must be https://github.com/...', 400, 'INVALID_REPO_URL', corsHeaders);
        }

        const repoBranch = body?.repoBranch !== undefined ? body.repoBranch.trim() || 'main' : String(project.repo_branch);
        const buildCommand = body?.buildCommand !== undefined ? (body.buildCommand?.trim() || null) : (project.build_command as string | null);
        const outputDir = body?.outputDir !== undefined ? body.outputDir.trim() || '.' : String(project.output_dir);
        const spaFallback = body?.spaFallback !== undefined ? (body.spaFallback ? 1 : 0) : Number(project.spa_fallback);

        const now = nowIso();
        await db
          .prepare(
            `UPDATE projects
             SET name = ?, framework = ?, repo_url = ?, repo_branch = ?,
                 build_command = ?, output_dir = ?, spa_fallback = ?, updated_at = ?
             WHERE id = ? AND owner_id = ?`,
          )
          .bind(name, framework, repoUrl, repoBranch, buildCommand, outputDir, spaFallback, now, projectId, auth.user.id)
          .run();

        await writeAuditLog(auth.user.id, projectId, 'project.update', 'project', projectId, { name, framework }, clientIp);
        const updated = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first();
        return jsonResponse({ project: mapProjectRow(updated!, request) }, 200, corsHeaders);
      }

      // DELETE /api/projects/:id
      if (method === 'DELETE' && subPath === '') {
        const files = await db
          .prepare('SELECT r2_key FROM deployment_files WHERE project_id = ?')
          .bind(projectId)
          .all<{ r2_key: string }>();
        if (files.results.length > 0) {
          await bucket.delete(files.results.map((f) => f.r2_key));
        }
        await db.prepare('DELETE FROM projects WHERE id = ? AND owner_id = ?').bind(projectId, auth.user.id).run();
        await writeAuditLog(auth.user.id, null, 'project.delete', 'project', projectId, { slug: project.slug }, clientIp);
        return jsonResponse({ ok: true }, 200, corsHeaders);
      }

      // GET /api/projects/:id/deployments
      if (method === 'GET' && subPath === '/deployments') {
        const rows = await db
          .prepare(
            `SELECT * FROM deployments WHERE project_id = ? ORDER BY created_at DESC LIMIT 50`,
          )
          .bind(projectId)
          .all();
        const prodId = project.production_deployment_id ? String(project.production_deployment_id) : null;
        return jsonResponse(
          {
            deployments: rows.results.map((r) =>
              mapDeploymentRow(r, prodId, request, String(project.slug), String(project.name)),
            ),
          },
          200,
          corsHeaders,
        );
      }

      // GET /api/projects/:id/tokens or POST /api/projects/:id/github-token
      if (method === 'GET' && subPath === '/github-token') {
        const rows = await db
          .prepare(
            `SELECT id, project_id, name, token_prefix, last_used_at, revoked_at, created_at
             FROM deployment_tokens WHERE project_id = ? ORDER BY created_at DESC`,
          )
          .bind(projectId)
          .all();
        const tokens: DeploymentTokenDTO[] = rows.results.map((r) => ({
          id: String(r.id),
          projectId: String(r.project_id),
          name: String(r.name),
          tokenPrefix: String(r.token_prefix),
          lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
          revokedAt: r.revoked_at ? String(r.revoked_at) : null,
          createdAt: String(r.created_at),
        }));
        return jsonResponse({ tokens }, 200, corsHeaders);
      }

      if (method === 'POST' && (subPath === '/github-token' || subPath === '/github-token/rotate')) {
        const isRotate = subPath === '/github-token/rotate';
        const body = await readJsonBody<{ name?: string }>(request);
        const now = nowIso();
        if (isRotate) {
          await db
            .prepare('UPDATE deployment_tokens SET revoked_at = ? WHERE project_id = ? AND revoked_at IS NULL')
            .bind(now, projectId)
            .run();
        }
        const rawToken = generateSecureToken('spdy_gh');
        const tokenHash = await sha256Hex(rawToken);
        const tokenPrefix = rawToken.slice(0, 14) + '...';
        const tokenId = generateId('tok');
        const tokenName = body?.name?.trim() || (isRotate ? 'Rotated GitHub Actions Token' : 'GitHub Actions Deploy Token');

        await db
          .prepare(
            `INSERT INTO deployment_tokens (id, project_id, owner_id, name, token_hash, token_prefix, last_used_at, revoked_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
          )
          .bind(tokenId, projectId, auth.user.id, tokenName, tokenHash, tokenPrefix, now)
          .run();

        await writeAuditLog(
          auth.user.id,
          projectId,
          isRotate ? 'token.rotate' : 'token.create',
          'deployment_token',
          tokenId,
          { tokenPrefix },
          clientIp,
        );

        return jsonResponse(
          {
            token: rawToken, // Shown ONCE only!
            record: {
              id: tokenId,
              projectId,
              name: tokenName,
              tokenPrefix,
              lastUsedAt: null,
              revokedAt: null,
              createdAt: now,
            },
          },
          201,
          corsHeaders,
        );
      }

      // DELETE /api/projects/:id/github-token/:tokenId
      const revokeMatch = subPath.match(/^\/github-token\/([^/]+)$/);
      if (method === 'DELETE' && revokeMatch) {
        const tokenId = revokeMatch[1];
        await db
          .prepare('UPDATE deployment_tokens SET revoked_at = ? WHERE id = ? AND project_id = ? AND owner_id = ?')
          .bind(nowIso(), tokenId, projectId, auth.user.id)
          .run();
        await writeAuditLog(auth.user.id, projectId, 'token.revoke', 'deployment_token', tokenId, {}, clientIp);
        return jsonResponse({ ok: true }, 200, corsHeaders);
      }

      // GET /api/projects/:id/workflow
      if (method === 'GET' && subPath === '/workflow') {
        const apiOrigin = getApiOrigin(request, env);
        const yaml = generateGitHubActionsWorkflow({
          projectId,
          projectName: String(project.name),
          projectSlug: String(project.slug),
          branch: String(project.repo_branch || 'main'),
          framework: String(project.framework),
          buildCommand: project.build_command ? String(project.build_command) : '',
          outputDir: String(project.output_dir || 'dist'),
          apiUrl: apiOrigin,
        });
        return jsonResponse({ yaml, filename: '.github/workflows/spidyy-deploy.yml' }, 200, corsHeaders);
      }

      // Domains: GET / POST / DELETE
      if (method === 'GET' && subPath === '/domains') {
        const rows = await db
          .prepare('SELECT * FROM domains WHERE project_id = ? ORDER BY type ASC, created_at DESC')
          .bind(projectId)
          .all();
        const domains: DomainDTO[] = rows.results.map((r) => ({
          id: String(r.id),
          projectId: String(r.project_id),
          projectSlug: String(project.slug),
          hostname: String(r.hostname),
          type: String(r.type) as 'platform' | 'custom',
          status: String(r.status) as DomainDTO['status'],
          verificationTxt: r.verification_txt ? String(r.verification_txt) : null,
          createdAt: String(r.created_at),
        }));
        return jsonResponse({ domains }, 200, corsHeaders);
      }

      if (method === 'POST' && subPath === '/domains') {
        const body = await readJsonBody<{ hostname?: string }>(request);
        const hostname = body?.hostname?.trim().toLowerCase() || '';
        if (!isValidHostname(hostname)) {
          return errorResponse('Enter a valid domain hostname (e.g. app.example.com).', 400, 'INVALID_HOSTNAME', corsHeaders);
        }
        const exists = await db.prepare('SELECT id FROM domains WHERE hostname = ?').bind(hostname).first();
        if (exists) {
          return errorResponse('This domain is already registered.', 409, 'DOMAIN_EXISTS', corsHeaders);
        }
        const domainId = generateId('dom');
        const verificationTxt = `spidyy-verify=${generateId('vrf')}`;
        const now = nowIso();
        // Honestly mark custom domain as 'unavailable' until Cloudflare Zone / Custom Hostname DNS & SSL routing is configured
        await db
          .prepare(
            `INSERT INTO domains (id, project_id, owner_id, hostname, type, status, verification_txt, created_at)
             VALUES (?, ?, ?, ?, 'custom', 'unavailable', ?, ?)`,
          )
          .bind(domainId, projectId, auth.user.id, hostname, verificationTxt, now)
          .run();

        await writeAuditLog(auth.user.id, projectId, 'domain.add', 'domain', domainId, { hostname }, clientIp);
        return jsonResponse(
          {
            domain: {
              id: domainId,
              projectId,
              projectSlug: String(project.slug),
              hostname,
              type: 'custom',
              status: 'unavailable',
              verificationTxt,
              createdAt: now,
            },
          },
          201,
          corsHeaders,
        );
      }

      const domDelMatch = subPath.match(/^\/domains\/([^/]+)$/);
      if (method === 'DELETE' && domDelMatch) {
        const domainId = domDelMatch[1];
        const dom = await db
          .prepare('SELECT type FROM domains WHERE id = ? AND project_id = ?')
          .bind(domainId, projectId)
          .first<{ type: string }>();
        if (!dom) return errorResponse('Domain not found.', 404, 'NOT_FOUND', corsHeaders);
        if (dom.type === 'platform') {
          return errorResponse('Platform workers.dev/path URL cannot be deleted.', 400, 'CANNOT_DELETE_PLATFORM_DOMAIN', corsHeaders);
        }
        await db.prepare('DELETE FROM domains WHERE id = ? AND project_id = ?').bind(domainId, projectId).run();
        return jsonResponse({ ok: true }, 200, corsHeaders);
      }

      // Env vars: GET / POST / DELETE
      if (method === 'GET' && subPath === '/env') {
        const rows = await db
          .prepare('SELECT id, project_id, key_name, value_masked, target, created_at, updated_at FROM env_vars WHERE project_id = ? ORDER BY key_name ASC')
          .bind(projectId)
          .all();
        const vars: EnvVarDTO[] = rows.results.map((r) => ({
          id: String(r.id),
          projectId: String(r.project_id),
          keyName: String(r.key_name),
          valueMasked: String(r.value_masked),
          target: String(r.target) as 'production' | 'preview',
          createdAt: String(r.created_at),
          updatedAt: String(r.updated_at),
        }));
        return jsonResponse({ envVars: vars }, 200, corsHeaders);
      }

      if (method === 'POST' && subPath === '/env') {
        const body = await readJsonBody<{ keyName?: string; value?: string; target?: string }>(request);
        const keyName = body?.keyName?.trim() || '';
        const value = body?.value ?? '';
        const target = body?.target === 'preview' ? 'preview' : 'production';
        if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(keyName)) {
          return errorResponse('Variable key must match ^[A-Z_][A-Z0-9_]*$ (uppercase letters, digits, underscores).', 400, 'INVALID_ENV_KEY', corsHeaders);
        }
        if (!value || value.length > 4096) {
          return errorResponse('Variable value must be between 1 and 4096 characters.', 400, 'INVALID_ENV_VALUE', corsHeaders);
        }
        const valueMasked = value.length <= 4 ? '••••' : `${value.slice(0, 2)}••••••${value.slice(-2)}`;
        const now = nowIso();
        const existing = await db
          .prepare('SELECT id FROM env_vars WHERE project_id = ? AND key_name = ? AND target = ?')
          .bind(projectId, keyName, target)
          .first<{ id: string }>();

        let envId = existing?.id || generateId('env');
        if (existing) {
          await db
            .prepare('UPDATE env_vars SET value_masked = ?, value_stored = ?, updated_at = ? WHERE id = ?')
            .bind(valueMasked, value, now, envId)
            .run();
        } else {
          await db
            .prepare(
              `INSERT INTO env_vars (id, project_id, owner_id, key_name, value_masked, value_stored, target, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(envId, projectId, auth.user.id, keyName, valueMasked, value, target, now, now)
            .run();
        }

        await writeAuditLog(auth.user.id, projectId, 'env.upsert', 'env_var', envId, { keyName, target }, clientIp);
        return jsonResponse(
          {
            envVar: {
              id: envId,
              projectId,
              keyName,
              valueMasked,
              target,
              createdAt: now,
              updatedAt: now,
            },
          },
          201,
          corsHeaders,
        );
      }

      const envDelMatch = subPath.match(/^\/env\/([^/]+)$/);
      if (method === 'DELETE' && envDelMatch) {
        const envId = envDelMatch[1];
        await db.prepare('DELETE FROM env_vars WHERE id = ? AND project_id = ? AND owner_id = ?').bind(envId, projectId, auth.user.id).run();
        await writeAuditLog(auth.user.id, projectId, 'env.delete', 'env_var', envId, {}, clientIp);
        return jsonResponse({ ok: true }, 200, corsHeaders);
      }

      // GET /api/projects/:id/usage
      if (method === 'GET' && subPath === '/usage') {
        const depStats = await db
          .prepare(
            `SELECT
               COUNT(*) AS deployment_count,
               SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS successful_deployments,
               SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_deployments,
               COALESCE(SUM(CASE WHEN status = 'ready' THEN file_count ELSE 0 END), 0) AS stored_files,
               COALESCE(SUM(CASE WHEN status = 'ready' THEN total_bytes ELSE 0 END), 0) AS stored_bytes
             FROM deployments WHERE project_id = ?`,
          )
          .bind(projectId)
          .first<{
            deployment_count: number;
            successful_deployments: number;
            failed_deployments: number;
            stored_files: number;
            stored_bytes: number;
          }>();
        const metricRows = await db
          .prepare(
            `SELECT metric_type, COALESCE(SUM(amount), 0) AS total
             FROM usage_records WHERE project_id = ? AND period_key = ?
             GROUP BY metric_type`,
          )
          .bind(projectId, todayPeriodKey())
          .all<{ metric_type: string; total: number }>();
        const metrics: Record<string, number> = {};
        for (const r of metricRows.results) {
          metrics[r.metric_type] = Number(r.total);
        }
        return jsonResponse(
          {
            projectId,
            periodKey: todayPeriodKey(),
            deployments: {
              total: Number(depStats?.deployment_count ?? 0),
              successful: Number(depStats?.successful_deployments ?? 0),
              failed: Number(depStats?.failed_deployments ?? 0),
              storedFiles: Number(depStats?.stored_files ?? 0),
              storedBytes: Number(depStats?.stored_bytes ?? 0),
            },
            metrics: {
              siteRequests: metrics.site_requests ?? 0,
              siteBandwidthBytes: metrics.site_bandwidth_bytes ?? 0,
              r2Ops: metrics.r2_ops ?? 0,
              githubDeployments: metrics.github_deployments ?? 0,
            },
          },
          200,
          corsHeaders,
        );
      }
    }

    // GET /api/deployments (user's recent deployments across all projects)
    if (method === 'GET' && pathname === '/api/deployments') {
      const rows = await db
        .prepare(
          `SELECT d.*, p.name AS project_name, p.slug AS project_slug, p.production_deployment_id
           FROM deployments d
           JOIN projects p ON p.id = d.project_id
           WHERE d.owner_id = ?
           ORDER BY d.created_at DESC
           LIMIT 50`,
        )
        .bind(auth.user.id)
        .all();
      return jsonResponse(
        {
          deployments: rows.results.map((r) =>
            mapDeploymentRow(
              r,
              r.production_deployment_id ? String(r.production_deployment_id) : null,
              request,
            ),
          ),
        },
        200,
        corsHeaders,
      );
    }

    // POST /api/deployments (start a new pending deployment)
    if (method === 'POST' && pathname === '/api/deployments') {
      const body = await readJsonBody<{
        projectId?: string;
        source?: 'zip' | 'github';
        branch?: string;
        commitSha?: string;
        commitMessage?: string;
        expectedTotalBytes?: number;
        expectedFileCount?: number;
      }>(request);

      const projectId = auth.scopedProjectId || body?.projectId || '';
      if (!projectId) {
        return errorResponse('projectId is required.', 400, 'MISSING_PROJECT_ID', corsHeaders);
      }
      if (auth.scopedProjectId && body?.projectId && body.projectId !== auth.scopedProjectId) {
        return errorResponse('Deployment token does not match the requested project.', 403, 'TOKEN_PROJECT_MISMATCH', corsHeaders);
      }

      const project = await db
        .prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?')
        .bind(projectId, auth.user.id)
        .first<Record<string, unknown>>();
      if (!project) {
        return errorResponse('Project not found or access denied.', 404, 'PROJECT_NOT_FOUND', corsHeaders);
      }

      const storage = await getAccountStorageBytes(auth.user.id);
      const expectedBytes = Number(body?.expectedTotalBytes ?? 0);
      const expectedFiles = Number(body?.expectedFileCount ?? 0);
      if (expectedFiles > SPIDYY_LIMITS.MAX_FILES_PER_DEPLOYMENT) {
        return errorResponse(
          `File count (${expectedFiles}) exceeds the maximum ${SPIDYY_LIMITS.MAX_FILES_PER_DEPLOYMENT} files per deployment.`,
          400,
          'QUOTA_FILE_COUNT_EXCEEDED',
          corsHeaders,
        );
      }
      if (storage.bytes + expectedBytes > SPIDYY_LIMITS.MAX_ACCOUNT_STORAGE_BYTES) {
        return errorResponse(
          `Account storage quota exceeded (${formatBytes(storage.bytes)} used of ${formatBytes(SPIDYY_LIMITS.MAX_ACCOUNT_STORAGE_BYTES)} limit). Delete old deployments to free space.`,
          403,
          'QUOTA_STORAGE_EXCEEDED',
          corsHeaders,
        );
      }

      const source = auth.kind === 'deploy_token' ? 'github' : body?.source === 'github' ? 'github' : 'zip';
      const deploymentId = generateId('dep');
      const now = nowIso();
      const initialLogs: DeploymentLogEntry[] = [
        {
          timestamp: now,
          level: 'info',
          message: `Deployment ${deploymentId} initialized via ${source === 'github' ? 'GitHub Actions' : 'ZIP upload'} for "${project.slug}".`,
        },
      ];

      await db
        .prepare(
          `INSERT INTO deployments (
            id, project_id, owner_id, source, status, commit_sha, commit_message, branch,
            file_count, total_bytes, duration_ms, logs_json, error_message, created_at, completed_at
          ) VALUES (?, ?, ?, ?, 'uploading', ?, ?, ?, 0, 0, 0, ?, NULL, ?, NULL)`,
        )
        .bind(
          deploymentId,
          projectId,
          auth.user.id,
          source,
          body?.commitSha ? String(body.commitSha).slice(0, 64) : null,
          body?.commitMessage ? redactSecrets(String(body.commitMessage).slice(0, 240)) : null,
          body?.branch ? String(body.branch).slice(0, 64) : String(project.repo_branch || 'main'),
          JSON.stringify(initialLogs),
          now,
        )
        .run();

      if (source === 'github') {
        await recordUsage(auth.user.id, projectId, 'github_deployments', 1);
      }
      await recordUsage(auth.user.id, projectId, 'd1_writes', 1);

      const created = await db.prepare('SELECT * FROM deployments WHERE id = ?').bind(deploymentId).first();
      return jsonResponse(
        {
          deployment: mapDeploymentRow(
            created!,
            project.production_deployment_id ? String(project.production_deployment_id) : null,
            request,
            String(project.slug),
            String(project.name),
          ),
        },
        201,
        corsHeaders,
      );
    }

    // Deployment-specific routes: /api/deployments/:id...
    const depMatch = pathname.match(/^\/api\/deployments\/([^/]+)(\/.*)?$/);
    if (depMatch) {
      const deploymentId = depMatch[1];
      const subPath = depMatch[2] || '';

      const dep = await db
        .prepare(
          `SELECT d.*, p.slug AS project_slug, p.name AS project_name, p.production_deployment_id
           FROM deployments d
           JOIN projects p ON p.id = d.project_id
           WHERE d.id = ?`,
        )
        .bind(deploymentId)
        .first<Record<string, unknown>>();

      if (!dep) {
        return errorResponse('Deployment not found.', 404, 'DEPLOYMENT_NOT_FOUND', corsHeaders);
      }
      if (String(dep.owner_id) !== auth.user.id) {
        return errorResponse('Access denied: you do not own this deployment.', 403, 'FORBIDDEN', corsHeaders);
      }
      if (auth.scopedProjectId && String(dep.project_id) !== auth.scopedProjectId) {
        return errorResponse('Deployment token cannot access another project.', 403, 'TOKEN_PROJECT_MISMATCH', corsHeaders);
      }

      const projectId = String(dep.project_id);
      const prodId = dep.production_deployment_id ? String(dep.production_deployment_id) : null;

      // GET /api/deployments/:id
      if (method === 'GET' && subPath === '') {
        const filesRows = await db
          .prepare(
            `SELECT id, deployment_id, file_path, content_type, size_bytes, created_at
             FROM deployment_files WHERE deployment_id = ? ORDER BY file_path ASC LIMIT 500`,
          )
          .bind(deploymentId)
          .all();
        const files: DeploymentFileDTO[] = filesRows.results.map((f) => ({
          id: String(f.id),
          deploymentId: String(f.deployment_id),
          filePath: String(f.file_path),
          contentType: String(f.content_type),
          sizeBytes: Number(f.size_bytes),
          createdAt: String(f.created_at),
        }));
        return jsonResponse(
          {
            deployment: mapDeploymentRow(dep, prodId, request),
            files,
          },
          200,
          corsHeaders,
        );
      }

      // PUT /api/deployments/:id/files
      if (method === 'PUT' && subPath === '/files') {
        if (!['pending', 'uploading', 'building'].includes(String(dep.status))) {
          return errorResponse(`Cannot upload files to a deployment in "${dep.status}" status.`, 400, 'INVALID_STATUS', corsHeaders);
        }

        const rawPath = request.headers.get('x-file-path') || url.searchParams.get('path') || '';
        const validation = sanitizeDeployPath(rawPath);
        if (!validation.valid || !validation.normalized) {
          return errorResponse(validation.reason || 'Invalid file path.', 400, 'INVALID_FILE_PATH', corsHeaders);
        }

        const buf = await request.arrayBuffer();
        const sizeBytes = buf.byteLength;
        if (sizeBytes > SPIDYY_LIMITS.MAX_FILE_SIZE_BYTES) {
          return errorResponse(
            `File "${validation.normalized}" (${formatBytes(sizeBytes)}) exceeds ${formatBytes(SPIDYY_LIMITS.MAX_FILE_SIZE_BYTES)} limit.`,
            400,
            'FILE_TOO_LARGE',
            corsHeaders,
          );
        }

        const currentCounts = await db
          .prepare('SELECT COUNT(*) AS cnt, COALESCE(SUM(size_bytes), 0) AS total FROM deployment_files WHERE deployment_id = ?')
          .bind(deploymentId)
          .first<{ cnt: number; total: number }>();

        if (Number(currentCounts?.cnt ?? 0) >= SPIDYY_LIMITS.MAX_FILES_PER_DEPLOYMENT) {
          return errorResponse(
            `Maximum ${SPIDYY_LIMITS.MAX_FILES_PER_DEPLOYMENT} files per deployment reached.`,
            400,
            'QUOTA_FILE_COUNT_EXCEEDED',
            corsHeaders,
          );
        }

        const storage = await getAccountStorageBytes(auth.user.id);
        if (storage.bytes + sizeBytes > SPIDYY_LIMITS.MAX_ACCOUNT_STORAGE_BYTES) {
          return errorResponse(
            `Account storage quota (${formatBytes(SPIDYY_LIMITS.MAX_ACCOUNT_STORAGE_BYTES)}) exceeded.`,
            403,
            'QUOTA_STORAGE_EXCEEDED',
            corsHeaders,
          );
        }

        const r2Key = `sites/${projectId}/${deploymentId}/${validation.normalized}`;
        const contentType = validation.contentType || lookupMimeType(validation.normalized);
        const sha256 = await sha256Hex(new Uint8Array(buf));

        await bucket.put(r2Key, buf, {
          httpMetadata: {
            contentType,
          },
        });

        const now = nowIso();
        await db
          .prepare(
            `INSERT INTO deployment_files (id, deployment_id, project_id, file_path, r2_key, content_type, size_bytes, sha256, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (deployment_id, file_path) DO UPDATE SET
               r2_key = excluded.r2_key,
               content_type = excluded.content_type,
               size_bytes = excluded.size_bytes,
               sha256 = excluded.sha256`,
          )
          .bind(
            generateId('fil'),
            deploymentId,
            projectId,
            validation.normalized,
            r2Key,
            contentType,
            sizeBytes,
            sha256,
            now,
          )
          .run();

        await db
          .prepare(
            `UPDATE deployments
             SET file_count = (SELECT COUNT(*) FROM deployment_files WHERE deployment_id = ?),
                 total_bytes = (SELECT COALESCE(SUM(size_bytes), 0) FROM deployment_files WHERE deployment_id = ?)
             WHERE id = ?`,
          )
          .bind(deploymentId, deploymentId, deploymentId)
          .run();

        await recordUsage(auth.user.id, projectId, 'r2_ops', 1);
        await recordUsage(auth.user.id, projectId, 'd1_writes', 2);

        return jsonResponse(
          {
            uploaded: {
              filePath: validation.normalized,
              contentType,
              sizeBytes,
              sha256,
            },
          },
          200,
          corsHeaders,
        );
      }

      // POST /api/deployments/:id/complete
      if (method === 'POST' && subPath === '/complete') {
        const indexRow = await db
          .prepare("SELECT id FROM deployment_files WHERE deployment_id = ? AND file_path = 'index.html'")
          .bind(deploymentId)
          .first();

        if (!indexRow) {
          const msg = 'Deployment rejected: root index.html is missing from uploaded static output.';
          await appendDeploymentLog(deploymentId, 'error', msg);
          await cleanupDeploymentR2Files(deploymentId);
          await db.prepare('DELETE FROM deployment_files WHERE deployment_id = ?').bind(deploymentId).run();
          await db
            .prepare(
              `UPDATE deployments
               SET status = 'failed', error_message = ?, completed_at = ?,
                   duration_ms = MAX(1, CAST((julianday(?) - julianday(created_at)) * 86400000 AS INTEGER))
               WHERE id = ?`,
            )
            .bind(msg, nowIso(), nowIso(), deploymentId)
            .run();
          return errorResponse(msg, 400, 'MISSING_INDEX_HTML', corsHeaders);
        }

        const totals = await db
          .prepare('SELECT COUNT(*) AS cnt, COALESCE(SUM(size_bytes), 0) AS total FROM deployment_files WHERE deployment_id = ?')
          .bind(deploymentId)
          .first<{ cnt: number; total: number }>();

        const now = nowIso();
        const createdAtMs = new Date(String(dep.created_at)).getTime();
        const durationMs = Math.max(1, Date.now() - (Number.isFinite(createdAtMs) ? createdAtMs : Date.now()));

        await appendDeploymentLog(
          deploymentId,
          'success',
          `Verified ${Number(totals?.cnt ?? 0)} files (${formatBytes(Number(totals?.total ?? 0))}) including index.html. Activating production pointer.`,
        );

        await db
          .prepare(
            `UPDATE deployments
             SET status = 'ready', file_count = ?, total_bytes = ?, duration_ms = ?, completed_at = ?
             WHERE id = ?`,
          )
          .bind(Number(totals?.cnt ?? 0), Number(totals?.total ?? 0), durationMs, now, deploymentId)
          .run();

        await db
          .prepare(
            `UPDATE projects
             SET production_deployment_id = ?, status = 'active', last_deployed_at = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(deploymentId, now, now, projectId)
          .run();

        await pruneExcessDeployments(projectId, deploymentId);
        await writeAuditLog(
          auth.user.id,
          projectId,
          'deployment.complete',
          'deployment',
          deploymentId,
          { fileCount: Number(totals?.cnt ?? 0), totalBytes: Number(totals?.total ?? 0) },
          clientIp,
        );

        const updatedDep = await db
          .prepare(
            `SELECT d.*, p.slug AS project_slug, p.name AS project_name, p.production_deployment_id
             FROM deployments d JOIN projects p ON p.id = d.project_id WHERE d.id = ?`,
          )
          .bind(deploymentId)
          .first();

        return jsonResponse(
          {
            deployment: mapDeploymentRow(
              updatedDep!,
              deploymentId,
              request,
            ),
          },
          200,
          corsHeaders,
        );
      }

      // POST /api/deployments/:id/fail
      if (method === 'POST' && subPath === '/fail') {
        const body = await readJsonBody<{ errorMessage?: string }>(request);
        const errMsg = redactSecrets(body?.errorMessage?.trim() || 'Deployment cancelled or failed during upload.');
        await appendDeploymentLog(deploymentId, 'error', errMsg);
        await cleanupDeploymentR2Files(deploymentId);
        await db.prepare('DELETE FROM deployment_files WHERE deployment_id = ?').bind(deploymentId).run();
        const now = nowIso();
        await db
          .prepare(
            `UPDATE deployments
             SET status = 'failed', error_message = ?, file_count = 0, total_bytes = 0, completed_at = ?
             WHERE id = ?`,
          )
          .bind(errMsg, now, deploymentId)
          .run();
        await writeAuditLog(auth.user.id, projectId, 'deployment.fail', 'deployment', deploymentId, { errMsg }, clientIp);
        return jsonResponse({ ok: true }, 200, corsHeaders);
      }

      // POST /api/deployments/:id/rollback
      if (method === 'POST' && subPath === '/rollback') {
        if (String(dep.status) !== 'ready') {
          return errorResponse('Only READY deployments can be promoted to production.', 400, 'NOT_READY', corsHeaders);
        }
        const indexRow = await db
          .prepare("SELECT id FROM deployment_files WHERE deployment_id = ? AND file_path = 'index.html'")
          .bind(deploymentId)
          .first();
        if (!indexRow) {
          return errorResponse('Deployment files are no longer available in storage.', 400, 'FILES_MISSING', corsHeaders);
        }
        const now = nowIso();
        await db
          .prepare('UPDATE projects SET production_deployment_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
          .bind(deploymentId, now, projectId, auth.user.id)
          .run();
        await appendDeploymentLog(deploymentId, 'info', 'Promoted to active production via rollback.');
        await writeAuditLog(auth.user.id, projectId, 'deployment.rollback', 'deployment', deploymentId, {}, clientIp);
        return jsonResponse(
          {
            ok: true,
            productionDeploymentId: deploymentId,
            liveUrl: `${getPublicOrigin(request, env)}/s/${dep.project_slug}/`,
          },
          200,
          corsHeaders,
        );
      }

      // POST /api/deployments/:id/redeploy
      if (method === 'POST' && subPath === '/redeploy') {
        if (String(dep.status) !== 'ready') {
          return errorResponse('Only READY deployments can be redeployed.', 400, 'NOT_READY', corsHeaders);
        }
        const sourceFiles = await db
          .prepare('SELECT file_path, r2_key, content_type, size_bytes, sha256 FROM deployment_files WHERE deployment_id = ?')
          .bind(deploymentId)
          .all<{
            file_path: string;
            r2_key: string;
            content_type: string;
            size_bytes: number;
            sha256: string | null;
          }>();

        if (sourceFiles.results.length === 0) {
          return errorResponse('No source files found for redeploy.', 400, 'NO_FILES', corsHeaders);
        }

        const totalNewBytes = sourceFiles.results.reduce((acc, f) => acc + Number(f.size_bytes), 0);
        const storage = await getAccountStorageBytes(auth.user.id);
        if (storage.bytes + totalNewBytes > SPIDYY_LIMITS.MAX_ACCOUNT_STORAGE_BYTES) {
          return errorResponse('Storage quota would be exceeded by redeploying.', 403, 'QUOTA_STORAGE_EXCEEDED', corsHeaders);
        }

        const newDepId = generateId('dep');
        const now = nowIso();
        const logs: DeploymentLogEntry[] = [
          { timestamp: now, level: 'info', message: `Redeploying snapshot from ${deploymentId}...` },
        ];
        await db
          .prepare(
            `INSERT INTO deployments (
              id, project_id, owner_id, source, status, commit_sha, commit_message, branch,
              file_count, total_bytes, duration_ms, logs_json, error_message, created_at, completed_at
            ) VALUES (?, ?, ?, 'redeploy', 'deploying', ?, ?, ?, 0, 0, 0, ?, NULL, ?, NULL)`,
          )
          .bind(
            newDepId,
            projectId,
            auth.user.id,
            dep.commit_sha || null,
            `Redeploy of ${deploymentId}`,
            dep.branch || null,
            JSON.stringify(logs),
            now,
          )
          .run();

        for (const f of sourceFiles.results) {
          const obj = await bucket.get(f.r2_key);
          if (!obj) continue;
          const bytes = await obj.arrayBuffer();
          const newKey = `sites/${projectId}/${newDepId}/${f.file_path}`;
          await bucket.put(newKey, bytes, { httpMetadata: { contentType: f.content_type } });
          await db
            .prepare(
              `INSERT INTO deployment_files (id, deployment_id, project_id, file_path, r2_key, content_type, size_bytes, sha256, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(generateId('fil'), newDepId, projectId, f.file_path, newKey, f.content_type, f.size_bytes, f.sha256, now)
            .run();
        }

        const doneAt = nowIso();
        await appendDeploymentLog(newDepId, 'success', `Redeployed ${sourceFiles.results.length} files cleanly.`);
        await db
          .prepare(
            `UPDATE deployments SET status = 'ready', file_count = ?, total_bytes = ?, duration_ms = 250, completed_at = ? WHERE id = ?`,
          )
          .bind(sourceFiles.results.length, totalNewBytes, doneAt, newDepId)
          .run();
        await db
          .prepare('UPDATE projects SET production_deployment_id = ?, last_deployed_at = ?, updated_at = ? WHERE id = ?')
          .bind(newDepId, doneAt, doneAt, projectId)
          .run();

        await pruneExcessDeployments(projectId, newDepId);
        await writeAuditLog(auth.user.id, projectId, 'deployment.redeploy', 'deployment', newDepId, { from: deploymentId }, clientIp);

        const created = await db
          .prepare(
            `SELECT d.*, p.slug AS project_slug, p.name AS project_name, p.production_deployment_id
             FROM deployments d JOIN projects p ON p.id = d.project_id WHERE d.id = ?`,
          )
          .bind(newDepId)
          .first();

        return jsonResponse({ deployment: mapDeploymentRow(created!, newDepId, request) }, 201, corsHeaders);
      }

      // DELETE /api/deployments/:id
      if (method === 'DELETE' && subPath === '') {
        if (prodId === deploymentId) {
          return errorResponse('Cannot delete the active production deployment. Roll back to another version first.', 400, 'CANNOT_DELETE_PRODUCTION', corsHeaders);
        }
        await cleanupDeploymentR2Files(deploymentId);
        await db.prepare('DELETE FROM deployment_files WHERE deployment_id = ?').bind(deploymentId).run();
        await db.prepare('DELETE FROM deployments WHERE id = ? AND owner_id = ?').bind(deploymentId, auth.user.id).run();
        await writeAuditLog(auth.user.id, projectId, 'deployment.delete', 'deployment', deploymentId, {}, clientIp);
        return jsonResponse({ ok: true }, 200, corsHeaders);
      }
    }

    // GET /api/account/usage
    if (method === 'GET' && pathname === '/api/account/usage') {
      const periodKey = todayPeriodKey();
      const projCountRow = await db
        .prepare('SELECT COUNT(*) AS cnt FROM projects WHERE owner_id = ?')
        .bind(auth.user.id)
        .first<{ cnt: number }>();
      const depStats = await db
        .prepare(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready_cnt,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_cnt
           FROM deployments WHERE owner_id = ?`,
        )
        .bind(auth.user.id)
        .first<{ total: number; ready_cnt: number; failed_cnt: number }>();

      const storage = await getAccountStorageBytes(auth.user.id);
      const metricRows = await db
        .prepare(
          `SELECT metric_type, COALESCE(SUM(amount), 0) AS total
           FROM usage_records WHERE user_id = ? AND period_key = ?
           GROUP BY metric_type`,
        )
        .bind(auth.user.id, periodKey)
        .all<{ metric_type: string; total: number }>();

      const m: Record<string, number> = {};
      for (const r of metricRows.results) m[r.metric_type] = Number(r.total);

      // Build real daily deployment & request activity over the last 14 days
      const depDaily = await db
        .prepare(
          `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS cnt
           FROM deployments WHERE owner_id = ?
           GROUP BY day ORDER BY day DESC LIMIT 14`,
        )
        .bind(auth.user.id)
        .all<{ day: string; cnt: number }>();
      const reqDaily = await db
        .prepare(
          `SELECT substr(recorded_at, 1, 10) AS day, COALESCE(SUM(amount), 0) AS cnt
           FROM usage_records WHERE user_id = ? AND metric_type = 'site_requests'
           GROUP BY day ORDER BY day DESC LIMIT 14`,
        )
        .bind(auth.user.id)
        .all<{ day: string; cnt: number }>();

      const depDayMap = new Map(depDaily.results.map((r) => [r.day, Number(r.cnt)]));
      const reqDayMap = new Map(reqDaily.results.map((r) => [r.day, Number(r.cnt)]));
      const dailyActivity: AccountUsageDTO['dailyActivity'] = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400 * 1000).toISOString().slice(0, 10);
        dailyActivity.push({
          date: d,
          deployments: depDayMap.get(d) ?? 0,
          siteRequests: reqDayMap.get(d) ?? 0,
        });
      }

      const projectCount = Number(projCountRow?.cnt ?? 0);
      const warnings: string[] = [];
      if (projectCount >= Math.ceil(SPIDYY_LIMITS.MAX_PROJECTS_PER_USER * SPIDYY_LIMITS.WARNING_THRESHOLD_RATIO)) {
        warnings.push(`Using ${projectCount} of ${SPIDYY_LIMITS.MAX_PROJECTS_PER_USER} allowed projects.`);
      }
      if (storage.bytes >= SPIDYY_LIMITS.MAX_ACCOUNT_STORAGE_BYTES * SPIDYY_LIMITS.WARNING_THRESHOLD_RATIO) {
        warnings.push(
          `Storage at ${Math.round((storage.bytes / SPIDYY_LIMITS.MAX_ACCOUNT_STORAGE_BYTES) * 100)}% (${formatBytes(storage.bytes)} / ${formatBytes(SPIDYY_LIMITS.MAX_ACCOUNT_STORAGE_BYTES)}).`,
        );
      }

      const payload: AccountUsageDTO = {
        periodKey,
        limits: {
          maxProjectsPerUser: SPIDYY_LIMITS.MAX_PROJECTS_PER_USER,
          maxFilesPerDeployment: SPIDYY_LIMITS.MAX_FILES_PER_DEPLOYMENT,
          maxFileSizeBytes: SPIDYY_LIMITS.MAX_FILE_SIZE_BYTES,
          maxZipSizeBytes: SPIDYY_LIMITS.MAX_ZIP_SIZE_BYTES,
          maxAccountStorageBytes: SPIDYY_LIMITS.MAX_ACCOUNT_STORAGE_BYTES,
          maxActiveDeploymentsPerProject: SPIDYY_LIMITS.MAX_ACTIVE_DEPLOYMENTS_PER_PROJECT,
        },
        current: {
          projectCount,
          deploymentCount: Number(depStats?.total ?? 0),
          successfulDeployments: Number(depStats?.ready_cnt ?? 0),
          failedDeployments: Number(depStats?.failed_cnt ?? 0),
          storedFileCount: storage.files,
          storedBytes: storage.bytes,
          workerRequests: m.worker_requests ?? 0,
          d1Reads: m.d1_reads ?? 0,
          d1Writes: m.d1_writes ?? 0,
          r2Ops: m.r2_ops ?? 0,
          siteRequests: m.site_requests ?? 0,
          siteBandwidthBytes: m.site_bandwidth_bytes ?? 0,
          githubDeployments: m.github_deployments ?? 0,
        },
        warnings,
        dailyActivity,
        unavailableMetrics: [
          {
            name: 'Global PoP Edge Latency (P50/P99)',
            reason: 'Unavailable on zero-budget free Workers without Workers Analytics Engine or Logpush.',
          },
          {
            name: 'Geographic Visitor Breakdown & ASN Telemetry',
            reason: 'Unavailable without Cloudflare Web Analytics / paid Logpush integration.',
          },
          {
            name: 'GitHub Actions Exact Account Minute Balance',
            reason: 'Requires GitHub Billing API OAuth scope; public repositories run free on standard runners.',
          },
        ],
      };

      return jsonResponse({ usage: payload }, 200, corsHeaders);
    }

    // GET /api/account/domains (all domains across user projects)
    if (method === 'GET' && pathname === '/api/account/domains') {
      const rows = await db
        .prepare(
          `SELECT d.*, p.slug AS project_slug
           FROM domains d
           JOIN projects p ON p.id = d.project_id
           WHERE d.owner_id = ?
           ORDER BY d.type ASC, d.created_at DESC`,
        )
        .bind(auth.user.id)
        .all();
      const domains: DomainDTO[] = rows.results.map((r) => ({
        id: String(r.id),
        projectId: String(r.project_id),
        projectSlug: String(r.project_slug),
        hostname: String(r.hostname),
        type: String(r.type) as 'platform' | 'custom',
        status: String(r.status) as DomainDTO['status'],
        verificationTxt: r.verification_txt ? String(r.verification_txt) : null,
        createdAt: String(r.created_at),
      }));
      return jsonResponse({ domains }, 200, corsHeaders);
    }

    // GET /api/account/audit-logs
    if (method === 'GET' && pathname === '/api/account/audit-logs') {
      const rows = await db
        .prepare('SELECT id, action, resource_type, resource_id, details_json, created_at FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 40')
        .bind(auth.user.id)
        .all();
      const logs: AuditLogDTO[] = rows.results.map((r) => {
        let details: Record<string, unknown> = {};
        try {
          details = JSON.parse(String(r.details_json || '{}'));
        } catch {
          details = {};
        }
        return {
          id: String(r.id),
          action: String(r.action),
          resourceType: String(r.resource_type),
          resourceId: r.resource_id ? String(r.resource_id) : null,
          details,
          createdAt: String(r.created_at),
        };
      });
      return jsonResponse({ logs }, 200, corsHeaders);
    }

    return errorResponse('API endpoint not found.', 404, 'NOT_FOUND', corsHeaders);
  };
}

function generateGitHubActionsWorkflow(opts: {
  projectId: string;
  projectName: string;
  projectSlug: string;
  branch: string;
  framework: string;
  buildCommand: string;
  outputDir: string;
  apiUrl: string;
}): string {
  const cleanDir = opts.outputDir || '.';
  const buildStep = opts.buildCommand
    ? `      - name: Install dependencies and build\n        run: |\n          npm ci || npm install\n          ${opts.buildCommand}\n`
    : `      - name: Skip build step (static HTML/CSS/JS)\n        run: echo "Using prebuilt static output in ${cleanDir}"\n`;

  return `# SPIDYY CLOUD Automated Deployment Workflow
# Project: ${opts.projectName} (${opts.projectSlug})
# Add SPIDYY_DEPLOY_TOKEN to GitHub Repository Secrets before pushing.

name: Deploy to SPIDYY CLOUD

on:
  push:
    branches:
      - "${opts.branch}"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"

${buildStep}
      - name: Validate output directory and deploy to SPIDYY CLOUD
        env:
          SPIDYY_API_URL: "${opts.apiUrl}"
          SPIDYY_PROJECT_ID: "${opts.projectId}"
          SPIDYY_DEPLOY_TOKEN: \${{ secrets.SPIDYY_DEPLOY_TOKEN }}
          SPIDYY_OUTPUT_DIR: "${cleanDir}"
          GITHUB_SHA: \${{ github.sha }}
          GITHUB_REF_NAME: \${{ github.ref_name }}
        run: |
          node << 'EOF'
          const fs = require('fs');
          const path = require('path');

          const apiUrl = process.env.SPIDYY_API_URL.replace(/\\/$/, '');
          const projectId = process.env.SPIDYY_PROJECT_ID;
          const token = process.env.SPIDYY_DEPLOY_TOKEN;
          const outDir = path.resolve(process.env.SPIDYY_OUTPUT_DIR || '.');

          if (!token) {
            console.error('Missing SPIDYY_DEPLOY_TOKEN secret.');
            process.exit(1);
          }
          if (!fs.existsSync(outDir)) {
            console.error('Output directory not found:', outDir);
            process.exit(1);
          }

          function walk(dir, base = '') {
            let files = [];
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              if (entry.name === '.git' || entry.name === 'node_modules') continue;
              const full = path.join(dir, entry.name);
              const rel = base ? base + '/' + entry.name : entry.name;
              if (entry.isDirectory()) {
                files = files.concat(walk(full, rel));
              } else if (entry.isFile()) {
                files.push({ full, rel, size: fs.statSync(full).size });
              }
            }
            return files;
          }

          async function run() {
            const files = walk(outDir);
            const hasIndex = files.some((f) => f.rel === 'index.html');
            if (!hasIndex) {
              console.error('Error: index.html not found in output directory:', outDir);
              process.exit(1);
            }
            const totalBytes = files.reduce((s, f) => s + f.size, 0);
            console.log(\`Deploying \${files.length} files (\${totalBytes} bytes) to SPIDYY CLOUD...\`);

            const createRes = await fetch(\`\${apiUrl}/api/deployments\`, {
              method: 'POST',
              headers: {
                'Authorization': \`Bearer \${token}\`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                projectId,
                source: 'github',
                branch: process.env.GITHUB_REF_NAME,
                commitSha: process.env.GITHUB_SHA,
                commitMessage: 'GitHub Actions automated deployment',
                expectedFileCount: files.length,
                expectedTotalBytes: totalBytes,
              }),
            });
            const created = await createRes.json();
            if (!createRes.ok) {
              console.error('Failed to initialize deployment:', created);
              process.exit(1);
            }
            const deploymentId = created.deployment.id;

            try {
              for (const f of files) {
                const data = fs.readFileSync(f.full);
                const putRes = await fetch(\`\${apiUrl}/api/deployments/\${deploymentId}/files\`, {
                  method: 'PUT',
                  headers: {
                    'Authorization': \`Bearer \${token}\`,
                    'X-File-Path': f.rel,
                    'Content-Type': 'application/octet-stream',
                  },
                  body: data,
                });
                if (!putRes.ok) {
                  const err = await putRes.text();
                  throw new Error(\`Upload failed for \${f.rel}: \${err}\`);
                }
              }

              const doneRes = await fetch(\`\${apiUrl}/api/deployments/\${deploymentId}/complete\`, {
                method: 'POST',
                headers: { 'Authorization': \`Bearer \${token}\` },
              });
              const done = await doneRes.json();
              if (!doneRes.ok) {
                throw new Error(\`Finalize failed: \${JSON.stringify(done)}\`);
              }
              console.log('Deployment LIVE:', done.deployment.liveUrl);
            } catch (err) {
              await fetch(\`\${apiUrl}/api/deployments/\${deploymentId}/fail\`, {
                method: 'POST',
                headers: {
                  'Authorization': \`Bearer \${token}\`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ errorMessage: String(err.message || err) }),
              });
              console.error(err);
              process.exit(1);
            }
          }

          run();
          EOF
`;
}

function renderNotFoundHtml(detail: string): string {
  const escaped = detail
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>404 — SPIDYY CLOUD</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #0B0D10; color: #E5E7EB; display: grid; place-items: center; min-height: 100vh; padding: 24px; }
    .box { max-width: 480px; width: 100%; border: 1px solid #1F2937; background: #12151A; padding: 32px; border-radius: 8px; }
    .code { font-family: ui-monospace, monospace; font-size: 13px; color: #9CA3AF; margin-bottom: 12px; }
    h1 { font-size: 22px; margin: 0 0 8px; color: #F9FAFB; }
    p { font-size: 14px; line-height: 1.6; color: #9CA3AF; margin: 0; }
  </style>
</head>
<body>
  <main class="box">
    <div class="code">HTTP 404 · SPIDYY CLOUD STATIC ENGINE</div>
    <h1>Site or asset not found</h1>
    <p>${escaped}</p>
  </main>
</body>
</html>`;
}
