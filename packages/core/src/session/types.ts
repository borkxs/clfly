/** Session store types — see docs/spec/session-store.md */

export const DEFAULT_SPOOL_THRESHOLD = 65_536; // 64 KiB
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const DEFAULT_SESSION_MAX_BYTES = 256 * 1024 * 1024; // 256 MiB
export const PREVIEW_ITEMS = 5;
export const PREVIEW_KEYS = 20;
export const PREVIEW_STRING_MAX = 200;
export const SESSION_ID_RE = /^[a-z0-9_-]{1,64}$/;
export const REF_RE = /^([a-z0-9_-]{1,64})\/(\d{1,10})$/;

export interface ManifestEntry {
  seq: number;
  command: string;
  argv: string[];
  ts: string;
  bytes: number;
  exit: number;
  schemaRef?: string;
}

export interface TruncationEnvelope {
  truncated: true;
  ref: string;
  sessionId: string;
  seq: number;
  totalCount?: number;
  preview: unknown;
  schemaPointer?: string;
  bytes: number;
  path: string;
}

export interface SessionStoreOptions {
  /** Absolute directory that contains `.clfly/sessions` (cwd or --root). */
  root: string;
  /** Max JSON bytes before auto-spool (MCP) / envelope (CLI --json --spool). */
  threshold?: number;
  ttlMs?: number;
  maxBytes?: number;
}

export interface SpoolInput {
  sessionId: string;
  command: string;
  argv: string[];
  value: unknown;
  exit?: number;
  schemaRef?: string;
}

export interface SpoolResult {
  entry: ManifestEntry;
  path: string;
  ref: string;
  bytes: number;
  envelope: TruncationEnvelope;
}

export interface SessionSummary {
  sessionId: string;
  dir: string;
  entries: number;
  bytes: number;
  mtimeMs: number;
}
