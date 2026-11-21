export const SPIDYY_LIMITS = {
  MAX_PROJECTS_PER_USER: 5,
  MAX_FILES_PER_DEPLOYMENT: 2000,
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB
  MAX_ZIP_SIZE_BYTES: 50 * 1024 * 1024, // 50 MB
  MAX_ACCOUNT_STORAGE_BYTES: 250 * 1024 * 1024, // 250 MB
  MAX_ACTIVE_DEPLOYMENTS_PER_PROJECT: 10,
  WARNING_THRESHOLD_RATIO: 0.8,
} as const;

export const SUPPORTED_FRAMEWORKS = [
  {
    id: 'static',
    label: 'HTML / CSS / JS',
    defaultBuildCommand: '',
    defaultOutputDir: '.',
    description: 'Prebuilt static site or plain HTML/CSS/JavaScript output.',
  },
  {
    id: 'react-vite',
    label: 'React + Vite',
    defaultBuildCommand: 'npm run build',
    defaultOutputDir: 'dist',
    description: 'Single-page React application bundled to static files via Vite.',
  },
  {
    id: 'vue-vite',
    label: 'Vue + Vite',
    defaultBuildCommand: 'npm run build',
    defaultOutputDir: 'dist',
    description: 'Vue 3 static application compiled with Vite.',
  },
  {
    id: 'svelte-vite',
    label: 'Svelte Static',
    defaultBuildCommand: 'npm run build',
    defaultOutputDir: 'dist',
    description: 'Svelte or SvelteKit adapter-static prebuilt output.',
  },
  {
    id: 'astro-static',
    label: 'Astro Static',
    defaultBuildCommand: 'npm run build',
    defaultOutputDir: 'dist',
    description: 'Astro static site generation output (output: "static").',
  },
] as const;

export type FrameworkId = (typeof SUPPORTED_FRAMEWORKS)[number]['id'];

export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

export const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.sh',
  '.bash',
  '.zsh',
  '.bat',
  '.cmd',
  '.ps1',
  '.php',
  '.phtml',
  '.py',
  '.pyc',
  '.rb',
  '.pl',
  '.cgi',
  '.asp',
  '.aspx',
  '.jsp',
  '.jar',
  '.war',
  '.msi',
  '.dmg',
  '.app',
  '.deb',
  '.rpm',
  '.env',
  '.pem',
  '.key',
  '.p12',
]);

export const SESSION_COOKIE_NAME = 'spidyy_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
