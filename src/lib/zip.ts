import JSZip from 'jszip';
import { SPIDYY_LIMITS } from '../../packages/shared/constants.ts';
import { formatBytes, sanitizeDeployPath, stripSingleRootFolder } from '../../packages/shared/security.ts';

export interface ExtractedStaticFile {
  path: string;
  contentType: string;
  sizeBytes: number;
  data: Uint8Array;
}

export interface ZipExtractionReport {
  valid: boolean;
  files: ExtractedStaticFile[];
  totalBytes: number;
  hasIndexHtml: boolean;
  skippedSystemFiles: string[];
  errors: string[];
}

export async function extractAndValidateZipInBrowser(
  zipSource: File | ArrayBuffer | Uint8Array,
): Promise<ZipExtractionReport> {
  const errors: string[] = [];
  const skippedSystemFiles: string[] = [];

  const zipByteLength =
    zipSource instanceof File
      ? zipSource.size
      : zipSource instanceof ArrayBuffer
        ? zipSource.byteLength
        : zipSource.byteLength;

  if (zipByteLength === 0) {
    return {
      valid: false,
      files: [],
      totalBytes: 0,
      hasIndexHtml: false,
      skippedSystemFiles,
      errors: ['Selected ZIP archive is empty.'],
    };
  }

  if (zipByteLength > SPIDYY_LIMITS.MAX_ZIP_SIZE_BYTES) {
    return {
      valid: false,
      files: [],
      totalBytes: 0,
      hasIndexHtml: false,
      skippedSystemFiles,
      errors: [
        `ZIP archive (${formatBytes(zipByteLength)}) exceeds the ${formatBytes(SPIDYY_LIMITS.MAX_ZIP_SIZE_BYTES)} upload limit.`,
      ],
    };
  }

  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(zipSource);
  } catch {
    return {
      valid: false,
      files: [],
      totalBytes: 0,
      hasIndexHtml: false,
      skippedSystemFiles,
      errors: ['Failed to parse ZIP archive. Ensure the file is a valid .zip bundle.'],
    };
  }

  const rawEntries: Array<{ rawName: string; entry: JSZip.JSZipObject }> = [];
  archive.forEach((relativePath, entry) => {
    if (!entry.dir) {
      rawEntries.push({ rawName: relativePath, entry });
    }
  });

  if (rawEntries.length === 0) {
    return {
      valid: false,
      files: [],
      totalBytes: 0,
      hasIndexHtml: false,
      skippedSystemFiles,
      errors: ['ZIP archive contains no files.'],
    };
  }

  // Strip a single wrapping folder if present (e.g. dist/index.html -> index.html)
  const strippedPaths = stripSingleRootFolder(rawEntries.map((e) => e.rawName));

  const extractedFiles: ExtractedStaticFile[] = [];
  let totalBytes = 0;

  for (let i = 0; i < rawEntries.length; i++) {
    const candidatePath = strippedPaths[i];
    const rawName = rawEntries[i].rawName;
    const lower = candidatePath.toLowerCase();

    // Silently skip harmless OS metadata files
    if (
      lower.startsWith('__macosx/') ||
      lower.includes('/__macosx/') ||
      lower.endsWith('.ds_store') ||
      lower.endsWith('thumbs.db')
    ) {
      skippedSystemFiles.push(rawName);
      continue;
    }

    // Reject raw traversal before stripping
    if (rawName.includes('..') || rawName.includes('\\')) {
      errors.push(`Rejected unsafe path traversal entry: "${rawName}"`);
      continue;
    }

    // Explicitly warn if user uploaded an unbuilt Node.js repository instead of static output
    if (candidatePath === 'package.json') {
      skippedSystemFiles.push('package.json');
      continue;
    }

    const validation = sanitizeDeployPath(candidatePath);
    if (!validation.valid || !validation.normalized) {
      errors.push(`${candidatePath}: ${validation.reason}`);
      continue;
    }

    const data = await rawEntries[i].entry.async('uint8array');
    if (data.byteLength > SPIDYY_LIMITS.MAX_FILE_SIZE_BYTES) {
      errors.push(
        `File "${validation.normalized}" (${formatBytes(data.byteLength)}) exceeds maximum individual file limit of ${formatBytes(SPIDYY_LIMITS.MAX_FILE_SIZE_BYTES)}.`,
      );
      continue;
    }

    totalBytes += data.byteLength;
    extractedFiles.push({
      path: validation.normalized,
      contentType: validation.contentType || 'application/octet-stream',
      sizeBytes: data.byteLength,
      data,
    });
  }

  if (extractedFiles.length > SPIDYY_LIMITS.MAX_FILES_PER_DEPLOYMENT) {
    errors.push(
      `Archive contains ${extractedFiles.length} files, exceeding the ${SPIDYY_LIMITS.MAX_FILES_PER_DEPLOYMENT} files per deployment limit.`,
    );
  }

  if (totalBytes > SPIDYY_LIMITS.MAX_ACCOUNT_STORAGE_BYTES) {
    errors.push(
      `Extracted files total ${formatBytes(totalBytes)}, exceeding the ${formatBytes(SPIDYY_LIMITS.MAX_ACCOUNT_STORAGE_BYTES)} account storage cap.`,
    );
  }

  const hasIndexHtml = extractedFiles.some((f) => f.path === 'index.html');
  if (!hasIndexHtml) {
    errors.push(
      'Missing root index.html. Ensure your ZIP contains prebuilt static website output (e.g., index.html, assets/style.css).',
    );
  }

  return {
    valid: errors.length === 0 && hasIndexHtml && extractedFiles.length > 0,
    files: extractedFiles,
    totalBytes,
    hasIndexHtml,
    skippedSystemFiles,
    errors,
  };
}

