/** Persisted to `.reasonix/reload-snapshot.json`. Records known-good state so
 *  `/reload` can detect what's changed since the last reload.
 *  `null` fields mean "not yet established" — first run baseline. */
export interface Snapshot {
  version: 1;
  /** mtime + sha256 hash of config.json. `null` before first reload. */
  config: { mtime: number; hash: string } | null;
  /** Per-skill entry for every discovered skill file. */
  skills: SkillSnapshotEntry[];
  /** Hash of normalized MCP server specs. `null` before first reload. */
  mcp: { hash: string; specNames: string[] } | null;
  /** ISO-8601 timestamp of the last completed reload. */
  lastReloadAt: string | null;
}

/** Fingerprint of a single skill file at snapshot time. */
export interface SkillSnapshotEntry {
  name: string;
  scope: string;
  /** `stat.mtimeMs` — milliseconds for sub-second precision. */
  mtime: number;
  /** Absolute filesystem path to the skill file. */
  path: string;
  /** sha256 of file content, empty string if only mtime was read. */
  hash: string;
}

/** Result of comparing current state vs snapshot for one item. */
export type ChangeKind = "new" | "changed" | "removed" | "unchanged";

/** One atomic change record — used in the human-readable reload report. */
export interface ItemChange {
  kind: ChangeKind;
  /** Human-readable label e.g. "config.json", skill name, "MCP servers". */
  name: string;
  /**
   * Optional detail shown in the report, e.g.
   * `"model (pro → flash)"` or `"内容已变更"`.
   * Absent for "unchanged" items that are still listed for context.
   */
  detail?: string;
}

/** Complete diff between current state and the last reload snapshot. */
export interface Changes {
  config: ChangeKind;
  configDetails: ItemChange[];
  skills: ItemChange[];
  mcp: ChangeKind;
  mcpDetails: ItemChange[];
  /** Convenience — true when any component needs action. */
  hasAny: boolean;
}

/** Outcome of one atomic reload operation. */
export interface ApplyResult {
  ok: boolean;
  detail: string;
}

/** Aggregated report from applying all detected changes. */
export interface ReloadReport {
  config: ApplyResult[];
  skills: ApplyResult[];
  mcp: ApplyResult[];
  hasAny: boolean;
}

/**
 * Facade over the runtime components the ReloadManager needs to apply changes.
 * Designed to be constructed by the slash handler from the live loop + SlashContext.
 *
 * `loop.model/stream/reasoningEffort/maxOutputTokens/budgetUsd` are the **current**
 * values (always present after initialization). `loop.configure` uses optional fields:
 * omitted = "don't change that field".
 */
export interface ReloadContext {
  loop: {
    model: string;
    stream: boolean;
    reasoningEffort: string;
    maxOutputTokens: number | undefined;
    budgetUsd: number | null;
    configure: (opts: {
      model?: string;
      stream?: boolean;
      reasoningEffort?: string;
      maxOutputTokens?: number;
    }) => void;
    setBudget: (usd: number | null) => void;
    /** Rebuild + replace system prompt via the registered _rebuildSystem callback. */
    rebuildSystemPrompt: () => void;
  };
  /** Fire-and-forget MCP reload. Returns result for reporting. */
  mcpReload: () => Promise<{
    added: string[];
    removed: string[];
    failed: Array<{ spec: string; reason: string }>;
    summaries: unknown[];
  }>;
  configPath: string;
  projectRoot: string;
  homeDir: string;
}
