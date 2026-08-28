/**
 * credentials.ts — Secure credential store (pentest-harness style).
 *
 * API keys live in an owner-only file (~/.bughunting/credentials.json,
 * chmod 600) and are referenced by ID — never stored inline in settings,
 * logs, or API responses.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const STORE_DIR = path.join(os.homedir(), '.bughunting');
const STORE_FILE = path.join(STORE_DIR, 'credentials.json');

type StoreShape = Record<string, { secret: string; created_at: string; label?: string }>;

function readStore(): StoreShape {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(store: StoreShape): void {
  fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(STORE_FILE, 0o600);
    fs.chmodSync(STORE_DIR, 0o700);
  } catch {
    /* best effort on non-POSIX */
  }
}

/** Save a secret; returns its reference id. */
export function saveCredential(secret: string, label?: string): string {
  const store = readStore();
  const id = crypto.randomUUID();
  store[id] = { secret, created_at: new Date().toISOString(), label };
  writeStore(store);
  return id;
}

/** Resolve a reference to its secret. Accepts raw secrets too (migration path). */
export function resolveCredential(refOrSecret: string): string {
  if (!refOrSecret) return '';
  if (refOrSecret.startsWith('cred:')) {
    const id = refOrSecret.slice(5);
    const entry = readStore()[id];
    return entry?.secret || '';
  }
  return refOrSecret;
}

/** Delete a credential by id. */
export function deleteCredential(id: string): boolean {
  const store = readStore();
  if (!(id in store)) return false;
  delete store[id];
  writeStore(store);
  return true;
}

/** List credential metadata (never secrets). */
export function listCredentials(): { id: string; label?: string; created_at: string }[] {
  return Object.entries(readStore()).map(([id, v]) => ({
    id,
    label: v.label,
    created_at: v.created_at,
  }));
}