/**
 * Generates a real, downloadable starter static website ZIP bundle in the browser
 * so developers can immediately test or inspect a valid static website package.
 */
export async function buildSampleStaticSiteZip(projectName: string, projectSlug: string): Promise<File> {
  const zip = new JSZip();
  const timestamp = new Date().toISOString();

  zip.file(
    'index.html',
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${projectName} — Hosted on SPIDYY CLOUD</title>
  <link rel="stylesheet" href="assets/style.css" />
</head>
<body>
  <main class="shell">
    <header class="top">
      <span class="tag">SPIDYY CLOUD EDGE RUNTIME · /s/${projectSlug}/</span>
      <span class="stamp">Deployed ${timestamp}</span>
    </header>
    <h1>${projectName}</h1>
    <p class="lead">
      This static website was extracted in the browser, uploaded file-by-file to R2 storage,
      verified in D1, and served live by the SPIDYY CLOUD multi-tenant hosting engine.
    </p>
    <div class="grid">
      <div class="card">
        <h2>Directory & Asset Integrity</h2>
        <p>Stylesheet loaded from <code>assets/style.css</code> and interactive script from <code>assets/app.js</code>.</p>
      </div>
      <div class="card">
        <h2>SPA Routing Test</h2>
        <p>Try visiting a client route or triggering the interactive latency check below.</p>
        <button id="ping-btn" type="button">Verify Edge Asset Execution</button>
        <p id="ping-out" class="out"></p>
      </div>
    </div>
  </main>
  <script src="assets/app.js"></script>
</body>
</html>`,
  );

  zip.file(
    'assets/style.css',
    `:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  background: #0A0C10;
  color: #F3F4F6;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.shell {
  max-width: 760px;
  width: 100%;
  border: 1px solid #1F242D;
  background: #11141B;
  padding: 40px;
  border-radius: 8px;
}
.top {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: #9CA3AF;
  border-bottom: 1px solid #1F242D;
  padding-bottom: 16px;
  margin-bottom: 24px;
}
h1 { font-size: 32px; margin: 0 0 12px; letter-spacing: -0.02em; }
.lead { color: #9CA3AF; line-height: 1.65; margin: 0 0 28px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
.card { border: 1px solid #1F242D; background: #0D1016; padding: 20px; border-radius: 6px; }
.card h2 { font-size: 16px; margin: 0 0 8px; }
.card p { font-size: 14px; color: #9CA3AF; line-height: 1.5; margin: 0 0 12px; }
button {
  background: #2563EB;
  color: #FFFFFF;
  border: none;
  padding: 9px 16px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}
button:hover { background: #1D4ED8; }
.out { font-family: ui-monospace, monospace; font-size: 12px; color: #34D399 !important; margin-top: 10px !important; }`,
  );

  zip.file(
    'assets/app.js',
    `document.getElementById('ping-btn')?.addEventListener('click', () => {
  const el = document.getElementById('ping-out');
  if (el) {
    el.textContent = 'Verified live execution at ' + window.location.pathname + ' (' + new Date().toLocaleTimeString() + ')';
  }
});`,
  );

  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], `${projectSlug}-static-release.zip`, { type: 'application/zip' });
}
