import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ClflyError } from "../errors.js";
import { isInsideRoot, resolveUnderRoot } from "../fs/resolve-under-root.js";
import {
  assertSessionId,
  buildEnvelope,
  commandSlug,
  formatRef,
  jsonByteLength,
  padSeq,
  parseRef,
} from "./ref.js";
import type {
  ManifestEntry,
  SessionStoreOptions,
  SessionSummary,
  SpoolInput,
  SpoolResult,
  TruncationEnvelope,
} from "./types.js";
import {
  DEFAULT_SESSION_MAX_BYTES,
  DEFAULT_SESSION_TTL_MS,
  DEFAULT_SPOOL_THRESHOLD,
} from "./types.js";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export class SessionStore {
  readonly root: string;
  readonly sessionsRoot: string;
  readonly threshold: number;
  readonly ttlMs: number;
  readonly maxBytes: number;

  constructor(opts: SessionStoreOptions) {
    this.root = opts.root;
    this.sessionsRoot = join(opts.root, ".clfly", "sessions");
    this.threshold = opts.threshold ?? DEFAULT_SPOOL_THRESHOLD;
    this.ttlMs = opts.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    this.maxBytes = opts.maxBytes ?? DEFAULT_SESSION_MAX_BYTES;

    if (!isInsideRoot(this.root, this.sessionsRoot)) {
      throw new ClflyError(
        `Session store must live under root ${this.root}`,
        2,
      );
    }
  }

  ensureSessionsRoot(): void {
    mkdirSync(this.sessionsRoot, { recursive: true, mode: DIR_MODE });
    try {
      chmodSync(this.sessionsRoot, DIR_MODE);
      const clfly = join(this.root, ".clfly");
      if (existsSync(clfly)) chmodSync(clfly, DIR_MODE);
    } catch {
      /* best-effort on platforms that ignore mode */
    }
  }

  sessionDir(sessionId: string): string {
    const id = assertSessionId(sessionId);
    const dir = resolveUnderRoot(this.sessionsRoot, id);
    return dir;
  }

  /** Write validated value to spool + append manifest; return envelope. */
  spool(input: SpoolInput): SpoolResult {
    this.ensureSessionsRoot();
    const id = assertSessionId(input.sessionId);
    const dir = this.sessionDir(id);
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    try {
      chmodSync(dir, DIR_MODE);
    } catch {
      /* ignore */
    }

    const seq = this.nextSeq(dir);
    const slug = commandSlug(input.command);
    const fileName = `${padSeq(seq)}-${slug}.json`;
    const filePath = resolveUnderRoot(dir, fileName);
    const body = `${JSON.stringify(input.value, null, 2)}\n`;
    const bytes = Buffer.byteLength(body, "utf8");

    writeFileSync(filePath, body, { encoding: "utf8", mode: FILE_MODE });
    try {
      chmodSync(filePath, FILE_MODE);
    } catch {
      /* ignore */
    }

    const entry: ManifestEntry = {
      seq,
      command: input.command,
      argv: input.argv,
      ts: new Date().toISOString(),
      bytes,
      exit: input.exit ?? 0,
      ...(input.schemaRef ? { schemaRef: input.schemaRef } : {}),
    };
    this.appendManifest(dir, entry);

    const envelope = buildEnvelope({
      sessionId: id,
      seq,
      value: input.value,
      bytes,
      path: filePath,
      schemaRef: input.schemaRef,
    });

    return {
      entry,
      path: filePath,
      ref: formatRef(id, seq),
      bytes,
      envelope,
    };
  }

  /** True when compact JSON exceeds the spool threshold. */
  exceedsThreshold(value: unknown): boolean {
    return jsonByteLength(value) > this.threshold;
  }

  /** Resolve a ref handle → absolute spool path (manifest lookup only). */
  resolveRefPath(ref: string): { path: string; entry: ManifestEntry; sessionId: string } {
    const { sessionId, seq } = parseRef(ref);
    const dir = this.sessionDir(sessionId);
    const entry = this.findManifestEntry(dir, seq);
    if (!entry) {
      throw new ClflyError(`Unknown result ref: ${ref}`, 2);
    }
    const slug = commandSlug(entry.command);
    const fileName = `${padSeq(seq)}-${slug}.json`;
    const filePath = resolveUnderRoot(dir, fileName);
    if (!existsSync(filePath)) {
      throw new ClflyError(`Spool file missing for ref: ${ref}`, 2);
    }
    return { path: filePath, entry, sessionId };
  }

  readRefValue(ref: string): unknown {
    const { path } = this.resolveRefPath(ref);
    const raw = readFileSync(path, "utf8");
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new ClflyError(`Corrupt spool JSON for ref: ${ref}`, 1);
    }
  }

  /**
   * Schema-aware slice for array roots.
   * Non-arrays return the full value (offset/limit ignored).
   */
  readSlice(
    ref: string,
    offset = 0,
    limit = 50,
  ): {
    ref: string;
    offset: number;
    limit: number;
    totalCount?: number;
    items?: unknown[];
    value?: unknown;
  } {
    const safeOffset = Math.max(0, Math.floor(offset));
    const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
    const value = this.readRefValue(ref);
    if (Array.isArray(value)) {
      return {
        ref,
        offset: safeOffset,
        limit: safeLimit,
        totalCount: value.length,
        items: value.slice(safeOffset, safeOffset + safeLimit),
      };
    }
    return { ref, offset: safeOffset, limit: safeLimit, value };
  }

  listSessions(): SessionSummary[] {
    if (!existsSync(this.sessionsRoot)) return [];
    const out: SessionSummary[] = [];
    for (const name of readdirSync(this.sessionsRoot)) {
      if (!SESSION_ID_OK(name)) continue;
      const dir = join(this.sessionsRoot, name);
      let st;
      try {
        st = statSync(dir);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      const { bytes, entries } = this.sessionStats(dir);
      out.push({
        sessionId: name,
        dir,
        entries,
        bytes,
        mtimeMs: st.mtimeMs,
      });
    }
    out.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return out;
  }

  /**
   * Evict expired sessions (TTL) then oldest-first until under maxBytes.
   * Returns removed session ids.
   */
  evict(now = Date.now()): string[] {
    if (!existsSync(this.sessionsRoot)) return [];
    const removed: string[] = [];
    let sessions = this.listSessions();

    for (const s of sessions) {
      if (now - s.mtimeMs > this.ttlMs) {
        rmSync(s.dir, { recursive: true, force: true });
        removed.push(s.sessionId);
      }
    }

    sessions = this.listSessions();
    let total = sessions.reduce((a, s) => a + s.bytes, 0);
    // Oldest first for byte eviction.
    sessions.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const s of sessions) {
      if (total <= this.maxBytes) break;
      rmSync(s.dir, { recursive: true, force: true });
      removed.push(s.sessionId);
      total -= s.bytes;
    }
    return removed;
  }

  private nextSeq(dir: string): number {
    const entries = this.readManifest(dir);
    if (entries.length === 0) return 1;
    return Math.max(...entries.map((e) => e.seq)) + 1;
  }

  private appendManifest(dir: string, entry: ManifestEntry): void {
    const manifestPath = join(dir, "manifest.jsonl");
    appendFileSync(manifestPath, `${JSON.stringify(entry)}\n`, {
      encoding: "utf8",
    });
    try {
      chmodSync(manifestPath, FILE_MODE);
    } catch {
      /* ignore */
    }
  }

  private readManifest(dir: string): ManifestEntry[] {
    const manifestPath = join(dir, "manifest.jsonl");
    if (!existsSync(manifestPath)) return [];
    const lines = readFileSync(manifestPath, "utf8").split("\n");
    const out: ManifestEntry[] = [];
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t) as ManifestEntry);
      } catch {
        /* skip corrupt lines */
      }
    }
    return out;
  }

  private findManifestEntry(
    dir: string,
    seq: number,
  ): ManifestEntry | undefined {
    return this.readManifest(dir).find((e) => e.seq === seq);
  }

  private sessionStats(dir: string): { bytes: number; entries: number } {
    const entries = this.readManifest(dir);
    let bytes = 0;
    for (const name of readdirSync(dir)) {
      try {
        bytes += statSync(join(dir, name)).size;
      } catch {
        /* skip */
      }
    }
    return { bytes, entries: entries.length };
  }
}

function SESSION_ID_OK(name: string): boolean {
  return /^[a-z0-9_-]{1,64}$/.test(name);
}

export function createSessionStore(opts: SessionStoreOptions): SessionStore {
  return new SessionStore(opts);
}

export type { TruncationEnvelope };
