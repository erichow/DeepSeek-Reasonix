import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { readConfig, clearConfigCache, normalizeMcpConfig } from "../config.js";
import type {
  Snapshot,
  SkillSnapshotEntry,
  ItemChange,
  Changes,
  ApplyResult,
  ReloadReport,
  ReloadContext,
} from "./types.js";

/** Default snapshot path inside project .reasonix/ */
function snapshotPath(projectRoot: string): string {
  return join(projectRoot, ".reasonix", "reload-snapshot.json");
}

// ─── Helpers ──────────────────────────────────────

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function readJsonSafe<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (err) {
    // Only swallow ENOENT (file not created yet) and SyntaxError (malformed JSON).
    // Let other errors (EACCES, EMFILE) propagate so they aren't silently hidden.
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || err instanceof SyntaxError) return fallback;
    throw err;
  }
}

function atomicWrite(file: string, data: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, file);
}

// ─── Snapshot I/O ──────────────────────────────────

function loadSnapshot(path: string): Snapshot {
  return readJsonSafe<Snapshot>(path, {
    version: 1,
    config: null,
    skills: [],
    mcp: null,
    lastReloadAt: null,
  });
}

function saveSnapshot(path: string, snap: Snapshot): void {
  atomicWrite(path, JSON.stringify(snap, null, 2));
}

// ─── Change Detection ──────────────────────────────

/** Stat + optional hash of a file. Returns {mtime, hash} or null if the path doesn't exist. */
function fileFingerprint(
  file: string,
  computeHash: boolean,
): { mtime: number; hash: string } | null {
  try {
    const st = statSync(file, { throwIfNoEntry: false });
    if (!st) return null;
    const mtime = st.mtimeMs;
    if (!computeHash) return { mtime, hash: "" };
    const content = readFileSync(file, "utf8");
    return { mtime, hash: sha256(content) };
  } catch {
    return null;
  }
}

/** Fetch fingerprints for all skill files under the standard search roots. */
function scanSkillFiles(projectRoot: string, home: string): SkillSnapshotEntry[] {
  const roots: string[] = [
    join(projectRoot, ".reasonix", "skills"),
    join(projectRoot, ".agents", "skills"),
    join(projectRoot, ".claude", "skills"),
    join(home, ".reasonix", "skills"),
    join(home, ".agents", "skills"),
    join(home, ".claude", "skills"),
  ];
  const out: SkillSnapshotEntry[] = [];
  for (const root of roots) {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      const dirFile = join(root, name, "SKILL.md");
      const flatFile = join(root, `${name}.md`);
      const target = existsSync(dirFile) ? dirFile : existsSync(flatFile) ? flatFile : null;
      if (!target) continue;
      try {
        const st = statSync(target);
        const content = readFileSync(target, "utf8");
        const scope = root.startsWith(resolve(projectRoot)) ? "project" : "global";
        out.push({
          name: name.endsWith(".md") ? name.slice(0, -3) : name,
          scope,
          mtime: st.mtimeMs,
          path: target,
          hash: sha256(content),
        });
      } catch {
        // skip inaccessible files
      }
    }
  }
  // Deduplicate by path — first scan-root wins (same priority as SkillStore)
  const seen = new Set<string>();
  return out.filter((e) => {
    if (seen.has(e.path)) return false;
    seen.add(e.path);
    return true;
  });
}

// ─── Public API ────────────────────────────────────

export class ReloadManager {
  private readonly projectRoot: string;
  private readonly homeDir: string;
  private readonly configPath: string;
  private snapPath: string;

  constructor(opts: {
    projectRoot?: string;
    homeDir?: string;
    configPath?: string;
  } = {}) {
    this.projectRoot = opts.projectRoot ?? process.cwd();
    this.homeDir = opts.homeDir ?? homedir();
    this.configPath = opts.configPath ?? join(this.homeDir, ".reasonix", "config.json");
    this.snapPath = snapshotPath(this.projectRoot);
  }

