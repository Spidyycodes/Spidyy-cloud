import type {
  AccountUsageDTO,
  AuditLogDTO,
  DeploymentDTO,
  DeploymentFileDTO,
  DeploymentTokenDTO,
  DomainDTO,
  EnvVarDTO,
  ProjectDTO,
  UserDTO,
} from '../../packages/shared/types.ts';

let csrfTokenMemory = '';

export function setCsrfToken(token: string | undefined | null) {
  if (token) csrfTokenMemory = token;
}

export function getCsrfToken(): string {
  return csrfTokenMemory;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(message: string, status: number, code = 'API_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function requestJson<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (csrfTokenMemory) {
    headers.set('X-CSRF-Token', csrfTokenMemory);
  }
  headers.set('X-Requested-With', 'XMLHttpRequest');

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (typeof data.csrfToken === 'string') {
    csrfTokenMemory = data.csrfToken;
  }

  if (!res.ok) {
    throw new ApiError(
      typeof data.error === 'string' ? data.error : `Request failed (${res.status})`,
      res.status,
      typeof data.code === 'string' ? data.code : 'HTTP_ERROR',
    );
  }

  return data as T;
}

export const spidyyApi = {
  getRecoveryStatus: () =>
    requestJson<{ enabled: boolean; reason: string | null }>('/api/auth/recovery-status'),

  register: (payload: { name: string; email: string; password: string }) =>
    requestJson<{ user: UserDTO; csrfToken: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (payload: { email: string; password: string }) =>
    requestJson<{ user: UserDTO; csrfToken: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  logout: () =>
    requestJson<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST',
    }),

  me: () =>
    requestJson<{ user: UserDTO; csrfToken: string }>('/api/auth/me'),

  updateProfile: (payload: { name: string }) =>
    requestJson<{ user: UserDTO }>('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  changePassword: (payload: { currentPassword: string; newPassword: string }) =>
    requestJson<{ ok: boolean }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  invalidateOtherSessions: () =>
    requestJson<{ ok: boolean }>('/api/auth/sessions/invalidate-all', {
      method: 'POST',
    }),

  listProjects: () =>
    requestJson<{ projects: ProjectDTO[] }>('/api/projects'),

  createProject: (payload: {
    name: string;
    slug?: string;
    framework: string;
    repoUrl?: string;
    repoBranch?: string;
    buildCommand?: string;
    outputDir?: string;
    spaFallback?: boolean;
  }) =>
    requestJson<{ project: ProjectDTO }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getProject: (projectId: string) =>
    requestJson<{ project: ProjectDTO }>(`/api/projects/${encodeURIComponent(projectId)}`),

  updateProject: (
    projectId: string,
    payload: Partial<{
      name: string;
      framework: string;
      repoUrl: string | null;
      repoBranch: string;
      buildCommand: string | null;
      outputDir: string;
      spaFallback: boolean;
    }>,
  ) =>
    requestJson<{ project: ProjectDTO }>(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteProject: (projectId: string) =>
    requestJson<{ ok: boolean }>(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
    }),

  listProjectDeployments: (projectId: string) =>
    requestJson<{ deployments: DeploymentDTO[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/deployments`,
    ),

  listAllDeployments: () =>
    requestJson<{ deployments: DeploymentDTO[] }>('/api/deployments'),

  createDeployment: (payload: {
    projectId: string;
    source: 'zip' | 'github';
    branch?: string;
    commitSha?: string;
    commitMessage?: string;
    expectedFileCount: number;
    expectedTotalBytes: number;
  }) =>
    requestJson<{ deployment: DeploymentDTO }>('/api/deployments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  uploadDeploymentFile: async (
    deploymentId: string,
    filePath: string,
    data: Uint8Array,
  ): Promise<{ uploaded: { filePath: string; contentType: string; sizeBytes: number; sha256: string } }> => {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    const res = await fetch(`/api/deployments/${encodeURIComponent(deploymentId)}/files`, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Path': filePath,
        'X-CSRF-Token': csrfTokenMemory,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: copy.buffer,
    });
    const json = await res.json();
    if (!res.ok) {
      throw new ApiError(json.error || 'File upload failed', res.status, json.code || 'UPLOAD_ERROR');
    }
    return json;
  },

  completeDeployment: (deploymentId: string) =>
    requestJson<{ deployment: DeploymentDTO }>(
      `/api/deployments/${encodeURIComponent(deploymentId)}/complete`,
      { method: 'POST' },
    ),

  failDeployment: (deploymentId: string, errorMessage: string) =>
    requestJson<{ ok: boolean }>(
      `/api/deployments/${encodeURIComponent(deploymentId)}/fail`,
      {
        method: 'POST',
        body: JSON.stringify({ errorMessage }),
      },
    ),

  getDeployment: (deploymentId: string) =>
    requestJson<{ deployment: DeploymentDTO; files: DeploymentFileDTO[] }>(
      `/api/deployments/${encodeURIComponent(deploymentId)}`,
    ),

  rollbackDeployment: (deploymentId: string) =>
    requestJson<{ ok: boolean; productionDeploymentId: string; liveUrl: string }>(
      `/api/deployments/${encodeURIComponent(deploymentId)}/rollback`,
      { method: 'POST' },
    ),

  redeployDeployment: (deploymentId: string) =>
    requestJson<{ deployment: DeploymentDTO }>(
      `/api/deployments/${encodeURIComponent(deploymentId)}/redeploy`,
      { method: 'POST' },
    ),

  deleteDeployment: (deploymentId: string) =>
    requestJson<{ ok: boolean }>(`/api/deployments/${encodeURIComponent(deploymentId)}`, {
      method: 'DELETE',
    }),

  listProjectTokens: (projectId: string) =>
    requestJson<{ tokens: DeploymentTokenDTO[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/github-token`,
    ),

  createProjectToken: (projectId: string, name?: string) =>
    requestJson<{ token: string; record: DeploymentTokenDTO }>(
      `/api/projects/${encodeURIComponent(projectId)}/github-token`,
      {
        method: 'POST',
        body: JSON.stringify({ name }),
      },
    ),

  rotateProjectToken: (projectId: string, name?: string) =>
    requestJson<{ token: string; record: DeploymentTokenDTO }>(
      `/api/projects/${encodeURIComponent(projectId)}/github-token/rotate`,
      {
        method: 'POST',
        body: JSON.stringify({ name }),
      },
    ),

  revokeProjectToken: (projectId: string, tokenId: string) =>
    requestJson<{ ok: boolean }>(
      `/api/projects/${encodeURIComponent(projectId)}/github-token/${encodeURIComponent(tokenId)}`,
      { method: 'DELETE' },
    ),

  getProjectWorkflow: (projectId: string) =>
    requestJson<{ yaml: string; filename: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/workflow`,
    ),

  listProjectDomains: (projectId: string) =>
    requestJson<{ domains: DomainDTO[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/domains`,
    ),

  listAllDomains: () =>
    requestJson<{ domains: DomainDTO[] }>('/api/account/domains'),

  addProjectDomain: (projectId: string, hostname: string) =>
    requestJson<{ domain: DomainDTO }>(
      `/api/projects/${encodeURIComponent(projectId)}/domains`,
      {
        method: 'POST',
        body: JSON.stringify({ hostname }),
      },
    ),

  deleteProjectDomain: (projectId: string, domainId: string) =>
    requestJson<{ ok: boolean }>(
      `/api/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domainId)}`,
      { method: 'DELETE' },
    ),

  listProjectEnvVars: (projectId: string) =>
    requestJson<{ envVars: EnvVarDTO[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/env`,
    ),

  upsertProjectEnvVar: (
    projectId: string,
    payload: { keyName: string; value: string; target: 'production' | 'preview' },
  ) =>
    requestJson<{ envVar: EnvVarDTO }>(
      `/api/projects/${encodeURIComponent(projectId)}/env`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),

  deleteProjectEnvVar: (projectId: string, envId: string) =>
    requestJson<{ ok: boolean }>(
      `/api/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(envId)}`,
      { method: 'DELETE' },
    ),

  getAccountUsage: () =>
    requestJson<{ usage: AccountUsageDTO }>('/api/account/usage'),

  getAuditLogs: () =>
    requestJson<{ logs: AuditLogDTO[] }>('/api/account/audit-logs'),
};
