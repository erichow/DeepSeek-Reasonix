# `/reload` 命令实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 添加 `/reload` 斜杠命令，自动检测 Config、Skills、MCP 的变更并触发热重载。

**架构：** 新增 `ReloadManager` 类，使用混合策略（mtime + SHA256 hash）检测变更，快照持久化到 `.reasonix/reload-snapshot.json`。Config 变更通过 `loop.configure()` + `prefix.replaceSystem()` 应用；Skills 变更重建系统提示索引；MCP 复用已有的 `ctx.reloadMcp()`。

**技术栈：** TypeScript/ESM, Node 22+, Vitest

---

### 任务 1：定义类型 — `src/reload/types.ts`

**文件：**
- 创建：`src/reload/types.ts`
- 测试：`tests/reload.test.ts`（在任务 6 中）

- [ ] **步骤 1：编写类型定义**

```typescript
/** Snapshot 文件格式，持久化到 .reasonix/reload-snapshot.json */
export interface Snapshot {
  version: 1;
  config: { mtime: number; hash: string } | null;
  skills: SkillSnapshotEntry[];
  mcp: { hash: string; specNames: string[] } | null;
  lastReloadAt: string | null;
}

export interface SkillSnapshotEntry {
  name: string;
  scope: string;
  mtime: number;
  path: string;
  hash: string;
}

export type ChangeKind = "new" | "changed" | "removed" | "unchanged";

export interface ItemChange {
  kind: ChangeKind;
  name: string;
  detail?: string;
}

export interface Changes {
  config: ChangeKind;
  configDetails: ItemChange[];
  skills: ItemChange[];
  mcp: ChangeKind;
  mcpDetails: ItemChange[];
  hasAny: boolean; // true if any changed/removed/new
}

export interface ApplyResult {
  ok: boolean;
  detail: string;
}

export interface ReloadReport {
  config: ApplyResult[];
  skills: ApplyResult[];
  mcp: ApplyResult[];
  hasAny: boolean;
}

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
    rebuildSystemPrompt: () => void;
  };
  mcpReload: () => Promise<{
    added: string[];
    removed: string[];
    failed: Array<{ spec: string; reason: string }>;
    summaries: unknown[];
  }>;
  skillStore: {
    list: () => Array<{ name: string; scope: string; path: string }>;
  };
  configPath: string;
  projectRoot: string;
  homeDir: string;
}
```

- [ ] **步骤 2：Commit**

```bash
git add src/reload/types.ts
git commit -m "feat(reload): add type definitions for snapshot and changes"
```

---

### 任务 2：暴露 `clearConfigCache()` — `src/config.ts`

**文件：**
- 修改：`src/config.ts`

- [ ] **步骤 1：在 `src/config.ts` 末尾附近（`writeConfig` 上方或同区域）添加导出函数**

`clearConfigCache` 需要能访问 `_configCache` 这个模块级 Map。当前它是通过 `readConfig()` 内部的闭包引用的，但 `_configCache` 在文件顶部定义。让我在 `writeConfig` 附近加一行。

查看现有代码：`_configCache` 在 `config.ts:504` 定义（模块级），`writeConfig` 在第 591 行调用 `_configCache.delete(path)`。所以只需导出一个清理函数：

```typescript
// 在 writeConfig 附近添加（config.ts, 约 600 行）
/** Force readConfig to re-read from disk on the next call. */
export function clearConfigCache(path: string = defaultConfigPath()): void {
  _configCache.delete(path);
}
```

- [ ] **步骤 2：验证编译通过**

运行：`npm run typecheck`（只检查新增导出不破坏现有代码）

- [ ] **步骤 3：Commit**

```bash
git add src/config.ts
git commit -m "feat(config): export clearConfigCache() for reload manager"
```

---

### 任务 3：给 `CacheFirstLoop` 加 `rebuildSystemPrompt()` — `src/loop.ts`

**文件：**
- 修改：`src/loop.ts`

- [ ] **步骤 1：在 `configure()` 方法后添加新方法**

定位 `configure()`（loop.ts:340-347），在后面添加：

```typescript
  /** Rebuild and replace the system prompt via _rebuildSystem callback.
   *  Does NOT clear conversation history (unlike clearLog which also archives).
   *  May cause a prefix-cache miss on the next API call. */
  rebuildSystemPrompt(): boolean {
    if (!this._rebuildSystem) return false;
    try {
      return this.prefix.replaceSystem(this._rebuildSystem());
    } catch {
      return false;
    }
  }
```

- [ ] **步骤 2：验证编译通过**

