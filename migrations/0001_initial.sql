-- SPIDYY CLOUD — Cloudflare D1 Initial Schema Migration
-- Compatible with Cloudflare D1 (SQLite) and Node 22 node:sqlite

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'developer',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  framework TEXT NOT NULL DEFAULT 'static',
  repo_url TEXT,
  repo_branch TEXT DEFAULT 'main',
  build_command TEXT,
  output_dir TEXT DEFAULT 'dist',
  production_deployment_id TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  spa_fallback INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_deployed_at TEXT,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('zip', 'github', 'redeploy')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'uploading', 'building', 'deploying', 'ready', 'failed', 'cancelled')),
  commit_sha TEXT,
  commit_message TEXT,
  branch TEXT,
  file_count INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  logs_json TEXT NOT NULL DEFAULT '[]',
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deployments_project_id ON deployments(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployments_owner_id ON deployments(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);

CREATE TABLE IF NOT EXISTS deployment_files (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (deployment_id, file_path),
  FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deployment_files_deployment_id ON deployment_files(deployment_id);
CREATE INDEX IF NOT EXISTS idx_deployment_files_lookup ON deployment_files(deployment_id, file_path);

CREATE TABLE IF NOT EXISTS deployment_tokens (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deployment_tokens_project_id ON deployment_tokens(project_id);
CREATE INDEX IF NOT EXISTS idx_deployment_tokens_hash ON deployment_tokens(token_hash);

CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  hostname TEXT NOT NULL UNIQUE COLLATE NOCASE,
  type TEXT NOT NULL CHECK (type IN ('platform', 'custom')),
  status TEXT NOT NULL CHECK (status IN ('active', 'pending_dns', 'unavailable')),
  verification_txt TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_domains_project_id ON domains(project_id);

CREATE TABLE IF NOT EXISTS env_vars (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  key_name TEXT NOT NULL,
  value_masked TEXT NOT NULL,
  value_stored TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT 'production' CHECK (target IN ('production', 'preview')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, key_name, target),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_env_vars_project_id ON env_vars(project_id);

CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  metric_type TEXT NOT NULL CHECK (metric_type IN (
    'worker_requests',
    'd1_reads',
    'd1_writes',
    'r2_ops',
    'site_requests',
    'site_bandwidth_bytes',
    'github_deployments'
  )),
  amount INTEGER NOT NULL DEFAULT 0,
  period_key TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_usage_records_user_period ON usage_records(user_id, period_key, metric_type);
CREATE INDEX IF NOT EXISTS idx_usage_records_project_period ON usage_records(project_id, period_key);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  ip_address TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id, created_at DESC);
