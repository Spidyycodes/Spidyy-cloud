const PBKDF2_ITERATIONS = 100_000;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function generateId(prefix = ''): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const id = toHex(bytes);
  return prefix ? `${prefix}_${id}` : id;
}

export function generateSecureToken(prefix: string): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${prefix}_${b64}`;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return toHex(new Uint8Array(digest));
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = toHex(saltBytes);
  const hash = await derivePbkdf2(password, saltBytes);
  return { hash, salt };
}

export async function verifyPassword(password: string, expectedHashHex: string, saltHex: string): Promise<boolean> {
  try {
    const saltBytes = fromHex(saltHex);
    const derived = await derivePbkdf2(password, saltBytes);
    return constantTimeEqual(derived, expectedHashHex);
  } catch {
    return false;
  }
}

async function derivePbkdf2(password: string, saltBytes: Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const saltCopy = new Uint8Array(saltBytes.byteLength);
  saltCopy.set(saltBytes);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltCopy.buffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  return toHex(new Uint8Array(bits));
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}