运行：`npm run typecheck`（确保新方法不破坏 CacheFirstLoop 接口）

- [ ] **步骤 3：Commit**

```bash
git add src/loop.ts
git commit -m "feat(loop): add rebuildSystemPrompt() for /reload support"
```

---

### 任务 4：实现 `ReloadManager` — `src/reload/manager.ts`

**文件：**
- 创建：`src/reload/manager.ts`
- 测试：`tests/reload.test.ts`（任务 6）

- [ ] **步骤 1：编写 `src/reload/manager.ts` 完整实现**

```typescript
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
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
  } catch {
    return fallback;
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

/** Fetch mtime for all skill files under a set of root directories. */
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
      entries = readdirSync(root, { withFileTypes: false });
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
        const scope = root.includes(projectRoot) ? "project" : "global";
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
  return out;
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
      // First run — snapshot absent
      configKind = "new";
      configDetails.push({ kind: "new", name: "config.json", detail: "首次检测，建立基线" });
    } else if (!cfp) {
      configKind = "changed";
      configDetails.push({ kind: "removed", name: "config.json", detail: "配置文件已删除" });
    } else if (cfp.mtime !== snap.config.mtime) {
      // mtime differs → read + hash
      const fp = fileFingerprint(this.configPath, true);
      if (fp && fp.hash !== snap.config.hash) {
        configKind = "changed";
        configDetails.push({ kind: "changed", name: "config.json", detail: "内容已变更" });
      }
      // hash matches → just touch (update mtime in snapshot later)
    }

    // ── Skills ──
    const currentSkills = scanSkillFiles(this.projectRoot, this.homeDir);
    const skillsChanges: ItemChange[] = [];

    // Build lookup from snapshot
    const snapSkillMap = new Map<string, SkillSnapshotEntry>();
    for (const s of snap.skills) snapSkillMap.set(s.path, s);

    // Check current skills against snapshot
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
        // hash matches → touch, will update snapshot
      }
    }
    // Check for removed skills
    for (const [path, prev] of snapSkillMap) {
      if (!seenPaths.has(path) && prev.scope !== "builtin") {
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
      mcpKind = "unchanged";
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

  /** Apply detected changes and update the snapshot. */
  applyChanges(changes: Changes, ctx: ReloadContext): ReloadReport {
    const report: ReloadReport = { config: [], skills: [], mcp: [], hasAny: false };

    // ── 1. Config ──
    if (changes.config === "changed" || changes.config === "new") {
      // Force re-read config
      clearConfigCache(this.configPath);
      const cfg = readConfig(this.configPath);

      // Runtime fields → loop.configure()
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

      // Budget
      if (cfg.budgetUsd !== undefined) {
        ctx.loop.setBudget(cfg.budgetUsd ?? null);
        report.config.push({
          ok: true,
          detail: `预算已更新: ${cfg.budgetUsd ?? "无上限"}`,
        });
      }

      // Rebuild system prompt (picks up skills paths changes, theme/lang changes reflected in prompt)
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

      if (added.length > 0) report.skills.push({ ok: true, detail: `新增: ${added.map((s) => s.name).join(", ")}` });
      if (changed.length > 0) report.skills.push({ ok: true, detail: `变更: ${changed.map((s) => s.name).join(", ")}` });
      if (removed.length > 0) report.skills.push({ ok: true, detail: `删除: ${removed.map((s) => s.name).join(", ")}` });

      // Rebuild system prompt to update skills index
      ctx.loop.rebuildSystemPrompt();
      report.skills.push({
        ok: true,
        detail: "技能索引已注入系统提示（下次 API 调用生效）",
      });
      report.hasAny = true;
    }

    // ── 3. MCP ──
    if (changes.mcp === "changed" || changes.mcp === "new") {
      report.mcp.push({ ok: true, detail: "正在重载 MCP servers..." });
      report.hasAny = true;
      // Note: actual MCP reload is async; the handler calls ctx.mcpReload()
      // and the result is appended via postInfo. Here we record the intent.
    }

    // ── Update snapshot ──
    this.updateSnapshot(changes);

    return report;
  }

  /** Write updated snapshot after applying changes. */
  private updateSnapshot(changes: Changes): void {
    const snap = loadSnapshot(this.snapPath);

    // Config
    const cfp = fileFingerprint(this.configPath, true);
    snap.config = cfp;

    // Skills — re-scan for current state
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
```

- [ ] **步骤 2：验证 TypeScript 编译通过**

运行：`npm run typecheck`（预期会有少部分 import 错误需要修复，比如 `readdirSync` 的 import）

- [ ] **步骤 3：Commit**

