import { BLOCKED_EXTENSIONS, MIME_TYPES } from './constants.ts';

export interface PathValidationResult {
  valid: boolean;
  normalized?: string;
  contentType?: string;
  reason?: string;
}

const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

export function sanitizeDeployPath(rawPath: string): PathValidationResult {
  if (!rawPath || typeof rawPath !== 'string') {
    return { valid: false, reason: 'Empty file path' };
  }

  if (CONTROL_CHARS_RE.test(rawPath)) {
    return { valid: false, reason: 'Control characters in path are rejected' };
  }

  if (rawPath.includes('\\')) {
    return { valid: false, reason: 'Backslashes in path are rejected' };
  }

  let cleaned = rawPath.trim();
  while (cleaned.startsWith('/')) {
    cleaned = cleaned.slice(1);
  }
  while (cleaned.startsWith('./')) {
    cleaned = cleaned.slice(2);
  }

  if (!cleaned || cleaned.endsWith('/')) {
    return { valid: false, reason: 'Directory entries are skipped' };
  }

  const segments = cleaned.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') {
      return { valid: false, reason: `Path traversal segment "${seg}" is forbidden` };
    }
  }

  const lower = cleaned.toLowerCase();
  if (
    lower.startsWith('.git/') ||
    lower === '.git' ||
    lower.startsWith('__macosx/') ||
    lower.includes('/__macosx/') ||
    lower.endsWith('.ds_store') ||
    lower.startsWith('node_modules/') ||
    lower.includes('/node_modules/')
  ) {
    return { valid: false, reason: 'System or dependency directories are not deployable' };
  }

  // Check file extension
  const lastSegment = segments[segments.length - 1];
  const dotIdx = lastSegment.lastIndexOf('.');
  const ext = dotIdx >= 0 ? lastSegment.slice(dotIdx).toLowerCase() : '';

  if (BLOCKED_EXTENSIONS.has(ext) || lastSegment === '.env' || lastSegment.startsWith('.env.')) {
    return {
      valid: false,
      reason: `Unsupported or unsafe file type "${ext || lastSegment}" for static hosting`,
    };
  }

  // Allow extensionless known static metadata files like CNAME, _redirects, robots, LICENSE
  const allowExtensionless = new Set(['cname', '_redirects', '_headers', 'license', 'robots']);
  if (!ext && !allowExtensionless.has(lastSegment.toLowerCase())) {
    return {
      valid: false,
      reason: `File "${lastSegment}" has no recognized static file extension`,
    };
  }

  const contentType = MIME_TYPES[ext];
  if (ext && !contentType) {
    return {
      valid: false,
      reason: `Unsupported static asset extension "${ext}"`,
    };
  }

  return {
    valid: true,
    normalized: cleaned,
    contentType: contentType || 'text/plain; charset=utf-8',
  };
}

/**
 * Strips a single shared top-level wrapper folder produced by GitHub or macOS ZIP exports
 * (e.g. "my-site-main/index.html" -> "index.html") ONLY when all non-system files share it
 * and there is no root "index.html".
 */
export function stripSingleRootFolder(paths: string[]): string[] {
  const cleanCandidates = paths.filter((p) => {
    const l = p.toLowerCase();
    return !l.startsWith('__macosx/') && !l.endsWith('.ds_store') && !p.endsWith('/');
  });
  if (cleanCandidates.length === 0) return paths;

  const hasRootIndex = cleanCandidates.some((p) => p.replace(/^\.?\//, '').toLowerCase() === 'index.html');
  if (hasRootIndex) return paths;

  const firstSegments = new Set(
    cleanCandidates.map((p) => {
      const trimmed = p.replace(/^\.?\//, '');
      const idx = trimmed.indexOf('/');
      return idx > 0 ? trimmed.slice(0, idx) : '';
    }),
  );

  if (firstSegments.size === 1) {
    const [prefix] = Array.from(firstSegments);
    if (prefix && prefix !== '.' && prefix !== '..') {
      return paths.map((p) => {
        const trimmed = p.replace(/^\.?\//, '');
        return trimmed.startsWith(prefix + '/') ? trimmed.slice(prefix.length + 1) : trimmed;
      });
    }
  }
  return paths;
}

export function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/.test(slug);
}

export function isValidGitHubRepoUrl(url: string): boolean {
  if (!url) return true; // optional when using ZIP
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com');
  } catch {
    return false;
  }
}

export function isValidHostname(hostname: string): boolean {
  return /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(hostname);
}

export function redactSecrets(input: string): string {
  return input
    .replace(/spdy_(?:gh|tok|sec)_[A-Za-z0-9_-]{8,}/g, '[REDACTED_SPIDYY_TOKEN]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, '$1[REDACTED_TOKEN]')
    .replace(/(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/(password|secret|token|api_key)\s*[:=]\s*["']?[^\s"']{6,}["']?/gi, '$1=[REDACTED]');
}

export function lookupMimeType(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  const ext = filePath.slice(dot).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val < 10 && idx > 0 ? val.toFixed(1) : Math.round(val)} ${units[idx]}`;
}