  /** For testing: inject a custom snapshot path. */
  setSnapshotPath(p: string): void {
    this.snapPath = p;
  }

  /** Detect what has changed since the last reload. */
  detectChanges(): Changes {
    const snap = loadSnapshot(this.snapPath);

    // ── Config ──
    const cfp = fileFingerprint(this.configPath, false);
    let configKind: Changes["config"] = "unchanged";
    const configDetails: ItemChange[] = [];

    if (!snap.config) {
      configKind = "new";
      configDetails.push({ kind: "new", name: "config.json", detail: "首次检测，建立基线" });
    } else if (!cfp) {
      configKind = "changed";
      configDetails.push({ kind: "removed", name: "config.json", detail: "配置文件已删除" });
    } else if (cfp.mtime !== snap.config.mtime) {
      const fp = fileFingerprint(this.configPath, true);
      if (fp && fp.hash !== snap.config.hash) {
        configKind = "changed";
        configDetails.push({ kind: "changed", name: "config.json", detail: "内容已变更" });
      }
      // hash matches → just touch (update mtime in snapshot later via updateSnapshot)
    }

    // ── Skills ──
    const currentSkills = scanSkillFiles(this.projectRoot, this.homeDir);
    const skillsChanges: ItemChange[] = [];

    const snapSkillMap = new Map<string, SkillSnapshotEntry>();
    for (const s of snap.skills) snapSkillMap.set(s.path, s);

    const seenPaths = new Set<string>();
    for (const cs of currentSkills) {
      seenPaths.add(cs.path);
      const prev = snapSkillMap.get(cs.path);
      if (!prev) {
        skillsChanges.push({ kind: "new", name: cs.name, detail: `新增技能 (${cs.scope})` });
      } else if (cs.mtime !== prev.mtime) {
        if (cs.hash !== prev.hash) {
          skillsChanges.push({ kind: "changed", name: cs.name, detail: `内容已变更 (${cs.scope})` });
        }
        // hash matches → just touch
      }
    }
    for (const [path, prev] of snapSkillMap) {
      if (!seenPaths.has(path)) {
        skillsChanges.push({ kind: "removed", name: prev.name, detail: "技能文件已删除" });
      }
    }

    // ── MCP ──
    let mcpKind: Changes["mcp"] = "unchanged";
    const mcpDetails: ItemChange[] = [];
    try {
      const cfg = readConfig(this.configPath);
      const specs = normalizeMcpConfig(cfg);
      const specNames = specs
        .filter((s) => !s.disabled)
        .map((s) => s.name ?? s.command ?? "unknown");
      const specHash = sha256(JSON.stringify({ names: [...specNames].sort() }));

      if (!snap.mcp) {
        mcpKind = "new";
        mcpDetails.push({ kind: "new", name: "MCP servers", detail: "首次检测，建立基线" });
      } else if (specHash !== snap.mcp.hash) {
        mcpKind = "changed";
        mcpDetails.push({ kind: "changed", name: "MCP servers", detail: "配置已变更" });
      }
    } catch {
      // if config is unreadable, leave mcp as unchanged
    }

    return {
      config: configKind,
      configDetails,
      skills: skillsChanges,
      mcp: mcpKind,
      mcpDetails,
      hasAny:
        configKind === "changed" ||
        configKind === "new" ||
        skillsChanges.length > 0 ||
        mcpKind === "changed" ||
        mcpKind === "new",
    };
  }