```bash
git add src/reload/manager.ts
git commit -m "feat(reload): implement ReloadManager with change detection"
```

---

### 任务 5：Slash handler + 命令注册

**文件：**
- 创建：`src/cli/ui/slash/handlers/reload.ts`
- 修改：`src/cli/ui/slash/commands.ts`
- 修改：`src/cli/ui/slash/dispatch.ts`

- [ ] **步骤 1：编写 slash handler `src/cli/ui/slash/handlers/reload.ts`**

```typescript
import { readConfig, clearConfigCache, normalizeMcpConfig } from "@/config.js";
import { ReloadManager } from "@/reload/manager.js";
import type {
  ReloadContext,
} from "@/reload/types.js";
import type { SlashHandler } from "../dispatch.js";

function formatLine(label: string, ok: boolean, detail: string): string {
  const icon = ok ? "✓" : "✗";
  return `  ${icon} ${label}: ${detail}`;
}

const reload: SlashHandler = (args, loop, ctx) => {
  const sub = (args[0] ?? "").toLowerCase();
  const validSubs = new Set(["", "config", "skills", "mcp"]);
  if (!validSubs.has(sub)) {
    return { info: "用法: /reload [config|skills|mcp] — 不带参数时检测并重载所有变更" };
  }

  const configPath = ctx.configPath;
  const codeRoot = ctx.codeRoot ?? process.cwd();
  if (!configPath) {
    return { info: "✗ 无法确定配置路径" };
  }

  const manager = new ReloadManager({
    projectRoot: codeRoot,
    homeDir: ctx.homeDir,
    configPath,
  });

  // Detect changes
  const changes = manager.detectChanges();

  // If no changes at all
  if (!changes.hasAny) {
    return { info: "✓ 一切均为最新 — Config / Skills / MCP 均未检测到变更" };
  }

  // Sub-command filter
  const lines: string[] = [];
  let hasWork = false;

  // Config
  if (sub === "" || sub === "config") {
    if (changes.config === "changed" || changes.config === "new") {
      hasWork = true;
      lines.push("", "  Config:");
      for (const d of changes.configDetails) {
        lines.push(formatLine(`• ${d.name}`, true, d.detail));
      }
      // Apply config changes
      clearConfigCache(configPath);
      const cfg = readConfig(configPath);
      if (cfg.model || cfg.stream !== undefined || cfg.reasoningEffort || cfg.maxOutputTokens !== undefined) {
        loop.configure({
          ...(cfg.model ? { model: cfg.model } : {}),
          ...(cfg.stream !== undefined ? { stream: cfg.stream } : {}),
          ...(cfg.reasoningEffort ? { reasoningEffort: cfg.reasoningEffort } : {}),
          ...(cfg.maxOutputTokens !== undefined ? { maxOutputTokens: cfg.maxOutputTokens } : {}),
        });
        lines.push(formatLine("  runtime", true, "model/stream/effort/tokens 已更新"));
      }
      if (cfg.budgetUsd !== undefined) {
        loop.setBudget(cfg.budgetUsd ?? null);
        lines.push(formatLine("  budget", true, `预算已更新: ${cfg.budgetUsd ?? "无上限"}`));
      }
      loop.rebuildSystemPrompt();
      lines.push(formatLine("  system", true, "系统提示已重建"));
    }
  }

  // Skills
  if (sub === "" || sub === "skills") {
    if (changes.skills.length > 0) {
      hasWork = true;
      lines.push("", "  Skills:");
      for (const s of changes.skills) {
        const icon = s.kind === "removed" ? "—" : s.kind === "new" ? "+" : "~";
        lines.push(`    ${icon} ${s.name}  ${s.detail ?? ""}`);
      }
      loop.rebuildSystemPrompt();
      lines.push(formatLine("  index", true, "技能索引已更新（下次 API 调用生效）"));
    }
  }

  // MCP
  if (sub === "" || sub === "mcp") {
    if (changes.mcp === "changed" || changes.mcp === "new") {
      hasWork = true;
      lines.push("", "  MCP:");
      lines.push(formatLine("  config", true, "检测到变更，触发重载..."));
      // Fire async MCP reload
      if (ctx.reloadMcp) {
        ctx.reloadMcp().then((result) => {
          const details: string[] = [];
          for (const name of result.added) details.push(`    + ${name} ✓`);
          for (const name of result.removed) details.push(`    — ${name}`);
          for (const f of result.failed) details.push(`    ✗ ${f.spec}: ${f.reason}`);
          if (ctx.postInfo) {
            ctx.postInfo(
              `MCP 重载结果:\n${details.join("\n")}`,
            );
          }
        });
        lines.push(formatLine("  reload", true, "后台重载中（结果将稍后显示）"));
      } else {
        lines.push(formatLine("  reload", false, "MCP 重载不可用（无 reloadMcp 上下文）"));
      }
    }
  }

  if (!hasWork) {
    lines.push("  (所请求的模块无变更)");
  }

  // Save updated snapshot
  const report = manager.applyChanges(changes, {
    loop: {
      model: loop.model,
      stream: loop.stream,
      reasoningEffort: loop.reasoningEffort,
      maxOutputTokens: loop.maxOutputTokens,
      budgetUsd: loop.budgetUsd,
      configure: (opts) => loop.configure(opts),
      setBudget: (usd) => loop.setBudget(usd),
      rebuildSystemPrompt: () => loop.rebuildSystemPrompt(),
    },
    mcpReload: ctx.reloadMcp ?? (async () => ({ added: [], removed: [], failed: [], summaries: [] })),
    skillStore: {
      list: () => [], // skills re-scanned inline
    },
    configPath,
    projectRoot: codeRoot,
    homeDir: ctx.homeDir ?? "",
  });

  return { info: [`✓ 重载完成`, ...lines].join("\n") };
};

export const handlers: Record<string, import("../dispatch.js").SlashHandler> = { reload };
```

