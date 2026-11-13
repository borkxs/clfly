/** Session store types — see packages/clfly-core/docs/session-store.md */

import type { RowMatch, RowsMeta } from "../types.js";

export const DEFAULT_SPOOL_THRESHOLD = 65_536; // 64 KiB
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const DEFAULT_SESSION_MAX_BYTES = 256 * 1024 * 1024; // 256 MiB
export const PREVIEW_ITEMS = 5;
export const PREVIEW_KEYS = 20;
export const PREVIEW_STRING_MAX = 200;
export const SESSION_ID_RE = /^[a-z0-9_-]{1,64}$/;
export const REF_RE = /^([a-z0-9_-]{1,64})\/(\d{1,10})$/;
/** `<sessionId>/<seq>#<n>`: row n of a typed-rows result. */
export const ROW_REF_RE = /^([a-z0-9_-]{1,64}\/\d{1,10})#(\d{1,9})$/;

export interface ManifestEntry {
  seq: number;
  command: string;
  argv: string[];
  ts: string;
  bytes: number;
  exit: number;
  schemaRef?: string;
  /** The producer route's `meta.rows`, so `@<ref>#<n>` can bind one row. */
  rows?: RowsMeta;
  /** The producer's args (JSON), for `{field}` placeholders the row lacks. */
  args?: Record<string, unknown>;
}

/** Typed rows in a result: their type, where they sit, how many. */
export interface EnvelopeRows {
  type: string;
  key: string;
  count: number;
}

/** An arg, in any linked tree, that takes rows of the envelope's type. */
export interface EnvelopeAcceptor {
  tree: string;
  route: string[];
  arg: string;
  where?: RowMatch;
}

export interface TruncationEnvelope {
  /** False only for a typed-rows result small enough that `preview` is the whole value. */
  truncated: boolean;
  ref: string;
  sessionId: string;
  seq: number;
  totalCount?: number;
  preview: unknown;
  schemaPointer?: string;
  bytes: number;
  path: string;
  /** Present when the producer declares `meta.rows`; bind row n with `@<ref>#<n>`. */
  rows?: EnvelopeRows;
  acceptors?: EnvelopeAcceptor[];
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
  rows?: RowsMeta;
  args?: Record<string, unknown>;
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