  /** Apply detected config + skills changes and update the snapshot.
   *  NOTE: MCP reload is ASYNC and must be triggered by the caller.
   *  The handler fires `ctx.mcpReload()` as fire-and-forget and reports
   *  results via `postInfo` — `applyChanges` records the intent in the report
   *  but does NOT call `ctx.mcpReload()` itself, keeping the method synchronous
   *  so slash handlers (which return SlashResult synchronously) can call it. */
  applyChanges(changes: Changes, ctx: ReloadContext): ReloadReport {
    const report: ReloadReport = { config: [], skills: [], mcp: [], hasAny: false };

    // ── 1. Config ──
    if (changes.config === "changed" || changes.config === "new") {
      clearConfigCache(this.configPath);
      const cfg = readConfig(this.configPath);

      const loopOpts: Record<string, unknown> = {};
      if (cfg.model) loopOpts.model = cfg.model;
      if (cfg.stream !== undefined) loopOpts.stream = cfg.stream;
      if (cfg.reasoningEffort) loopOpts.reasoningEffort = cfg.reasoningEffort;
      if (cfg.maxOutputTokens !== undefined) loopOpts.maxOutputTokens = cfg.maxOutputTokens;

      if (Object.keys(loopOpts).length > 0) {
        ctx.loop.configure(loopOpts as Parameters<typeof ctx.loop.configure>[0]);
        report.config.push({
          ok: true,
          detail: `运行时参数已更新: ${Object.keys(loopOpts).join(", ")}`,
        });
      }

      if (cfg.budgetUsd !== undefined) {
        ctx.loop.setBudget(cfg.budgetUsd ?? null);
        report.config.push({
          ok: true,
          detail: `预算已更新: ${cfg.budgetUsd ?? "无上限"}`,
        });
      }

      ctx.loop.rebuildSystemPrompt();
      report.config.push({
        ok: true,
        detail: "系统提示已重建（theme/lang/skills路径变更生效）",
      });

      if (report.config.length === 0) {
        report.config.push({ ok: true, detail: "配置已重读，无运行时变更字段" });
      }
      report.hasAny = true;
    }

    // ── 2. Skills ──
    if (changes.skills.length > 0) {
      const added = changes.skills.filter((s) => s.kind === "new");
      const changed = changes.skills.filter((s) => s.kind === "changed");
      const removed = changes.skills.filter((s) => s.kind === "removed");

      if (added.length > 0) {
        report.skills.push({ ok: true, detail: `新增: ${added.map((s) => s.name).join(", ")}` });
      }
      if (changed.length > 0) {
        report.skills.push({ ok: true, detail: `变更: ${changed.map((s) => s.name).join(", ")}` });
      }
      if (removed.length > 0) {
        report.skills.push({ ok: true, detail: `删除: ${removed.map((s) => s.name).join(", ")}` });
      }

      ctx.loop.rebuildSystemPrompt();
      report.skills.push({
        ok: true,
        detail: "技能索引已注入系统提示（下次 API 调用生效）",
      });
      report.hasAny = true;
    }

    // ── 3. MCP ──
    if (changes.mcp === "changed" || changes.mcp === "new") {
      // MCP reload is ASYNC — the caller (slash handler) fires
      // ctx.mcpReload() as fire-and-forget and reports results via postInfo.
      // We mark the intent here; the handler builds the final report.
      report.mcp.push({ ok: true, detail: "MCP 配置已变更 (由 handler 异步重载)" });
      report.hasAny = true;
    }

    // ── Update snapshot ──
    this.updateSnapshot();

    return report;
  }

  /** Write updated snapshot reflecting the current state of config, skills, and MCP. */
  updateSnapshot(): void {
    const snap = loadSnapshot(this.snapPath);

    // Config
    const cfp = fileFingerprint(this.configPath, true);
    snap.config = cfp;

    // Skills
    snap.skills = scanSkillFiles(this.projectRoot, this.homeDir);

    // MCP
    try {
      const cfg = readConfig(this.configPath);
      const specs = normalizeMcpConfig(cfg);
      const specNames = specs
        .filter((s) => !s.disabled)
        .map((s) => s.name ?? s.command ?? "unknown");
      const specHash = sha256(JSON.stringify({ names: [...specNames].sort() }));
      snap.mcp = { hash: specHash, specNames };
    } catch {
      // keep old snapshot
    }

    snap.lastReloadAt = new Date().toISOString();
    saveSnapshot(this.snapPath, snap);
  }
}