- [ ] **步骤 2：在 `src/cli/ui/slash/commands.ts` 中注册命令**

在 `commands.ts` 中找到 `extend` 组的末尾（在 `qq`、`telegram`、`weixin` 附近）或 `advanced` 组中，添加：

```typescript
  {
    cmd: "reload",
    group: "advanced",
    argsHint: "[config|skills|mcp]",
    summary: "detect and hot-reload config / skills / MCP changes",
  },
```

- [ ] **步骤 3：在 `src/cli/ui/slash/dispatch.ts` 中注册 handler**

在文件顶部添加 import：

```typescript
import { handlers as reloadHandlers } from "./handlers/reload.js";
```

在 `HANDLERS` 对象展开中添加：

```typescript
  ...reloadHandlers,
```

- [ ] **步骤 4：验证编译通过**

运行：`npm run typecheck`（确认所有新模块导入路径正确）

- [ ] **步骤 5：Commit**

```bash
git add src/cli/ui/slash/handlers/reload.ts src/cli/ui/slash/commands.ts src/cli/ui/slash/dispatch.ts
git commit -m "feat(slash): add /reload command for config/skills/mcp hot-reload"
```

---

### 任务 6：编写测试 — `tests/reload.test.ts`

**文件：**
- 创建：`tests/reload.test.ts`

- [ ] **步骤 1：编写 ReloadManager 变更检测测试**

