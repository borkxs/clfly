import { randomBytes } from "node:crypto";
import type { TruncationEnvelope } from "./types.js";
import {
  PREVIEW_ITEMS,
  PREVIEW_KEYS,
  PREVIEW_STRING_MAX,
  REF_RE,
  SESSION_ID_RE,
} from "./types.js";
import { ClflyError } from "../errors.js";

/** Mint a filesystem-safe opaque session id (16 hex chars). */
export function mintSessionId(): string {
  return randomBytes(8).toString("hex");
}

export function assertSessionId(id: string): string {
  if (!SESSION_ID_RE.test(id)) {
    throw new ClflyError(
      `Invalid session id ${JSON.stringify(id)} (expected [a-z0-9_-]{1,64})`,
      2,
    );
  }
  return id;
}

/** Parse `sid/001` → { sessionId, seq }. Rejects path tricks. */
export function parseRef(ref: string): { sessionId: string; seq: number } {
  const m = REF_RE.exec(ref);
  if (!m) {
    throw new ClflyError(
      `Invalid result ref ${JSON.stringify(ref)} (expected <sessionId>/<seq>)`,
      2,
    );
  }
  return { sessionId: m[1]!, seq: Number(m[2]) };
}

export function formatRef(sessionId: string, seq: number): string {
  return `${assertSessionId(sessionId)}/${padSeq(seq)}`;
}

export function padSeq(seq: number): string {
  return String(seq).padStart(3, "0");
}

/** Slug a command path / tool name for spool filenames. */
export function commandSlug(command: string): string {
  const slug = command
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "command";
}

/** Compact UTF-8 byte length of JSON serialization. */
export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function buildPreview(value: unknown): {
  preview: unknown;
  totalCount?: number;
} {
  if (Array.isArray(value)) {
    return {
      preview: value.slice(0, PREVIEW_ITEMS),
      totalCount: value.length,
    };
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const preview: Record<string, unknown> = {};
    for (const [k, v] of entries.slice(0, PREVIEW_KEYS)) {
      preview[k] = previewValue(v);
    }
    return { preview };
  }
  return { preview: value };
}

function previewValue(v: unknown): unknown {
  if (typeof v === "string") {
    return v.length > PREVIEW_STRING_MAX
      ? `${v.slice(0, PREVIEW_STRING_MAX)}…`
      : v;
  }
  if (Array.isArray(v)) {
    return { _truncated: true, type: "array", length: v.length };
  }
  if (v !== null && typeof v === "object") {
    return {
      _truncated: true,
      type: "object",
      keys: Object.keys(v as object).length,
    };
  }
  return v;
}

export function buildEnvelope(opts: {
  sessionId: string;
  seq: number;
  value: unknown;
  bytes: number;
  path: string;
  schemaRef?: string;
}): TruncationEnvelope {
  const { preview, totalCount } = buildPreview(opts.value);
  return {
    truncated: true,
    ref: formatRef(opts.sessionId, opts.seq),
    sessionId: opts.sessionId,
    seq: opts.seq,
    ...(totalCount !== undefined ? { totalCount } : {}),
    preview,
    ...(opts.schemaRef ? { schemaPointer: opts.schemaRef } : {}),
    bytes: opts.bytes,
    path: opts.path,
  };
}

/**
 * Resolve session id: valid env → use; else mint.
 * Empty / invalid env falls back to mint (documented CLI fallback).
 */
export function resolveSessionId(
  env: NodeJS.ProcessEnv,
  envKey = "CLFLY_SESSION",
): string {
  const raw = env[envKey];
  if (typeof raw === "string" && raw.length > 0 && SESSION_ID_RE.test(raw)) {
    return raw;
  }
  return mintSessionId();
}

export function resolveThreshold(
  env: NodeJS.ProcessEnv,
  override?: number,
  fallback = 65_536,
): number {
  if (override !== undefined) return override;
  const raw = env.CLFLY_SPOOL_THRESHOLD;
  if (raw && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n > 0) return n;
  }
  return fallback;
}
