export type DeploymentSource = 'zip' | 'github' | 'redeploy';
export type DeploymentStatus =
  | 'pending'
  | 'uploading'
  | 'building'
  | 'deploying'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

export interface ProjectDTO {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  framework: string;
  repoUrl: string | null;
  repoBranch: string;
  buildCommand: string | null;
  outputDir: string;
  productionDeploymentId: string | null;
  status: string;
  spaFallback: boolean;
  createdAt: string;
  updatedAt: string;
  lastDeployedAt: string | null;
  liveUrl: string;
  deploymentCount?: number;
  storageBytes?: number;
}

export interface DeploymentLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export interface DeploymentDTO {
  id: string;
  projectId: string;
  projectName?: string;
  projectSlug?: string;
  ownerId: string;
  source: DeploymentSource;
  status: DeploymentStatus;
  commitSha: string | null;
  commitMessage: string | null;
  branch: string | null;
  fileCount: number;
  totalBytes: number;
  durationMs: number;
  logs: DeploymentLogEntry[];
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  isProduction: boolean;
  liveUrl?: string;
}

export interface DeploymentFileDTO {
  id: string;
  deploymentId: string;
  filePath: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface DeploymentTokenDTO {
  id: string;
  projectId: string;
  name: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface DomainDTO {
  id: string;
  projectId: string;
  projectSlug?: string;
  hostname: string;
  type: 'platform' | 'custom';
  status: 'active' | 'pending_dns' | 'unavailable';
  verificationTxt: string | null;
  createdAt: string;
}

export interface EnvVarDTO {
  id: string;
  projectId: string;
  keyName: string;
  valueMasked: string;
  target: 'production' | 'preview';
  createdAt: string;
  updatedAt: string;
}

export interface AccountUsageDTO {
  periodKey: string;
  limits: {
    maxProjectsPerUser: number;
    maxFilesPerDeployment: number;
    maxFileSizeBytes: number;
    maxZipSizeBytes: number;
    maxAccountStorageBytes: number;
    maxActiveDeploymentsPerProject: number;
  };
  current: {
    projectCount: number;
    deploymentCount: number;
    successfulDeployments: number;
    failedDeployments: number;
    storedFileCount: number;
    storedBytes: number;
    workerRequests: number;
    d1Reads: number;
    d1Writes: number;
    r2Ops: number;
    siteRequests: number;
    siteBandwidthBytes: number;
    githubDeployments: number;
  };
  warnings: string[];
  dailyActivity: Array<{
    date: string;
    deployments: number;
    siteRequests: number;
  }>;
  unavailableMetrics: Array<{
    name: string;
    reason: string;
  }>;
}

export interface AuditLogDTO {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}