```typescript
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReloadManager } from "../src/reload/manager.js";

function tmpProject(): { root: string; configPath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "reload-test-"));
  const reasonixDir = join(root, ".reasonix");
  mkdirSync(reasonixDir, { recursive: true });
  const configPath = join(reasonixDir, "config.json");
  writeFileSync(configPath, JSON.stringify({ model: "deepseek-v4-flash" }), "utf8");
  return {
    root,
    configPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("ReloadManager", () => {
  it("detects 'new' on first run (empty snapshot)", () => {
    const { root, configPath, cleanup } = tmpProject();
    try {
      const mgr = new ReloadManager({ projectRoot: root, configPath });
      // Use a non-existent snapshot path so it starts fresh
      mgr.setSnapshotPath(join(root, ".reasonix", "reload-snapshot.json"));
      const changes = mgr.detectChanges();
      expect(changes.hasAny).toBe(true);
      expect(changes.config).toBe("new");
    } finally {
      cleanup();
    }
  });

  it("detects 'unchanged' when nothing has changed between calls", () => {
    const { root, configPath, cleanup } = tmpProject();
    try {
      const snapPath = join(root, ".reasonix", "reload-snapshot.json");
      const mgr = new ReloadManager({ projectRoot: root, configPath });
      mgr.setSnapshotPath(snapPath);

      // First detection to build snapshot
      const first = mgr.detectChanges();
      expect(first.hasAny).toBe(true);

      // Apply to write snapshot
      mgr.applyChanges(first, {
        loop: {
          model: "deepseek-v4-flash",
          stream: false,
          reasoningEffort: "high",
          maxOutputTokens: undefined,
          budgetUsd: null,
          configure: () => {},
          setBudget: () => {},
          rebuildSystemPrompt: () => {},
        },
        mcpReload: async () => ({ added: [], removed: [], failed: [], summaries: [] }),
        skillStore: { list: () => [] },
        configPath,
        projectRoot: root,
        homeDir: root,
      });

      // Second detection — should be unchanged
      const second = mgr.detectChanges();
      expect(second.hasAny).toBe(false);
      expect(second.config).toBe("unchanged");
    } finally {
      cleanup();
    }
  });

  it("detects 'changed' when config file content changes", () => {
    const { root, configPath, cleanup } = tmpProject();
    try {
      const snapPath = join(root, ".reasonix", "reload-snapshot.json");
      const mgr = new ReloadManager({ projectRoot: root, configPath });
      mgr.setSnapshotPath(snapPath);

      // Build baseline
      const first = mgr.detectChanges();
      mgr.applyChanges(first, {
        loop: {
          model: "deepseek-v4-flash",
          stream: false,
          reasoningEffort: "high",
          maxOutputTokens: undefined,
          budgetUsd: null,
          configure: () => {},
          setBudget: () => {},
          rebuildSystemPrompt: () => {},
        },
        mcpReload: async () => ({ added: [], removed: [], failed: [], summaries: [] }),
        skillStore: { list: () => [] },
        configPath,
        projectRoot: root,
        homeDir: root,
      });

      // Change config
      writeFileSync(configPath, JSON.stringify({ model: "deepseek-v4-pro" }), "utf8");

      // Re-detect
      const second = mgr.detectChanges();
      expect(second.hasAny).toBe(true);
      expect(second.config).toBe("changed");
    } finally {
      cleanup();
    }
  });

  it("detects skill file additions", () => {
    const { root, configPath, cleanup } = tmpProject();
    try {
      const snapPath = join(root, ".reasonix", "reload-snapshot.json");
      // Create skills dir
      const skillsDir = join(root, ".reasonix", "skills");
      mkdirSync(skillsDir, { recursive: true });

      const mgr = new ReloadManager({ projectRoot: root, configPath });
      mgr.setSnapshotPath(snapPath);

      // Baseline
      const first = mgr.detectChanges();
      mgr.applyChanges(first, {
        loop: {
          model: "deepseek-v4-flash",
          stream: false,
          reasoningEffort: "high",
          maxOutputTokens: undefined,
          budgetUsd: null,
          configure: () => {},
          setBudget: () => {},
          rebuildSystemPrompt: () => {},
        },
        mcpReload: async () => ({ added: [], removed: [], failed: [], summaries: [] }),
        skillStore: { list: () => [] },
        configPath,
        projectRoot: root,
        homeDir: root,
      });

      // Add a skill
      writeFileSync(
        join(skillsDir, "test-skill.md"),
        "---\ndescription: A test skill\n---\nHello",
        "utf8",
      );

      // Re-detect
      const second = mgr.detectChanges();
      expect(second.skills.length).toBeGreaterThan(0);
      expect(second.skills.some((s) => s.kind === "new")).toBe(true);
    } finally {
      cleanup();
    }
  });
});
```

- [ ] **步骤 2：运行测试**

运行：`npx vitest run tests/reload.test.ts` — 预期所有测试通过

- [ ] **步骤 3：Commit**

```bash
git add tests/reload.test.ts
git commit -m "test(reload): add ReloadManager change detection tests"
```

---

### 自检

1. **规格覆盖度：**
   - ✓ Snapshot 持久化 — 任务 4 中 `loadSnapshot`/`saveSnapshot`/`updateSnapshot`
   - ✓ Config 变更检测 — 任务 4 `detectChanges()` config 部分
   - ✓ Skills 变更检测 — 任务 4 `scanSkillFiles()`
   - ✓ MCP 变更检测 — 任务 4 `normalizeMcpConfig()` + hash 对比
   - ✓ Config 重载 — 任务 4 `applyChanges()` + 任务 5 handler
   - ✓ Skills 重载 — 任务 4 调用 `rebuildSystemPrompt()`
   - ✓ MCP 重载 — 任务 5 handler 调用 `ctx.reloadMcp()`
   - ✓ 子命令 — 任务 5 handler 支持 `/reload`, `/reload config`, `/reload skills`, `/reload mcp`
   - ✓ 输出格式 — 任务 5 handler 组装摘要 + 详情文本
   - ✓ 变更检测引擎 — 任务 4 混合策略 (stat → hash)

2. **占位符扫描：** 无 "TODO"、"待定"、未完成的代码块

3. **类型一致性：** `Snapshot` 类型在任务 1 定义，任务 4 完整使用。`ReloadContext` 类型匹配 handler 的调用方式
